/**
 * Placement of openings, roof items and outdoor props.
 *
 * Both views place things — the plan by grid position, the render by picking a
 * wall or inverting the ground plane — so the defaults and the insertion logic
 * live here, where neither view owns them. Before this module, the viewport
 * imported its defaults from the plan and duplicated the insertion code; the
 * two had already begun to drift.
 */

import { newId } from '../core/model.js';

export const OPENING_DEFAULTS = {
  window: { width: 1.3, height: 1.3, sill: 0.95 },
  shutter: { width: 1.3, height: 1.3, sill: 0.95 },
  door: { width: 1.0, height: 2.1, sill: 0 },
  garage: { width: 2.6, height: 2.1, sill: 0 },
};

export const ROOF_ITEM_DEFAULTS = {
  solar: { w: 4, d: 2.4 },
  chimney: { w: 0.8, d: 0.8, h: 1.1 },
  velux: { w: 1, d: 1.2 },
  dish: { w: 0.8, d: 0.8 },
};

export const PROP_DEFAULTS = {
  muret: { w: 6, d: 0.24, h: 1.5 },
  gate: { w: 1.1, d: 0.16, h: 1.5, style: 'swing' },
  pool: { w: 7, d: 4, shape: 'rounded' },
  terrace: { w: 6, d: 4, material: 'paving' },
  path: { w: 3, d: 2, material: 'gravel' },
  deck: { w: 5, d: 3 },
  hedge: { w: 4, d: 0.6, h: 0.8 },
  fence: { w: 6, d: 0.2, h: 1.1 },
  tree: { r: 1.5 },
  bush: { r: 1.1 },
};

/** Items positioned by their centre rather than their minimum corner. */
export const CENTRED_KINDS = new Set(['tree', 'bush', 'car']);

/** Items drawn by dragging a run, where the length is the whole point. */
export const LINEAR_KINDS = new Set(['muret', 'fence', 'hedge']);

/** Thickness given to a linear run, across its direction. */
const LINEAR_THICKNESS = { muret: 0.24, fence: 0.2, hedge: 0.6 };

const snap = (v) => Math.round(v * 4) / 4;

export function placeOpening(store, kind, edgeId, storey, offsetMetres) {
  const id = newId('o');
  store.update((m) => ({
    ...m,
    openings: [...m.openings, {
      id, edge: edgeId, storey: storey || 0, kind,
      offset: Math.max(0.05, Math.round(offsetMetres * 20) / 20), ...OPENING_DEFAULTS[kind],
    }],
  }));
  store.select({ type: 'opening', id });
}

export function placeRoofItem(store, kind, pt) {
  const id = newId('r');
  store.update((m) => ({
    ...m,
    roofItems: [...m.roofItems, { id, kind, x: snap(pt[0]), y: snap(pt[1]), ...ROOF_ITEM_DEFAULTS[kind] }],
  }));
  store.select({ type: 'roofItem', id });
}

export function placeProp(store, kind, pt) {
  const id = newId('p');
  const def = PROP_DEFAULTS[kind];
  const centred = CENTRED_KINDS.has(kind);
  let x = snap(centred ? pt[0] : pt[0] - (def.w ?? 2) / 2);
  let y = snap(centred ? pt[1] : pt[1] - (def.d ?? 2) / 2);
  let extra = {};
  if (kind === 'gate') {
    // Snap onto the nearest wall: a gate is only useful in one, and aligning
    // it by hand to a quarter of a metre would be tedious and easy to miss.
    const near = nearestMuret(store.model, pt);
    if (near) extra = near.fit(pt, def);
  }
  store.update((m) => ({ ...m, props: [...m.props, { id, kind, x, y, ...def, ...extra }] }));
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

/** Create a linear prop from a dragged run, snapped to quarter metres. */
export function placeRun(store, kind, from, to) {
  const id = newId('p');
  const def = PROP_DEFAULTS[kind] || {};
  const t = LINEAR_THICKNESS[kind] ?? 0.24;
  const horiz = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]);
  const a0 = snap(Math.min(horiz ? from[0] : from[1], horiz ? to[0] : to[1]));
  const a1 = snap(Math.max(horiz ? from[0] : from[1], horiz ? to[0] : to[1]));
  const len = Math.max(0.5, a1 - a0);
  const c = snap((horiz ? from[1] : from[0]) - t / 2);
  const shape = horiz ? { x: a0, y: c, w: len, d: t } : { x: c, y: a0, w: t, d: len };
  store.update((m) => ({ ...m, props: [...m.props, { id, kind, ...def, ...shape }] }));
  store.select({ type: 'prop', id });
}
