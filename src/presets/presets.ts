import type { Params, SeedMode, BoundaryMode, Tonemap } from '../core/params';
import { defaultParams, identityMatrix } from '../core/params';

// Ten hand-tuned presets. Each names the BEHAVIOUR, not the look (§8).
export interface Preset {
  name: string;
  description: string;
  params: Params;
}

function base(over: Partial<Params>, matrix?: number[]): Params {
  const p = defaultParams();
  Object.assign(p, over);
  if (matrix) p.interaction = new Float32Array(matrix);
  return p;
}

// A symmetric 2-species matrix: attracted to self, mildly to the other.
const chaseMatrix = [
  0.9, -0.6, 0, 0,
  0.7, 0.9, 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
];

export const PRESETS: Preset[] = [
  {
    name: 'Classic Network',
    description: 'The canonical Physarum web — coarse blobs coalesce into stable transport veins.',
    params: base({ moveSpeed: 1.2, turnSpeed: 0.35, sensorAngle: 0.52, sensorDistance: 9, depositAmount: 0.9, decayHalfLife: 0.55, diffuseRate: 0.28, exposure: 0.3, bloomThreshold: 0.75, bloomIntensity: 0.8 }),
  },
  {
    name: 'Coral',
    description: 'Slow deposit, high decay — agents abandon weak paths quickly, leaving crisp reefs.',
    params: base({ moveSpeed: 0.9, turnSpeed: 0.28, sensorAngle: 0.7, sensorDistance: 6, depositAmount: 0.5, decayHalfLife: 0.28, diffuseRate: 0.18, bloomIntensity: 0.9 }),
  },
  {
    name: 'Nervous System',
    description: 'Long sensors, tight turns — thin dendritic filaments that keep reaching outward.',
    params: base({ moveSpeed: 1.4, turnSpeed: 0.22, sensorAngle: 0.35, sensorDistance: 18, depositAmount: 0.8, decayHalfLife: 0.9, diffuseRate: 0.2 }),
  },
  {
    name: 'Cyclone',
    description: 'High turn speed with a wide sensor sweep — the field organizes into rotating cells.',
    params: base({ moveSpeed: 1.6, turnSpeed: 0.9, sensorAngle: 1.1, sensorDistance: 12, depositAmount: 1.0, decayHalfLife: 0.5, diffuseRate: 0.4 }),
  },
  {
    name: 'Two-Species Chase',
    description: 'Two populations, asymmetric attraction — one pursues, the other flees, forever.',
    params: base({ speciesCount: 2, moveSpeed: 1.3, turnSpeed: 0.4, sensorAngle: 0.5, sensorDistance: 10, decayHalfLife: 0.6, seedMode: 'two-clusters' as SeedMode }, chaseMatrix),
  },
  {
    name: 'Maze',
    description: 'Negative self-weighting — agents avoid their own trails, carving self-avoiding corridors.',
    params: base({ moveSpeed: 1.0, turnSpeed: 0.5, sensorAngle: 0.6, sensorDistance: 7, depositAmount: 1.0, decayHalfLife: 1.4, diffuseRate: 0.1 }, [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  },
  {
    name: 'Nebula',
    description: 'Heavy diffusion, long half-life — soft luminous clouds instead of hard veins.',
    params: base({ moveSpeed: 0.8, turnSpeed: 0.3, sensorAngle: 0.55, sensorDistance: 14, depositAmount: 0.7, decayHalfLife: 3.0, diffuseRate: 0.75, bloomIntensity: 1.1, exposure: 0.5 }),
  },
  {
    name: 'Filament',
    description: 'Minimal diffusion, fast agents — hair-fine threads that barely blur.',
    params: base({ moveSpeed: 2.2, turnSpeed: 0.3, sensorAngle: 0.4, sensorDistance: 11, depositAmount: 0.9, decayHalfLife: 0.7, diffuseRate: 0.05 }),
  },
  {
    name: 'Crystalline',
    description: 'Wide symmetric sensors, low turn — regular lattice-like growth with faceted joins.',
    params: base({ moveSpeed: 1.1, turnSpeed: 0.15, sensorAngle: 1.3, sensorDistance: 9, depositAmount: 1.1, decayHalfLife: 0.65, diffuseRate: 0.22, contrast: 1.2 }),
  },
  {
    name: 'Bloom',
    description: 'High deposit into a bright HDR field — trails saturate and flower into light.',
    params: base({ moveSpeed: 1.0, turnSpeed: 0.4, sensorAngle: 0.6, sensorDistance: 10, depositAmount: 1.6, decayHalfLife: 0.8, diffuseRate: 0.35, exposure: 0.9, bloomIntensity: 1.3, bloomThreshold: 0.4 }),
  },
];

export function presetByName(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}

// Keep the identity export used by callers that want a clean matrix.
export { identityMatrix };
export type { BoundaryMode, Tonemap };
