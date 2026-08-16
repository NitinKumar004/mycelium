#version 300 es
precision highp float;
precision highp int;
#include "common.glsl"

// Sense + Steer + Move (§4.4). One texel per agent in an RGBA32F texture:
// R=x, G=y, B=heading, A=species. Renders into the write agent texture.

uniform sampler2D uAgents;
uniform sampler2D uTrail;
uniform float uRes;
uniform float uMove, uTurn, uSensorAngle, uSensorDist, uSensorSize;
uniform int uBoundary;         // 0 wrap, 1 bounce, 2 respawn
uniform uint uFrame;
uniform int uAgentTexSize;
uniform mat4 uInteraction;     // rows = species weighting

out vec4 outAgent;

float sense(vec2 world, vec4 row) {
  vec2 uv = world / uRes;
  if (uSensorSize > 1.5) {
    float px = 1.0 / uRes;
    float acc = 0.0;
    for (int dy = -1; dy <= 1; dy++)
      for (int dx = -1; dx <= 1; dx++)
        acc += dot(texture(uTrail, uv + vec2(float(dx), float(dy)) * px), row);
    return acc / 9.0;
  }
  return dot(texture(uTrail, uv), row);
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uAgents, coord, 0);
  vec2 pos = a.xy;
  float angle = a.z;
  int species = int(a.w + 0.5);
  vec4 row = uInteraction[species];

  uint idx = uint(coord.y * uAgentTexSize + coord.x);
  uint seed = idx * 2654435761u ^ (uFrame * 40503u + 1u);

  float sd = uSensorDist, sa = uSensorAngle;
  float wL = sense(pos + dir(angle - sa) * sd, row);
  float wC = sense(pos + dir(angle)      * sd, row);
  float wR = sense(pos + dir(angle + sa) * sd, row);

  if (wC > wL && wC > wR) {
    // straight
  } else if (wC < wL && wC < wR) {
    angle += (rand01(seed) - 0.5) * 2.0 * uTurn; // random turn — breaks symmetry
  } else if (wR > wL) {
    angle += uTurn;
  } else if (wL > wR) {
    angle -= uTurn;
  }

  vec2 np = pos + dir(angle) * uMove;
  float R = uRes;
  if (uBoundary == 0) {
    np -= floor(np / R) * R;
  } else if (uBoundary == 1) {
    if (np.x < 0.0 || np.x >= R) { angle = TAU * 0.5 - angle; np.x = clamp(np.x, 0.0, R - 1.0); }
    if (np.y < 0.0 || np.y >= R) { angle = -angle;            np.y = clamp(np.y, 0.0, R - 1.0); }
  } else {
    if (np.x < 0.0 || np.x >= R || np.y < 0.0 || np.y >= R) {
      np = vec2(rand01(seed * 7u) * R, rand01(seed * 13u) * R);
      angle = rand01(seed * 17u) * TAU;
    }
  }

  outAgent = vec4(np, angle, float(species));
}
