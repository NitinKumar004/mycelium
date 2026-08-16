import type { Store } from '../core/Store';
import type { Params } from '../core/params';

// Per-parameter cross-fade between two states over N seconds (§8). Numeric
// fields and the interaction matrix ease with a smoothstep; enums and structural
// fields (agentCount, seedMode, simResolution) snap at the midpoint so we don't
// reseed every frame.
const EASE = (t: number) => t * t * (3 - 2 * t);
const NUMERIC: (keyof Params)[] = [
  'moveSpeed', 'turnSpeed', 'sensorAngle', 'sensorDistance', 'depositAmount', 'decayHalfLife',
  'diffuseRate', 'exposure', 'bloomThreshold', 'bloomIntensity', 'contrast', 'saturation',
  'grain', 'vignette', 'aberration', 'zoom',
];

export class Morph {
  private from: Params | null = null;
  private to: Params | null = null;
  private t = 0;
  private duration = 6;
  private snapped = false;

  constructor(private store: Store, private onSync: () => void) {}

  get running(): boolean {
    return this.to !== null;
  }

  begin(target: Params, seconds: number): void {
    this.from = structuredCloneParams(this.store.params);
    this.to = structuredCloneParams(target);
    this.t = 0;
    this.duration = Math.max(0.1, seconds);
    this.snapped = false;
  }

  // Advance by real seconds; called once per rendered frame.
  update(dt: number): void {
    if (!this.to || !this.from) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    const k = EASE(this.t);
    const p = this.store.params;
    for (const key of NUMERIC) {
      (p[key] as number) = (this.from[key] as number) + ((this.to[key] as number) - (this.from[key] as number)) * k;
    }
    for (let i = 0; i < 16; i++) {
      p.interaction[i] = (this.from.interaction[i] ?? 0) + ((this.to.interaction[i] ?? 0) - (this.from.interaction[i] ?? 0)) * k;
    }
    if (!this.snapped && this.t >= 0.5) {
      // Snap structural fields at the midpoint.
      p.speciesCount = this.to.speciesCount;
      p.tonemap = this.to.tonemap;
      p.boundary = this.to.boundary;
      this.snapped = true;
    }
    this.store.revision++;
    this.onSync();
    if (this.t >= 1) { this.to = null; this.from = null; }
  }
}

function structuredCloneParams(p: Params): Params {
  return { ...p, interaction: new Float32Array(p.interaction) };
}
