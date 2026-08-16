import type { Simulation, SimFrameContext, GpuTimings } from '../Simulation';
import { halfLifeToDecay, activeSpecies } from '../Simulation';
import type { Store } from '../../core/Store';
import type { Params, SeedMode } from '../../core/params';
import { writePalette } from '../../render/palette';

import commonAgent from '../../shaders/wgsl/agent_update.wgsl';
import depositSrc from '../../shaders/wgsl/deposit.wgsl';
import diffuseSrc from '../../shaders/wgsl/diffuse.wgsl';
import fullscreenSrc from '../../shaders/wgsl/fullscreen.wgsl';
import compositeSrc from '../../shaders/wgsl/composite.wgsl';
import bloomSrc from '../../shaders/wgsl/bloom.wgsl';
import postSrc from '../../shaders/wgsl/post.wgsl';
import seedSrc from '../../shaders/wgsl/seed.wgsl';
import brushSrc from '../../shaders/wgsl/brush.wgsl';

const TRAIL_FORMAT: GPUTextureFormat = 'rgba16float';
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
const BLOOM_MIPS = 5;
const SEED_MODE_INDEX: Record<SeedMode, number> = {
  'random-uniform': 0,
  'center-disc-outward': 1,
  'ring-inward': 2,
  'two-clusters': 3,
  'image-mask': 4,
};

export class WebGPUSimulation implements Simulation {
  readonly backend = 'webgpu' as const;
  readonly adapterInfo: string;
  readonly timings: GpuTimings = {};

  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private canvasFormat: GPUTextureFormat;
  private canvas: HTMLCanvasElement;

  // Uniforms (packed CPU-side, uploaded each frame).
  private simUBO: GPUBuffer;
  private renderUBO: GPUBuffer;
  private seedUBO: GPUBuffer;
  private simData = new Float32Array(32);
  private simU32 = new Uint32Array(this.simData.buffer);
  private renderData = new Float32Array(32);

  // Agent + trail state.
  private agentBuf!: GPUBuffer;
  private trail: GPUTexture[] = [];
  private trailView: GPUTextureView[] = [];
  private cur = 0;

  // Render targets.
  private hdr!: GPUTexture;
  private hdrView!: GPUTextureView;
  private bloom: GPUTexture[] = [];
  private bloomView: GPUTextureView[] = [];

  // Samplers.
  private repeatSampler: GPUSampler;
  private clampSampler: GPUSampler;

  // Image-mask.
  private maskTex: GPUTexture;
  private hasImage = 0;

  // Pipelines.
  private seedPipe!: GPUComputePipeline;
  private agentPipe!: GPUComputePipeline;
  private depositPipe!: GPURenderPipeline;
  private diffusePipe!: GPURenderPipeline;
  private compositePipe!: GPURenderPipeline;
  private prefilterPipe!: GPURenderPipeline;
  private downPipe!: GPURenderPipeline;
  private upPipe!: GPURenderPipeline;
  private postPipe!: GPURenderPipeline;
  private brushPipe!: GPURenderPipeline;
  private bloomBGL!: GPUBindGroupLayout;
  private brushUBO: GPUBuffer;
  private brushData = new Float32Array(8);

