import type { Store } from '../core/Store';
import type { ParamGroup, Params, SeedMode, BoundaryMode, Tonemap } from '../core/params';
import { PARAM_META, GROUP_HELP } from '../core/params';
import { Slider } from './Slider';
import { SpeciesMatrix } from './SpeciesMatrix';
import { PRESETS } from '../presets/presets';

export interface PanelActions {
  reseed(): void;
  copyLink(): void;
  exportPNG(): void;
  toggleRecord(): boolean;
  loadPreset(name: string): void;
  morphTo(name: string): void;
  dropImage(file: File): void;
}

const GROUP_ORDER: ParamGroup[] = ['Agents', 'Chemistry', 'Species', 'Look', 'Camera'];

export class Panel {
  private root: HTMLElement;
  private sliders: Slider[] = [];
  private matrix?: SpeciesMatrix;
  collapsed = false;

  constructor(private store: Store, private actions: PanelActions) {
    this.root = document.getElementById('chassis')!;
    this.build();
    this.mountToasts();
  }

  private build(): void {
    this.root.innerHTML = '';

    // Head with live indicator + adapter line (filled by main) + explain toggle.
    const head = document.createElement('div');
    head.className = 'panel-head';
    head.innerHTML = `
      <div>
        <div class="panel-title"><span class="live-dot"></span>Mycelium</div>
        <div class="panel-sub" id="adapterline">— transport network</div>
      </div>`;
    const right = document.createElement('div');
    right.style.textAlign = 'right';
    const explain = document.createElement('button');
    explain.className = 'explain-toggle';
    explain.type = 'button';
    explain.textContent = '? Explain';
    explain.title = 'Show a plain-language description under every control';
    explain.setAttribute('aria-pressed', 'false');
    explain.addEventListener('click', () => {
      const on = this.root.classList.toggle('explain');
      explain.setAttribute('aria-pressed', String(on));
      explain.classList.toggle('signal', on);
    });
    const tab = document.createElement('div');
    tab.className = 'panel-sub';
    tab.textContent = 'Tab ⟶ hide';
    right.append(explain, tab);
    head.append(right);
    this.root.append(head);

    const body = document.createElement('div');
    body.className = 'panel-body';
    this.root.append(body);

    // Preset selector.
    body.append(this.buildPresets());

    // Parameter groups.
    for (const g of GROUP_ORDER) body.append(this.buildGroup(g));

    // Action buttons.
    body.append(this.buildActions());
  }

  private buildPresets(): HTMLElement {
    const g = document.createElement('div');
    g.className = 'group';
    const wrap = document.createElement('div');
    wrap.style.padding = '12px 16px 4px';
    const sel = document.createElement('select');
    sel.className = 'preset';
    sel.setAttribute('aria-label', 'Preset');
    for (const p of PRESETS) {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.name; sel.append(o);
    }
    const desc = document.createElement('div');
    desc.className = 'preset-desc';
    desc.textContent = PRESETS[0]!.description;
    const updateDesc = () => { desc.textContent = PRESETS.find((p) => p.name === sel.value)?.description ?? ''; };
    sel.addEventListener('change', () => { updateDesc(); this.actions.loadPreset(sel.value); });

    const morphBtn = document.createElement('button');
    morphBtn.className = 'btn';
    morphBtn.textContent = 'Morph 6s';
    morphBtn.style.marginTop = '8px';
    morphBtn.addEventListener('click', () => this.actions.morphTo(sel.value));

    wrap.append(sel, desc, morphBtn);
    g.append(wrap);
    return g;
  }

