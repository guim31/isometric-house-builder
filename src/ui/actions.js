/**
 * Placement of openings, roof items and outdoor props.
 *
 * Both views place things — the plan by grid position, the render by picking a
 * wall or inverting the ground plane — so the defaults and the insertion logic
 * live here, where neither view owns them. Before this module, the viewport
 * imported its defaults from the plan and duplicated the insertion code; the
 * two had already begun to drift.
 */

import {
  newId, fitOpening, OPENING_DEFAULTS, PROP_DEFAULTS, ROOF_ITEM_DEFAULTS, CENTRED_KINDS, stairsRun, cellSizeOf,
  FIXTURE_DEFAULTS,
} from '../core/model.js';

// Defined in the model, which fills them into files that leave them out.
export { OPENING_DEFAULTS, PROP_DEFAULTS, ROOF_ITEM_DEFAULTS, CENTRED_KINDS, FIXTURE_DEFAULTS };




/** Items drawn by dragging a run, where the length is the whole point. */
export const LINEAR_KINDS = new Set(['muret', 'fence', 'hedge']);

/** Thickness given to a linear run, across its direction. */
const LINEAR_THICKNESS = { muret: 0.24, fence: 0.2, hedge: 0.6 };

const snap = (v) => Math.round(v * 4) / 4;

export function placeOpening(store, kind, edgeId, storey, offsetMetres) {
  const id = newId('o', store.model);
  // Whole on its wall: a click near a corner put half a window round it.
  store.update((m) => ({
    ...m,
    openings: [...m.openings, fitOpening(m, {
      id, edge: edgeId, storey: storey || 0, kind,
      offset: Math.round(offsetMetres * 20) / 20, ...OPENING_DEFAULTS[kind],
    })],
  }));
  store.select({ type: 'opening', id });
}

/** The building whose roof would carry an item centred on `pt`, or null. */
export function roofAt(model, pt) {
  const cs = cellSizeOf(model);
  const k = `${Math.floor(pt[0] / cs)},${Math.floor(pt[1] / cs)}`;
  return model.buildings.find((b) => b.cells.includes(k)) || null;
}

/**
 * Hang a fixture on a wall, `offsetMetres` along its edge and, when given,
 * `z` metres above its level's floor — where the wall was clicked in the
 * render; at the kind's usual height from the plan, which has no height.
 */
export function placeFixture(store, kind, edgeId, storey, offsetMetres, z = null) {
  const id = newId('f', store.model);
  const def = FIXTURE_DEFAULTS[kind];
  store.update((m) => ({
    ...m,
    fixtures: [...m.fixtures, fitOpening(m, {
      id, kind, edge: edgeId, storey: storey || 0,
      offset: Math.round(offsetMetres * 20) / 20,
      z: Number.isFinite(z) ? Math.round(z * 20) / 20 : def.z,
    })],
  }));
  store.select({ type: 'fixture', id });
}

/** The roof item a click at `pt` would make, without its id. */
export function roofItemAt(kind, pt) {
  return { kind, x: snap(pt[0]), y: snap(pt[1]), ...ROOF_ITEM_DEFAULTS[kind] };
}

/**
 * Put a roof item down — on a roof only. Off every roof it was created all
 * the same, and never drawn: an object nobody could see or find again.
 * Returns whether one was placed.
 */
export function placeRoofItem(store, kind, pt) {
  const item = roofItemAt(kind, pt);
  if (!roofAt(store.model, [item.x, item.y])) {
    store.notify?.('Posez cet objet sur le toit d’un corps de bâtiment');
    return false;
  }
  const id = newId('r', store.model);
  store.update((m) => ({ ...m, roofItems: [...m.roofItems, { id, ...item }] }));
  store.select({ type: 'roofItem', id });
  return true;
}

/**
 * The outdoor item a click at `pt` would make, without its id, along with
 * what it took its cue from: the wall a gate lines up with, the raised slab
 * steps climb to. Shared by the placement and by the plan's preview of it,
 * which must show exactly where the click will land.
 */
export function propAt(model, kind, pt) {
  let def = PROP_DEFAULTS[kind];
  let extra = {};
  let slab = null, wall = null;
  if (kind === 'stairs') {
    // Steps exist to reach something. Turned the wrong way by default they
    // would have to be reoriented every single time, so they take their
    // height and their direction from the raised slab they are dropped by —
    // and a run long enough to climb it: at a fixed 1,25 m, three metres of
    // steps had seven-centimetre treads.
    const near = nearestRaisedSlab(model, pt);
    if (near) {
      slab = near.slab;
      const run = stairsRun(near.z);
      const along = near.dir === 'N' || near.dir === 'S';
      def = { ...def, h: near.z, dir: near.dir, w: along ? def.w : run, d: along ? run : def.d };
    }
  }
  const centred = CENTRED_KINDS.has(kind);
  const x = snap(centred ? pt[0] : pt[0] - (def.w ?? 2) / 2);
  const y = snap(centred ? pt[1] : pt[1] - (def.d ?? 2) / 2);
  if (kind === 'gate') {
    // Snap onto the nearest wall: a gate is only useful in one, and aligning
    // it by hand to a quarter of a metre would be tedious and easy to miss.
    const near = nearestMuret(model, pt);
    if (near) { extra = near.fit(pt, def); wall = near.wall; }
  }
  return { prop: { kind, x, y, ...def, ...extra }, slab, wall };
}

export function placeProp(store, kind, pt) {
  const id = newId('p', store.model);
  const { prop } = propAt(store.model, kind, pt);
  store.update((m) => ({ ...m, props: [...m.props, { id, ...prop }] }));
  store.select({ type: 'prop', id });
}

