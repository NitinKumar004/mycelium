#version 300 es
precision highp float;

in float vSpecies;
uniform float uDeposit;
out vec4 outColor;

void main() {
  int s = int(vSpecies + 0.5);
  vec4 c = vec4(0.0);
  if (s == 0) c.x = uDeposit;
  else if (s == 1) c.y = uDeposit;
  else if (s == 2) c.z = uDeposit;
  else c.w = uDeposit;
  outColor = c;
}
