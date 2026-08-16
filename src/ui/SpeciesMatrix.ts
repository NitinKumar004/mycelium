import type { Store } from '../core/Store';
import { activeSpecies } from '../sim/Simulation';

// The signature control (§7): the 4x4 species interaction matrix as a grid of
// drag-to-set cells with diverging red↔blue fill. Drag a cell vertically to set
// its weight in [-1,1]; red = attraction, blue = repulsion.
export class SpeciesMatrix {
  readonly el: HTMLDivElement;
  private cells: HTMLDivElement[] = [];
  private unsub: () => void;

  constructor(private store: Store) {
    const wrap = document.createElement('div');
    wrap.className = 'matrix';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Species interaction matrix');

    // Corner + column headers (j = sensed species).
    const corner = document.createElement('div');
    corner.className = 'matrix-corner';
    corner.textContent = 'i\\j';
    wrap.append(corner);
    for (let j = 0; j < 4; j++) {
      const h = document.createElement('div');
      h.className = 'matrix-h';
      h.textContent = String(j + 1);
      wrap.append(h);
    }

    for (let i = 0; i < 4; i++) {
      const rowLabel = document.createElement('div');
      rowLabel.className = 'matrix-v';
      rowLabel.textContent = String(i + 1);
      wrap.append(rowLabel);
      for (let j = 0; j < 4; j++) {
        const cell = document.createElement('div');
        cell.className = 'mcell';
        cell.tabIndex = 0;
        cell.setAttribute('role', 'slider');
        cell.setAttribute('aria-label', `Species ${i + 1} sensing species ${j + 1}`);
        this.bindCell(cell, i, j);
        this.cells[i * 4 + j] = cell;
        wrap.append(cell);
      }
    }

    this.el = wrap;
    this.unsub = store.on('param', (k) => { if (k === 'interaction' || k === 'speciesCount') this.sync(); });
    this.sync();
  }

  private bindCell(cell: HTMLDivElement, i: number, j: number): void {
    let dragging = false;
    let startY = 0;
    let startVal = 0;
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const dv = -(e.clientY - startY) / 90; // full range over ~180px
      this.store.setInteraction(i, j, clamp(startVal + dv));
      this.sync();
    };
    const onUp = (): void => {
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    cell.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      startVal = this.store.params.interaction[i * 4 + j] ?? 0;
      cell.setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    cell.addEventListener('keydown', (e) => {
      const cur = this.store.params.interaction[i * 4 + j] ?? 0;
      if (e.key === 'ArrowUp') { this.store.setInteraction(i, j, clamp(cur + 0.1)); this.sync(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this.store.setInteraction(i, j, clamp(cur - 0.1)); this.sync(); e.preventDefault(); }
      else if (e.key === '0') { this.store.setInteraction(i, j, 0); this.sync(); }
    });
  }

  sync(): void {
    const n = activeSpecies(this.store.params);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const cell = this.cells[i * 4 + j]!;
        const active = i < n && j < n;
        cell.classList.toggle('disabled', !active);
        const v = this.store.params.interaction[i * 4 + j] ?? 0;
        cell.style.background = divergingColor(v);
        cell.textContent = v === 0 ? '' : v.toFixed(1);
        cell.setAttribute('aria-valuenow', v.toFixed(2));
      }
    }
  }

  dispose(): void { this.unsub(); }
}

function clamp(v: number): number {
  return Math.round(Math.min(1, Math.max(-1, v)) * 100) / 100;
}

// Diverging red (attraction, +1) ↔ neutral ↔ blue (repulsion, -1).
function divergingColor(v: number): string {
  const t = (v + 1) / 2; // 0..1
  const neg = [58, 110, 165];
  const mid = [64, 58, 50];
  const pos = [181, 67, 42];
  const lerp = (a: number[], b: number[], k: number) => a.map((x, idx) => Math.round(x + (b[idx]! - x) * k));
  const c = t < 0.5 ? lerp(neg, mid, t * 2) : lerp(mid, pos, (t - 0.5) * 2);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