  private frame = 0;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice, adapterInfo: string, private store: Store) {
    this.canvas = canvas;
    this.device = device;
    this.adapterInfo = adapterInfo;

    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('WebGPU canvas context unavailable');
    this.ctx = ctx;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: this.canvasFormat, alphaMode: 'opaque' });

    this.simUBO = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.renderUBO = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.seedUBO = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.brushUBO = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.repeatSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
    this.clampSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

    // 1x1 placeholder mask until an image is dropped.
    this.maskTex = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: this.maskTex }, new Uint8Array([0, 0, 0, 255]), {}, [1, 1]);

    // Surface WebGPU validation errors on-page (they otherwise only hit the
    // console). Capped so a per-frame error can't flood the DOM.
    device.addEventListener('uncapturederror', (ev) => {
      const e = (ev as GPUUncapturedErrorEvent).error;
      if (this.errCount >= 24) return;
      this.errCount++;
      const box = document.getElementById('booterr');
      if (box) {
        box.style.display = 'block';
        box.textContent += `● WebGPU validation:\n${e.message}\n\n`;
      }
      console.error('[webgpu]', e.message);
    });

    this.buildPipelines();
    this.rebuild();
  }
  private errCount = 0;

  // ---- Pipeline construction ------------------------------------------------
  private module(code: string): GPUShaderModule {
    return this.device.createShaderModule({ code });
  }

  private buildPipelines(): void {
    const d = this.device;
    const fsMod = this.module(fullscreenSrc);

    this.seedPipe = d.createComputePipeline({ layout: 'auto', compute: { module: this.module(seedSrc), entryPoint: 'main' } });
    this.agentPipe = d.createComputePipeline({ layout: 'auto', compute: { module: this.module(commonAgent), entryPoint: 'main' } });

    const additive: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };
    const depMod = this.module(depositSrc);
    this.depositPipe = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: depMod, entryPoint: 'vs' },
      fragment: { module: depMod, entryPoint: 'fs', targets: [{ format: TRAIL_FORMAT, blend: additive }] },
      primitive: { topology: 'point-list' },
    });

    const fsTarget = (format: GPUTextureFormat, mod: GPUShaderModule, entry: string): GPURenderPipeline =>
      d.createRenderPipeline({
        layout: 'auto',
        vertex: { module: fsMod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: entry, targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });

    this.diffusePipe = fsTarget(TRAIL_FORMAT, this.module(diffuseSrc), 'fs');
    this.compositePipe = fsTarget(HDR_FORMAT, this.module(compositeSrc), 'fs');

    // Cursor brush: a fullscreen stamp additively blended into the trail field.
    const brushMod = this.module(brushSrc);
    this.brushPipe = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: fsMod, entryPoint: 'vs' },
      fragment: { module: brushMod, entryPoint: 'fs', targets: [{ format: TRAIL_FORMAT, blend: additive }] },
      primitive: { topology: 'triangle-list' },
    });

    // Explicit layout for the bloom passes. The `down`/`up` entry points never
    // read the R uniform, so `layout: 'auto'` would drop binding 0 and reject a
    // bind group that provides it. An explicit layout keeps binding 0 present
    // for all three passes (an unused uniform binding is legal).
    this.bloomBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const bloomPL = d.createPipelineLayout({ bindGroupLayouts: [this.bloomBGL] });
    const bloomMod = this.module(bloomSrc);
    const bloomPipe = (entry: string, blend?: GPUBlendState): GPURenderPipeline =>
      d.createRenderPipeline({
        layout: bloomPL,
        vertex: { module: fsMod, entryPoint: 'vs' },
        fragment: { module: bloomMod, entryPoint: entry, targets: [blend ? { format: HDR_FORMAT, blend } : { format: HDR_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      });
    this.prefilterPipe = bloomPipe('prefilter');
    this.downPipe = bloomPipe('down');
    // The upsample chain draws with loadOp:'load' to ACCUMULATE onto the lower
    // mip; without additive blend it would overwrite and discard all the
    // downsampled detail, so the up pipeline must blend additively.
    this.upPipe = bloomPipe('up', additive);
    this.postPipe = fsTarget(this.canvasFormat, this.module(postSrc), 'fs');
  }

  // ---- Resource (re)allocation ---------------------------------------------
  rebuild(): void {
    const p = this.store.params;
    const res = p.simResolution;

    // Agent buffer: 16 bytes each. Round count up to a multiple of 64.
    const count = Math.max(64, p.agentCount | 0);
    this.agentBuf?.destroy?.();
    this.agentBuf = this.device.createBuffer({
      size: count * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Trail ping-pong.
    for (const t of this.trail) t.destroy();
    this.trail = [];
    this.trailView = [];
    for (let i = 0; i < 2; i++) {
      const tex = this.device.createTexture({
        size: [res, res],
        format: TRAIL_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      });
      this.trail.push(tex);
      this.trailView.push(tex.createView());
    }
    this.cur = 0;

    this.allocRenderTargets(this.width, this.height);
    this.reseed();
  }

  private allocRenderTargets(w: number, h: number): void {
    this.hdr?.destroy();
    this.hdr = this.device.createTexture({
      size: [w, h],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.hdrView = this.hdr.createView();

    for (const t of this.bloom) t.destroy();
    this.bloom = [];
    this.bloomView = [];
    let mw = Math.max(1, w >> 1);
    let mh = Math.max(1, h >> 1);
    for (let i = 0; i < BLOOM_MIPS; i++) {
      const tex = this.device.createTexture({
        size: [Math.max(1, mw), Math.max(1, mh)],
        format: HDR_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.bloom.push(tex);
      this.bloomView.push(tex.createView());
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
    }
  }

  resize(width: number, height: number, _dpr: number): void {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.allocRenderTargets(this.width, this.height);
  }

  // ---- Seeding --------------------------------------------------------------
  reseed(): void {
    const p = this.store.params;
    const seed = new Uint32Array(8);
    const f = new Float32Array(seed.buffer);
    f[0] = p.simResolution;
    seed[1] = p.agentCount | 0;
    seed[2] = SEED_MODE_INDEX[p.seedMode];
    seed[3] = activeSpecies(p);
    seed[4] = (this.frame * 2654435761) >>> 0 || 1;
    seed[5] = this.hasImage;
    this.device.queue.writeBuffer(this.seedUBO, 0, seed);

    const bg = this.device.createBindGroup({
      layout: this.seedPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.seedUBO } },
        { binding: 1, resource: { buffer: this.agentBuf } },
        { binding: 2, resource: this.maskTex.createView() },
        { binding: 3, resource: this.clampSampler },
      ],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.seedPipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil((p.agentCount | 0) / 256));
    pass.end();
    // Clear both trail textures so a reseed starts from a blank field.
    this.device.queue.submit([enc.finish()]);
    this.clearTrails();
  }

  private clearTrails(): void {
    for (let i = 0; i < 2; i++) {
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.trailView[i]!, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }
  }

  // ---- Uniform packing ------------------------------------------------------
  private packSim(dt: number): void {
    const p = this.store.params;
    const s = this.simData;
    const u = this.simU32;
    s[0] = p.simResolution;
    u[1] = p.agentCount | 0;
    u[2] = this.frame >>> 0;
    u[3] = activeSpecies(p);
    s[4] = p.moveSpeed;
    s[5] = p.turnSpeed;
    s[6] = p.sensorAngle;
    s[7] = p.sensorDistance;
    s[8] = p.sensorSize;
    s[9] = p.depositAmount;
    s[10] = halfLifeToDecay(p.decayHalfLife);
    s[11] = p.diffuseRate;
    u[12] = p.boundary === 'wrap' ? 0 : p.boundary === 'bounce' ? 1 : 2;
    s[13] = dt;
    s.set(p.interaction, 16);
    this.device.queue.writeBuffer(this.simUBO, 0, this.simData);
  }

  private packRender(p: Params, time: number, ambient: number): void {
    const r = this.renderData;
    r[0] = p.simResolution;
    r[1] = this.width / this.height;
    r[2] = p.zoom;
    r[3] = time;
    r[4] = p.panX + ambient;
    r[5] = p.panY;
    r[6] = Math.pow(2, p.exposure);
    r[7] = activeSpecies(p);
    r[8] = p.bloomThreshold;
    r[9] = p.bloomIntensity;
    r[10] = p.contrast;
    r[11] = p.saturation;
    r[12] = p.grain;
    r[13] = p.vignette;
    r[14] = p.aberration;
    r[15] = p.tonemap === 'agx' ? 0 : 1;
    writePalette(r.subarray(16) as Float32Array);
    this.device.queue.writeBuffer(this.renderUBO, 0, this.renderData);
  }

  // ---- Simulation step ------------------------------------------------------
  step(dt: number): void {
    this.frame++;
    this.packSim(dt);
    const p = this.store.params;
    const enc = this.device.createCommandEncoder();

    // 1. Sense + Steer + Move (compute), sampling the current trail.
    const agentBG = this.device.createBindGroup({
      layout: this.agentPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUBO } },
        { binding: 1, resource: { buffer: this.agentBuf } },
        { binding: 2, resource: this.trailView[this.cur]! },
        { binding: 3, resource: this.repeatSampler },
      ],
    });
    const cp = enc.beginComputePass();
    cp.setPipeline(this.agentPipe);
    cp.setBindGroup(0, agentBG);
    cp.dispatchWorkgroups(Math.ceil((p.agentCount | 0) / 256));
    cp.end();

    // 2. Deposit additively into the current trail.
    const depBG = this.device.createBindGroup({
      layout: this.depositPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUBO } },
        { binding: 1, resource: { buffer: this.agentBuf } },
      ],
    });
    const dp = enc.beginRenderPass({
      colorAttachments: [{ view: this.trailView[this.cur]!, loadOp: 'load', storeOp: 'store' }],
    });
    dp.setPipeline(this.depositPipe);
    dp.setBindGroup(0, depBG);
    dp.draw(p.agentCount | 0);
    dp.end();

    // 3. Diffuse + Decay: current -> other, then swap.
    const other = 1 - this.cur;
    const difBG = this.device.createBindGroup({
      layout: this.diffusePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUBO } },
        { binding: 1, resource: this.trailView[this.cur]! },
        { binding: 2, resource: this.repeatSampler },
      ],
    });
    const df = enc.beginRenderPass({
      colorAttachments: [{ view: this.trailView[other]!, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
    });
    df.setPipeline(this.diffusePipe);
    df.setBindGroup(0, difBG);
    df.draw(3);
    df.end();

    this.device.queue.submit([enc.finish()]);
    this.cur = other;
  }

  // ---- Render + Post --------------------------------------------------------
  render(ctx: SimFrameContext): void {
    const p = this.store.params;
    this.packRender(p, ctx.time, ctx.reducedMotion ? 0 : this.storeAmbient());
    this.renderInto(this.ctx.getCurrentTexture().createView(), this.hdrView, this.bloomView, this.width, this.height);
  }

  private storeAmbient(): number {
    return 0; // ambient drift folded via Camera into panX before render if desired
  }

  private drawFS(enc: GPUCommandEncoder, pipe: GPURenderPipeline, target: GPUTextureView, bg: GPUBindGroup, clear = true): void {
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: clear ? 'clear' : 'load', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }

  private renderInto(canvasView: GPUTextureView, hdrView: GPUTextureView, bloomViews: GPUTextureView[], _w: number, _h: number): void {
    const enc = this.device.createCommandEncoder();

    // Composite trail (current) -> HDR.
    const compBG = this.device.createBindGroup({
      layout: this.compositePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUBO } },
        { binding: 1, resource: this.trailView[this.cur]! },
        { binding: 2, resource: this.repeatSampler },
      ],
    });
    this.drawFS(enc, this.compositePipe, hdrView, compBG);

    // Bloom prefilter HDR -> mip0, then downsample chain.
    const mkBloomBG = (_pipe: GPURenderPipeline, src: GPUTextureView): GPUBindGroup =>
      this.device.createBindGroup({
        layout: this.bloomBGL,
        entries: [
          { binding: 0, resource: { buffer: this.renderUBO } },
          { binding: 1, resource: src },
          { binding: 2, resource: this.clampSampler },
        ],
      });

    this.drawFS(enc, this.prefilterPipe, bloomViews[0]!, mkBloomBG(this.prefilterPipe, hdrView));
    for (let i = 1; i < bloomViews.length; i++) {
      this.drawFS(enc, this.downPipe, bloomViews[i]!, mkBloomBG(this.downPipe, bloomViews[i - 1]!));
    }
    // Upsample chain, additively back up the pyramid.
    for (let i = bloomViews.length - 2; i >= 0; i--) {
      this.drawFS(enc, this.upPipe, bloomViews[i]!, mkBloomBG(this.upPipe, bloomViews[i + 1]!), false);
    }

    // Final post -> canvas.
    const postBG = this.device.createBindGroup({
      layout: this.postPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUBO } },
        { binding: 1, resource: hdrView },
        { binding: 2, resource: bloomViews[0]! },
        { binding: 3, resource: this.clampSampler },
      ],
    });
    this.drawFS(enc, this.postPipe, canvasView, postBG);

    this.device.queue.submit([enc.finish()]);
  }

  // ---- Brush / image mask ---------------------------------------------------
  // Inject into the trail field at trail-space UV (x,y). +strength paints,
  // -strength erases. Runs a single additive fullscreen stamp into the current
  // trail texture (§11 — cursor forces act on the field, never teleport agents).
  brush(x: number, y: number, radius: number, strength: number, species: number): void {
    this.brushData[0] = x;
    this.brushData[1] = y;
    this.brushData[2] = Math.max(0.002, radius);
    this.brushData[3] = strength;
    this.brushData[4] = Math.min(3, Math.max(0, species | 0));
    this.device.queue.writeBuffer(this.brushUBO, 0, this.brushData);

    const bg = this.device.createBindGroup({
      layout: this.brushPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.brushUBO } }],
    });
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.trailView[this.cur]!, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.brushPipe);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  async setSeedImage(image: ImageBitmap | null): Promise<void> {
    if (!image) {
      this.hasImage = 0;
      return;
    }
    this.maskTex.destroy();
    this.maskTex = this.device.createTexture({
      size: [image.width, image.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: image }, { texture: this.maskTex }, [image.width, image.height]);
    this.hasImage = 1;
  }

  // ---- PNG capture ----------------------------------------------------------
  async capturePNG(scale: number): Promise<Blob> {
    // Clamp by a single factor so a non-square canvas keeps its framing when
    // one dimension would exceed the 8192 texture limit.
    const factor = Math.min(scale, 8192 / this.width, 8192 / this.height);
    const w = Math.max(1, Math.round(this.width * factor));
    const h = Math.max(1, Math.round(this.height * factor));

    // Offscreen targets at capture size (does not disturb live trail state).
    const hdr = this.device.createTexture({ size: [w, h], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    const bloom: GPUTexture[] = [];
    let mw = w >> 1, mh = h >> 1;
    for (let i = 0; i < BLOOM_MIPS; i++) {
      bloom.push(this.device.createTexture({ size: [Math.max(1, mw), Math.max(1, mh)], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }));
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    }
    const out = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });

    // Temporarily override aspect in the render uniform for the capture size.
    const savedAspect = this.renderData[1] ?? 1;
    this.renderData[1] = w / h;
    this.device.queue.writeBuffer(this.renderUBO, 0, this.renderData);

    // Reuse renderInto but targeting the capture chain. It reads canvasFormat
    // pipeline though; the post pipeline targets canvasFormat, not rgba8unorm,
    // so we run a dedicated encoder using an rgba8 post pipeline built on demand.
    const postRGBA = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.module(fullscreenSrc), entryPoint: 'vs' },
      fragment: { module: this.module(postSrc), entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.renderCaptureChain(hdr.createView(), bloom.map((b) => b.createView()), out.createView(), postRGBA);

    // Read back.
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
    const readBuf = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: out }, { buffer: readBuf, bytesPerRow, rowsPerImage: h }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(readBuf.getMappedRange());
    const tight = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      tight.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
    }
    readBuf.unmap();

    // Restore live aspect.
    this.renderData[1] = savedAspect;
    this.device.queue.writeBuffer(this.renderUBO, 0, this.renderData);

    for (const b of bloom) b.destroy();
    hdr.destroy(); out.destroy(); readBuf.destroy();

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c2d = cv.getContext('2d')!;
    c2d.putImageData(new ImageData(tight, w, h), 0, 0);
    return await new Promise<Blob>((res) => cv.toBlob((b) => res(b!), 'image/png'));
  }

  private renderCaptureChain(hdrView: GPUTextureView, bloomViews: GPUTextureView[], outView: GPUTextureView, postPipe: GPURenderPipeline): void {
    const enc = this.device.createCommandEncoder();
    const compBG = this.device.createBindGroup({
      layout: this.compositePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUBO } },
        { binding: 1, resource: this.trailView[this.cur]! },
        { binding: 2, resource: this.repeatSampler },
      ],
    });
    this.drawFS(enc, this.compositePipe, hdrView, compBG);
    const mkBG = (_pipe: GPURenderPipeline, src: GPUTextureView) =>
      this.device.createBindGroup({ layout: this.bloomBGL, entries: [
        { binding: 0, resource: { buffer: this.renderUBO } }, { binding: 1, resource: src }, { binding: 2, resource: this.clampSampler } ] });
    this.drawFS(enc, this.prefilterPipe, bloomViews[0]!, mkBG(this.prefilterPipe, hdrView));
    for (let i = 1; i < bloomViews.length; i++) this.drawFS(enc, this.downPipe, bloomViews[i]!, mkBG(this.downPipe, bloomViews[i - 1]!));
    for (let i = bloomViews.length - 2; i >= 0; i--) this.drawFS(enc, this.upPipe, bloomViews[i]!, mkBG(this.upPipe, bloomViews[i + 1]!), false);
    const postBG = this.device.createBindGroup({ layout: postPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.renderUBO } }, { binding: 1, resource: hdrView }, { binding: 2, resource: bloomViews[0]! }, { binding: 3, resource: this.clampSampler } ] });
    this.drawFS(enc, postPipe, outView, postBG);
    this.device.queue.submit([enc.finish()]);
  }

  dispose(): void {
    for (const t of this.trail) t.destroy();
    for (const b of this.bloom) b.destroy();
    this.hdr?.destroy();
    this.agentBuf?.destroy();
    this.maskTex?.destroy();
    this.simUBO.destroy();
    this.renderUBO.destroy();
    this.seedUBO.destroy();
    this.brushUBO.destroy();
    this.ctx.unconfigure();
  }
}
