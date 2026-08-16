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
  // Pan only fires when this returns true (so the Paint/Erase tools can own the
  // left button instead). Middle-mouse always pans regardless.
  panEnabled: () => boolean = () => true;

  constructor(private store: Store, el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onDown = (e: PointerEvent): void => {
    // Left button pans only when the Move tool is active; middle button always.
    const panLeft = e.button === 0 && this.panEnabled();
    const panMiddle = e.button === 1;
    if (!panLeft && !panMiddle) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.vx = 0;
    this.vy = 0;
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const rect = this.el.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const dx = (e.clientX - this.lastX) / rect.width;
    const dy = (e.clientY - this.lastY) / rect.height;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const z = this.store.params.zoom;
    // X carries the same aspect factor the composite/brush transforms use, so
    // the grabbed point stays under the cursor and diagonal drags don't skew.
    this.vx = (-dx * aspect) / z;
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
    if (nz === z) return;
    // Zoom toward the cursor: keep the world point under the pointer fixed.
    const rect = this.el.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const sx = ((e.clientX - rect.left) / rect.width - 0.5) * aspect;
    const sy = (e.clientY - rect.top) / rect.height - 0.5;
    this.store.params.panX += sx * (1 / z - 1 / nz);
    this.store.params.panY += sy * (1 / z - 1 / nz);
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
