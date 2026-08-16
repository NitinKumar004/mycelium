import type { Simulation, SimFrameContext, GpuTimings } from '../Simulation';
import { halfLifeToDecay, activeSpecies } from '../Simulation';
import type { Store } from '../../core/Store';
import type { SeedMode } from '../../core/params';
import { writePalette } from '../../render/palette';

import quadVert from '../../shaders/glsl/quad.vert';
import agentFrag from '../../shaders/glsl/agent.frag';
import seedFrag from '../../shaders/glsl/seed.frag';
import depositVert from '../../shaders/glsl/deposit.vert';
import depositFrag from '../../shaders/glsl/deposit.frag';
import diffuseFrag from '../../shaders/glsl/diffuse.frag';
import compositeFrag from '../../shaders/glsl/composite.frag';
import bloomFrag from '../../shaders/glsl/bloom.frag';
import postFrag from '../../shaders/glsl/post.frag';

const SEED_MODE_INDEX: Record<SeedMode, number> = {
  'random-uniform': 0,
  'center-disc-outward': 1,
  'ring-inward': 2,
  'two-clusters': 3,
  'image-mask': 4,
};

interface Tex {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

// The WebGL2 fallback. Same simulation, texture-ping-pong instead of storage
// buffers. Post is a lighter (single-pyramid) approximation of the WebGPU
// path's dual-Kawase bloom — see README "known-lean".
export class WebGL2Simulation implements Simulation {
  readonly backend = 'webgl2' as const;
  readonly adapterInfo: string;
  readonly timings: GpuTimings = {};

  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private palette = new Float32Array(16);

  private progAgent: WebGLProgram;
  private progSeed: WebGLProgram;
  private progDeposit: WebGLProgram;
  private progDiffuse: WebGLProgram;
  private progComposite: WebGLProgram;
  private progBloom: WebGLProgram;
  private progPost: WebGLProgram;

  private agentA!: Tex;
  private agentB!: Tex;
  private trailA!: Tex;
  private trailB!: Tex;
  private hdr!: Tex;
  private bloomA!: Tex;
  private bloomB!: Tex;

  private agentTexSize = 1024;
  private frame = 0;
  private width = 1;
  private height = 1;
  private maskTex: WebGLTexture | null = null;
  private hasImage = 0;

  constructor(canvas: HTMLCanvasElement, adapterInfo: string, private store: Store) {
    this.canvas = canvas;
    this.adapterInfo = adapterInfo;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      console.warn('[webgl2] EXT_color_buffer_float missing — float targets may fail.');
    }
    gl.getExtension('OES_texture_float_linear');

    writePalette(this.palette);

    this.progAgent = this.program(quadVert, agentFrag);
    this.progSeed = this.program(quadVert, seedFrag);
    this.progDeposit = this.program(depositVert, depositFrag);
    this.progDiffuse = this.program(quadVert, diffuseFrag);
    this.progComposite = this.program(quadVert, compositeFrag);
    this.progBloom = this.program(quadVert, bloomFrag);
    this.progPost = this.program(quadVert, postFrag);

    this.rebuild();
  }

