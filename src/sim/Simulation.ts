import type { Params } from '../core/params';

// One Simulation interface, two implementations. The app talks only to this.
// A Simulation owns its GPU device/context, the agent state, the trail field,
// and the full render+post pipeline, and draws directly to the canvas.

export interface SimFrameContext {
  // Simulation substeps already ran this frame (fixed timestep). This is the
  // count so the render can be told whether anything changed.
  substeps: number;
  // Wall-clock seconds since start, for temporally-coherent grain/camera drift.
  time: number;
  // Whether ambient camera drift should animate (reduced-motion freezes it).
  reducedMotion: boolean;
}

export interface GpuTimings {
  [pass: string]: number; // milliseconds
}

export interface Simulation {
  readonly backend: 'webgpu' | 'webgl2';
  readonly adapterInfo: string;

  // Advance the simulation exactly one fixed 1/60s step (sense → deposit →
  // diffuse+decay). No rendering here.
  step(dt: number): void;

  // Composite the trail field to the canvas through the full post stack.
  render(ctx: SimFrameContext): void;

  // Re-seed the agent buffers from the current params.seedMode. GPU-only work.
  reseed(): void;

  // Reallocate GPU resources after a structural change (agentCount, simResolution).
  rebuild(): void;

  // Resize the drawing surface to a new device-pixel size.
  resize(width: number, height: number, dpr: number): void;

  // Optionally paint into the trail field: cursor brush (attract/repel/erase).
  brush(x: number, y: number, radius: number, strength: number, species: number): void;

  // Seed weighting from a dropped image's luminance (image-mask mode).
  setSeedImage(image: ImageBitmap | null): void;

  // Read the last GPU pass timings (dev overlay). May be empty if unsupported.
  readonly timings: GpuTimings;

  // Render one frame to an offscreen target at `scale`× and return a PNG blob,
  // WITHOUT disturbing live state.
  capturePNG(scale: number): Promise<Blob>;

  dispose(): void;
}

// Shared derived values both backends compute identically from Params, so the
// conversion math lives in exactly one place.
export function halfLifeToDecay(halfLifeSeconds: number): number {
  // Trail multiplied by `d` each 1/60s step. After `halfLife` seconds we want 0.5:
  //   d^(halfLife*60) = 0.5  →  d = 0.5^(1/(halfLife*60))
  const steps = Math.max(1, halfLifeSeconds * 60);
  return Math.pow(0.5, 1 / steps);
}

export function activeSpecies(p: Params): number {
  return Math.min(4, Math.max(1, p.speciesCount | 0));
}
