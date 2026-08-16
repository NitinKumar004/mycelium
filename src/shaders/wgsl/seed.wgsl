#include "common.wgsl"

// GPU seeding (§4.1). Fills the agent buffer directly on the GPU so no
// per-agent array ever crosses the JS boundary. Seed modes match the spec.

struct Agent {
  pos     : vec2<f32>,
  angle   : f32,
  species : u32,
};

struct SeedParams {
  resolution   : f32,
  agentCount   : u32,
  mode         : u32,   // 0 random,1 disc-outward,2 ring-inward,3 two-clusters,4 image-mask
  speciesCount : u32,
  seed         : u32,
  hasImage     : u32,
  pad0         : u32,
  pad1         : u32,
};

@group(0) @binding(0) var<uniform> S : SeedParams;
@group(0) @binding(1) var<storage, read_write> agents : array<Agent>;
@group(0) @binding(2) var maskTex : texture_2d<f32>;
@group(0) @binding(3) var maskSamp : sampler;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= S.agentCount) { return; }

  let base = (i * 2654435761u) ^ (S.seed * 2246822519u + 1u);
  let r1 = rand01(base);
  let r2 = rand01(base * 3u + 7u);
  let r3 = rand01(base * 5u + 11u);
  let R = S.resolution;
  let center = vec2<f32>(R * 0.5, R * 0.5);

  var pos = vec2<f32>(r1 * R, r2 * R);
  var angle = r3 * TAU;

  if (S.mode == 1u) {
    // center-disc-outward: uniformly inside a small disc, heading outward.
    let rad = sqrt(r1) * R * 0.18;
    let th = r2 * TAU;
    pos = center + vec2<f32>(cos(th), sin(th)) * rad;
    angle = th;
  } else if (S.mode == 2u) {
    // ring-inward: on a ring, heading toward the center.
    let th = r1 * TAU;
    let rad = R * 0.42;
    pos = center + vec2<f32>(cos(th), sin(th)) * rad;
    angle = th + TAU * 0.5;
  } else if (S.mode == 3u) {
    // two-clusters: split the population between two discs.
    let side = select(-1.0, 1.0, r3 > 0.5);
    let rad = sqrt(r1) * R * 0.12;
    let th = r2 * TAU;
    pos = center + vec2<f32>(side * R * 0.22, 0.0) + vec2<f32>(cos(th), sin(th)) * rad;
    angle = r3 * TAU;
  } else if (S.mode == 4u && S.hasImage == 1u) {
    // image-mask: rejection toward bright regions. A few candidate draws, keep
    // the brightest — approximates luminance-weighted seeding cheaply.
    var best = pos;
    var bestL = -1.0;
    for (var k = 0u; k < 4u; k++) {
      let cx = rand01(base * (17u + k) + 3u);
      let cy = rand01(base * (29u + k) + 5u);
      let l = textureSampleLevel(maskTex, maskSamp, vec2<f32>(cx, cy), 0.0).r;
      if (l > bestL) { bestL = l; best = vec2<f32>(cx * R, (1.0 - cy) * R); }
    }
    pos = best;
    angle = r3 * TAU;
  }

  var a : Agent;
  a.pos = pos;
  a.angle = angle;
  // Assign species round-robin-ish via hash so clusters aren't monochrome.
  a.species = pcg_hash(i + S.seed) % max(1u, S.speciesCount);
  agents[i] = a;
}
