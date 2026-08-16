#include "common.wgsl"

// Deposit pass (§4.3 step 2). Draws one 1px point per agent, additively blended
// into the trail field. Each agent writes into its own species channel.

struct Agent {
  pos     : vec2<f32>,
  angle   : f32,
  species : u32,
};

@group(0) @binding(0) var<uniform> P : SimParams;
@group(0) @binding(1) var<storage, read> agents : array<Agent>;

struct VOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) species    : f32,
};

@vertex
fn vs(@builtin(vertex_index) vid : u32) -> VOut {
  let a = agents[vid];
  // World pixel -> clip space. Flip Y so texture space matches sampling.
  let ndc = (a.pos / P.resolution) * 2.0 - vec2<f32>(1.0, 1.0);
  var out : VOut;
  out.clip = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  out.species = f32(a.species);
  return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
  let s = u32(in.species + 0.5);
  var c = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  // Route the deposit into the agent's species channel.
  if (s == 0u) { c.x = P.depositAmount; }
  else if (s == 1u) { c.y = P.depositAmount; }
  else if (s == 2u) { c.z = P.depositAmount; }
  else { c.w = P.depositAmount; }
  return c;
}
