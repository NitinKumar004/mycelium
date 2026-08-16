import './ui/styles.css';
import { Store } from './core/Store';
import { Loop } from './core/Loop';
import { detectCapability } from './core/capability';
import type { Simulation } from './sim/Simulation';
import { WebGPUSimulation } from './sim/webgpu/WebGPUSimulation';
import { WebGL2Simulation } from './sim/webgl2/WebGL2Simulation';
import { Camera } from './render/Camera';
import { Panel, toast } from './ui/Panel';
import type { PanelActions } from './ui/Panel';
import { presetByName } from './presets/presets';
import { readHash, writeHash } from './state/serialize';
import { Recorder } from './state/recorder';
import { Morph } from './state/morph';

class App {
  private store = new Store();
  private sim!: Simulation;
  private loop!: Loop;
  private camera!: Camera;
  private panel!: Panel;
  private recorder!: Recorder;
  private morph!: Morph;

  private canvas = document.getElementById('stage') as HTMLCanvasElement;
  private debugEl = document.getElementById('debug') as HTMLElement;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private debug = new URLSearchParams(location.search).has('debug');

  // Adaptive quality (§6): render-scale tier stepped by a rolling median.
  private qualityScale = 1;
  private slowFor = 0;
  private fastFor = 0;
  private lastNow = performance.now();
  private hashTimer = 0;
  private startTime = performance.now();

  async boot(): Promise<void> {
    const cap = await detectCapability(this.canvas);

    // Restore state from the URL hash before building GPU resources so sizes
    // are correct on first allocation.
    const restored = readHash();
    if (restored) this.store.replaceAll(restored);

    if (cap.backend === 'webgpu' && cap.device) {
      this.sim = new WebGPUSimulation(this.canvas, cap.device, cap.adapterInfo ?? 'WebGPU', this.store);
    } else {
      this.sim = new WebGL2Simulation(this.canvas, cap.adapterInfo ?? 'WebGL2', this.store);
    }

    this.camera = new Camera(this.store, this.canvas);
    this.camera.reducedMotion = this.reducedMotion;
    this.recorder = new Recorder(this.canvas);
    this.morph = new Morph(this.store, () => this.panel.sync());

    this.buildPanel();
    this.panel.setAdapterLine(`${cap.backend.toUpperCase()} · ${cap.adapterInfo ?? ''}`.slice(0, 46));
    // Keep the instrument off-screen behind the gate; entry stays in aesthetic mode.
    this.panel.setCollapsed(true);

    // Structural changes rebuild GPU resources; reseeds refill agent state.
    this.store.on('rebuild', () => this.sim.rebuild());
    this.store.on('reseed', () => this.sim.reseed());
    this.store.on('param', () => this.scheduleHashWrite());

    this.installResize();
    this.installKeys();

    this.loop = new Loop(
      (dt) => this.sim.step(dt),
      () => this.frame(),
    );
    this.loop.start();

    if (this.debug) this.debugEl.classList.add('on');

    // The sim now runs live behind the landing gate. Entry happens on click.
    this.runGate(`${cap.backend.toUpperCase()} · ${cap.adapterInfo ?? ''}`.slice(0, 46), !!restored);
  }

  // ---- Landing gate + aesthetic entry --------------------------------------
  private runGate(backendLine: string, hasHash: boolean): void {
    const gate = document.getElementById('gate')!;
    const enter = document.getElementById('enterbtn') as HTMLButtonElement;
    const keep = document.getElementById('keepbtn') as HTMLButtonElement;
    const backendEl = document.getElementById('gate-backend');
    if (backendEl) backendEl.textContent = backendLine;

    // A shared link lands here too; offer to keep that exact state.
    if (hasHash) keep.hidden = false;

    enter.addEventListener('click', () => this.enter(gate, false));
    keep.addEventListener('click', () => this.enter(gate, true));
    enter.focus();
  }

  private async enter(gate: HTMLElement, keepState: boolean): Promise<void> {
    gate.classList.add('gone');
    setTimeout(() => gate.remove(), 1000);

    // Reveal the instrument so the controls are right there; Tab hides it for a
    // clean full-screen view whenever you want.
    this.panel.setCollapsed(false);
    const cue = this.showAestheticCue();

    // Fresh entry loads a gorgeous 1M-agent network; a shared-link entry keeps
    // whatever state was restored. Either way, just let the network grow — no
    // risky pyrotechnics.
    if (!keepState) {
      const preset = presetByName('Classic Network')!;
      this.store.replaceAll(preset.params);
      this.store.set('seedMode', 'center-disc-outward', { reseed: true });
      this.panel.sync();
      this.sim.reseed();
    }
    setTimeout(() => cue.classList.add('show'), 700);
  }

  private showAestheticCue(): HTMLElement {
    let cue = document.getElementById('aesthetic-cue');
    if (!cue) {
      cue = document.createElement('div');
      cue.id = 'aesthetic-cue';
      cue.textContent = 'Tab — hide panel';
      document.body.append(cue);
    }
    return cue;
  }

