#version 300 es
precision highp float;

// Compact bloom for the WebGL2 path: soft-knee threshold + separable 13-tap
// Gaussian in one direction per pass. The WebGL2 fallback runs this twice
// (horizontal then vertical) at half resolution — a lighter approximation of
// the WebGPU dual-Kawase pyramid, documented in the README as "known-lean".
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uDir;        // (1/w,0) or (0,1/h)
uniform float uThreshold;
uniform int uPrefilter;   // 1 = apply threshold, 0 = pure blur
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 tap(vec2 uv) {
  vec3 c = texture(uSrc, uv).rgb;
  if (uPrefilter == 1) {
    float l = luma(c);
    float knee = 0.5;
    float soft = clamp((l - uThreshold + knee) / (2.0 * knee), 0.0, 1.0);
    c *= max(soft * soft, step(uThreshold, l));
  }
  return c;
}

void main() {
  float w[7] = float[7](0.1964, 0.1747, 0.1210, 0.0656, 0.0278, 0.0092, 0.0024);
  vec3 s = tap(vUV) * w[0];
  for (int i = 1; i < 7; i++) {
    s += tap(vUV + uDir * float(i)) * w[i];
    s += tap(vUV - uDir * float(i)) * w[i];
  }
  outColor = vec4(s, 1.0);
}
