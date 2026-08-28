/**
 * Top-down plan view: where the footprint is drawn and everything is placed.
 *
 * Painting a shape from above is far more direct than manipulating it in
 * perspective, so this view owns creation and placement, while the isometric
 * view owns inspection and export.
 */

import { key, parseKey, boundaryEdges, SIDES } from '../core/grid.js';
import { cellSet } from '../core/model.js';
import { newId } from '../core/model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Default footprint of each placeable item, in metres. */
export const PROP_DEFAULTS = {
  pool: { w: 7, d: 4, shape: 'rounded' },
  terrace: { w: 6, d: 4, material: 'paving' },
  path: { w: 3, d: 2, material: 'gravel' },
  deck: { w: 5, d: 3 },
  hedge: { w: 4, d: 0.6, h: 0.8 },
  fence: { w: 6, d: 0.2, h: 1.1 },
  tree: { r: 1.5 },
  bush: { r: 1.1 },
  car: { w: 1.8, d: 4.2 },
};

export const ROOF_ITEM_DEFAULTS = {
  solar: { w: 4, d: 2.4 },
  chimney: { w: 0.8, d: 0.8, h: 1.1 },
  velux: { w: 1, d: 1.2 },
  dish: { w: 0.8, d: 0.8 },
};

export const OPENING_DEFAULTS = {
  window: { width: 1.3, height: 1.3, sill: 0.95 },
  shutter: { width: 1.3, height: 1.3, sill: 0.95 },
  door: { width: 1.0, height: 2.1, sill: 0 },
  garage: { width: 2.6, height: 2.1, sill: 0 },
};

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

