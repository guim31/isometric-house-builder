/**
 * The geometry of direct manipulation in the plan: which cells a stroke
 * crosses, where a dragged item snaps, which handles a selection carries and
 * what pulling one does. No DOM here — the plan view asks, these answer, and
 * the tests can ask the same questions without a pointer.
 */

import { boundaryEdges } from '../core/grid.js';
import { cellSizeOf, propFootprint, LIMITS, CENTRED_KINDS } from '../core/model.js';
import { LINEAR_KINDS } from './actions.js';

/** The quarter-metre trame everything outdoors is placed on. */
export const GRID = 0.25;
/** How close an edge has to come to a line for the magnet to take it. */
export const MAGNET = 0.3;

const snapGrid = (v) => Math.round(v / GRID) * GRID;
const clean = (v) => Math.round(v * 1000) / 1000 || 0;

/**
 * Every cell a straight stroke from `a` to `b` passes through, in order,
 * both ends included — points in cell units. A fast hand moves the pointer
 * several cells between two events, and painting only where the events
 * landed left gaps in the stroke.
 */
export function cellsAlong(a, b) {
  let i = Math.floor(a[0]), j = Math.floor(a[1]);
  const i1 = Math.floor(b[0]), j1 = Math.floor(b[1]);
  const out = [[i, j]];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const sx = Math.sign(dx), sy = Math.sign(dy);
  // Amanatides–Woo: step to whichever cell border the segment meets first.
  const tdx = sx ? Math.abs(1 / dx) : Infinity;
  const tdy = sy ? Math.abs(1 / dy) : Infinity;
  let tx = sx > 0 ? (i + 1 - a[0]) / dx : sx < 0 ? (a[0] - i) / -dx : Infinity;
  let ty = sy > 0 ? (j + 1 - a[1]) / dy : sy < 0 ? (a[1] - j) / -dy : Infinity;
  for (let n = 0; (i !== i1 || j !== j1) && n < 4096; n++) {
    if (tx < ty) { i += sx; tx += tdx; } else { j += sy; ty += tdy; }
    out.push([i, j]);
  }
  return out;
}

/* ---------------- what an item is, as a box ---------------- */

/** Ground box of an item, [x0, y0, x1, y1], whatever list it is in. */
export function boxOf(type, it) {
  if (type === 'prop') return propFootprint(it);
  if (type === 'roofItem') {
    const w = it.w ?? 2, d = it.d ?? 1.5;
    return [it.x - w / 2, it.y - d / 2, it.x + w / 2, it.y + d / 2];
  }
  if (type === 'focus') return [it.x, it.y, it.x + it.w, it.y + it.d];
  return null;
}

/** The fields that put an item on `box` — the inverse of boxOf. */
function fromBox(type, it, [x0, y0, x1, y1]) {
  const w = clean(x1 - x0), d = clean(y1 - y0);
  if (type === 'roofItem' || (type === 'prop' && CENTRED_KINDS.has(it.kind))) {
    return { x: clean((x0 + x1) / 2), y: clean((y0 + y1) / 2), w, d };
  }
  return { x: clean(x0), y: clean(y0), w, d };
}

/* ---------------- snapping ---------------- */

/**
 * Lines the magnet pulls towards: the walls of every body, and the edges of
 * every item but the one being moved. `xs` are vertical lines (an x), `ys`
 * horizontal ones.
 */
export function snapLines(model, skipId = null) {
  const xs = new Set(), ys = new Set();
  const cs = cellSizeOf(model);
  for (const b of model.buildings) {
    for (const e of boundaryEdges(new Set(b.cells))) {
      if (e.side === 'E' || e.side === 'W') xs.add(e.a[0] * cs); else ys.add(e.a[1] * cs);
    }
  }
  const add = (box) => { xs.add(box[0]); xs.add(box[2]); ys.add(box[1]); ys.add(box[3]); };
  for (const p of model.props) if (p.id !== skipId) add(propFootprint(p));
  for (const it of model.roofItems) if (it.id !== skipId) add(boxOf('roofItem', it));
  return { xs: [...xs], ys: [...ys] };
}

/** The line within reach of any of `edges`, and the shift that lands on it. */
function pull(edges, lines) {
  let best = null;
  for (const e of edges) {
    for (const t of lines) {
      const d = Math.abs(t - e);
      if (d < MAGNET && (!best || d < best.d)) best = { d, shift: t - e, at: t };
    }
  }
  return best;
}

/**
 * Where a box dragged by (dx, dy) from `box` comes to rest: on the magnet's
 * line when one of its edges comes within reach, else with its anchor on the
 * quarter-metre trame. `anchor` is the point the item stores (its corner, or
 * its centre). Returns the anchor's shift and the guides the magnet drew.
 */
export function snapMove(box, anchor, dx, dy, lines, { magnet = true } = {}) {
  const guides = [];
  const axis = (k, d, lo, hi, list) => {
    const raw = anchor[k] + d;
    const hit = magnet && pull([lo + d, hi + d], list);
    if (hit) {
      guides.push({ axis: k ? 'y' : 'x', at: hit.at });
      return clean(raw + hit.shift) - anchor[k];
    }
    return snapGrid(raw) - anchor[k];
  };
  const sx = axis(0, dx, box[0], box[2], lines.xs);
  const sy = axis(1, dy, box[1], box[3], lines.ys);
  return { dx: sx, dy: sy, guides };
}

