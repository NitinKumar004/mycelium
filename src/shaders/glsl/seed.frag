#version 300 es
precision highp float;
precision highp int;
#include "common.glsl"

// GPU seeding into the agent texture (§4.1). Mirrors wgsl/seed.wgsl.
uniform float uRes;
uniform int uMode;          // 0 random,1 disc,2 ring,3 two-clusters,4 image
uniform int uSpeciesCount;
uniform uint uSeed;
uniform int uAgentTexSize;
uniform int uHasImage;
uniform sampler2D uMask;

out vec4 outAgent;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  uint i = uint(c.y * uAgentTexSize + c.x);
  uint base = (i * 2654435761u) ^ (uSeed * 2246822519u + 1u);
  float r1 = rand01(base), r2 = rand01(base * 3u + 7u), r3 = rand01(base * 5u + 11u);
  float R = uRes;
  vec2 center = vec2(R * 0.5);
  vec2 pos = vec2(r1 * R, r2 * R);
  float angle = r3 * TAU;

  if (uMode == 1) {
    float rad = sqrt(r1) * R * 0.18; float th = r2 * TAU;
    pos = center + vec2(cos(th), sin(th)) * rad; angle = th;
  } else if (uMode == 2) {
    float th = r1 * TAU; float rad = R * 0.42;
    pos = center + vec2(cos(th), sin(th)) * rad; angle = th + TAU * 0.5;
  } else if (uMode == 3) {
    float side = r3 > 0.5 ? 1.0 : -1.0;
    float rad = sqrt(r1) * R * 0.12; float th = r2 * TAU;
    pos = center + vec2(side * R * 0.22, 0.0) + vec2(cos(th), sin(th)) * rad; angle = r3 * TAU;
  } else if (uMode == 4 && uHasImage == 1) {
    float bestL = -1.0; vec2 best = pos;
    for (int k = 0; k < 4; k++) {
      float cx = rand01(base * uint(17 + k) + 3u);
      float cy = rand01(base * uint(29 + k) + 5u);
      float l = texture(uMask, vec2(cx, cy)).r;
      if (l > bestL) { bestL = l; best = vec2(cx * R, (1.0 - cy) * R); }
    }
    pos = best; angle = r3 * TAU;
  }

  float species = float(pcg_hash(i + uSeed) % uint(max(1, uSpeciesCount)));
  outAgent = vec4(pos, angle, species);
}