  private buildPanel(): void {
    const actions: PanelActions = {
      reseed: () => { this.sim.reseed(); toast('Agents reseeded'); },
      copyLink: async () => {
        writeHash(this.store.params);
        try { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
        catch { toast('Link is in the address bar'); }
      },
      exportPNG: () => this.exportPNG(),
      toggleRecord: () => {
        if (this.recorder.active) { this.recorder.stop(); toast('Recording saved'); return false; }
        this.recorder.start(); toast('Recording…'); return true;
      },
      loadPreset: (name) => this.applyPreset(name, false),
      morphTo: (name) => this.applyPreset(name, true),
      dropImage: (file) => this.loadSeedImage(file),
    };
    this.panel = new Panel(this.store, actions);
  }

  private applyPreset(name: string, withMorph: boolean): void {
    const preset = presetByName(name);
    if (!preset) return;
    if (withMorph) {
      this.morph.begin(preset.params, 6);
      toast(`Morphing to ${name}`);
    } else {
      this.store.replaceAll(preset.params);
      this.panel.sync();
      toast(`${name}`);
    }
  }

  private async loadSeedImage(file: File): Promise<void> {
    const bitmap = await createImageBitmap(file);
    await this.sim.setSeedImage(bitmap);
    this.store.set('seedMode', 'image-mask', { reseed: true });
    this.sim.reseed();
    this.panel.sync();
    toast('Seeded from image');
  }

  private async exportPNG(): Promise<void> {
    toast('Rendering PNG…');
    try {
      const blob = await this.sim.capturePNG(this.sim.backend === 'webgpu' ? 2 : 1);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mycelium-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('PNG saved');
    } catch (e) {
      console.error(e);
      toast('PNG export failed');
    }
  }

  // ---- Per-frame render + housekeeping -------------------------------------
  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;

    if (this.morph.running) this.morph.update(dt);
    this.camera.update(dt, (now - this.startTime) / 1000);

    this.sim.render({
      substeps: this.loop.stats.substeps,
      time: (now - this.startTime) / 1000,
      reducedMotion: this.reducedMotion,
    });

    this.adapt(dt);
    if (this.debug) this.updateDebug();
  }

  private adapt(dt: number): void {
    const ms = this.loop.stats.frameMs;
    if (ms > 15) { this.slowFor += dt; this.fastFor = 0; }
    else if (ms < 11) { this.fastFor += dt; this.slowFor = 0; }
    else { this.slowFor = 0; this.fastFor = 0; }

    if (this.slowFor > 2 && this.qualityScale > 0.6) {
      this.qualityScale = Math.max(0.6, this.qualityScale - 0.2);
      this.slowFor = 0;
      this.applyResize();
      toast(`Quality → ${Math.round(this.qualityScale * 100)}% (holding 60fps)`);
    } else if (this.fastFor > 5 && this.qualityScale < 1) {
      this.qualityScale = Math.min(1, this.qualityScale + 0.2);
      this.fastFor = 0;
      this.applyResize();
    }
  }

  // ---- Resize ---------------------------------------------------------------
  private installResize(): void {
    const ro = new ResizeObserver(() => this.applyResize());
    ro.observe(document.body);
    this.applyResize();
  }

  private applyResize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.qualityScale;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    this.sim.resize(w, h, dpr);
  }

  // ---- Keyboard -------------------------------------------------------------
  private installKeys(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      switch (e.key) {
        case 'Tab': e.preventDefault(); this.panel.toggle(); document.getElementById('aesthetic-cue')?.classList.remove('show'); break;
        case 'r': case 'R': this.sim.reseed(); toast('Agents reseeded'); break;
        case ' ': e.preventDefault(); if (this.loopRunning) this.loop.stop(); else this.loop.start(); this.loopRunning = !this.loopRunning; break;
        case 'p': case 'P': this.exportPNG(); break;
      }
    });
    // Fade the ambient hint out after a few seconds.
    const hint = document.createElement('div');
    hint.id = 'hint';
    hint.textContent = 'drag to pan · scroll to zoom · Tab to hide panel';
    document.body.append(hint);
    setTimeout(() => { hint.style.opacity = '0'; }, 6000);
  }
  private loopRunning = true;

  private scheduleHashWrite(): void {
    clearTimeout(this.hashTimer);
    this.hashTimer = window.setTimeout(() => writeHash(this.store.params), 400);
  }

  private updateDebug(): void {
    const s = this.loop.stats;
    this.debugEl.textContent =
      `backend  ${this.sim.backend}\n` +
      `fps      ${s.fps.toFixed(0)}  (${s.frameMs.toFixed(1)}ms)\n` +
      `agents   ${(this.store.params.agentCount / 1e6).toFixed(2)}M\n` +
      `sim res  ${this.store.params.simResolution}\n` +
      `quality  ${Math.round(this.qualityScale * 100)}%\n` +
      `zoom     ${this.store.params.zoom.toFixed(2)}×`;
  }

}

// Boot.
new App().boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<div style="color:#e8e2d6;font-family:monospace;padding:40px;max-width:640px;line-height:1.6">
    <h2>Mycelium could not start</h2>
    <p>${String(err?.message ?? err)}</p>
    <p style="color:#938b7b">This build needs WebGPU (Chrome/Edge) or WebGL2 with float render targets (Safari 17+, Firefox).</p>
  </div>`;
});
