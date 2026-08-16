// Shared fullscreen-triangle vertex stage for every fullscreen pass. A single
// oversized triangle covers the viewport with one primitive (cheaper than a quad).

struct FSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv         : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vid : u32) -> FSOut {
  var out : FSOut;
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  out.uv = vec2<f32>(x, y);
  out.clip = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return out;
}
