// Capability detection: choose the WebGPU path where available, else WebGL2.
// Both paths must be visually identical (§2), so the only thing that leaks out
// of here is which backend to instantiate.

export type Backend = 'webgpu' | 'webgl2';

export interface Capability {
  backend: Backend;
  device?: GPUDevice;
  adapterInfo?: string;
  maxTextureDim: number;
  timestampQuery: boolean;
}

export async function detectCapability(_canvas: HTMLCanvasElement): Promise<Capability> {
  const forced = new URLSearchParams(location.search).get('backend');

  if (forced !== 'webgl2' && 'gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const wantTimestamp = adapter.features.has('timestamp-query');
        const device = await adapter.requestDevice({
          requiredFeatures: wantTimestamp ? ['timestamp-query'] : [],
          requiredLimits: {
            maxStorageBufferBindingSize: Math.min(
              adapter.limits.maxStorageBufferBindingSize,
              256 * 1024 * 1024,
            ),
          },
        });
        const info = adapter.info ?? (await (adapter as any).requestAdapterInfo?.());
        return {
          backend: 'webgpu',
          device,
          adapterInfo: info ? `${info.vendor ?? ''} ${info.architecture ?? info.description ?? ''}`.trim() : 'WebGPU',
          maxTextureDim: device.limits.maxTextureDimension2D,
          timestampQuery: wantTimestamp,
        };
      }
    } catch (e) {
      console.warn('[capability] WebGPU init failed, falling back to WebGL2:', e);
    }
  }

  // WebGL2 fallback. Probe on a THROWAWAY canvas so the real canvas can still
  // hand the WebGL2Simulation a pristine context (a canvas returns only one).
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2', { antialias: false });
  if (!gl) {
    throw new Error('Neither WebGPU nor WebGL2 is available in this browser.');
  }
  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float');
  if (!colorBufferFloat) {
    console.warn('[capability] EXT_color_buffer_float missing — float render targets unavailable.');
  }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : 'WebGL2';
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  return {
    backend: 'webgl2',
    adapterInfo: renderer,
    maxTextureDim: 4096,
    timestampQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
  };
}
