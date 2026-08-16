#version 300 es
precision highp float;

// Final post for WebGL2 (§5.3–5.5): HDR + bloom -> tonemap -> grade ->
// grain + vignette + aberration -> sRGB. Mirrors wgsl/post.wgsl.
in vec2 vUV;
uniform sampler2D uHDR;
uniform sampler2D uBloom;
uniform float uResolution, uTime;
uniform float uBloomIntensity, uContrast, uSaturation, uGrain, uVignette, uAberration;
uniform int uTonemap; // 0 AgX, 1 ACES
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 agx(vec3 val) {
  mat3 m1 = mat3(0.842479, 0.042328, 0.042376, 0.078844, 0.878396, 0.078844, 0.078816, 0.078399, 0.879622);
  vec3 x = m1 * val;
  vec3 ax = clamp((log2(x + 1e-6) + 12.47393) / (12.47393 + 4.026069), 0.0, 1.0);
  vec3 x2 = ax * ax; vec3 x4 = x2 * x2;
  vec3 y = 15.5 * x4 * x2 - 40.14 * x4 * ax + 31.96 * x4 - 6.868 * x2 * ax + 0.4298 * x2 + 0.1191 * ax - 0.00232;
  return clamp(y, 0.0, 1.0);
}
vec3 tonemap(vec3 x) { return uTonemap < 1 ? agx(x) : aces(x); }
vec3 toSRGB(vec3 c) {
  return mix(1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
}

void main() {
  vec2 center = vUV - 0.5;
  float ca = uAberration * 0.004 * dot(center, center);
  vec2 dirv = normalize(center + 1e-6);
  vec3 rC = texture(uHDR, vUV + dirv * ca).rgb;
  vec3 gC = texture(uHDR, vUV).rgb;
  vec3 bC = texture(uHDR, vUV - dirv * ca).rgb;
  vec3 color = vec3(rC.r, gC.g, bC.b);

  color += texture(uBloom, vUV).rgb * uBloomIntensity;
  color = tonemap(color);
  color = (color - 0.5) * uContrast + 0.5;
  float l = luma(color);
  color = mix(vec3(l), color, uSaturation);
  color = clamp(color, 0.0, 1.0);

  float vig = 1.0 - uVignette * smoothstep(0.35, 0.85, length(center));
  color *= vig;

  float tq = floor(uTime * 12.0);
  float g = hash21(vUV * uResolution + vec2(tq, tq * 1.7)) - 0.5;
  color += g * uGrain * 0.06;

  outColor = vec4(toSRGB(color), 1.0);
}
