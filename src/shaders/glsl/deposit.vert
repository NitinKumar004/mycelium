#version 300 es
precision highp float;

// One point per agent. gl_VertexID indexes into the agent texture; we fetch the
// agent's world position and place a 1px point in the trail field.
uniform sampler2D uAgents;
uniform int uAgentTexSize;
uniform int uAgentCount;
uniform float uRes;

out float vSpecies;

void main() {
  int id = gl_VertexID;
  // The agent texture is square (texSize^2 >= agentCount); cull the surplus
  // tail so the effective population matches agentCount, as on the WebGPU path.
  if (id >= uAgentCount) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip space → discarded
    gl_PointSize = 0.0;
    vSpecies = 0.0;
    return;
  }
  ivec2 coord = ivec2(id % uAgentTexSize, id / uAgentTexSize);
  vec4 a = texelFetch(uAgents, coord, 0);
  vec2 ndc = (a.xy / uRes) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, ndc.y, 0.0, 1.0);
  gl_PointSize = 1.0;
  vSpecies = a.w;
}
