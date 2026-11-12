/**
 * Top-down plan view: where the footprint is drawn and everything is placed.
 *
 * Painting a shape from above is far more direct than manipulating it in
 * perspective, so this view owns creation and placement, while the isometric
 * view owns inspection and export.
 *
 * The view — its centre and its scale — belongs to the view. It is fitted to
 * the content when a project opens and when asked, never otherwise: refitted
 * at every render, it shrank under the brush as a stroke went past the edge
 * of the house, cells passing from sixteen pixels to eleven in mid-gesture.
 */

import { key, parseKey, boundaryEdges, boundaryRuns, SIDES } from '../core/grid.js';
import {
  cellSet, cellSizeOf, fmtMetres, buildingCells, setBuildingCells, fitOpening, openingRun, propFootprint,
  wallSpan, buildingOfEdge, storeyHeightOf, fixtureZRange, offsetOnRun,
} from '../core/model.js';
import { moveBody } from '../core/bodies.js';
import { focusFrame } from '../core/focus.js';
import {
  OPENING_DEFAULTS, ROOF_ITEM_DEFAULTS, PROP_DEFAULTS, CENTRED_KINDS, LINEAR_KINDS, FIXTURE_DEFAULTS,
  placeOpening, placeRoofItem, placeProp, placeRun, runShape, propAt, roofItemAt, roofAt, placeFixture, OFF_ROOF,
} from './actions.js';
import {
  cellsAlong, snapLines, snapMove, handlesOf, resizeTo, boxOf, handleShape,
} from './plan-edit.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/** Bounds of the view's scale, in pixels per metre. */
export const PLAN_SCALE = [3, 240];

const clampScale = (s) => Math.max(PLAN_SCALE[0], Math.min(PLAN_SCALE[1], s));

/** Gestures that edit the model as they go, and are undone whole on Échap. */
const LIVE = new Set(['brush', 'move', 'slide', 'resize', 'body', 'focusMove', 'focusResize']);

const ICON = {
  plus: '<path fill="currentColor" d="M7.1 3.2h1.8v3.9h3.9v1.8H8.9v3.9H7.1V8.9H3.2V7.1h3.9z"/>',
  minus: '<path fill="currentColor" d="M3.2 7.1h9.6v1.8H3.2z"/>',
  fit: '<path fill="currentColor" d="M2.4 6.4V2.4h4v1.5H3.9v2.5zm7.2-4h4v4h-1.5V3.9h-2.5zm4 7.2v4h-4v-1.5h2.5v-2.5zm-7.2 4h-4v-4h1.5v2.5h2.5z"/>',
};

/** A key press meant for a field, which keeps it. */
const typingIn = (t) => !!t?.closest?.('input, textarea, select, [contenteditable="true"]');

/** Ground point and direction of a wall edge, from its id. */
function edgeFrame(edgeId, cs) {
  const [i, j, side] = edgeId.split(',');
  const s = SIDES[side];
  const a = s.a(Number(i), Number(j)), b = s.b(Number(i), Number(j));
  return { a: [a[0] * cs, a[1] * cs], u: [b[0] - a[0], b[1] - a[1]], n: s.d };
}

