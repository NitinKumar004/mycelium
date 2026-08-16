#include "common.wgsl"
#include "fullscreen.wgsl"

// Diffuse + Decay (§4.6). 3x3 box blur, mix toward the blur by diffuseRate,
// then multiply by the per-step decay factor. Clamp to keep the HDR buffer from
// accumulating to inf.

@group(0) @binding(0) var<uniform> P : SimParams;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

@fragment
fn fs(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let px = 1.0 / P.resolution;
  var sum = vec4<f32>(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      sum += textureSampleLevel(src, samp, uv + vec2<f32>(f32(dx), f32(dy)) * px, 0.0);
    }
  }
  let blurred = sum / 9.0;
  let original = textureSampleLevel(src, samp, uv, 0.0);
  var v = mix(original, blurred, P.diffuseRate);
  v *= P.decay;
  return clamp(v, vec4<f32>(0.0), vec4<f32>(64.0));
}