  // ---- GL helpers -----------------------------------------------------------
  private program(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`shader compile: ${gl.getShaderInfoLog(sh)}\n${src.slice(0, 400)}`);
      }
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`program link: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }

  private makeTex(w: number, h: number, internal: number, format: number, type: number, filter: number): Tex {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    // Torus wrap for the trail; clamp is fine elsewhere but repeat is harmless.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  private free(t?: Tex): void {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  // ---- Allocation -----------------------------------------------------------
  rebuild(): void {
    const gl = this.gl;
    const p = this.store.params;
    this.agentTexSize = Math.max(32, Math.ceil(Math.sqrt(p.agentCount)));
    const res = p.simResolution;

    const RGBA16F = gl.RGBA16F, RGBA32F = gl.RGBA32F, RGBA = gl.RGBA;
    this.free(this.agentA); this.free(this.agentB);
    this.agentA = this.makeTex(this.agentTexSize, this.agentTexSize, RGBA32F, RGBA, gl.FLOAT, gl.NEAREST);
    this.agentB = this.makeTex(this.agentTexSize, this.agentTexSize, RGBA32F, RGBA, gl.FLOAT, gl.NEAREST);

    this.free(this.trailA); this.free(this.trailB);
    this.trailA = this.makeTex(res, res, RGBA16F, RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.trailB = this.makeTex(res, res, RGBA16F, RGBA, gl.HALF_FLOAT, gl.LINEAR);

    this.allocRenderTargets(this.width, this.height);
    this.reseed();
  }

  private allocRenderTargets(w: number, h: number): void {
    const gl = this.gl;
    this.free(this.hdr); this.free(this.bloomA); this.free(this.bloomB);
    this.hdr = this.makeTex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    this.bloomA = this.makeTex(bw, bh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.bloomB = this.makeTex(bw, bh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  }

  resize(width: number, height: number, _dpr: number): void {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.allocRenderTargets(this.width, this.height);
  }

  // ---- Draw helpers ---------------------------------------------------------
  private fullscreen(prog: WebGLProgram, target: Tex | null): void {
    const gl = this.gl;
    gl.useProgram(prog);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private u(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(prog, name);
  }

  private bindTex(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  // ---- Seeding --------------------------------------------------------------
  reseed(): void {
    const gl = this.gl;
    const p = this.store.params;
    gl.disable(gl.BLEND);
    gl.useProgram(this.progSeed);
    gl.uniform1f(this.u(this.progSeed, 'uRes'), p.simResolution);
    gl.uniform1i(this.u(this.progSeed, 'uMode'), SEED_MODE_INDEX[p.seedMode]);
    gl.uniform1i(this.u(this.progSeed, 'uSpeciesCount'), activeSpecies(p));
    gl.uniform1ui(this.u(this.progSeed, 'uSeed'), (this.frame * 2654435761) >>> 0 || 1);
    gl.uniform1i(this.u(this.progSeed, 'uAgentTexSize'), this.agentTexSize);
    gl.uniform1i(this.u(this.progSeed, 'uHasImage'), this.hasImage);
    if (this.maskTex) { this.bindTex(0, this.maskTex); gl.uniform1i(this.u(this.progSeed, 'uMask'), 0); }
    this.fullscreen(this.progSeed, this.agentA);

    // Clear trails.
    for (const t of [this.trailA, this.trailB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.w, t.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- Step -----------------------------------------------------------------
  step(_dt: number): void {
    this.frame++;
    const gl = this.gl;
    const p = this.store.params;
    gl.disable(gl.BLEND);

    // 1. Agent update: agentA -> agentB, sampling trailA.
    const pa = this.progAgent;
    gl.useProgram(pa);
    this.bindTex(0, this.agentA.tex); gl.uniform1i(this.u(pa, 'uAgents'), 0);
    this.bindTex(1, this.trailA.tex); gl.uniform1i(this.u(pa, 'uTrail'), 1);
    gl.uniform1f(this.u(pa, 'uRes'), p.simResolution);
    gl.uniform1f(this.u(pa, 'uMove'), p.moveSpeed);
    gl.uniform1f(this.u(pa, 'uTurn'), p.turnSpeed);
    gl.uniform1f(this.u(pa, 'uSensorAngle'), p.sensorAngle);
    gl.uniform1f(this.u(pa, 'uSensorDist'), p.sensorDistance);
    gl.uniform1f(this.u(pa, 'uSensorSize'), p.sensorSize);
    gl.uniform1i(this.u(pa, 'uBoundary'), p.boundary === 'wrap' ? 0 : p.boundary === 'bounce' ? 1 : 2);
    gl.uniform1ui(this.u(pa, 'uFrame'), this.frame >>> 0);
    gl.uniform1i(this.u(pa, 'uAgentTexSize'), this.agentTexSize);
    gl.uniformMatrix4fv(this.u(pa, 'uInteraction'), false, p.interaction);
    this.fullscreen(pa, this.agentB);
    [this.agentA, this.agentB] = [this.agentB, this.agentA];

    // 2. Deposit updated agents additively into trailA.
    const pd = this.progDeposit;
    gl.useProgram(pd);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailA.fbo);
    gl.viewport(0, 0, this.trailA.w, this.trailA.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(gl.FUNC_ADD);
    this.bindTex(0, this.agentA.tex); gl.uniform1i(this.u(pd, 'uAgents'), 0);
    gl.uniform1i(this.u(pd, 'uAgentTexSize'), this.agentTexSize);
    gl.uniform1f(this.u(pd, 'uRes'), p.simResolution);
    gl.uniform1f(this.u(pd, 'uDeposit'), p.depositAmount);
    gl.drawArrays(gl.POINTS, 0, this.agentTexSize * this.agentTexSize);
    gl.disable(gl.BLEND);

    // 3. Diffuse + Decay: trailA -> trailB, then swap.
    const pf = this.progDiffuse;
    gl.useProgram(pf);
    this.bindTex(0, this.trailA.tex); gl.uniform1i(this.u(pf, 'uTrail'), 0);
    gl.uniform1f(this.u(pf, 'uRes'), p.simResolution);
    gl.uniform1f(this.u(pf, 'uDiffuse'), p.diffuseRate);
    gl.uniform1f(this.u(pf, 'uDecay'), halfLifeToDecay(p.decayHalfLife));
    this.fullscreen(pf, this.trailB);
    [this.trailA, this.trailB] = [this.trailB, this.trailA];
  }

  // ---- Render ---------------------------------------------------------------
  render(ctx: SimFrameContext): void {
    const gl = this.gl;
    const p = this.store.params;
    gl.disable(gl.BLEND);

    // Composite trailA (current) -> HDR.
    const pc = this.progComposite;
    gl.useProgram(pc);
    this.bindTex(0, this.trailA.tex); gl.uniform1i(this.u(pc, 'uTrail'), 0);
    gl.uniform1f(this.u(pc, 'uAspect'), this.width / this.height);
    gl.uniform1f(this.u(pc, 'uZoom'), p.zoom);
    gl.uniform1f(this.u(pc, 'uPanX'), p.panX);
    gl.uniform1f(this.u(pc, 'uPanY'), p.panY);
    gl.uniform1f(this.u(pc, 'uExposure'), Math.pow(2, p.exposure));
    gl.uniform1i(this.u(pc, 'uSpeciesCount'), activeSpecies(p));
    gl.uniform4fv(this.u(pc, 'uColors'), this.palette);
    this.fullscreen(pc, this.hdr);

    // Bloom: prefilter+horizontal -> bloomA, vertical -> bloomB.
    const pb = this.progBloom;
    gl.useProgram(pb);
    gl.uniform1f(this.u(pb, 'uThreshold'), p.bloomThreshold);
    this.bindTex(0, this.hdr.tex); gl.uniform1i(this.u(pb, 'uSrc'), 0);
    gl.uniform1i(this.u(pb, 'uPrefilter'), 1);
    gl.uniform2f(this.u(pb, 'uDir'), 1 / this.bloomA.w, 0);
    this.fullscreen(pb, this.bloomA);
    this.bindTex(0, this.bloomA.tex); gl.uniform1i(this.u(pb, 'uSrc'), 0);
    gl.uniform1i(this.u(pb, 'uPrefilter'), 0);
    gl.uniform2f(this.u(pb, 'uDir'), 0, 1 / this.bloomB.h);
    this.fullscreen(pb, this.bloomB);

    // Post -> canvas.
    const pp = this.progPost;
    gl.useProgram(pp);
    this.bindTex(0, this.hdr.tex); gl.uniform1i(this.u(pp, 'uHDR'), 0);
    this.bindTex(1, this.bloomB.tex); gl.uniform1i(this.u(pp, 'uBloom'), 1);
    gl.uniform1f(this.u(pp, 'uResolution'), p.simResolution);
    gl.uniform1f(this.u(pp, 'uTime'), ctx.time);
    gl.uniform1f(this.u(pp, 'uBloomIntensity'), p.bloomIntensity);
    gl.uniform1f(this.u(pp, 'uContrast'), p.contrast);
    gl.uniform1f(this.u(pp, 'uSaturation'), p.saturation);
    gl.uniform1f(this.u(pp, 'uGrain'), p.grain);
    gl.uniform1f(this.u(pp, 'uVignette'), p.vignette);
    gl.uniform1f(this.u(pp, 'uAberration'), p.aberration);
    gl.uniform1i(this.u(pp, 'uTonemap'), p.tonemap === 'agx' ? 0 : 1);
    this.fullscreen(pp, null);
  }

  brush(): void {
    // Trail-field brush is a WebGPU-first feature; the WebGL2 fallback ships
    // without it (README "known-lean").
  }

  setSeedImage(image: ImageBitmap | null): void {
    const gl = this.gl;
    if (!image) { this.hasImage = 0; return; }
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    this.maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.hasImage = 1;
  }

  async capturePNG(_scale: number): Promise<Blob> {
    // Render one live frame, then read the canvas. (Tiled super-res is a
    // WebGPU-path feature; WebGL2 exports at canvas resolution.)
    return await new Promise<Blob>((res, rej) => {
      this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png');
    });
  }

  dispose(): void {
    for (const t of [this.agentA, this.agentB, this.trailA, this.trailB, this.hdr, this.bloomA, this.bloomB]) this.free(t);
    if (this.maskTex) this.gl.deleteTexture(this.maskTex);
  }
}
