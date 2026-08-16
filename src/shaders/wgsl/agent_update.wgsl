#include "common.wgsl"

// Sense + Steer + Move (§4.4). One invocation per agent. Reads the current
// trail field, updates the agent's heading and position in place.

struct Agent {
  pos     : vec2<f32>,
  angle   : f32,
  species : u32,
};

@group(0) @binding(0) var<uniform> P : SimParams;
@group(0) @binding(1) var<storage, read_write> agents : array<Agent>;
@group(0) @binding(2) var trail : texture_2d<f32>;
@group(0) @binding(3) var trailSampler : sampler;

// Sample the trail at a world position, weighted by this agent's species row of
// the interaction matrix. sensorSize > 1 averages a 3x3 neighborhood (softer).
fn sense(worldPos: vec2<f32>, speciesRow: vec4<f32>) -> f32 {
  let uv = worldPos / P.resolution; // torus UV; sampler wraps
  var acc = 0.0;
  if (P.sensorSize > 1.5) {
    let px = 1.0 / P.resolution;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let s = textureSampleLevel(trail, trailSampler, uv + vec2<f32>(f32(dx), f32(dy)) * px, 0.0);
        acc += dot(s, speciesRow);
      }
    }
    return acc / 9.0;
  }
  let s = textureSampleLevel(trail, trailSampler, uv, 0.0);
  return dot(s, speciesRow);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= P.agentCount) { return; }

  var a = agents[i];
  // Salt the RNG with agent index and frame so the stream differs each step.
  let seed = (i * 2654435761u) ^ (P.frame * 40503u + 1u);
  let speciesRow = P.interaction[a.species];

  let sd = P.sensorDistance;
  let sa = P.sensorAngle;

  let wL = sense(a.pos + dir(a.angle - sa) * sd, speciesRow);
  let wC = sense(a.pos + dir(a.angle)      * sd, speciesRow);
  let wR = sense(a.pos + dir(a.angle + sa) * sd, speciesRow);

  let turn = P.turnSpeed;
  if (wC > wL && wC > wR) {
    // Strongest ahead: keep going straight.
  } else if (wC < wL && wC < wR) {
    // Both sides better than center: turn a RANDOM direction. This branch
    // breaks symmetry and is what produces organic asymmetry instead of a
    // sterile lattice — never remove the randomness here (Jones 2010, §4.4).
    a.angle += (rand01(seed) - 0.5) * 2.0 * turn;
  } else if (wR > wL) {
    a.angle += turn;
  } else if (wL > wR) {
    a.angle -= turn;
  }

  // Move along the (possibly new) heading.
  var np = a.pos + dir(a.angle) * P.moveSpeed;
  let R = P.resolution;

  if (P.boundary == 0u) {
    // Wrap (torus).
    np = np - floor(np / R) * R;
  } else if (P.boundary == 1u) {
    // Bounce: reflect heading off the walls.
    if (np.x < 0.0 || np.x >= R) { a.angle = TAU * 0.5 - a.angle; np.x = clamp(np.x, 0.0, R - 1.0); }
    if (np.y < 0.0 || np.y >= R) { a.angle = -a.angle;            np.y = clamp(np.y, 0.0, R - 1.0); }
  } else {
    // Kill-and-respawn: if it left the field, drop it back at a random spot
    // with a random heading.
    if (np.x < 0.0 || np.x >= R || np.y < 0.0 || np.y >= R) {
      np = vec2<f32>(rand01(seed * 7u) * R, rand01(seed * 13u) * R);
      a.angle = rand01(seed * 17u) * TAU;
    }
  }

  a.pos = np;
  agents[i] = a;
}
