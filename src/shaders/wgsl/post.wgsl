#include "render_common.wgsl"
#include "fullscreen.wgsl"

// Final post (§5.3–5.5): combine HDR + bloom → tonemap → grade →
// grain + vignette + chromatic aberration → sRGB. Linear throughout; sRGB
// conversion happens exactly once, here at the very end.

@group(0) @binding(0) var<uniform> R : RenderParams;
@group(0) @binding(1) var hdr : texture_2d<f32>;
@group(0) @binding(2) var bloom : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;

// ---- Tonemappers ----------------------------------------------------------
fn aces(x: vec3<f32>) -> vec3<f32> {
  // Narkowicz ACES filmic approximation.
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn agx(val: vec3<f32>) -> vec3<f32> {
  // Minimal AgX (Troy Sobotka / Benjamin Wrensch approximation). Preserves hue
  // in blown highlights, which matters when trails saturate (§5.3).
  let m1 = mat3x3<f32>(
    0.842479, 0.042328, 0.042376,
    0.078844, 0.878396, 0.078844,
    0.078816, 0.078399, 0.879622);
  var x = m1 * val;
  let ax = clamp((log2(x + 1e-6) + 12.47393) / (12.47393 + 4.026069), vec3<f32>(0.0), vec3<f32>(1.0));
  // Sigmoid-ish polynomial approximation of the AgX contrast curve.
  let x2 = ax * ax; let x4 = x2 * x2;
  var y = 15.5 * x4 * x2 - 40.14 * x4 * ax + 31.96 * x4 - 6.868 * x2 * ax + 0.4298 * x2 + 0.1191 * ax - 0.00232;
  return clamp(y, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemap(x: vec3<f32>) -> vec3<f32> {
  if (R.tonemap < 0.5) { return agx(x); }
  return aces(x);
}

fn toSRGB(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

@fragment
fn fs(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  // Chromatic aberration: offset the channels radially, strongest at the edges.
  let center = uv - vec2<f32>(0.5, 0.5);
  let ca = R.aberration * 0.004 * dot(center, center);
  let dirv = normalize(center + vec2<f32>(1e-6, 1e-6));
  let rC = textureSampleLevel(hdr, samp, uv + dirv * ca, 0.0).rgb;
  let gC = textureSampleLevel(hdr, samp, uv, 0.0).rgb;
  let bC = textureSampleLevel(hdr, samp, uv - dirv * ca, 0.0).rgb;
  var color = vec3<f32>(rC.r, gC.g, bC.b);

  color += textureSampleLevel(bloom, samp, uv, 0.0).rgb * R.bloomIntensity;

  color = tonemap(color);

  // Grade: contrast around mid-grey, then saturation.
  color = (color - 0.5) * R.contrast + 0.5;
  let l = luma(color);
  color = mix(vec3<f32>(l), color, R.saturation);
  color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));

  // Vignette.
  let vig = 1.0 - R.vignette * smoothstep(0.35, 0.85, length(center));
  color *= vig;

  // Animated grain, temporally LOW frequency (quantized time) so video export
  // doesn't read as per-frame compression noise (§5.5).
  let tq = floor(R.time * 12.0);
  let g = hash21(uv * R.resolution + vec2<f32>(tq, tq * 1.7)) - 0.5;
  color += g * R.grain * 0.06;

  return vec4<f32>(toSRGB(color), 1.0);
}
