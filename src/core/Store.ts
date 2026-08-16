import type { Params } from './params';
import { defaultParams } from './params';

// A single reactive store. No state library — a typed object plus a
// subscribe/notify pattern is faster and allocation-free on the hot path.
//
// Two notification channels:
//   - 'param'   fires when any live parameter changes (UI + sim read this).
//   - 'reseed'  fires when a change requires rebuilding agent buffers.
//   - 'rebuild' fires when a change requires reallocating GPU resources.

export type StoreEvent = 'param' | 'reseed' | 'rebuild';
type Listener = (key: keyof Params) => void;

export class Store {
  readonly params: Params = defaultParams();
  private listeners: Record<StoreEvent, Set<Listener>> = {
    param: new Set(),
    reseed: new Set(),
    rebuild: new Set(),
  };
  // A monotonically increasing revision so consumers can cheaply detect change.
  revision = 0;

  on(event: StoreEvent, fn: Listener): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit(event: StoreEvent, key: keyof Params): void {
    for (const fn of this.listeners[event]) fn(key);
  }

  // Set a single scalar/enum field.
  set<K extends keyof Params>(key: K, value: Params[K], opts?: { reseed?: boolean; rebuild?: boolean }): void {
    if (this.params[key] === value) return;
    this.params[key] = value;
    this.revision++;
    if (opts?.rebuild) this.emit('rebuild', key);
    if (opts?.reseed) this.emit('reseed', key);
    this.emit('param', key);
  }

  // Mutate the interaction matrix in place (avoids reallocating the Float32Array).
  setInteraction(i: number, j: number, value: number): void {
    const idx = i * 4 + j;
    if (this.params.interaction[idx] === value) return;
    this.params.interaction[idx] = value;
    this.revision++;
    this.emit('param', 'interaction');
  }

  // Replace the whole parameter set (preset load / URL restore). Fires reseed +
  // rebuild + param so every subsystem resynchronizes.
  replaceAll(next: Params): void {
    // Keep the store's OWN interaction buffer — Object.assign would otherwise
    // adopt the caller's array (aliasing a preset's Float32Array), so later
    // setInteraction() would silently mutate that preset.
    const buf = this.params.interaction;
    Object.assign(this.params, next);
    this.params.interaction = buf;
    buf.set(next.interaction);
    this.revision++;
    this.emit('rebuild', 'agentCount');
    this.emit('reseed', 'agentCount');
    this.emit('param', 'agentCount');
  }

  // Force a param notification without changing a value (e.g. after resetting
  // pan, so persistence/redraw hooks still fire).
  touch(): void {
    this.revision++;
    this.emit('param', 'panX');
  }
}
