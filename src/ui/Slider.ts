import type { Store } from '../core/Store';
import type { ParamMeta, Params } from '../core/params';
import { trackToValue, valueToTrack } from '../core/params';

// A scrubbable slider row: click-drag anywhere on the track, Shift for fine
// control, the numeric value directly editable, arrow keys nudge (§7). Log
// scale honored via the param metadata.
export class Slider {
  readonly el: HTMLDivElement;
  private fill: HTMLDivElement;
  private tick: HTMLDivElement;
  private input: HTMLInputElement;
  private track: HTMLDivElement;
  private dragging = false;
  private unsub: () => void;

  constructor(private store: Store, private meta: ParamMeta) {
    const row = document.createElement('div');
    row.className = 'row';

    const top = document.createElement('div');
    top.className = 'row-top';
    const label = document.createElement('label');
    label.className = 'row-label';
    label.textContent = meta.label;
    this.input = document.createElement('input');
    this.input.className = 'row-value';
    this.input.setAttribute('aria-label', `${meta.label} value`);
    top.append(label, this.input);

    this.track = document.createElement('div');
    this.track.className = 'track';
    this.track.tabIndex = 0;
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', meta.label);
    this.fill = document.createElement('div');
    this.fill.className = 'track-fill';
    this.tick = document.createElement('div');
    this.tick.className = 'track-tick';
    this.track.append(this.fill, this.tick);

    row.append(top, this.track);

    // Plain-language help, revealed by the panel's "?" explain toggle.
    if (meta.help) {
      const help = document.createElement('div');
      help.className = 'row-help';
      help.textContent = meta.help;
      row.append(help);
    }
    this.el = row;

    this.track.addEventListener('pointerdown', this.onDown);
    this.track.addEventListener('keydown', this.onKey);
    this.input.addEventListener('change', this.onType);
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.input.blur(); });

    this.unsub = store.on('param', (key) => { if (key === meta.key) this.sync(); });
    this.sync();
  }

  private value(): number {
    return this.store.params[this.meta.key] as number;
  }

  private commit(v: number): void {
    const m = this.meta;
    const clamped = Math.min(m.max, Math.max(m.min, v));
    this.store.set(m.key as keyof Params, clamped, { reseed: m.reseeds, rebuild: m.rebuilds });
    this.sync();
  }

  private onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.track.setPointerCapture(e.pointerId);
    this.scrub(e);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  };
  private onMove = (e: PointerEvent): void => { if (this.dragging) this.scrub(e); };
  private onUp = (): void => {
    this.dragging = false;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  };

  private scrub(e: PointerEvent): void {
    const rect = this.track.getBoundingClientRect();
    let t = (e.clientX - rect.left) / rect.width;
    if (e.shiftKey) {
      // Fine mode: move relative to the current position at 1/6 gain.
      const cur = valueToTrack(this.meta, this.value());
      t = cur + (t - cur) * 0.16;
    }
    this.commit(trackToValue(this.meta, t));
  }

  private onKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? this.meta.step : this.meta.step * (this.meta.scale === 'log' ? 1 : 5);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { this.commit(this.value() + step); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { this.commit(this.value() - step); e.preventDefault(); }
  };

  private onType = (): void => {
    const v = parseFloat(this.input.value);
    if (!Number.isNaN(v)) this.commit(v);
    else this.sync();
  };

  sync(): void {
    const v = this.value();
    const t = valueToTrack(this.meta, v);
    this.fill.style.width = `${(t * 100).toFixed(2)}%`;
    this.tick.style.left = `calc(${(t * 100).toFixed(2)}% - 1px)`;
    this.track.setAttribute('aria-valuenow', v.toFixed(3));
    if (document.activeElement !== this.input) {
      this.input.value = this.meta.format ? this.meta.format(v) : formatNumber(v, this.meta.step, this.meta.unit);
    }
  }

  dispose(): void { this.unsub(); }
}

function formatNumber(v: number, step: number, unit?: string): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return `${v.toFixed(decimals)}${unit ? ' ' + unit : ''}`;
}
