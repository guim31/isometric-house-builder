/**
 * The isometric viewport: what gets exported, and where things are inspected.
 */

import { renderScene } from '../render/svg.js';
import { hitLayer } from '../render/hit.js';
import { boundaryEdges } from '../core/grid.js';
import { cellSet } from '../core/model.js';
import { OPENING_DEFAULTS } from './plan.js';
import { newId } from '../core/model.js';

export class Viewport {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.zoom = 1;
    this.pan = [0, 0];
    this.drag = null;
    this.lastRender = null;
    this.bindEvents();
  }

  render() {
    const r = this.root.getBoundingClientRect();
    const width = Math.max(320, Math.round(r.width));
    const height = Math.max(240, Math.round(r.height));
    const m = this.store.model;
    // The on-screen view always has a background; only exports honour the
    // transparent setting, where it is what makes the image drop cleanly onto
    // a dashboard of any colour.
    const shown = { ...m, style: { ...m.style, background: 'transparent' } };
    const out = renderScene(shown, {
      width, height, zoom: this.zoom, panX: this.pan[0], panY: this.pan[1],
    });
    this.lastRender = out;

    const hits = hitLayer(m, out.camera);
    const selected = this.selectionOverlay(out.camera);
    this.root.innerHTML = out.svg.replace(
      '</svg>',
      `<g class="hit-layer">${hits}</g>${selected}</svg>`,
    );
    this.svg = this.root.querySelector('svg');
  }

  /** A dashed outline over whatever is selected. */
  selectionOverlay(camera) {
    const sel = this.store.selection;
    if (!sel) return '';
    const item = this.store.selected;
    if (!item) return '';
    const pts = [];
    if (sel.type === 'prop' || sel.type === 'roofItem') {
      const centred = item.kind === 'tree' || item.kind === 'bush' || item.kind === 'car' || sel.type === 'roofItem';
      const w = item.r ? item.r * 2 : item.w ?? 2;
      const d = item.r ? item.r * 2 : item.d ?? 2;
      const x0 = centred ? item.x - w / 2 : item.x;
      const y0 = centred ? item.y - d / 2 : item.y;
      const z = sel.type === 'roofItem' ? 6 : 0.06;
      pts.push([x0, y0, z], [x0 + w, y0, z], [x0 + w, y0 + d, z], [x0, y0 + d, z]);
    } else if (sel.type === 'opening') {
      const e = boundaryEdges(cellSet(this.store.model)).find((x) => x.id === item.edge);
      if (!e) return '';
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const u = [(e.b[0] - e.a[0]) / len, (e.b[1] - e.a[1]) / len];
      const m = this.store.model;
      const zb = m.plinth + (item.storey || 0) * m.storeyHeight + (item.sill ?? 0);
      const w = item.width ?? 1.2, h = item.height ?? 1.25, c = item.offset ?? 0.5;
      const p = (s, z) => [e.a[0] + u[0] * s + e.n[0] * 0.06, e.a[1] + u[1] * s + e.n[1] * 0.06, z];
      pts.push(p(c - w / 2, zb), p(c + w / 2, zb), p(c + w / 2, zb + h), p(c - w / 2, zb + h));
    }
    if (!pts.length) return '';
    const d = pts.map((p, i) => {
      const s = camera.toScreen(p);
      return `${i === 0 ? 'M' : 'L'}${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
    }).join('') + 'Z';
    return `<path d="${d}" class="selection-outline" fill="none"/>`;
  }

  bindEvents() {
    const s = this.store;

    this.root.addEventListener('pointerdown', (ev) => {
      const pick = ev.target.dataset?.pick;
      if (ev.button === 1 || ev.shiftKey || !pick) {
        this.drag = { from: [ev.clientX, ev.clientY], pan: [...this.pan] };
        this.root.setPointerCapture?.(ev.pointerId);
        if (!pick) s.select(null);
        return;
      }
      if (pick === 'wall') {
        const tool = s.tool;
        if (OPENING_DEFAULTS[tool]) {
          this.addOpening(tool, ev.target.dataset.edge, Number(ev.target.dataset.storey), ev);
        }
        return;
      }
      s.select({ type: pick, id: ev.target.dataset.id });
    });

    this.root.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      this.pan = [
        this.drag.pan[0] + (ev.clientX - this.drag.from[0]),
        this.drag.pan[1] + (ev.clientY - this.drag.from[1]),
      ];
      this.render();
    });
    const end = () => { this.drag = null; };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);

    this.root.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoom = Math.max(0.4, Math.min(5, this.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
      this.render();
    }, { passive: false });
  }

  /** Place an opening where the wall was actually clicked, not at its centre. */
  addOpening(kind, edgeId, storey, ev) {
    const camera = this.lastRender?.camera;
    const e = boundaryEdges(cellSet(this.store.model)).find((x) => x.id === edgeId);
    if (!camera || !e) return;
    const rect = this.svg.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const a = camera.toScreen([e.a[0], e.a[1], 0]);
    const b = camera.toScreen([e.b[0], e.b[1], 0]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
    const id = newId('o');
    this.store.update((m) => ({
      ...m,
      openings: [...m.openings, {
        id, edge: edgeId, storey: storey || 0, kind,
        offset: Math.round(t * 4) / 4 || 0.5, ...OPENING_DEFAULTS[kind],
      }],
    }));
    this.store.select({ type: 'opening', id });
  }

  resetView() {
    this.zoom = 1;
    this.pan = [0, 0];
    this.render();
  }
}
