// The single typed Params object with min/max/step/scale metadata declared
// alongside every field. The UI generates itself from PARAM_META; adding a
// tunable parameter means editing exactly this one file (§10).

export type SeedMode =
  | 'random-uniform'
  | 'center-disc-outward'
  | 'ring-inward'
  | 'two-clusters'
  | 'image-mask';

export type BoundaryMode = 'wrap' | 'bounce' | 'respawn';
export type Tonemap = 'agx' | 'aces';

export interface Params {
  // Agents
  agentCount: number;
  moveSpeed: number;
  turnSpeed: number;
  sensorAngle: number;
  sensorDistance: number;
  sensorSize: number; // 1 = single tap, 3 = 3x3 average
  seedMode: SeedMode;
  boundary: BoundaryMode;

  // Chemistry
  depositAmount: number;
  decayHalfLife: number; // seconds — converted to a per-frame multiplier internally
  diffuseRate: number;

  // Species
  speciesCount: number;
  // 4x4 interaction matrix, row-major. M[i*4+j] = how species i weights species j's trail.
  interaction: Float32Array;

  // Look
  exposure: number;
  bloomThreshold: number;
  bloomIntensity: number;
  tonemap: Tonemap;
  contrast: number;
  saturation: number;
  grain: number;
  vignette: number;
  aberration: number;

  // Camera (managed live by the camera controller, serialized with the rest)
  zoom: number;
  panX: number;
  panY: number;

  // Engine
  simResolution: number; // 1024 | 2048 | 4096
}

export type ParamScale = 'linear' | 'log';
export type ParamGroup = 'Agents' | 'Chemistry' | 'Species' | 'Look' | 'Camera';

export interface ParamMeta {
  key: keyof Params;
  label: string;
  group: ParamGroup;
  min: number;
  max: number;
  step: number;
  scale: ParamScale;
  unit?: string;
  // Plain-language explanation shown in the UI when "explain mode" is on.
  help?: string;
  // Changing this parameter forces a reseed of the agent buffers.
  reseeds?: boolean;
  // Changing this rebuilds GPU resources (buffer/texture sizes).
  rebuilds?: boolean;
  format?: (v: number) => string;
}

const deg = (v: number) => `${((v * 180) / Math.PI).toFixed(0)}°`;

// Only numeric sliders are described here. Enums (seedMode, boundary, tonemap)
// and the interaction matrix get purpose-built controls in the UI.
export const PARAM_META: ParamMeta[] = [
  // Agents
  { key: 'agentCount', label: 'Population', group: 'Agents', min: 1024, max: 4_194_304, step: 1, scale: 'log', reseeds: true, rebuilds: true, format: fmtCount,
    help: 'How many agents (dots) exist. More agents = denser, richer networks. Changing this restarts the simulation.' },
  { key: 'moveSpeed', label: 'Move speed', group: 'Agents', min: 0, max: 6, step: 0.01, scale: 'linear', unit: 'px',
    help: 'How fast agents travel each step. Higher = looser, more energetic patterns; lower = calm and tight.' },
  { key: 'turnSpeed', label: 'Turn speed', group: 'Agents', min: 0, max: 2, step: 0.005, scale: 'linear', unit: 'rad',
    help: 'How sharply agents can turn. Higher = twitchy and chaotic; lower = smooth, flowing lines.' },
  { key: 'sensorAngle', label: 'Sensor angle', group: 'Agents', min: 0.05, max: 1.57, step: 0.005, scale: 'linear', format: deg,
    help: "How far apart the agent's left/right 'nostrils' point. Wide = fat branches; narrow = fine threads." },
  { key: 'sensorDistance', label: 'Sensor distance', group: 'Agents', min: 1, max: 40, step: 0.1, scale: 'log', unit: 'px',
    help: 'How far ahead agents can smell trails. Longer = bigger, coarser structures; shorter = fine detail.' },
  { key: 'sensorSize', label: 'Sensor blur', group: 'Agents', min: 1, max: 3, step: 2, scale: 'linear',
    help: 'Softness of sensing. 3 samples a small area (calmer); 1 is a single sharp point.' },

  // Chemistry
  { key: 'depositAmount', label: 'Deposit', group: 'Chemistry', min: 0, max: 3, step: 0.01, scale: 'linear',
    help: 'How much trail each agent leaves behind. Higher = bolder, brighter veins.' },
  { key: 'decayHalfLife', label: 'Half-life', group: 'Chemistry', min: 0.05, max: 6, step: 0.01, scale: 'log', unit: 's',
    help: 'How long trails last before fading by half. Short = crisp and fast-changing; long = trails linger and thicken.' },
  { key: 'diffuseRate', label: 'Diffusion', group: 'Chemistry', min: 0, max: 1, step: 0.005, scale: 'linear',
    help: 'How much trails blur outward. Higher = soft, cloudy, nebula-like; lower = sharp and wiry.' },

  // Species
  { key: 'speciesCount', label: 'Species', group: 'Species', min: 1, max: 4, step: 1, scale: 'linear',
    help: 'How many separate colored populations exist. Use the grid below to make them attract or repel each other.' },

  // Look
  { key: 'exposure', label: 'Exposure', group: 'Look', min: -4, max: 4, step: 0.01, scale: 'linear', unit: 'EV',
    help: 'Overall brightness of the image. Purely visual — does not change the simulation.' },
  { key: 'bloomThreshold', label: 'Bloom threshold', group: 'Look', min: 0, max: 3, step: 0.01, scale: 'linear',
    help: 'How bright a spot must be before it starts to glow. Lower = more of the image glows.' },
  { key: 'bloomIntensity', label: 'Bloom', group: 'Look', min: 0, max: 2, step: 0.01, scale: 'linear',
    help: 'Strength of the soft glow/halo around bright veins.' },
  { key: 'contrast', label: 'Contrast', group: 'Look', min: 0.5, max: 1.8, step: 0.01, scale: 'linear',
    help: 'Difference between darks and lights. Higher = punchier, more dramatic.' },
  { key: 'saturation', label: 'Saturation', group: 'Look', min: 0, max: 2, step: 0.01, scale: 'linear',
    help: 'Color intensity. 0 = black-and-white; 2 = vivid.' },
  { key: 'grain', label: 'Grain', group: 'Look', min: 0, max: 1, step: 0.01, scale: 'linear',
    help: 'Subtle film-grain texture over the image.' },
  { key: 'vignette', label: 'Vignette', group: 'Look', min: 0, max: 1, step: 0.01, scale: 'linear',
    help: 'Darkening toward the corners, to draw the eye to the center.' },
  { key: 'aberration', label: 'Aberration', group: 'Look', min: 0, max: 1, step: 0.01, scale: 'linear',
    help: 'A subtle color-fringe lens effect near the edges. Keep it low for a hint of realism.' },

  // Camera
  { key: 'zoom', label: 'Zoom', group: 'Camera', min: 0.25, max: 16, step: 0.01, scale: 'log', unit: '×',
    help: 'Magnify the view. You can also scroll on the canvas, and drag to pan.' },
];

