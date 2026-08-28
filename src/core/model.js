/**
 * The project model. One plain JSON object, serialisable as-is: it is what the
 * save file, the undo stack and the shareable URL all carry.
 */

import { key, rectCells } from './grid.js';
import { DEFAULT_PROJECTION } from './iso.js';

export const MODEL_VERSION = 1;
export const GRID = 40; // cells per side; 1 cell = 1 metre

let seq = 0;
export const newId = (prefix) => `${prefix}${(seq++).toString(36)}${Math.floor(performance.now() % 1e6).toString(36)}`;

export function emptyModel() {
  return {
    version: MODEL_VERSION,
    name: 'Ma maison',
    grid: { w: GRID, d: GRID, cellSize: 1 },
    cells: [],
    storeys: 1,
    storeyHeight: 2.7,
    plinth: 0.2,
    roof: { type: 'hip', pitch: 30, overhang: 0.5, fascia: 0.18, shedDir: 'S' },
    theme: 'terracotta',
    overrides: {},
    openings: [],
    roofItems: [],
    props: [],
    ground: { enabled: true, material: 'grass', margin: 3 },
    camera: { rotation: 0, projection: DEFAULT_PROJECTION },
    style: { outline: true, outlineWidth: 1.1, background: 'transparent', shadow: true },
  };
}

/** An L-shaped starter house, in the spirit of the reference illustration. */
export function defaultModel() {
  const m = emptyModel();
  const wing = rectCells(11, 12, 27, 18); // long bar
  const arm = rectCells(21, 19, 27, 24); // short arm, forming the L
  m.cells = [...new Set([...wing, ...arm])];
  // Placed on the north and east walls: those are the two facades the default
  // camera looks at, so a new project shows its openings straight away.
  m.openings = [
    { id: newId('o'), edge: '12,18,N', storey: 0, kind: 'shutter', offset: 0.5, width: 1.3, height: 1.3, sill: 0.95 },
    { id: newId('o'), edge: '15,18,N', storey: 0, kind: 'window', offset: 0.5, width: 1.8, height: 1.4, sill: 0.9 },
    { id: newId('o'), edge: '18,18,N', storey: 0, kind: 'door', offset: 0.5, width: 1.0, height: 2.1, sill: 0 },
    { id: newId('o'), edge: '22,24,N', storey: 0, kind: 'window', offset: 0.5, width: 1.3, height: 1.3, sill: 0.95 },
    { id: newId('o'), edge: '25,24,N', storey: 0, kind: 'garage', offset: 0.5, width: 2.6, height: 2.1, sill: 0 },
    { id: newId('o'), edge: '27,15,E', storey: 0, kind: 'shutter', offset: 0.5, width: 1.3, height: 1.3, sill: 0.95 },
    { id: newId('o'), edge: '27,21,E', storey: 0, kind: 'window', offset: 0.5, width: 1.5, height: 1.3, sill: 0.95 },
  ];
  m.props = [
    { id: newId('p'), kind: 'pool', x: 12.5, y: 20, w: 7, d: 4.5, shape: 'rounded' },
    { id: newId('p'), kind: 'terrace', x: 11, y: 19, w: 10, d: 6.5, material: 'paving' },
    { id: newId('p'), kind: 'path', x: 17.5, y: 19.2, w: 2.5, d: 2, material: 'paving' },
    { id: newId('p'), kind: 'tree', x: 8.5, y: 22, r: 1.4 },
    { id: newId('p'), kind: 'tree', x: 30, y: 15, r: 1.7 },
  ];
  m.roofItems = [
    { id: newId('r'), kind: 'solar', x: 15, y: 13.2, w: 4.4, d: 2.4 },
    { id: newId('r'), kind: 'chimney', x: 24.5, y: 14.5, w: 0.8, d: 0.8, h: 1.1 },
  ];
  return m;
}

/** Fill in anything a hand-edited or older file may be missing. */
export function normalise(input) {
  const base = emptyModel();
  const m = { ...base, ...(input || {}) };
  m.grid = { ...base.grid, ...(input?.grid || {}) };
  m.roof = { ...base.roof, ...(input?.roof || {}) };
  m.ground = { ...base.ground, ...(input?.ground || {}) };
  m.camera = { ...base.camera, ...(input?.camera || {}) };
  m.style = { ...base.style, ...(input?.style || {}) };
  m.overrides = { ...(input?.overrides || {}) };
  m.cells = Array.isArray(m.cells) ? m.cells.filter((c) => /^-?\d+,-?\d+$/.test(c)) : [];
  for (const list of ['openings', 'roofItems', 'props']) {
    m[list] = Array.isArray(m[list]) ? m[list].filter(Boolean) : [];
    for (const it of m[list]) if (!it.id) it.id = newId(list[0]);
  }
  m.storeys = Math.max(1, Math.min(4, Math.round(m.storeys) || 1));
  m.version = MODEL_VERSION;
  return m;
}

export const cellSet = (m) => new Set(m.cells);

export function setCells(m, set) {
  return { ...m, cells: [...set].sort() };
}

/** Total height of the walls, plinth included. */
export const wallTop = (m) => m.plinth + m.storeys * m.storeyHeight;

export function findById(m, list, id) {
  return (m[list] || []).find((it) => it.id === id) || null;
}

export { key };
