// Per-species emission colors. Written into the render uniform's `colors[]`.
// Chosen to read as living tissue under bloom: warm amber, arterial red,
// cyan-phosphor, and a violet. Values are linear RGB with a gain in .a.

export interface SpeciesColor {
  r: number;
  g: number;
  b: number;
  gain: number;
}

// sRGB hex -> linear rgb.
function srgbToLinear(hex: number): [number, number, number] {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

const DEFAULTS = [0xffb347, 0xff4d5e, 0x35e0d8, 0xb388ff];

// Fill a Float32Array(16) as 4 × vec4(r,g,b,gain) for the render uniform.
export function writePalette(out: Float32Array, gain = 1.4): void {
  for (let s = 0; s < 4; s++) {
    const [r, g, b] = srgbToLinear(DEFAULTS[s]!);
    out[s * 4 + 0] = r;
    out[s * 4 + 1] = g;
    out[s * 4 + 2] = b;
    out[s * 4 + 3] = gain;
  }
}
