#version 300 es
precision highp float;

// Cursor brush for the WebGL2 path. Mirrors wgsl/brush.wgsl: a soft radial
// stamp added/subtracted into one species channel of the trail field.
in vec2 vUV;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uStrength;
uniform int uChannel;
out vec4 outColor;

void main() {
  float d = distance(vUV, uCenter);
  float fall = 1.0 - smoothstep(0.0, uRadius, d);
  float v = uStrength * fall;
  vec4 c = vec4(0.0);
  if (uChannel == 0) c.x = v;
  else if (uChannel == 1) c.y = v;
  else if (uChannel == 2) c.z = v;
  else c.w = v;
  outColor = c;
}
