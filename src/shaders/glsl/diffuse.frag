#version 300 es
precision highp float;

// Diffuse + Decay (§4.6): 3x3 box blur, mix by diffuseRate, multiply by decay.
in vec2 vUV;
uniform sampler2D uTrail;
uniform float uRes, uDiffuse, uDecay;
out vec4 outColor;

void main() {
  float px = 1.0 / uRes;
  vec4 sum = vec4(0.0);
  for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++)
      sum += texture(uTrail, vUV + vec2(float(dx), float(dy)) * px);
  vec4 blurred = sum / 9.0;
  vec4 original = texture(uTrail, vUV);
  vec4 v = mix(original, blurred, uDiffuse) * uDecay;
  outColor = clamp(v, 0.0, 64.0);
}
