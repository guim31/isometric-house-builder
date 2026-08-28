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
  const x = snap(centred ? pt[0] : pt[0] - (def.w ?? 2) / 2);
  const y = snap(centred ? pt[1] : pt[1] - (def.d ?? 2) / 2);
  store.update((m) => ({ ...m, props: [...m.props, { id, kind, x, y, ...def }] }));
  store.select({ type: 'prop', id });
}