  private buildGroup(group: ParamGroup): HTMLElement {
    const g = document.createElement('div');
    g.className = 'group';
    // Keep the panel short: only Agents + Chemistry open by default; the rest
    // fold away until the user expands them.
    if (group === 'Species' || group === 'Look' || group === 'Camera') g.classList.add('folded');
    const head = document.createElement('button');
    head.className = 'group-head';
    head.innerHTML = `<span>${group}</span><span class="group-caret">▾</span>`;
    head.addEventListener('click', () => g.classList.toggle('folded'));
    const gbody = document.createElement('div');
    gbody.className = 'group-body';
    g.append(head, gbody);

    // Group-level plain-language description (shown in explain mode).
    const gdesc = document.createElement('div');
    gdesc.className = 'group-desc';
    gdesc.textContent = GROUP_HELP[group];
    gbody.append(gdesc);

    // Sliders belonging to this group.
    for (const meta of PARAM_META.filter((m) => m.group === group)) {
      const s = new Slider(this.store, meta);
      this.sliders.push(s);
      gbody.append(s.el);
    }

    // Special controls per group.
    if (group === 'Agents') {
      gbody.append(this.segmented<SeedMode>('Seed', ['random-uniform', 'center-disc-outward', 'ring-inward', 'two-clusters', 'image-mask'],
        () => this.store.params.seedMode, (v) => { this.store.set('seedMode', v, { reseed: true }); this.actions.reseed(); },
        undefined, 'Where agents start from. Picking one restarts the simulation.'));
      gbody.append(this.segmented<BoundaryMode>('Boundary', ['wrap', 'bounce', 'respawn'],
        () => this.store.params.boundary, (v) => this.store.set('boundary', v),
        undefined, 'What happens at the edges: Wrap teleports to the opposite side (endless), Bounce reflects, Respawn drops the agent back randomly.'));
      gbody.append(this.buildImageDrop());
    }
    if (group === 'Species') {
      this.matrix = new SpeciesMatrix(this.store);
      const l = document.createElement('div'); l.className = 'field-label'; l.textContent = 'Interaction matrix (drag ↕)';
      const mhelp = document.createElement('div');
      mhelp.className = 'row-help';
      mhelp.textContent = 'Drag a cell up/down to set how much one species is pulled toward another\'s trail. Red = attract, blue = avoid. This is the single most powerful creative control.';
      gbody.append(l, this.matrix.el, mhelp);
    }
    if (group === 'Look') {
      gbody.append(this.segmented<Tonemap>('Tonemap', ['agx', 'aces'],
        () => this.store.params.tonemap, (v) => this.store.set('tonemap', v),
        undefined, 'The film-style color curve. AgX keeps colors natural in bright glowing areas; ACES is punchier.'));
    }
    if (group === 'Camera') {
      gbody.append(this.segmented<number>('Sim resolution', [1024, 2048, 4096],
        () => this.store.params.simResolution, (v) => this.store.set('simResolution', v, { rebuild: true }),
        (v) => `${v}`, 'Detail of the simulation grid. Higher = finer veins but heavier on the GPU.'));
      const reset = document.createElement('button');
      reset.className = 'btn';
      reset.textContent = 'Reset view';
      reset.addEventListener('click', () => {
        this.store.set('zoom', 1); this.store.params.panX = 0; this.store.params.panY = 0; this.store.revision++;
        this.sync();
      });
      gbody.append(reset);
    }

    return g;
  }

  private segmented<T extends string | number>(label: string, options: T[], get: () => T, set: (v: T) => void, fmt?: (v: T) => string, help?: string): HTMLElement {
    const wrap = document.createElement('div');
    const l = document.createElement('div'); l.className = 'field-label'; l.textContent = label;
    const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group');
    const buttons: HTMLButtonElement[] = [];
    for (const opt of options) {
      const b = document.createElement('button');
      b.textContent = fmt ? fmt(opt) : String(opt).replace(/-/g, ' ');
      b.setAttribute('aria-pressed', String(get() === opt));
      b.addEventListener('click', () => {
        set(opt);
        for (const bb of buttons) bb.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', 'true');
      });
      buttons.push(b);
      seg.append(b);
    }
    wrap.append(l, seg);
    if (help) {
      const h = document.createElement('div');
      h.className = 'row-help';
      h.textContent = help;
      wrap.append(h);
    }
    return wrap;
  }

  private buildImageDrop(): HTMLElement {
    const wrap = document.createElement('div');
    const l = document.createElement('label');
    l.className = 'btn';
    l.style.display = 'block';
    l.style.textAlign = 'center';
    l.textContent = 'Drop / choose seed image';
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
    input.addEventListener('change', () => { if (input.files?.[0]) this.actions.dropImage(input.files[0]); });
    l.append(input);
    l.addEventListener('dragover', (e) => { e.preventDefault(); });
    l.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) this.actions.dropImage(f);
    });
    wrap.append(l);
    return wrap;
  }

  private buildActions(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'btnrow';
    const mk = (label: string, fn: () => void, signal = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'btn' + (signal ? ' signal' : '');
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    row.append(mk('Reseed agents', () => this.actions.reseed(), true));
    row.append(mk('Copy link', () => this.actions.copyLink()));
    row.append(mk('Save PNG', () => this.actions.exportPNG()));
    const rec = mk('Record', () => {
      const on = this.actions.toggleRecord();
      rec.textContent = on ? 'Stop ●' : 'Record';
      rec.classList.toggle('signal', on);
    });
    row.append(rec);
    return row;
  }

  private mountToasts(): void {
    if (!document.getElementById('toasts')) {
      const t = document.createElement('div'); t.id = 'toasts';
      document.body.append(t);
    }
  }

  setAdapterLine(text: string): void {
    const el = document.getElementById('adapterline');
    if (el) el.textContent = text;
  }

  toggle(): void {
    this.setCollapsed(!this.collapsed);
  }

  setCollapsed(v: boolean): void {
    this.collapsed = v;
    this.root.classList.toggle('collapsed', v);
  }

  // Re-sync every control after a bulk parameter change (preset / URL / morph).
  sync(): void {
    for (const s of this.sliders) s.sync();
    this.matrix?.sync();
  }

  dispose(): void {
    for (const s of this.sliders) s.dispose();
    this.matrix?.dispose();
  }
}

// Toast helper. Copy is plain, active-voice; the label matches the control (§7).
export function toast(message: string): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  host.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

export type { Params };
