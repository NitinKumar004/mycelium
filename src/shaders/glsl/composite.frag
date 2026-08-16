#version 300 es
precision highp float;

// Composite (§5.1): trail channels -> linear HDR, under the camera transform.
in vec2 vUV;
uniform sampler2D uTrail;
uniform float uAspect, uZoom, uPanX, uPanY, uExposure;
uniform int uSpeciesCount;
uniform vec4 uColors[4]; // rgb + gain
out vec4 outColor;

void main() {
  vec2 p = vUV - 0.5;
  p.x *= uAspect;
  p /= uZoom;
  p += vec2(uPanX, uPanY);
  vec2 uv = p + 0.5;

  vec4 t = texture(uTrail, uv);
  float ch[4]; ch[0]=t.x; ch[1]=t.y; ch[2]=t.z; ch[3]=t.w;
  vec3 col = vec3(0.0);
  for (int s = 0; s < 4; s++) {
    if (s >= uSpeciesCount) break;
    float v = ch[s] * uColors[s].w;
    // Saturating emission — dense networks glow but never blow out to white.
    float intensity = 1.0 - exp(-v * 0.85);
    col += uColors[s].rgb * intensity;
    col += vec3(1.0) * smoothstep(0.7, 1.0, intensity) * 0.25;
  }
  col *= uExposure;
  outColor = vec4(col, 1.0);
}
