// Shared WGSL definitions included by every pass. Keep this line-for-line
// parallel with glsl/common.glsl — duplicated math between backends is the
// main source of divergence bugs (§10).

struct SimParams {
  resolution     : f32,
  agentCount     : u32,
  frame          : u32,
  speciesCount   : u32,
  moveSpeed      : f32,
  turnSpeed      : f32,
  sensorAngle    : f32,
  sensorDistance : f32,
  sensorSize     : f32,
  depositAmount  : f32,
  decay          : f32,
  diffuseRate    : f32,
  boundary       : u32,   // 0 = wrap, 1 = bounce, 2 = respawn
  dt             : f32,
  pad0           : f32,
  pad1           : f32,
  // Row i holds species i's weighting of species j's trail (the interaction
  // matrix, §4.5). Positive = attraction, negative = repulsion.
  interaction    : array<vec4<f32>, 4>,
};

// PCG hash — a well-distributed integer hash. We deliberately avoid
// fract(sin(dot(...))) which bands on some GPUs and shows visible artifacts at
// 1M agents (§4.4).
fn pcg_hash(v: u32) -> u32 {
  var state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// A uniform random float in [0,1) from an agent index + frame salt.
fn rand01(seed: u32) -> f32 {
  return f32(pcg_hash(seed)) / 4294967296.0;
}

fn dir(angle: f32) -> vec2<f32> {
  return vec2<f32>(cos(angle), sin(angle));
}

const TAU: f32 = 6.28318530718;
