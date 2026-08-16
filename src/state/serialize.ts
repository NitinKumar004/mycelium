import type { Params, SeedMode, BoundaryMode, Tonemap } from '../core/params';
import { defaultParams } from '../core/params';

// Full parameter state -> compact binary -> base64url -> URL hash (§8). A
// leading version byte lets the format evolve without breaking old links.

const VERSION = 1;
const SEED_MODES: SeedMode[] = ['random-uniform', 'center-disc-outward', 'ring-inward', 'two-clusters', 'image-mask'];
const BOUNDARIES: BoundaryMode[] = ['wrap', 'bounce', 'respawn'];
const TONEMAPS: Tonemap[] = ['agx', 'aces'];

// Byte size: 1 (ver) + 4 (count) + 4*4 + 4 (u8×4) + 3*4 + 16*4 + 3*4 + 1 (tone)
//          + 5*4 + 3*4 + 2 (res u16). Padded to a fixed 145.
const SIZE = 160;

export function encodeParams(p: Params): string {
  const buf = new ArrayBuffer(SIZE);
  const dv = new DataView(buf);
  let o = 0;
  const u8 = (v: number) => { dv.setUint8(o, v & 255); o += 1; };
  const u16 = (v: number) => { dv.setUint16(o, v & 0xffff, true); o += 2; };
  const u32 = (v: number) => { dv.setUint32(o, v >>> 0, true); o += 4; };
  const f = (v: number) => { dv.setFloat32(o, v, true); o += 4; };

  u8(VERSION);
  u32(p.agentCount);
  f(p.moveSpeed); f(p.turnSpeed); f(p.sensorAngle); f(p.sensorDistance);
  u8(p.sensorSize); u8(SEED_MODES.indexOf(p.seedMode)); u8(BOUNDARIES.indexOf(p.boundary)); u8(p.speciesCount);
  f(p.depositAmount); f(p.decayHalfLife); f(p.diffuseRate);
  for (let i = 0; i < 16; i++) f(p.interaction[i] ?? 0);
  f(p.exposure); f(p.bloomThreshold); f(p.bloomIntensity); u8(TONEMAPS.indexOf(p.tonemap));
  f(p.contrast); f(p.saturation); f(p.grain); f(p.vignette); f(p.aberration);
  f(p.zoom); f(p.panX); f(p.panY);
  u16(p.simResolution);

  return bytesToB64url(new Uint8Array(buf));
}

export function decodeParams(str: string): Params | null {
  try {
    const bytes = b64urlToBytes(str);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    const u8 = () => { const v = dv.getUint8(o); o += 1; return v; };
    const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
    const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
    const f = () => { const v = dv.getFloat32(o, true); o += 4; return v; };

    const ver = u8();
    if (ver !== VERSION) return null;
    const p = defaultParams();
    p.agentCount = u32();
    p.moveSpeed = f(); p.turnSpeed = f(); p.sensorAngle = f(); p.sensorDistance = f();
    p.sensorSize = u8(); p.seedMode = SEED_MODES[u8()] ?? 'random-uniform';
    p.boundary = BOUNDARIES[u8()] ?? 'wrap'; p.speciesCount = u8();
    p.depositAmount = f(); p.decayHalfLife = f(); p.diffuseRate = f();
    const m = new Float32Array(16);
    for (let i = 0; i < 16; i++) m[i] = f();
    p.interaction = m;
    p.exposure = f(); p.bloomThreshold = f(); p.bloomIntensity = f(); p.tonemap = TONEMAPS[u8()] ?? 'agx';
    p.contrast = f(); p.saturation = f(); p.grain = f(); p.vignette = f(); p.aberration = f();
    p.zoom = f(); p.panX = f(); p.panY = f();
    p.simResolution = u16();
    return p;
  } catch (e) {
    console.warn('[serialize] decode failed:', e);
    return null;
  }
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Write the current state into location.hash without triggering a navigation.
export function writeHash(p: Params): void {
  const enc = encodeParams(p);
  history.replaceState(null, '', `#${enc}`);
}

export function readHash(): Params | null {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  return decodeParams(h);
}
