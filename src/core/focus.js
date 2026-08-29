/**
 * Framing: showing one part of the model instead of all of it.
 *
 * A dashboard widget that drives the sliding gate gains nothing from a picture
 * of the whole property — everything in it is small and nothing is obvious. So
 * a project can carry a rectangle drawn on the plan, and an export framed on
 * it.
 *
 * Cropping alone is not enough, and this is the part worth understanding: in an
 * isometric view, distance on the ground is not distance on screen. A shed at
 * the far end of the garden projects *upward*, straight into a frame drawn
 * around the front gate. Tightening the camera brings it closer rather than
 * removing it. Hence `hide`: what falls outside the rectangle is taken out of
 * the model before anything is built.
 *
 * Whole items are kept or dropped, never clipped. A hedge that starts inside
 * the frame stays whole, because half a hedge ending in mid-air is a worse
 * artefact than a hedge that runs past the edge of the picture.
 */

import { parseKey } from './grid.js';
import { propFootprint, cellSizeOf, DEFAULT_FOCUS } from './model.js';

/** The rectangle actually used, margin included: [x0, y0, x1, y1] in metres. */
export function focusRect(focus) {
  const f = { ...DEFAULT_FOCUS, ...(focus || {}) };
  const m = Math.max(0, f.margin ?? 0);
  return [f.x - m, f.y - m, f.x + f.w + m, f.y + f.d + m];
}

const overlaps = (a, r) => a[0] < r[2] && a[2] > r[0] && a[1] < r[3] && a[3] > r[1];

/** Does any cell of this building fall inside the frame? */
function buildingInside(b, rect, cs) {
  for (const k of b.cells) {
    const [i, j] = parseKey(k);
    if (overlaps([i * cs, j * cs, (i + 1) * cs, (j + 1) * cs], rect)) return true;
  }
  return false;
}

// One-entry memo, keyed by model identity. The model is immutable, so this is
// exact — and it is what lets the viewport keep its built mesh across an orbit
// drag instead of rebuilding the house sixty times a second.
let memo = { in: null, out: null };

/**
 * The model as it should be drawn: unchanged when no frame is set, otherwise
 * stripped of everything outside it.
 *
 * Returns the *same object* when nothing is removed, so callers can compare by
 * identity to decide whether their caches are still good.
 */
export function focusModel(model) {
  if (memo.in === model) return memo.out;
  const out = compute(model);
  memo = { in: model, out };
  return out;
}

function compute(model) {
  const f = model.focus;
  if (!f?.enabled || !f.hide) return model;
  const rect = focusRect(f);
  const cs = cellSizeOf(model);

  const buildings = model.buildings.filter((b) => !b.cells.length || buildingInside(b, rect, cs));
  const kept = new Set(buildings.flatMap((b) => b.cells));
  const props = model.props.filter((p) => overlaps(propFootprint(p), rect));

  // Openings and roof items live on a volume; dropping the volume drops them
  // with it. Their own position is not tested: a window on the far side of a
  // kept house is hidden by the house, not by the frame.
  const openings = model.openings.filter((o) => kept.has(o.edge.split(',').slice(0, 2).join(',')));
  const roofItems = model.roofItems.filter((it) =>
    kept.has(`${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`));

  if (buildings.length === model.buildings.length
    && props.length === model.props.length
    && openings.length === model.openings.length
    && roofItems.length === model.roofItems.length) return model;

  return { ...model, buildings, props, openings, roofItems };
}

/**
 * Points the camera should frame.
 *
 * The rectangle's own eight corners, plus every vertex standing inside it. The
 * vertices are what raise the frame to clear a roof: the rectangle is drawn on
 * the ground, but a house inside it is six metres tall and would otherwise be
 * beheaded.
 */
export function focusPoints(focus, faces) {
  const [x0, y0, x1, y1] = focusRect(focus);
  const pts = [];
  let zMax = 0;
  for (const f of faces) {
    for (const loop of f.loops) {
      for (const p of loop) {
        if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
        pts.push(p);
        if (p[2] > zMax) zMax = p[2];
      }
    }
  }
  for (const z of [0, zMax]) {
    pts.push([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
  }
  return pts;
}
