#include "render_common.wgsl"
#include "fullscreen.wgsl"

// Composite (§5.1): map the up-to-4 trail channels through per-species emission
// colors into a linear HDR target, under the camera transform (pan/zoom on the
// torus — sampling wraps, so panning past an edge shows the field repeat).

@group(0) @binding(0) var<uniform> R : RenderParams;
@group(0) @binding(1) var trail : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

fn cameraUV(screenUV: vec2<f32>) -> vec2<f32> {
  var p = screenUV - vec2<f32>(0.5, 0.5);
  p.x *= R.aspect;
  p /= R.zoom;
  p += vec2<f32>(R.panX, R.panY);
  return p + vec2<f32>(0.5, 0.5);
}

@fragment
fn fs(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  let t = textureSampleLevel(trail, samp, cameraUV(uv), 0.0);
  let chans = array<f32, 4>(t.x, t.y, t.z, t.w);

  var col = vec3<f32>(0.0);
  let n = i32(R.speciesCount + 0.5);
  for (var s = 0; s < 4; s++) {
    if (s >= n) { break; }
    let v = chans[s] * R.colors[s].w;
    // Saturating emission: 1 - exp(-v) maps any trail density into [0,1] so a
    // dense network glows richly but can never blow out to white. A small,
    // BOUNDED white-hot core lifts the brightest cores toward white.
    let intensity = 1.0 - exp(-v * 0.85);
    col += R.colors[s].rgb * intensity;
    col += vec3<f32>(1.0) * smoothstep(0.7, 1.0, intensity) * 0.25;
  }
  col *= R.exposure;
  return vec4<f32>(col, 1.0);
}