// Plain-language descriptions for each group heading.
export const GROUP_HELP: Record<ParamGroup, string> = {
  Agents: 'The dots themselves — how many there are and how they move and sense.',
  Chemistry: 'The trails they leave — how they build up, fade, and spread. This has the biggest effect on the vein look.',
  Species: 'Multiple colored populations and how they attract or avoid each other.',
  Look: 'Purely visual polish — brightness, glow, color, film effects. None of this changes the simulation.',
  Camera: 'How you view it — zoom and rendering quality.',
};

export function fmtCount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_048_576).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
  return `${v | 0}`;
}

export function identityMatrix(): Float32Array {
  // Default: each species attracted to its own trail, indifferent to others.
  const m = new Float32Array(16);
  for (let i = 0; i < 4; i++) m[i * 4 + i] = 1;
  return m;
}

export function defaultParams(): Params {
  return {
    agentCount: 1_048_576,
    moveSpeed: 1.2,
    turnSpeed: 0.35,
    sensorAngle: 0.52,
    sensorDistance: 9.0,
    sensorSize: 1,
    seedMode: 'random-uniform',
    boundary: 'wrap',

    depositAmount: 0.9,
    decayHalfLife: 0.55,
    diffuseRate: 0.28,

    speciesCount: 1,
    interaction: identityMatrix(),

    exposure: 0.2,
    bloomThreshold: 0.6,
    bloomIntensity: 0.7,
    tonemap: 'agx',
    contrast: 1.06,
    saturation: 1.05,
    grain: 0.32,
    vignette: 0.4,
    aberration: 0.18,

    zoom: 1,
    panX: 0,
    panY: 0,

    simResolution: 2048,
  };
}

// Map a slider's normalized [0,1] track position to a value, honoring scale.
export function trackToValue(meta: ParamMeta, t: number): number {
  const c = Math.min(1, Math.max(0, t));
  let v: number;
  if (meta.scale === 'log') {
    const lo = Math.log(meta.min);
    const hi = Math.log(meta.max);
    v = Math.exp(lo + (hi - lo) * c);
  } else {
    v = meta.min + (meta.max - meta.min) * c;
  }
  // Snap to step, offset from min (so e.g. min 1 / step 2 snaps to 1 or 3,
  // never the invalid value 2).
  v = meta.min + Math.round((v - meta.min) / meta.step) * meta.step;
  return Math.min(meta.max, Math.max(meta.min, v));
}

export function valueToTrack(meta: ParamMeta, v: number): number {
  if (meta.scale === 'log') {
    const lo = Math.log(meta.min);
    const hi = Math.log(meta.max);
    return (Math.log(Math.min(meta.max, Math.max(meta.min, v))) - lo) / (hi - lo);
  }
  return (v - meta.min) / (meta.max - meta.min);
}
