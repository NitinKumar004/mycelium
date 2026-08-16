// Shared render-side uniform + color helpers for the composite/bloom/post
// passes. Parallel to glsl/render_common.glsl.

struct RenderParams {
  resolution     : f32,
  aspect         : f32,
  zoom           : f32,
  time           : f32,
  panX           : f32,
  panY           : f32,
  exposure       : f32,   // linear multiplier (2^EV)
  speciesCount   : f32,
  bloomThreshold : f32,
  bloomIntensity : f32,
  contrast       : f32,
  saturation     : f32,
  grain          : f32,
  vignette       : f32,
  aberration     : f32,
  tonemap        : f32,   // 0 = AgX, 1 = ACES
  // Per-species emission color (rgb) and gain (a).
  colors         : array<vec4<f32>, 4>,
};

fn luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Cheap hash for animated grain.
fn hash21(p: vec2<f32>) -> f32 {
  var h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}
