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
 * removing it. So what falls outside the rectangle is taken out of the model
 * before anything is built.
 *
 * That used to be optional. It is not any more: leaving it off produced an
 * image cropped by its own border — a roof sliced by a straight machine cut on
 * one side, a soft rounded lawn on the other — which is the one result this
 * whole mechanism exists to avoid.
 *
 * Extended items are cut at the frame; compact ones are kept whole or dropped
 * on where their centre falls. That is a reversal, and the reason is worth
 * recording: they used to be kept whole, on the grounds that half a hedge
 * ending in mid-air is worse than one running past the edge of the picture.
 * True while the picture was an opaque rectangle. It stopped being true once
 * the ground became a pad with transparency around it — a hedge kept whole
 * then runs off the pad and *does* end in mid-air, and dragging the pad out to
 * meet it turns the export back into a green tile.
 */

import { parseKey } from './grid.js';
import { propFootprint, cellSizeOf, DEFAULT_FOCUS } from './model.js';

/**
 * The zone itself: [x0, y0, x1, y1] in metres.
 *
 * What is kept, what is cut, and how far the ground reaches. The margin is
 * deliberately *not* in it — the margin is air the camera leaves around the
 * zone, and folding it in here grew the lawn instead, so a generous margin
 * filled the picture with empty ground rather than framing what was in it.
 */
export function focusRect(focus) {
  const f = { ...DEFAULT_FOCUS, ...(focus || {}) };
  return [f.x, f.y, f.x + f.w, f.y + f.d];
}

/** The zone plus its margin: what the camera frames. */
export function focusFrame(focus) {
  const f = { ...DEFAULT_FOCUS, ...(focus || {}) };
  const m = Math.max(0, f.margin ?? 0);
  return [f.x - m, f.y - m, f.x + f.w + m, f.y + f.d + m];
}

const overlaps = (a, r) => a[0] < r[2] && a[2] > r[0] && a[1] < r[3] && a[3] > r[1];

/**
 * Does this building actually stand in the zone?
 *
 * By cell centres, not by overlap. A house whose east wall runs along the edge
 * of a zone drawn around the gate in front of it grazes that zone by a
 * centimetre — and being kept for it, was drawn whole and then sliced by the
 * picture's border. Standing in the zone means having ground inside it.
 */
function buildingInside(b, rect, cs) {
  for (const k of b.cells) {
    const [i, j] = parseKey(k);
    const cx = (i + 0.5) * cs, cy = (j + 0.5) * cs;
    if (cx >= rect[0] && cx <= rect[2] && cy >= rect[1] && cy <= rect[3]) return true;
  }
  return false;
}

/**
 * Items long enough that cutting them is better than losing them.
 *
 * A wall, a hedge or a terrace crossing the frame is cut at it. A tree, a gate
 * or a car is not: those are single objects with a shape of their own, and
 * half of one is not a smaller one. They are kept whole if their centre falls
 * inside the frame and dropped otherwise.
 */
const CLIPPABLE = new Set(['muret', 'hedge', 'fence', 'terrace', 'path', 'deck', 'pool']);

/**
 * Below this a cut leaves a sliver rather than an object.
 *
 * Measured against the item's own size, not as an absolute: a muret is 24 cm
 * thick and a gate 16 cm, so a flat thirty-centimetre floor deleted every wall
 * and fence in the model the moment a frame was drawn.
 */
const MIN_KEEP = 0.3;
const keeps = (left, whole) => left >= Math.min(MIN_KEEP, whole * 0.5);

function clipProp(p, rect) {
  const fp = propFootprint(p);
  if (!overlaps(fp, rect)) return null;
  if (!CLIPPABLE.has(p.kind)) {
    const cx = (fp[0] + fp[2]) / 2, cy = (fp[1] + fp[3]) / 2;
    const inside = cx >= rect[0] && cx <= rect[2] && cy >= rect[1] && cy <= rect[3];
    return inside ? p : null;
  }
  const x0 = Math.max(fp[0], rect[0]), x1 = Math.min(fp[2], rect[2]);
  const y0 = Math.max(fp[1], rect[1]), y1 = Math.min(fp[3], rect[3]);
  if (!keeps(x1 - x0, fp[2] - fp[0]) || !keeps(y1 - y0, fp[3] - fp[1])) return null;
  if (x0 === fp[0] && y0 === fp[1] && x1 === fp[2] && y1 === fp[3]) return p;
  return { ...p, x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
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
  if (!f?.enabled) return model;
  const rect = focusRect(f);
  const cs = cellSizeOf(model);

  const buildings = model.buildings.filter((b) => !b.cells.length || buildingInside(b, rect, cs));
  const kept = new Set(buildings.flatMap((b) => b.cells));
  const props = model.props.map((p) => clipProp(p, rect)).filter(Boolean);

  // Openings and roof items live on a volume; dropping the volume drops them
  // with it. Their own position is not tested: a window on the far side of a
  // kept house is hidden by the house, not by the frame.
  const openings = model.openings.filter((o) => kept.has(o.edge.split(',').slice(0, 2).join(',')));
  const roofItems = model.roofItems.filter((it) =>
    kept.has(`${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`));

  const propsUnchanged = props.length === model.props.length
    && props.every((p, i) => p === model.props[i]);
  if (buildings.length === model.buildings.length
    && propsUnchanged
    && openings.length === model.openings.length
    && roofItems.length === model.roofItems.length) return model;

  return { ...model, buildings, props, openings, roofItems };
}