/**
 * The garden wall closest to a point, with a helper that aligns a gate into
 * it: same orientation, same thickness, centred on the wall's own line.
 */
export function nearestMuret(model, pt, maxDist = 2.5) {
  let best = null, bestD = maxDist;
  for (const p of model.props) {
    if (p.kind !== 'muret') continue;
    const horiz = (p.w ?? 4) >= (p.d ?? 0.2);
    const a0 = horiz ? p.x : p.y;
    const a1 = a0 + (horiz ? p.w : p.d);
    const c = (horiz ? p.y + (p.d ?? 0.24) / 2 : p.x + (p.w ?? 0.24) / 2);
    const along = horiz ? pt[0] : pt[1];
    const across = horiz ? pt[1] : pt[0];
    const d = Math.hypot(Math.max(0, Math.max(a0 - along, along - a1)), across - c);
    if (d >= bestD) continue;
    bestD = d;
    best = {
      wall: p, horiz,
      fit: (at, def) => {
        const w = def.w ?? 1.1;
        const t = def.d ?? 0.16;
        const mid = Math.min(Math.max(horiz ? at[0] : at[1], a0), a1);
        const start = snap(mid - w / 2);
        return horiz
          ? { x: start, y: snap(c - t / 2), w, d: t }
          : { x: snap(c - t / 2), y: start, w: t, d: w, h: def.h };
      },
    };
  }
  return best;
}

/**
 * The raised slab nearest a point, and which way one would climb onto it.
 *
 * The direction is the side of the slab the point falls outside of, taking the
 * nearest edge — drop the steps below a terrace and they face up towards it.
 */
export function nearestRaisedSlab(model, pt, maxDist = 3) {
  let best = null, bestD = maxDist;
  for (const p of model.props) {
    if (!['terrace', 'deck', 'path', 'pool'].includes(p.kind)) continue;
    const z = p.z ?? 0;
    if (z < 0.15) continue;
    const x0 = p.x, x1 = p.x + (p.w ?? 2), y0 = p.y, y1 = p.y + (p.d ?? 2);
    const dx = Math.max(x0 - pt[0], 0, pt[0] - x1);
    const dy = Math.max(y0 - pt[1], 0, pt[1] - y1);
    const d = Math.hypot(dx, dy);
    if (d >= bestD) continue;
    bestD = d;
    // Which edge of the slab is closest: that is the one to climb.
    const gaps = [[pt[1] - y1, 'S'], [y0 - pt[1], 'N'], [pt[0] - x1, 'W'], [x0 - pt[0], 'E']];
    gaps.sort((a, b) => b[0] - a[0]);
    best = { slab: p, z, dir: gaps[0][1] };
  }
  return best;
}

/**
 * The footprint a dragged run becomes, snapped to quarter metres — shared by
 * the placement and by the length shown while dragging, which rounded the raw
 * distance and could announce 1 m for a wall laid at 1,25 m.
 */
export function runShape(kind, from, to) {
  const t = LINEAR_THICKNESS[kind] ?? 0.24;
  const horiz = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]);
  const a0 = snap(Math.min(horiz ? from[0] : from[1], horiz ? to[0] : to[1]));
  const a1 = snap(Math.max(horiz ? from[0] : from[1], horiz ? to[0] : to[1]));
  const len = Math.max(0.5, a1 - a0);
  const c = snap((horiz ? from[1] : from[0]) - t / 2);
  return { len, shape: horiz ? { x: a0, y: c, w: len, d: t } : { x: c, y: a0, w: t, d: len } };
}

/**
 * Create a linear prop from a dragged run. A click without a drag lays
 * nothing: it used to leave a half-metre stub where one meant to select.
 */
export function placeRun(store, kind, from, to) {
  if (Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) < 0.25) return;
  const id = newId('p', store.model);
  const def = PROP_DEFAULTS[kind] || {};
  const { shape } = runShape(kind, from, to);
  store.update((m) => ({ ...m, props: [...m.props, { id, kind, ...def, ...shape }] }));
  store.select({ type: 'prop', id });
}

/**
 * Nudge the selection with the arrow keys, one step in direction (dx, dy):
 * a quarter metre (a metre with `big`) for an item, five centimetres (a
 * quarter metre) along its wall for an opening, a whole cell for a body.
 * Held keys repeat, and coalesce into one step of the history.
 * Returns whether the key was used.
 */
export function nudgeSelection(store, dx, dy, big = false) {
  const sel = store.selection;
  if (!sel) return false;
  if (sel.type === 'building') {
    store.moveBuilding(sel.id, dx, dy, 'nudge');
    return true;
  }
  const item = store.selected;
  if (!item) return false;
  if (sel.type === 'opening') {
    // Along the wall only: an arrow across it has nowhere to send it.
    const side = item.edge.split(',')[2];
    const u = { S: [1, 0], N: [-1, 0], E: [0, 1], W: [0, -1] }[side];
    const along = dx * u[0] + dy * u[1];
    if (!along) return true;
    const step = (big ? 0.25 : 0.05) * along;
    store.patchSelected((it, m) => fitOpening(m, {
      ...it, offset: Math.round(((it.offset ?? 0.5) + step) * 100) / 100,
    }), 'nudge');
    return true;
  }
  const step = big ? 1 : 0.25;
  store.patchSelected((it) => ({
    x: Math.round((it.x + dx * step) * 100) / 100,
    y: Math.round((it.y + dy * step) * 100) / 100,
  }), 'nudge');
  return true;
}