export class PlanView {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.svg = el('svg', { class: 'plan-svg' });
    this.root.appendChild(this.svg);
    this.view = null; // { cx, cy, scale }: metres at the centre, pixels per metre
    this.drag = null;
    this.hover = null; // world point under a pointer that is not dragging
    this.pointerAt = null;
    this.space = false;
    this.overlay = null;
    this.buildPad();
    this.bindEvents();
    this.bindKeys();
  }

  /* ---------------- the view ---------------- */

  /** Fit the view to the content at the next drawing: a project was opened. */
  refit() {
    this.view = null;
  }

  /** Fit the view to the content now. */
  fit() {
    this.view = null;
    this.render();
  }

  /** The view that shows the whole content, with some room around it. */
  fitted(w, h) {
    const m = this.store.model;
    const cs = cellSizeOf(m);
    const cells = cellSet(m);
    // The plan's canvas space is metres; only painting converts to cells.
    let i0 = 12, j0 = 12, i1 = 28, j1 = 28;
    if (cells.size) {
      i0 = Infinity; j0 = Infinity; i1 = -Infinity; j1 = -Infinity;
      for (const k of cells) {
        const [i, j] = parseKey(k);
        i0 = Math.min(i0, i * cs); j0 = Math.min(j0, j * cs);
        i1 = Math.max(i1, (i + 1) * cs); j1 = Math.max(j1, (j + 1) * cs);
      }
    }
    for (const p of m.props) {
      const [px0, py0, px1, py1] = propFootprint(p);
      i0 = Math.min(i0, px0); j0 = Math.min(j0, py0);
      i1 = Math.max(i1, px1); j1 = Math.max(j1, py1);
    }
    if (m.focus?.enabled) {
      const [fx0, fy0, fx1, fy1] = focusFrame(m.focus);
      i0 = Math.min(i0, fx0); j0 = Math.min(j0, fy0);
      i1 = Math.max(i1, fx1); j1 = Math.max(j1, fy1);
    }
    const pad = 4;
    i0 -= pad; j0 -= pad; i1 += pad; j1 += pad;
    return {
      cx: (i0 + i1) / 2,
      cy: (j0 + j1) / 2,
      scale: clampScale(Math.min(w / (i1 - i0), h / (j1 - j0))),
    };
  }

  /**
   * Pixel mapping of the current view. A resize keeps the centre where it
   * was: only the amount of plan around it changes.
   */
  layout() {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(200, r.width);
    const h = Math.max(200, r.height);
    if (!this.view) this.view = this.fitted(w, h);
    const { cx, cy, scale } = this.view;
    this.map = {
      w, h, scale,
      ox: w / 2 - cx * scale,
      // Screen y grows downward while the model's y grows north, so the plan
      // is flipped: north stays up, as anyone reading a plan expects.
      oy: h / 2 + cy * scale,
    };
    return this.map;
  }

  /** Zoom by `factor`, keeping the plan point under pixel (px, py) in place. */
  zoomAt(px, py, factor) {
    if (!this.map) this.layout();
    const [wx, wy] = this.toWorld(px, py);
    const scale = clampScale(this.view.scale * factor);
    const { w, h } = this.map;
    this.view = { scale, cx: wx - (px - w / 2) / scale, cy: wy + (py - h / 2) / scale };
    this.render();
  }

  /** Zoom about the middle of the panel — the pad's buttons. */
  zoomBy(factor) {
    if (!this.map) this.layout();
    this.zoomAt(this.map.w / 2, this.map.h / 2, factor);
  }

  /** Slide the plan by a number of pixels. */
  panBy(dx, dy) {
    if (!this.view) this.layout();
    const { scale } = this.view;
    this.view = { ...this.view, cx: this.view.cx - dx / scale, cy: this.view.cy + dy / scale };
    this.render();
  }

  toPx(x, y) { return [x * this.map.scale + this.map.ox, -y * this.map.scale + this.map.oy]; }
  toWorld(px, py) {
    return [(px - this.map.ox) / this.map.scale, -(py - this.map.oy) / this.map.scale];
  }

  eventPoint(ev) {
    const r = this.svg.getBoundingClientRect();
    return this.toWorld(ev.clientX - r.left, ev.clientY - r.top);
  }

  /**
   * Zoom and fit buttons on the plan, as the render has its pad: a wheel or a
   * pinch nobody knows about is a feature nobody has, and buttons are what a
   * keyboard can reach.
   */
  buildPad() {
    const pad = document.createElement('div');
    pad.className = 'plan-nav';
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', 'Navigation dans le plan');
    const btn = (cls, glyph, label, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `nav-btn ${cls}`;
      b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[glyph]}</svg>`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', run);
      return b;
    };
    pad.append(
      btn('plan-out', 'minus', 'Dézoomer le plan', () => this.zoomBy(1 / 1.25)),
      btn('plan-in', 'plus', 'Zoomer le plan', () => this.zoomBy(1.25)),
      btn('plan-fit', 'fit', 'Ajuster le plan au projet', () => this.fit()),
    );
    this.pad = pad;
    this.root.appendChild(pad);
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
    const gDims = g('plan-dims');
    const gOpen = g('plan-openings');
    const gFrame = g('plan-frame');

    // Grid, spanning the whole panel rather than just the fitted box: an
    // unruled margin reads as "outside the drawing area", which it is not.
    // Lines follow the grid pitch, with metre and 5 m lines emphasised; the
    // finer rulings drop out as soon as they would sit less than ~7 px apart.
    const cs = cellSizeOf(m);
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(map.w, map.h);
    const gx0 = Math.min(tl[0], br[0]), gx1 = Math.max(tl[0], br[0]);
    const gy0 = Math.min(tl[1], br[1]), gy1 = Math.max(tl[1], br[1]);
    const step = map.scale * cs >= 7 ? cs : map.scale >= 7 ? 1 : 5;
    const perMetre = Math.round(1 / step);
    const classOf = (n) => {
      const metres = n * step;
      if (Math.abs(metres / 5 - Math.round(metres / 5)) < 1e-9) return 'major';
      return perMetre > 1 && n % perMetre ? 'sub' : '';
    };
    for (let n = Math.ceil(gx0 / step); n * step <= gx1; n++) {
      const x = n * step;
      const a = this.toPx(x, gy0), b = this.toPx(x, gy1);
      gGrid.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: classOf(n) }));
    }
    for (let n = Math.ceil(gy0 / step); n * step <= gy1; n++) {
      const y = n * step;
      const a = this.toPx(gx0, y), b = this.toPx(gx1, y);
      gGrid.appendChild(el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: classOf(n) }));
    }

    // Ground items, drawn under the house.
    for (const p of m.props) {
      const centred = CENTRED_KINDS.has(p.kind);
      const pw = p.r ? p.r * 2 : p.w ?? 2;
      const pd = p.r ? p.r * 2 : p.d ?? 2;
      const px = centred ? p.x - pw / 2 : p.x;
      const py = centred ? p.y - pd / 2 : p.y;
      const a = this.toPx(px, py + pd);
      const selected = this.store.selection?.id === p.id;
      const shape = p.kind === 'tree' || p.kind === 'bush' || p.kind === 'lamppost'
        ? el('circle', { cx: a[0] + (pw * map.scale) / 2, cy: a[1] + (pd * map.scale) / 2, r: (pw * map.scale) / 2 })
        : el('rect', {
          x: a[0], y: a[1],
          // A wall or a gate can be thinner than a hairline on screen; give it
          // a floor so it stays grabbable and visible.
          width: Math.max(pw * map.scale, p.kind === 'muret' || p.kind === 'gate' ? 3 : 0),
          height: Math.max(pd * map.scale, p.kind === 'muret' || p.kind === 'gate' ? 3 : 0),
          rx: p.kind === 'pool' ? 8 : 2,
        });
      shape.setAttribute('class', `prop prop-${p.kind}${selected ? ' selected' : ''}`);
      shape.dataset.id = p.id;
      shape.dataset.type = 'prop';
      gProps.appendChild(shape);
    }

    // Footprint, one layer per volume so the one being edited stands out.
    const activeId = this.store.activeBuildingId;
    for (const bd of m.buildings) {
      const bCells = buildingCells(bd);
      const active = bd.id === activeId;
      for (const k of bCells) {
        const [i, j] = parseKey(k);
        const a = this.toPx(i * cs, (j + 1) * cs);
        const r = el('rect', {
          x: a[0], y: a[1], width: map.scale * cs, height: map.scale * cs,
          class: active ? 'cell' : 'cell inactive',
        });
        // So that clicking a volume anywhere makes it the active one, and not
        // only on the three pixels of its outline.
        r.dataset.building = bd.id;
        gCells.appendChild(r);
      }
      for (const e of boundaryEdges(bCells)) {
        const a = this.toPx(e.a[0] * cs, e.a[1] * cs);
        const b2 = this.toPx(e.b[0] * cs, e.b[1] * cs);
        const line = el('line', {
          x1: a[0], y1: a[1], x2: b2[0], y2: b2[1],
          class: active ? 'edge' : 'edge inactive',
        });
        line.dataset.edge = e.id;
        line.dataset.building = bd.id;
        gEdges.appendChild(line);
      }
      // Dimensions, one per straight wall run — the answer to "how long is
      // this wall?" without counting cells. Short runs stay unlabelled: the
      // label would cover more wall than it measures.
      if (!active && m.buildings.length > 1) continue;
      for (const run of boundaryRuns(bCells)) {
        const metres = run.cells * cs;
        if (metres * map.scale < 26) continue;
        const mid = [((run.a[0] + run.b[0]) / 2) * cs, ((run.a[1] + run.b[1]) / 2) * cs];
        const p = this.toPx(mid[0] + run.n[0] * 0.9, mid[1] + run.n[1] * 0.9);
        const t = el('text', { x: p[0], y: p[1], dy: 4 });
        t.textContent = `${fmtMetres(metres)} m`;
        gDims.appendChild(t);
      }
    }

    // Openings, as marks straddling their wall — each volume's own walls, as
    // the renderer has them: a wall another volume was later built against
    // is still drawn, so it must still be findable here.
    const byId = new Map(m.buildings.flatMap((bd) => boundaryEdges(new Set(bd.cells))).map((e) => [e.id, e]));
    for (const op of m.openings) {
      const e = byId.get(op.edge);
      if (!e) continue;
      const a = [e.a[0] * cs, e.a[1] * cs];
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
      const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
      const c = op.offset ?? 0.5;
      const w = (op.width ?? 1.2) / 2;
      const p0 = this.toPx(a[0] + u[0] * (c - w), a[1] + u[1] * (c - w));
      const p1 = this.toPx(a[0] + u[0] * (c + w), a[1] + u[1] * (c + w));
      const line = el('line', {
        x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1],
        class: `opening opening-${op.kind}${this.store.selection?.id === op.id ? ' selected' : ''}`,
      });
      line.dataset.id = op.id;
      line.dataset.type = 'opening';
      gOpen.appendChild(line);
    }

    // Wall fixtures, as a dot on their wall.
    for (const f of m.fixtures || []) {
      const e = byId.get(f.edge);
      if (!e) continue;
      const { a, u } = edgeFrame(f.edge, cs);
      const c = f.offset ?? 0.5;
      const pt = this.toPx(a[0] + u[0] * c, a[1] + u[1] * c);
      const dot = el('circle', {
        cx: pt[0], cy: pt[1], r: 5,
        class: `fixture fixture-${f.kind}${this.store.selection?.id === f.id ? ' selected' : ''}`,
      });
      dot.dataset.id = f.id;
      dot.dataset.type = 'fixture';
      gOpen.appendChild(dot);
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

    // The framing rectangle. Two outlines: the zone as drawn, and the margin
    // actually given to the camera, so the gap between the zone selected and
    // what will end up in the picture is visible rather than guessed at.
    if (m.focus?.enabled) {
      const f = m.focus;
      const [mx0, my0, mx1, my1] = focusFrame(f);
      const box = (x0, y0, x1, y1, cls) => {
        const a = this.toPx(x0, y1);
        const r = el('rect', {
          x: a[0], y: a[1],
          width: (x1 - x0) * map.scale, height: (y1 - y0) * map.scale, class: cls,
        });
        gFrame.appendChild(r);
        return r;
      };
      box(mx0, my0, mx1, my1, 'focus-margin');
      // Grabbed with the framing tool, to move the zone rather than draw anew.
      box(f.x, f.y, f.x + f.w, f.y + f.d, 'focus-zone').dataset.focus = 'zone';
      // Above the margin ring, not the zone: over the zone the label lands on
      // whatever is being framed, which is exactly what one wants to look at.
      const p = this.toPx(mx0, my1);
      const t = el('text', { x: p[0] + ((mx1 - mx0) * map.scale) / 2, y: p[1] - 8, class: 'rect-size' });
      t.textContent = `cadrage ${fmtMetres(f.w)} × ${fmtMetres(f.d)} m`;
      gFrame.appendChild(t);
    }

    // Compass. The plan flips y so north is up; the arrow makes it explicit,
    // and pairs with the one in the render for orientation between views.
    const comp = el('g', { class: 'plan-compass', transform: `translate(${map.w - 30}, 34)` });
    comp.appendChild(el('circle', { cx: 0, cy: 0, r: 15 }));
    comp.appendChild(el('line', { x1: 0, y1: 9, x2: 0, y2: -5 }));
    comp.appendChild(el('path', { d: 'M -4 -3 L 0 -10 L 4 -3 Z' }));
    const label = el('text', { x: 0, y: 26 });
    label.textContent = 'N';
    comp.appendChild(label);
    this.svg.appendChild(comp);

    // What follows the pointer — previews, handles, guides, coordinates —
    // lives in its own layer, redrawn alone as the pointer moves.
    this.overlay = el('g', { class: 'plan-overlay' });
    this.svg.appendChild(this.overlay);
    this.renderOverlay();
  }

  /* ---------------- the overlay ---------------- */

  /**
   * Everything that follows the pointer or the selection, over the drawing:
   * the preview of what a click would make, the dimensions and handles of the
   * selection, the magnet's guides, the coordinates under the pointer.
   */
  renderOverlay() {
    const o = this.overlay;
    if (!o || !this.map) return;
    o.replaceChildren();
    const s = this.store;
    const add = (name, attrs, text) => {
      const n = el(name, attrs);
      if (text !== undefined) n.textContent = text;
      o.appendChild(n);
      return n;
    };
    const d = this.drag;

    this.drawSelection(add);
    if (!d && this.hover) this.drawHover(add, this.hover);
    if (d?.mode === 'rect') this.drawRect(add, d);
    if (d?.mode === 'run') this.drawRun(add, d);
    if (d?.mode === 'frame') this.drawFrame(add, d);

    // The magnet's lines, across the whole panel: they say what the item
    // has just lined up with, which is often off at the other end.
    for (const g of d?.guides || []) {
      const a = g.axis === 'x' ? this.toPx(g.at, 0) : this.toPx(0, g.at);
      add('line', g.axis === 'x'
        ? { x1: a[0], y1: 0, x2: a[0], y2: this.map.h, class: 'plan-guide' }
        : { x1: 0, y1: a[1], x2: this.map.w, y2: a[1], class: 'plan-guide' });
    }

    if (this.pointerAt && (this.hover || d)) {
      const q = (v) => fmtMetres(Math.round(v * 20) / 20);
      add('text', { x: 10, y: this.map.h - 10, class: 'plan-coords' },
        `x ${q(this.pointerAt[0])} m · y ${q(this.pointerAt[1])} m`);
    }
    this.fitLabels();
  }

  /**
   * Keep the selection's dimensions readable: inside the panel — near its
   * edge, one was cut in half — and over the walls' own dimensions, which
   * make way for them rather than being written across.
   */
  fitLabels() {
    const labels = [...this.overlay.querySelectorAll('text.plan-dim')];
    const walls = [...this.svg.querySelectorAll('.plan-dims text')];
    for (const t of walls) t.classList.remove('plan-dim-covered');
    if (!labels.length) return;
    const M = 4;
    const boxes = [];
    for (const t of labels) {
      let b;
      try { b = t.getBBox(); } catch { continue; }
      if (!b.width) continue;
      // A label beside a wall that runs off the panel goes to the wall's
      // other side rather than being pushed back across the wall it measures.
      const side = t.classList.contains('side') ? 1 : t.classList.contains('side-end') ? -1 : 0;
      if (side && (b.x < M || b.x + b.width > this.map.w - M)) {
        t.classList.toggle('side', side < 0);
        t.classList.toggle('side-end', side > 0);
        t.setAttribute('x', Number(t.getAttribute('x')) - side * 60);
        try { b = t.getBBox(); } catch { continue; }
      }
      const dx = b.x < M ? M - b.x : b.x + b.width > this.map.w - M ? this.map.w - M - b.x - b.width : 0;
      const dy = b.y < M ? M - b.y : b.y + b.height > this.map.h - M ? this.map.h - M - b.y - b.height : 0;
      if (dx || dy) {
        t.setAttribute('x', Number(t.getAttribute('x')) + dx);
        t.setAttribute('y', Number(t.getAttribute('y')) + dy);
      }
      boxes.push({ x: b.x + dx, y: b.y + dy, w: b.width, h: b.height });
    }
    const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.w && a.y < b.y + b.height && b.y < a.y + a.h;
    for (const t of walls) {
      let b;
      try { b = t.getBBox(); } catch { continue; }
      if (boxes.some((a) => hit(a, b))) t.classList.add('plan-dim-covered');
    }
  }

  /** A box in metres, as an SVG rect. */
  boxAttrs([x0, y0, x1, y1]) {
    const a = this.toPx(x0, y1);
    return { x: a[0], y: a[1], width: (x1 - x0) * this.map.scale, height: (y1 - y0) * this.map.scale };
  }

  /** Dimensions along the sides of a box, as the walls have theirs. */
  drawBoxDims(add, [x0, y0, x1, y1], depth = true) {
    const top = this.toPx((x0 + x1) / 2, y1);
    add('text', { x: top[0], y: top[1] - 8, class: 'rect-size plan-dim' }, `${fmtMetres(x1 - x0)} m`);
    if (!depth) return;
    const side = this.toPx(x1, (y0 + y1) / 2);
    add('text', { x: side[0] + 8, y: side[1] + 4, class: 'rect-size plan-dim side' }, `${fmtMetres(y1 - y0)} m`);
  }

  /** Where an opening or a fixture stands on the plan: its two ends in pixels. */
  openingEnds(op) {
    const cs = cellSizeOf(this.store.model);
    const { a, u } = edgeFrame(op.edge, cs);
    const c = op.offset ?? 0.5, w = wallSpan(op) / 2;
    return [
      this.toPx(a[0] + u[0] * (c - w), a[1] + u[1] * (c - w)),
      this.toPx(a[0] + u[0] * (c + w), a[1] + u[1] * (c + w)),
    ];
  }

  /**
   * The straight wall an opening or a fixture stands on, and its distance to
   * the nearer corner — from its edge for an opening, from its centre for a
   * fixture, which is a point on the wall rather than a hole in it.
   */
  openingContext(op) {
    const m = this.store.model;
    const run = openingRun(m, op);
    if (!run) return null;
    const cs = cellSizeOf(m);
    const { a, u, n } = edgeFrame(op.edge, cs);
    const c = op.offset ?? 0.5, w = FIXTURE_DEFAULTS[op.kind] ? 0 : wallSpan(op);
    return {
      p0: this.toPx(a[0] + u[0] * run.lo, a[1] + u[1] * run.lo),
      p1: this.toPx(a[0] + u[0] * run.hi, a[1] + u[1] * run.hi),
      corner: Math.max(0, Math.min(c - w / 2 - run.lo, run.hi - (c + w / 2))),
      // Beside an east or west wall, the text starts (or ends) off the wall:
      // centred on its anchor, it was written across the wall and the very
      // mark it measures.
      anchor: n[0] > 0 ? ' side' : n[0] < 0 ? ' side-end' : '',
      // Further out than the wall's own dimension, which it would cover.
      label: (() => {
        const p = this.toPx(a[0] + u[0] * c, a[1] + u[1] * c);
        return [p[0] + n[0] * 30, p[1] - n[1] * 30];
      })(),
    };
  }

  drawSelection(add) {
    const s = this.store;
    const m = s.model;
    const sel = s.selection;
    // The framing zone is handled with its own tool, whatever is selected.
    if (s.tool === 'frame' && m.focus?.enabled) {
      for (const h of handlesOf('focus', m.focus)) this.drawHandle(add, h, 'focus');
    }
    if (!sel || s.tool !== 'select') return;
    const it = s.selected;
    if (!it) return;
    if (sel.type === 'opening' || sel.type === 'fixture') {
      const ctx = this.openingContext(it);
      if (ctx) {
        add('text', { x: ctx.label[0], y: ctx.label[1] + 4, class: `rect-size plan-dim${ctx.anchor}` },
          `${fmtMetres(Math.round(ctx.corner * 100) / 100)} m de l’angle`);
        // A fixture's other dimension is its height, which the plan cannot
        // show otherwise.
        if (sel.type === 'fixture') {
          add('text', { x: ctx.label[0], y: ctx.label[1] + 18, class: `rect-size plan-dim${ctx.anchor}` },
            `à ${fmtMetres(Math.round(this.fixtureZ(it) * 100) / 100)} m du plancher`);
        }
      }
      return;
    }
    const shape = handleShape(sel.type, it);
    const box = boxOf(sel.type, it);
    if (shape === 'radius') {
      const top = this.toPx(it.x, it.y + (it.r ?? 1));
      add('text', { x: top[0], y: top[1] - 8, class: 'rect-size plan-dim' }, `⌀ ${fmtMetres((it.r ?? 1) * 2)} m`);
    } else if (shape === 'ends') {
      const horiz = box[2] - box[0] >= box[3] - box[1];
      const len = horiz ? box[2] - box[0] : box[3] - box[1];
      const p = horiz ? this.toPx((box[0] + box[2]) / 2, box[3]) : this.toPx(box[2], (box[1] + box[3]) / 2);
      add('text', horiz ? { x: p[0], y: p[1] - 8, class: 'rect-size plan-dim' }
        : { x: p[0] + 8, y: p[1] + 4, class: 'rect-size plan-dim side' }, `${fmtMetres(len)} m`);
    } else {
      this.drawBoxDims(add, box);
    }
    for (const h of handlesOf(sel.type, it)) this.drawHandle(add, h, sel.type);
  }

  /**
   * A handle: a small square, always the same size on screen, over a wider
   * transparent disc that a finger can actually land on.
   */
  drawHandle(add, h, owner) {
    const [px, py] = this.toPx(h.x, h.y);
    for (const n of [
      add('circle', { cx: px, cy: py, r: 14, class: 'plan-handle-hit' }),
      add('rect', { x: px - 4.5, y: py - 4.5, width: 9, height: 9, class: `plan-handle handle-${h.id}` }),
    ]) {
      n.dataset.handle = h.id;
      n.dataset.owner = owner;
    }
  }

  /** A fixture's height above its level's floor, as its wall draws it. */
  fixtureZ(f) {
    const host = buildingOfEdge(this.store.model, f.edge);
    const [lo, hi] = fixtureZRange(host ? storeyHeightOf(host, f.storey || 0) : 2.7);
    return Math.max(lo, Math.min(hi, f.z ?? FIXTURE_DEFAULTS[f.kind]?.z ?? 2));
  }

  /** What a click with the current tool would make, where it would make it. */
  drawHover(add, pt) {
    const s = this.store;
    const m = s.model;
    const tool = s.tool;
    const cs = cellSizeOf(m);
    if (tool === 'paint' || tool === 'erase') {
      const i = Math.floor(pt[0] / cs), j = Math.floor(pt[1] / cs);
      const owner = m.buildings.find((b) => b.cells.includes(key(i, j)));
      const taken = tool === 'paint' && owner && owner.id !== s.activeBuildingId;
      add('rect', {
        ...this.boxAttrs([i * cs, j * cs, (i + 1) * cs, (j + 1) * cs]),
        class: `plan-cell-hover${tool === 'erase' ? ' erase' : ''}${taken ? ' refused' : ''}`,
      });
      return;
    }
    if (OPENING_DEFAULTS[tool]) {
      const hit = this.nearestEdge(pt);
      if (!hit) return;
      const op = fitOpening(m, {
        kind: tool, edge: hit.edge.id, storey: 0,
        offset: Math.round(hit.offset * 20) / 20, ...OPENING_DEFAULTS[tool],
      });
      const ctx = this.openingContext(op);
      if (ctx) {
        add('line', { x1: ctx.p0[0], y1: ctx.p0[1], x2: ctx.p1[0], y2: ctx.p1[1], class: 'plan-wall-hover' });
        add('text', { x: ctx.label[0], y: ctx.label[1] + 4, class: `rect-size plan-dim${ctx.anchor}` },
          `${fmtMetres(Math.round(ctx.corner * 100) / 100)} m de l’angle`);
      }
      const [p0, p1] = this.openingEnds(op);
      add('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], class: `opening opening-${tool} ghost` });
      return;
    }
    if (FIXTURE_DEFAULTS[tool]) {
      // As for an opening: the wall it would hang on, and where along it.
      const hit = this.nearestEdge(pt);
      if (!hit) return;
      const f = fitOpening(m, {
        kind: tool, edge: hit.edge.id, storey: 0, offset: Math.round(hit.offset * 20) / 20,
      });
      const ctx = this.openingContext(f);
      if (ctx) {
        add('line', { x1: ctx.p0[0], y1: ctx.p0[1], x2: ctx.p1[0], y2: ctx.p1[1], class: 'plan-wall-hover' });
        add('text', { x: ctx.label[0], y: ctx.label[1] + 4, class: `rect-size plan-dim${ctx.anchor}` },
          `${fmtMetres(Math.round(ctx.corner * 100) / 100)} m de l’angle`);
      }
      const { a, u } = edgeFrame(f.edge, cs);
      const c = this.toPx(a[0] + u[0] * f.offset, a[1] + u[1] * f.offset);
      add('circle', { cx: c[0], cy: c[1], r: 5, class: `fixture fixture-${tool} ghost` });
      return;
    }
    if (ROOF_ITEM_DEFAULTS[tool]) {
      const it = roofItemAt(tool, pt);
      const on = roofAt(m, [it.x, it.y]);
      const box = boxOf('roofItem', it);
      add('rect', { ...this.boxAttrs(box), class: `roof-item roof-${tool} ghost${on ? '' : ' refused'}` });
      if (!on) {
        const p = this.toPx(it.x, box[3]);
        add('text', { x: p[0], y: p[1] - 8, class: 'rect-size plan-refused' }, 'hors toit');
      }
      return;
    }
    if (LINEAR_KINDS.has(tool)) {
      const p = this.toPx(Math.round(pt[0] * 4) / 4, Math.round(pt[1] * 4) / 4);
      add('circle', { cx: p[0], cy: p[1], r: 4, class: 'plan-start' });
      return;
    }
    if (PROP_DEFAULTS[tool]) {
      const { prop, wall, slab } = propAt(m, tool, pt);
      // What it lines up with or climbs to, outlined first, under the ghost.
      for (const target of [wall, slab]) {
        if (target) add('rect', { ...this.boxAttrs(propFootprint(target)), class: 'plan-target' });
      }
      const box = propFootprint(prop);
      if (tool === 'tree' || tool === 'bush') {
        const c = this.toPx(prop.x, prop.y);
        add('circle', { cx: c[0], cy: c[1], r: (prop.r ?? 1) * this.map.scale, class: `prop prop-${tool} ghost` });
      } else if (tool === 'lamppost') {
        // Drawn round, as the plan draws it once placed.
        const c = this.toPx((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
        add('circle', { cx: c[0], cy: c[1], r: ((box[2] - box[0]) / 2) * this.map.scale, class: `prop prop-${tool} ghost` });
      } else {
        add('rect', { ...this.boxAttrs(box), class: `prop prop-${tool} ghost` });
      }
    }
  }

  drawRect(add, d) {
    const cs = cellSizeOf(this.store.model);
    const { x0, y0, x1, y1 } = this.rectCells(d);
    add('rect', {
      ...this.boxAttrs([x0 * cs, y0 * cs, (x1 + 1) * cs, (y1 + 1) * cs]),
      class: d.erase ? 'rect-preview erase' : 'rect-preview',
    });
    // Live dimensions while dragging: this is how a wall gets its real length.
    const p = this.toPx(((x0 + x1 + 1) / 2) * cs, (y1 + 1) * cs);
    add('text', { x: p[0], y: p[1] - 9, class: 'rect-size' },
      `${fmtMetres((x1 - x0 + 1) * cs)} × ${fmtMetres((y1 - y0 + 1) * cs)} m`);
  }

  drawRun(add, d) {
    const { from, to, kind } = d;
    const horiz = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]);
    const p0 = this.toPx(from[0], from[1]);
    const p1 = horiz ? this.toPx(to[0], from[1]) : this.toPx(from[0], to[1]);
    add('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], class: `run-preview run-${kind}` });
    const { len } = runShape(kind, from, to);
    add('text', { x: (p0[0] + p1[0]) / 2, y: (p0[1] + p1[1]) / 2 - 10, class: 'rect-size' }, `${fmtMetres(len)} m`);
  }

  drawFrame(add, d) {
    const [a, b] = [d.from, d.to];
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    add('rect', { ...this.boxAttrs([x0, y0, x1, y1]), class: 'focus-zone drawing' });
    const p = this.toPx((x0 + x1) / 2, y1);
    add('text', { x: p[0], y: p[1] - 9, class: 'rect-size' },
      `${fmtMetres(Math.round((x1 - x0) * 4) / 4)} × ${fmtMetres(Math.round((y1 - y0) * 4) / 4)} m`);
  }

  /** Nearest exterior wall to a world point, within `maxDist` metres. */
  nearestEdge(pt, maxDist = 1.5) {
    const m = this.store.model;
    const cs = cellSizeOf(m);
    const cells = cellSet(m);
    let best = null, bestD = maxDist;
    for (const e of boundaryEdges(cells)) {
      const ax = e.a[0] * cs, ay = e.a[1] * cs;
      const bx = e.b[0] * cs, by = e.b[1] * cs;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pt[0] - (ax + dx * t), pt[1] - (ay + dy * t));
      // `offset` is the metre distance along the wall — the unit openings
      // store, whatever the grid pitch.
      if (d < bestD) { bestD = d; best = { edge: e, t, offset: t * Math.sqrt(len2) }; }
    }
    return best;
  }

  /* ---------------- gestures ---------------- */

  bindEvents() {
    const s = this.store;
    this.pointers = new Map();

    this.svg.addEventListener('pointerdown', (ev) => {
      // Only the main button draws, and the middle one pans. A right click
      // painted cells, and opened the browser's menu over them as well.
      if (ev.button !== 0 && ev.button !== 1) return;
      // Capture is a convenience, not a requirement: synthetic pointers (and
      // some browsers) reject an id they never issued.
      try { this.svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.pointers.size === 2) {
        // A second finger makes it a pinch: whatever the first one started is
        // taken back, rather than left as a stray cell under the thumb.
        this.abandon();
        this.startPinch();
        return;
      }
      if (this.pinch) return;
      if (!this.map) this.layout();
      const pt = this.eventPoint(ev);
      this.pointerAt = pt;
      this.hover = null;
      this.start(ev, pt);
      this.renderOverlay();
    });

    this.svg.addEventListener('pointermove', (ev) => {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.pinch && this.pointers.size >= 2) { this.movePinch(); return; }
      if (!this.map) return;
      const pt = this.eventPoint(ev);
      this.pointerAt = pt;
      if (!this.drag) {
        this.hover = pt;
        this.renderOverlay();
        return;
      }
      this.move(ev, pt);
    });

    const finish = (ev) => {
      if (ev) {
        this.pointers.delete(ev.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
      }
      const d = this.drag;
      this.drag = null;
      if (d?.mode === 'run') placeRun(s, d.kind, d.from, d.to);
      if (d?.mode === 'rect' && d.to) this.commitRect(d);
      if (d?.mode === 'frame' && d.to) this.commitFrame(d);
      if (d && LIVE.has(d.mode)) s.endGesture();
      s.commit();
      this.render();
    };
    this.svg.addEventListener('pointerup', finish);
    this.svg.addEventListener('pointercancel', finish);
    this.svg.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hover = null;
      this.renderOverlay();
    });

    this.svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (!this.map) this.layout();
      const rect = this.svg.getBoundingClientRect();
      // Anchored to the cursor: the grid point under the pointer stays put.
      this.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }

  /**
   * Keys the plan answers itself. Échap takes back the gesture under way
   * before anything else hears of it — otherwise it also dropped the
   * selection being dragged. Espace held turns a drag into a pan, as in
   * drawing programs, wherever the pointer is on the plan.
   */
  bindKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.drag && this.drag.mode !== 'cancelled') {
        this.cancel();
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (ev.key === ' ' && !typingIn(ev.target) && (this.hover || this.drag)) {
        // Over the plan, Espace pans; it neither scrolls the page nor presses
        // whichever button last had the focus.
        ev.preventDefault();
        if (!this.space) {
          this.space = true;
          this.svg.classList.add('space-pan');
        }
      }
    }, true);
    window.addEventListener('keyup', (ev) => {
      if (ev.key !== ' ') return;
      this.space = false;
      this.svg.classList.remove('space-pan');
    }, true);
  }

  /** Échap: the gesture under way is taken back, nothing is changed. */
  cancel() {
    const d = this.drag;
    if (!d) return;
    if (LIVE.has(d.mode)) this.store.cancelGesture();
    // Until the button comes up, the pointer neither draws nor previews.
    this.drag = { mode: 'cancelled' };
    this.render();
  }

  /** Drop the gesture under way silently — a second finger came down. */
  abandon() {
    const d = this.drag;
    this.drag = null;
    if (d && LIVE.has(d.mode)) this.store.cancelGesture();
  }

  /** What a press does, by tool and by what is under it. */
  start(ev, pt) {
    const s = this.store;
    const tool = s.tool;
    const target = ev.target;
    // Panning is available whatever the active tool — middle button, shift
    // or space — so nobody has to switch back to Select just to move around.
    if (ev.button === 1 || ev.shiftKey || this.space) {
      this.drag = { mode: 'pan', from: [ev.clientX, ev.clientY], view: { ...this.view } };
      return;
    }
    if (tool === 'paint' || tool === 'erase') {
      // Alt swaps the tool for its opposite, both ways — as the guide says.
      this.drag = { mode: 'brush', erase: (tool === 'erase') !== ev.altKey, last: pt, warned: false };
      s.beginGesture();
      this.paintStroke(pt, pt);
      return;
    }
    if (tool === 'rect') {
      this.drag = { mode: 'rect', from: pt, to: pt, erase: ev.altKey };
      return;
    }
    if (tool === 'frame') {
      const f = s.model.focus;
      if (f?.enabled && target.dataset?.owner === 'focus') {
        this.drag = { mode: 'focusResize', handle: target.dataset.handle, base: { ...f }, lines: snapLines(s.model) };
        s.beginGesture();
      } else if (f?.enabled && target.dataset?.focus === 'zone') {
        this.drag = { mode: 'focusMove', from: pt, base: { ...f }, lines: snapLines(s.model) };
        s.beginGesture();
      } else {
        this.drag = { mode: 'frame', from: pt, to: pt };
      }
      return;
    }
    if (tool === 'select') {
      const sel = s.selection;
      const item = s.selected;
      if (target.dataset?.handle && item && target.dataset.owner === sel.type) {
        this.drag = {
          mode: 'resize', type: sel.type, handle: target.dataset.handle, base: { ...item },
          lines: snapLines(s.model, item.id),
        };
        s.beginGesture();
        return;
      }
      if (target.dataset?.type) {
        s.select({ type: target.dataset.type, id: target.dataset.id });
        const it = s.selected;
        if (target.dataset.type === 'opening' || target.dataset.type === 'fixture') {
          // An opening has no free x/y — it lives on a wall, and so does a
          // fixture. Dragging slides it along the walls (and across corners)
          // instead of writing meaningless coordinates onto it.
          this.drag = { mode: 'slide' };
        } else if (it) {
          this.drag = {
            mode: 'move', type: target.dataset.type, from: pt, base: { ...it },
            lines: snapLines(s.model, it.id),
          };
        }
        if (this.drag) s.beginGesture();
        return;
      }
      if (target.dataset?.building) {
        const id = target.dataset.building;
        s.setActiveBuilding(id);
        s.select({ type: 'building', id });
        // The whole body follows, by whole cells, with what it carries.
        this.drag = { mode: 'body', id, from: pt, base: s.model, at: [0, 0], warned: false };
        s.beginGesture();
        return;
      }
      s.select(null);
      // Empty ground: a drag there can only mean moving around.
      this.drag = { mode: 'pan', from: [ev.clientX, ev.clientY], view: { ...this.view } };
      return;
    }
    if (OPENING_DEFAULTS[tool]) {
      const hit = this.nearestEdge(pt);
      if (hit) placeOpening(s, tool, hit.edge.id, 0, hit.offset);
      else s.notify('Cliquez près d’un mur pour y poser l’ouverture');
      return;
    }
    if (FIXTURE_DEFAULTS[tool]) {
      const hit = this.nearestEdge(pt);
      if (hit) placeFixture(s, tool, hit.edge.id, 0, hit.offset);
      else s.notify('Cliquez près d’un mur pour y fixer l’équipement');
      return;
    }
    if (ROOF_ITEM_DEFAULTS[tool]) { placeRoofItem(s, tool, pt); return; }
    if (LINEAR_KINDS.has(tool)) {
      // Drawn as a run: for a wall or a hedge the length is the point, and
      // clicking then hunting for a slider is the long way round.
      this.drag = { mode: 'run', kind: tool, from: pt, to: pt };
      return;
    }
    if (PROP_DEFAULTS[tool]) placeProp(s, tool, pt);
  }

  /** What a pointer moving with a gesture under way does. */
  move(ev, pt) {
    const s = this.store;
    const d = this.drag;
    const magnet = !ev.altKey;
    switch (d.mode) {
      case 'pan': {
        const { scale } = d.view;
        this.view = {
          ...d.view,
          cx: d.view.cx - (ev.clientX - d.from[0]) / scale,
          cy: d.view.cy + (ev.clientY - d.from[1]) / scale,
        };
        this.render();
        return;
      }
      case 'brush':
        this.paintStroke(d.last, pt);
        d.last = pt;
        this.renderOverlay();
        return;
      case 'rect': case 'frame': case 'run':
        d.to = pt;
        this.renderOverlay();
        return;
      case 'slide': {
        const hit = this.nearestEdge(pt, 3);
        if (hit) {
          s.patchSelected((it, m) => {
            const along = offsetOnRun(m, it, hit.edge.id, hit.offset);
            const at = along === null ? { edge: hit.edge.id, offset: hit.offset } : { offset: along };
            return fitOpening(m, { ...it, ...at, offset: Math.round(at.offset * 20) / 20 });
          });
        }
        this.render();
        return;
      }
      case 'move': {
        const box = boxOf(d.type, d.base);
        const r = snapMove(box, [d.base.x, d.base.y], pt[0] - d.from[0], pt[1] - d.from[1], d.lines, { magnet });
        d.guides = r.guides;
        const x = Math.round((d.base.x + r.dx) * 1000) / 1000;
        const y = Math.round((d.base.y + r.dy) * 1000) / 1000;
        if (d.type === 'roofItem' && !roofAt(s.model, [x, y])) {
          // Held on the last roof it was over, as the render holds it: let
          // go past the eaves it was never drawn again.
          if (!d.warned) s.notify(OFF_ROOF);
          d.warned = true;
          this.renderOverlay();
          return;
        }
        s.patchSelected({ x, y });
        this.render();
        return;
      }
      case 'resize': {
        const r = resizeTo(d.type, d.base, d.handle, pt, d.lines, { magnet });
        d.guides = r.guides;
        s.patchSelected(r.patch);
        this.render();
        return;
      }
      case 'focusMove': case 'focusResize': {
        let patch;
        if (d.mode === 'focusMove') {
          const box = boxOf('focus', d.base);
          const r = snapMove(box, [d.base.x, d.base.y], pt[0] - d.from[0], pt[1] - d.from[1], d.lines, { magnet });
          d.guides = r.guides;
          patch = { x: Math.round((d.base.x + r.dx) * 1000) / 1000, y: Math.round((d.base.y + r.dy) * 1000) / 1000 };
        } else {
          const r = resizeTo('focus', d.base, d.handle, pt, d.lines, { magnet });
          d.guides = r.guides;
          patch = r.patch;
        }
        s.update((m) => ({ ...m, focus: { ...m.focus, ...patch } }));
        this.render();
        return;
      }
      case 'body': {
        const cs = cellSizeOf(d.base);
        const at = [Math.round((pt[0] - d.from[0]) / cs), Math.round((pt[1] - d.from[1]) / cs)];
        if (at[0] === d.at[0] && at[1] === d.at[1]) { this.renderOverlay(); return; }
        const next = moveBody(d.base, d.id, at[0], at[1]);
        if (!next) {
          // Held where it last fitted; said once, not at every pixel.
          if (!d.warned) s.notify('Un corps ne peut pas en recouvrir un autre');
          d.warned = true;
          this.renderOverlay();
          return;
        }
        d.at = at;
        s.update({ ...next, camera: s.model.camera });
        this.render();
        return;
      }
      default:
    }
  }

  startPinch() {
    if (!this.map) this.layout();
    const rect = this.svg.getBoundingClientRect();
    const [a, b] = [...this.pointers.values()];
    this.drag = null;
    this.pinch = {
      dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
      world: this.toWorld((a[0] + b[0]) / 2 - rect.left, (a[1] + b[1]) / 2 - rect.top),
    };
  }

  /**
   * Two fingers zoom and pan at once: the plan point first grabbed stays
   * under their midpoint, wherever it goes and however far apart they move.
   */
  movePinch() {
    const rect = this.svg.getBoundingClientRect();
    const [a, b] = [...this.pointers.values()];
    const mid = [(a[0] + b[0]) / 2 - rect.left, (a[1] + b[1]) / 2 - rect.top];
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const scale = clampScale(this.view.scale * (dist / this.pinch.dist));
    const [wx, wy] = this.pinch.world;
    this.view = {
      scale,
      cx: wx - (mid[0] - this.map.w / 2) / scale,
      cy: wy + (mid[1] - this.map.h / 2) / scale,
    };
    this.pinch.dist = dist;
    this.render();
  }

  /**
   * Paint or erase every cell a stroke crosses from `a` to `b`.
   *
   * A cell belongs to one building only. Painting over a neighbour used to
   * give both of them the cell, hence two walls and two roofs in the same
   * place; the brush passes over cells another body owns, and says so once
   * per stroke. Erasing acts on whichever body owns the cell, not only the
   * active one — the eraser is aimed at what is under it.
   */
  paintStroke(a, b) {
    const s = this.store;
    const d = this.drag;
    const m = s.model;
    const cs = cellSizeOf(m);
    const owner = new Map();
    for (const bd of m.buildings) for (const c of bd.cells) owner.set(c, bd);
    const active = s.activeBuildingId;
    const changes = new Map(); // building id -> cells to add or remove
    let refused = null;
    for (const [i, j] of cellsAlong([a[0] / cs, a[1] / cs], [b[0] / cs, b[1] / cs])) {
      const k = key(i, j);
      const o = owner.get(k);
      const id = d.erase ? o?.id : active;
      if (!id) continue;
      if (!d.erase && o) {
        if (o.id !== active) refused = o;
        continue;
      }
      if (!changes.has(id)) changes.set(id, []);
      changes.get(id).push(k);
    }
    if (refused && !d.warned) {
      d.warned = true;
      s.notify(`Case déjà occupée par « ${refused.name} »`);
    }
    if (!changes.size) return;
    s.update((cur) => {
      let next = cur;
      for (const [id, list] of changes) {
        const body = next.buildings.find((x) => x.id === id);
        if (!body) continue;
        const set = buildingCells(body);
        for (const k of list) if (d.erase) set.delete(k); else set.add(k);
        next = setBuildingCells(next, id, set);
      }
      return next;
    });
    this.render();
  }

  /** The cell rectangle a rectangle drag covers, corners included. */
  rectCells(d) {
    const cs = cellSizeOf(this.store.model);
    const [a, b] = [d.from, d.to];
    return {
      x0: Math.min(Math.floor(a[0] / cs), Math.floor(b[0] / cs)),
      y0: Math.min(Math.floor(a[1] / cs), Math.floor(b[1] / cs)),
      x1: Math.max(Math.floor(a[0] / cs), Math.floor(b[0] / cs)),
      y1: Math.max(Math.floor(a[1] / cs), Math.floor(b[1] / cs)),
    };
  }

  commitFrame(d) {
    const [a, b] = [d.from, d.to];
    const snap = (v) => Math.round(v * 4) / 4;
    const x0 = snap(Math.min(a[0], b[0])), x1 = snap(Math.max(a[0], b[0]));
    const y0 = snap(Math.min(a[1], b[1])), y1 = snap(Math.max(a[1], b[1]));
    // A click is not a frame. Below a couple of metres the zone would hold
    // nothing and the camera would zoom to a blur, so it is read as a miss.
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    this.store.update((m) => ({
      ...m,
      focus: { ...m.focus, enabled: true, x: x0, y: y0, w: x1 - x0, d: y1 - y0 },
    }));
  }

  commitRect(d) {
    const { x0, y0, x1, y1 } = this.rectCells(d);
    const erase = d.erase;
    const s = this.store;
    const id = s.activeBuildingId;
    let refused = null;
    s.update((m) => {
      // As with the brush: removing takes the cells from whichever body owns
      // them, adding leaves alone the cells another body already owns.
      const owner = new Map();
      for (const b of m.buildings) if (b.id !== id) for (const c of b.cells) owner.set(c, b);
      let next = m;
      for (const b of m.buildings) {
        if (!erase && b.id !== id) continue;
        const set = buildingCells(b);
        for (let j = y0; j <= y1; j++) {
          for (let i = x0; i <= x1; i++) {
            const k = key(i, j);
            if (erase) set.delete(k);
            else if (owner.has(k)) refused = owner.get(k);
            else set.add(k);
          }
        }
        if (set.size !== b.cells.length || erase) next = setBuildingCells(next, b.id, set);
      }
      return next;
    });
    if (refused) s.notify(`Cases déjà occupées par « ${refused.name} » laissées de côté`);
  }
}
