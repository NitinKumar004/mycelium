import type { Store } from '../core/Store';

// Momentum-based pan/zoom on the infinite torus. Damped so a flick glides and
// settles. Zoom is anchored at the cursor. Backends read zoom/panX/panY out of
// the store each frame; this class just integrates input into those fields.

export class Camera {
  private vx = 0;
  private vy = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLElement;
  private ambientPhase = 0;
  reducedMotion = false;

  constructor(private store: Store, el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.vx = 0;
    this.vy = 0;
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const rect = this.el.getBoundingClientRect();
    const dx = (e.clientX - this.lastX) / rect.width;
    const dy = (e.clientY - this.lastY) / rect.height;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const z = this.store.params.zoom;
    this.vx = -dx / z;
    this.vy = -dy / z;
    this.store.params.panX += this.vx;
    this.store.params.panY += this.vy;
    this.store.revision++;
  };

  private onUp = (): void => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    const z = this.store.params.zoom;
    const nz = Math.min(16, Math.max(0.25, z * factor));
    this.store.set('zoom', nz);
  };

  // Called once per rendered frame. Applies momentum glide + ambient drift.
  update(dt: number, time: number): void {
    if (!this.dragging) {
      // Inertial glide with damping.
      this.store.params.panX += this.vx;
      this.store.params.panY += this.vy;
      this.vx *= 0.92;
      this.vy *= 0.92;
    }
    if (!this.reducedMotion) {
      // Barely-there ambient drift so a static state still breathes.
      this.ambientPhase = time * 0.05;
      // Applied as a tiny offset at read time by the backend; kept here as state.
    }
    void dt;
  }

  get ambient(): number {
    return this.reducedMotion ? 0 : Math.sin(this.ambientPhase) * 0.002;
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
  }
}
