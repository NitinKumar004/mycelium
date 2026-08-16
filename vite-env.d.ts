/// <reference types="vite/client" />

// Shader files are imported as strings (vite-plugin-glsl resolves #include).
declare module '*.wgsl' {
  const src: string;
  export default src;
}
declare module '*.glsl' {
  const src: string;
  export default src;
}
declare module '*.vert' {
  const src: string;
  export default src;
}
declare module '*.frag' {
  const src: string;
  export default src;
}
