// Shared GLSL ES 3.00 math. Kept line-for-line parallel with wgsl/common.wgsl
// so the two backends produce the same structure (§10).

// PCG hash — avoids fract(sin(dot())) banding at 1M agents (§4.4).
uint pcg_hash(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// Top 24 bits → exactly representable in float, never rounds up to 1.0.
float rand01(uint seed) {
  return float(pcg_hash(seed) >> 8u) / 16777216.0;
}

vec2 dir(float angle) {
  return vec2(cos(angle), sin(angle));
}

const float TAU = 6.28318530718;
