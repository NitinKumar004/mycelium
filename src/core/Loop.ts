// Fixed-timestep loop with an accumulator (§6). The simulation ALWAYS advances
// in 1/60s steps regardless of display refresh rate — feeding raw deltaTime into
// the agent update changes the character of the structure with framerate and
// makes states non-reproducible. Max 3 substeps per frame so a stall can't spiral.

const STEP = 1 / 60;
const MAX_SUBSTEPS = 3;

export interface FrameStats {
  fps: number;
  frameMs: number; // rolling median CPU frame time
  substeps: number;
}

type StepFn = (dt: number) => void;
type RenderFn = (alpha: number) => void;

export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private raf = 0;

  // Rolling window of frame times for a MEDIAN (not mean) — one GC hitch must
  // not skew the adaptive-quality decision.
  private readonly window = new Float32Array(60);
  private windowPos = 0;
  private readonly sortScratch = new Float32Array(60);

  readonly stats: FrameStats = { fps: 60, frameMs: 16.7, substeps: 1 };

  constructor(private step: StepFn, private render: RenderFn) {
    // Seed the window with 16.7ms so the rolling median reports ~60fps from the
    // first frame instead of 0 while the buffer fills.
    this.window.fill(1000 / 60);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  // Arrow so `this` stays bound with zero per-frame closure allocation.
  private tick = (now: number): void => {
    if (!this.running) return;
    const frameSeconds = Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.accumulator += frameSeconds;
    let substeps = 0;
    while (this.accumulator >= STEP && substeps < MAX_SUBSTEPS) {
      this.step(STEP);
      this.accumulator -= STEP;
      substeps++;
    }
    // If we blew the substep budget, drop the backlog rather than spiral.
    if (this.accumulator > STEP) this.accumulator = 0;

    const alpha = this.accumulator / STEP; // render interpolation factor
    this.render(alpha);

    this.recordFrame(frameSeconds * 1000, substeps);
    this.raf = requestAnimationFrame(this.tick);
  };

  private recordFrame(ms: number, substeps: number): void {
    this.window[this.windowPos] = ms;
    this.windowPos = (this.windowPos + 1) % this.window.length;

    this.sortScratch.set(this.window);
    this.sortScratch.sort();
    const median = this.sortScratch[this.sortScratch.length >> 1] ?? ms;

    this.stats.frameMs = median;
    this.stats.fps = median > 0 ? 1000 / median : 0;
    this.stats.substeps = substeps;
  }
}