/** One coordinate, on the trame or on a line within reach. */
function snapValue(v, list, magnet, axis, guides) {
  const hit = magnet && pull([v], list);
  if (hit) { guides.push({ axis, at: hit.at }); return clean(hit.at); }
  return snapGrid(v);
}

/* ---------------- handles ---------------- */

const RECT_HANDLES = {
  sw: [0, 0], s: [0.5, 0], se: [1, 0], e: [1, 0.5], ne: [1, 1], n: [0.5, 1], nw: [0, 1], w: [0, 0.5],
};
const CORNERS = ['sw', 'se', 'ne', 'nw'];

/*
 * Sizes stay within what the inspector's own controls offer: a handle that
 * went further left a slider pinned at its end, unable to show the value.
 */

/** Smallest size of a box, by what it is: a pool still holds water, a car a car. */
function minSize(type, it) {
  if (type === 'focus') return [2, 2];
  if (type === 'roofItem') return [0.4, 0.4];
  if (it.kind === 'pool') return [1, 1];
  if (it.kind === 'car') return [1, 2];
  if (it.kind === 'gate') return [0.1, 0.1];
  return [0.25, 0.25];
}

function maxSize(type, it) {
  if (type === 'focus') return [200, 200];
  if (type === 'roofItem') return [10, 8];
  if (it.kind === 'gate') return [LIMITS.gate, LIMITS.gate];
  return [24, 24];
}

/** How an item is resized: its sides, its two ends, or its radius. */
export function handleShape(type, it) {
  if (type === 'prop' && (it.kind === 'tree' || it.kind === 'bush')) return 'radius';
  if (type === 'prop' && LINEAR_KINDS.has(it.kind)) return 'ends';
  if (type === 'roofItem') return 'corners';
  return 'box';
}

/** The handles of a selection, as `{ id, x, y }` in metres. */
export function handlesOf(type, it) {
  if (!it || type === 'opening' || type === 'building') return [];
  const shape = handleShape(type, it);
  if (shape === 'radius') return [{ id: 'r', x: it.x + (it.r ?? 1), y: it.y }];
  const [x0, y0, x1, y1] = boxOf(type, it);
  if (shape === 'ends') {
    const horiz = x1 - x0 >= y1 - y0;
    return horiz
      ? [{ id: 'a', x: x0, y: (y0 + y1) / 2 }, { id: 'b', x: x1, y: (y0 + y1) / 2 }]
      : [{ id: 'a', x: (x0 + x1) / 2, y: y0 }, { id: 'b', x: (x0 + x1) / 2, y: y1 }];
  }
  const ids = shape === 'corners' ? CORNERS : Object.keys(RECT_HANDLES);
  return ids.map((id) => ({
    id, x: x0 + (x1 - x0) * RECT_HANDLES[id][0], y: y0 + (y1 - y0) * RECT_HANDLES[id][1],
  }));
}

/**
 * Pull handle `handle` of item `it` to `pt`: the patch it makes, and the
 * guides of any magnet that acted. The opposite side stays where it was, and
 * the size stays within what the item can be.
 */
export function resizeTo(type, it, handle, pt, lines, { magnet = true } = {}) {
  const guides = [];
  const shape = handleShape(type, it);
  if (shape === 'radius') {
    const r = Math.round(Math.hypot(pt[0] - it.x, pt[1] - it.y) * 10) / 10;
    return { patch: { r: Math.max(0.5, Math.min(4, r)) }, guides };
  }
  const [mw, md] = minSize(type, it);
  const [Mw, Md] = maxSize(type, it);
  let [x0, y0, x1, y1] = boxOf(type, it);
  if (shape === 'ends') {
    const horiz = x1 - x0 >= y1 - y0;
    const lo = horiz ? x0 : y0, hi = horiz ? x1 : y1;
    const list = horiz ? lines.xs : lines.ys;
    const v = snapValue(horiz ? pt[0] : pt[1], list, magnet, horiz ? 'x' : 'y', guides);
    // A run is at least half a metre: a click without a drag lays nothing either.
    let a = lo, b = hi;
    if (handle === 'a') a = Math.max(hi - 60, Math.min(v, hi - 0.5));
    else b = Math.min(lo + 60, Math.max(v, lo + 0.5));
    if (horiz) { x0 = a; x1 = b; } else { y0 = a; y1 = b; }
    return { patch: fromBox(type, it, [x0, y0, x1, y1]), guides };
  }
  const h = RECT_HANDLES[handle];
  if (!h) return { patch: {}, guides };
  if (h[0] === 0) x0 = Math.max(x1 - Mw, Math.min(snapValue(pt[0], lines.xs, magnet, 'x', guides), x1 - mw));
  if (h[0] === 1) x1 = Math.min(x0 + Mw, Math.max(snapValue(pt[0], lines.xs, magnet, 'x', guides), x0 + mw));
  if (h[1] === 0) y0 = Math.max(y1 - Md, Math.min(snapValue(pt[1], lines.ys, magnet, 'y', guides), y1 - md));
  if (h[1] === 1) y1 = Math.min(y0 + Md, Math.max(snapValue(pt[1], lines.ys, magnet, 'y', guides), y0 + md));
  return { patch: fromBox(type, it, [x0, y0, x1, y1]), guides };
}

/** The same box, moved: the patch for an anchor shifted by (dx, dy). */
export function movedBy(type, it, dx, dy) {
  return { x: clean(it.x + dx), y: clean(it.y + dy) };
}