export class PlanView {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.svg = el('svg', { class: 'plan-svg' });
    this.root.appendChild(this.svg);
    this.zoom = 1;
    this.pan = [0, 0];
    this.drag = null;
    this.bindEvents();
  }

  /** Metres per pixel mapping, refitted whenever the footprint changes. */
  layout() {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(200, r.width);
    const h = Math.max(200, r.height);
    const m = this.store.model;
    const cells = cellSet(m);
    let i0 = 12, j0 = 12, i1 = 28, j1 = 28;
    if (cells.size) {
      i0 = Infinity; j0 = Infinity; i1 = -Infinity; j1 = -Infinity;
      for (const k of cells) {
        const [i, j] = parseKey(k);
        i0 = Math.min(i0, i); j0 = Math.min(j0, j);
        i1 = Math.max(i1, i + 1); j1 = Math.max(j1, j + 1);
      }
    }
    for (const p of m.props) {
      const centred = p.kind === 'tree' || p.kind === 'bush' || p.kind === 'car';
      const pw = p.r ? p.r * 2 : p.w ?? 2;
      const pd = p.r ? p.r * 2 : p.d ?? 2;
      const px = centred ? p.x - pw / 2 : p.x;
      const py = centred ? p.y - pd / 2 : p.y;
      i0 = Math.min(i0, px); j0 = Math.min(j0, py);
      i1 = Math.max(i1, px + pw); j1 = Math.max(j1, py + pd);
    }
    const pad = 4;
    i0 -= pad; j0 -= pad; i1 += pad; j1 += pad;
    const scale = Math.min(w / (i1 - i0), h / (j1 - j0)) * this.zoom;
    this.map = {
      w, h, scale,
      ox: w / 2 - ((i0 + i1) / 2) * scale + this.pan[0],
      // Screen y grows downward while the model's y grows north, so the plan
      // is flipped: north stays up, as anyone reading a plan expects.
      oy: h / 2 + ((j0 + j1) / 2) * scale + this.pan[1],
      i0, j0, i1, j1,
    };
    return this.map;
  }

  toPx(x, y) { return [x * this.map.scale + this.map.ox, -y * this.map.scale + this.map.oy]; }
  toWorld(px, py) {
    return [(px - this.map.ox) / this.map.scale, -(py - this.map.oy) / this.map.scale];
  }

  eventPoint(ev) {
    const r = this.svg.getBoundingClientRect();
    return this.toWorld(ev.clientX - r.left, ev.clientY - r.top);
  }

  render() {
    const m = this.store.model;
    const map = this.layout();
    const cells = cellSet(m);
    // Explicit pixel size, not just a viewBox: if the two ever disagree the
    // browser letterboxes the drawing, which shows up as an unruled band along
    // one edge of the panel.
    this.svg.setAttribute('width', map.w);
    this.svg.setAttribute('height', map.h);
    this.svg.setAttribute('viewBox', `0 0 ${map.w} ${map.h}`);
    this.svg.replaceChildren();

    const g = (cls) => { const n = el('g', { class: cls }); this.svg.appendChild(n); return n; };
    const gGrid = g('plan-grid');
    const gProps = g('plan-props');
    const gCells = g('plan-cells');
    const gEdges = g('plan-edges');
    const gRoof = g('plan-roof');
    const gOpen = g('plan-openings');

    // Grid, spanning the whole panel rather than just the fitted box: an
    // unruled margin reads as "outside the drawing area", which it is not.
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(map.w, map.h);
    const gx0 = Math.floor(Math.min(tl[0], br[0])), gx1 = Math.ceil(Math.max(tl[0], br[0]));
    const gy0 = Math.floor(Math.min(tl[1], br[1])), gy1 = Math.ceil(Math.max(tl[1], br[1]));
    const step = map.scale < 9 ? 5 : 1;
    for (let i = gx0; i <= gx1; i++) {
      if (i % step) continue;
      const a = this.toPx(i, gy0), b = this.toPx(i, gy1);
      gGrid.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: i % 5 ? '' : 'major' }));
    }
    for (let j = gy0; j <= gy1; j++) {
      if (j % step) continue;
      const a = this.toPx(gx0, j), b = this.toPx(gx1, j);
      gGrid.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: j % 5 ? '' : 'major' }));
    }

    // Ground items, drawn under the house.
    for (const p of m.props) {
      const centred = p.kind === 'tree' || p.kind === 'bush' || p.kind === 'car';
      const pw = p.r ? p.r * 2 : p.w ?? 2;
      const pd = p.r ? p.r * 2 : p.d ?? 2;
      const px = centred ? p.x - pw / 2 : p.x;
      const py = centred ? p.y - pd / 2 : p.y;
      const a = this.toPx(px, py + pd);
      const selected = this.store.selection?.id === p.id;
      const shape = p.kind === 'tree' || p.kind === 'bush'
        ? el('circle', { cx: a[0] + (pw * map.scale) / 2, cy: a[1] + (pd * map.scale) / 2, r: (pw * map.scale) / 2 })
        : el('rect', { x: a[0], y: a[1], width: pw * map.scale, height: pd * map.scale, rx: p.kind === 'pool' ? 8 : 2 });
      shape.setAttribute('class', `prop prop-${p.kind}${selected ? ' selected' : ''}`);
      shape.dataset.id = p.id;
      shape.dataset.type = 'prop';
      gProps.appendChild(shape);
    }

    // Footprint.
    for (const k of cells) {
      const [i, j] = parseKey(k);
      const a = this.toPx(i, j + 1);
      gCells.appendChild(el('rect', {
        x: a[0], y: a[1], width: map.scale, height: map.scale, class: 'cell',
      }));
    }

    // Exterior walls, thicker so they read as the building outline.
    for (const e of boundaryEdges(cells)) {
      const a = this.toPx(e.a[0], e.a[1]);
      const b = this.toPx(e.b[0], e.b[1]);
      const line = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'edge' });
      line.dataset.edge = e.id;
      gEdges.appendChild(line);
    }

    // Openings, as marks straddling their wall.
    const byId = new Map(boundaryEdges(cells).map((e) => [e.id, e]));
    for (const op of m.openings) {
      const e = byId.get(op.edge);
      if (!e) continue;
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const u = [(e.b[0] - e.a[0]) / len, (e.b[1] - e.a[1]) / len];
      const c = op.offset ?? 0.5;
      const w = (op.width ?? 1.2) / 2;
      const p0 = this.toPx(e.a[0] + u[0] * (c - w), e.a[1] + u[1] * (c - w));
      const p1 = this.toPx(e.a[0] + u[0] * (c + w), e.a[1] + u[1] * (c + w));
      const line = el('line', {
        x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1],
        class: `opening opening-${op.kind}${this.store.selection?.id === op.id ? ' selected' : ''}`,
      });
      line.dataset.id = op.id;
      line.dataset.type = 'opening';
      gOpen.appendChild(line);
    }

    // Roof items.
    for (const it of m.roofItems) {
      const w = it.w ?? 2, d = it.d ?? 1.5;
      const a = this.toPx(it.x - w / 2, it.y + d / 2);
      const r = el('rect', {
        x: a[0], y: a[1], width: w * map.scale, height: d * map.scale,
        class: `roof-item roof-${it.kind}${this.store.selection?.id === it.id ? ' selected' : ''}`,
      });
      r.dataset.id = it.id;
      r.dataset.type = 'roofItem';
      gRoof.appendChild(r);
    }
  }

  /** Nearest exterior wall to a world point, within `maxDist` metres. */
  nearestEdge(pt, maxDist = 1.5) {
    const cells = cellSet(this.store.model);
    let best = null, bestD = maxDist;
    for (const e of boundaryEdges(cells)) {
      const ax = e.a[0], ay = e.a[1], bx = e.b[0], by = e.b[1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pt[0] - (ax + dx * t), pt[1] - (ay + dy * t));
      if (d < bestD) { bestD = d; best = { edge: e, t }; }
    }
    return best;
  }

  bindEvents() {
    const s = this.store;

    this.svg.addEventListener('pointerdown', (ev) => {
      // Capture is a convenience, not a requirement: synthetic pointers (and
      // some browsers) reject an id they never issued.
      try { this.svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      const pt = this.eventPoint(ev);
      const tool = s.tool;

      if (ev.button === 1 || ev.shiftKey && tool === 'select') {
        this.drag = { mode: 'pan', from: [ev.clientX, ev.clientY], pan: [...this.pan] };
        return;
      }

      if (tool === 'paint' || tool === 'erase') {
        this.drag = { mode: 'brush', erase: tool === 'erase' || ev.altKey };
        this.paintAt(pt, this.drag.erase, true);
        return;
      }
      if (tool === 'rect') {
        this.drag = { mode: 'rect', from: pt, erase: ev.altKey };
        return;
      }
      if (tool === 'select') {
        const target = ev.target.dataset?.type ? ev.target : null;
        if (target) {
          s.select({ type: target.dataset.type, id: target.dataset.id });
          const item = s.selected;
          this.drag = { mode: 'move', from: pt, origin: item ? { x: item.x, y: item.y } : null };
        } else {
          s.select(null);
        }
        return;
      }
      if (OPENING_DEFAULTS[tool]) { this.placeOpening(tool, pt); return; }
      if (ROOF_ITEM_DEFAULTS[tool]) { this.placeRoofItem(tool, pt); return; }
      if (PROP_DEFAULTS[tool]) { this.placeProp(tool, pt); return; }
    });

    this.svg.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const pt = this.eventPoint(ev);
      if (this.drag.mode === 'pan') {
        this.pan = [
          this.drag.pan[0] + (ev.clientX - this.drag.from[0]),
          this.drag.pan[1] + (ev.clientY - this.drag.from[1]),
        ];
        this.render();
      } else if (this.drag.mode === 'brush') {
        this.paintAt(pt, this.drag.erase, false);
      } else if (this.drag.mode === 'rect') {
        this.drag.to = pt;
        this.previewRect();
      } else if (this.drag.mode === 'move' && this.drag.origin) {
        const dx = pt[0] - this.drag.from[0];
        const dy = pt[1] - this.drag.from[1];
        const snap = (v) => Math.round(v * 4) / 4;
        s.patchSelected({
          x: snap(this.drag.origin.x + dx),
          y: snap(this.drag.origin.y + dy),
        }, 'move');
      }
    });

    const finish = () => {
      if (this.drag?.mode === 'rect' && this.drag.to) this.commitRect();
      this.drag = null;
      s.commit();
      this.render();
    };
    this.svg.addEventListener('pointerup', finish);
    this.svg.addEventListener('pointercancel', finish);

    this.svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoom = Math.max(0.35, Math.min(6, this.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
      this.render();
    }, { passive: false });
  }

  paintAt(pt, erase, fresh) {
    const i = Math.floor(pt[0]), j = Math.floor(pt[1]);
    const k = key(i, j);
    const s = this.store;
    const cells = cellSet(s.model);
    if (erase ? !cells.has(k) : cells.has(k)) { if (!fresh) return; }
    s.update((m) => {
      const set = cellSet(m);
      if (erase) set.delete(k); else set.add(k);
      return { ...m, cells: [...set].sort() };
    }, { coalesce: 'brush' });
    this.render();
  }

  previewRect() {
    this.render();
    const [a, b] = [this.drag.from, this.drag.to];
    const x0 = Math.min(Math.floor(a[0]), Math.floor(b[0]));
    const y0 = Math.min(Math.floor(a[1]), Math.floor(b[1]));
    const x1 = Math.max(Math.floor(a[0]), Math.floor(b[0])) + 1;
    const y1 = Math.max(Math.floor(a[1]), Math.floor(b[1])) + 1;
    const p = this.toPx(x0, y1);
    this.svg.appendChild(el('rect', {
      x: p[0], y: p[1],
      width: (x1 - x0) * this.map.scale, height: (y1 - y0) * this.map.scale,
      class: this.drag.erase ? 'rect-preview erase' : 'rect-preview',
    }));
  }

  commitRect() {
    const [a, b] = [this.drag.from, this.drag.to];
    const x0 = Math.min(Math.floor(a[0]), Math.floor(b[0]));
    const y0 = Math.min(Math.floor(a[1]), Math.floor(b[1]));
    const x1 = Math.max(Math.floor(a[0]), Math.floor(b[0]));
    const y1 = Math.max(Math.floor(a[1]), Math.floor(b[1]));
    const erase = this.drag.erase;
    this.store.update((m) => {
      const set = cellSet(m);
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          if (erase) set.delete(key(i, j)); else set.add(key(i, j));
        }
      }
      return { ...m, cells: [...set].sort() };
    });
  }

  placeOpening(kind, pt) {
    const hit = this.nearestEdge(pt);
    if (!hit) return;
    const id = newId('o');
    const def = OPENING_DEFAULTS[kind];
    this.store.update((m) => ({
      ...m,
      openings: [...m.openings, {
        id, edge: hit.edge.id, storey: 0, kind,
        offset: Math.round(hit.t * 4) / 4 || 0.5, ...def,
      }],
    }));
    this.store.select({ type: 'opening', id });
  }

  placeRoofItem(kind, pt) {
    const id = newId('r');
    this.store.update((m) => ({
      ...m,
      roofItems: [...m.roofItems, {
        id, kind, x: Math.round(pt[0] * 4) / 4, y: Math.round(pt[1] * 4) / 4,
        ...ROOF_ITEM_DEFAULTS[kind],
      }],
    }));
    this.store.select({ type: 'roofItem', id });
  }

  placeProp(kind, pt) {
    const id = newId('p');
    const def = PROP_DEFAULTS[kind];
    const centred = kind === 'tree' || kind === 'bush' || kind === 'car';
    const x = Math.round((centred ? pt[0] : pt[0] - (def.w ?? 2) / 2) * 4) / 4;
    const y = Math.round((centred ? pt[1] : pt[1] - (def.d ?? 2) / 2) * 4) / 4;
    this.store.update((m) => ({ ...m, props: [...m.props, { id, kind, x, y, ...def }] }));
    this.store.select({ type: 'prop', id });
  }
}
