#include "render_common.wgsl"
#include "fullscreen.wgsl"

// Dual-filter Kawase bloom (§5.2): cheaper than a Gaussian and kinder to thin
// filaments. Three entry points share this file; the pipeline picks one.
//   prefilter → soft-knee threshold at half res
//   down      → 13-tap dual-Kawase downsample
//   up        → 9-tap tent upsample, additively accumulated

@group(0) @binding(0) var<uniform> R : RenderParams;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

// Texel size of the SOURCE texture, provided per-pass via a tiny push of the
// mip dimensions packed into R is impractical, so we derive it from resolution
// is wrong for mips — instead we read src dimensions.
fn texel() -> vec2<f32> {
  let d = vec2<f32>(textureDimensions(src, 0));
  return vec2<f32>(1.0 / d.x, 1.0 / d.y);
}

@fragment
fn prefilter(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSampleLevel(src, samp, uv, 0.0).rgb;
  let l = luma(c);
  // Soft knee around the threshold so bright edges ramp in smoothly.
  let knee = 0.5;
  let t = R.bloomThreshold;
  let soft = clamp((l - t + knee) / (2.0 * knee), 0.0, 1.0);
  let contrib = max(soft * soft, step(t, l));
  return vec4<f32>(c * contrib, 1.0);
}

@fragment
fn down(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let e = texel();
  var s = textureSampleLevel(src, samp, uv, 0.0).rgb * 4.0;
  s += textureSampleLevel(src, samp, uv + vec2<f32>(-e.x, -e.y), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + vec2<f32>( e.x, -e.y), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + vec2<f32>(-e.x,  e.y), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + vec2<f32>( e.x,  e.y), 0.0).rgb;
  return vec4<f32>(s / 8.0, 1.0);
}

@fragment
fn up(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let e = texel();
  // 9-tap tent filter.
  var s = textureSampleLevel(src, samp, uv, 0.0).rgb * 4.0;
  s += (textureSampleLevel(src, samp, uv + vec2<f32>(-e.x, 0.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + vec2<f32>( e.x, 0.0), 0.0).rgb
      + textureSampleLevel(src, samp, uv + vec2<f32>(0.0, -e.y), 0.0).rgb
      + textureSampleLevel(src, samp, uv + vec2<f32>(0.0,  e.y), 0.0).rgb) * 2.0;
  s += textureSampleLevel(src, samp, uv + vec2<f32>(-e.x, -e.y), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + vec2<f32>( e.x, -e.y), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + vec2<f32>(-e.x,  e.y), 0.0).rgb;
  s += textureSampleLevel(src, samp, uv + vec2<f32>( e.x,  e.y), 0.0).rgb;
  return vec4<f32>(s / 16.0, 1.0);
}
