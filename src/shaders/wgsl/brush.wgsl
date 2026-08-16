#include "fullscreen.wgsl"

// Cursor brush (§11): inject directly into the trail field, not the agents.
// A soft radial stamp added (paint/attract) or subtracted (erase) into one
// species channel. Rendered with additive blending into the current trail.

struct BrushParams {
  center   : vec2<f32>, // trail-space UV [0,1]
  radius   : f32,       // in UV units
  strength : f32,       // +paint / -erase
  channel  : f32,       // which species channel
  pad0     : f32,
  pad1     : f32,
  pad2     : f32,
};

@group(0) @binding(0) var<uniform> B : BrushParams;

@fragment
fn fs(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let d = distance(uv, B.center);
  let fall = 1.0 - smoothstep(0.0, B.radius, d);
  let v = B.strength * fall;
  let c = u32(B.channel + 0.5);
  var col = vec4<f32>(0.0);
  if (c == 0u) { col.x = v; }
  else if (c == 1u) { col.y = v; }
  else if (c == 2u) { col.z = v; }
  else { col.w = v; }
  return col;
}
