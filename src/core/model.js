/**
 * The project model. One plain JSON object, serialisable as-is: it is what the
 * save file, the undo stack and the shareable URL all carry.
 */

import { key, rectCells } from './grid.js';
import { DEFAULT_PROJECTION } from './iso.js';
import { THEMES } from './palette.js';
import { PRESETS } from '../data/presets.js';

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
    plinth: 0,
    roof: { type: 'hip', pitch: 30, overhang: 0.5, fascia: 0.18, shedDir: 'S' },
    // Defaults to the Gladys Assistant v5 look, which is what this tool is
    // primarily meant to feed. Every other palette is one click away.
    theme: 'horizons',
    texture: { roof: 'none', wall: 'none' },
    overrides: {},
    openings: [],
    roofItems: [],
    props: [],
    ground: { enabled: true, material: 'grass', margin: 3 },
    camera: { rotation: 0, projection: DEFAULT_PROJECTION },
    style: { outline: false, outlineWidth: 1.1, background: 'transparent', shadow: false, windowBars: false },
  };
}

/**
 * The project a first-time visitor lands on: the first entry of the starter
 * gallery, so there is one description of it rather than two that can drift.
 */
export function defaultModel() {
  const preset = PRESETS[0];
  return normalise({ ...preset.model, name: preset.name });
}

/** Fill in anything a hand-edited or older file may be missing. */
export function normalise(input) {
  const base = emptyModel();
  const m = { ...base, ...(input || {}) };
  m.grid = { ...base.grid, ...(input?.grid || {}) };
  if (![1, 0.5, 0.25].includes(m.grid.cellSize)) m.grid.cellSize = 1;
  m.roof = { ...base.roof, ...(input?.roof || {}) };
  m.ground = { ...base.ground, ...(input?.ground || {}) };
  m.camera = { ...base.camera, ...(input?.camera || {}) };
  m.texture = { ...base.texture, ...(input?.texture || {}) };
  m.style = { ...base.style, ...(input?.style || {}) };
  m.overrides = { ...(input?.overrides || {}) };
  m.cells = Array.isArray(m.cells) ? m.cells.filter((c) => /^-?\d+,-?\d+$/.test(c)) : [];
  for (const list of ['openings', 'roofItems', 'props']) {
    m[list] = Array.isArray(m[list]) ? m[list].filter(Boolean) : [];
    for (const it of m[list]) if (!it.id) it.id = newId(list[0]);
  }
  // Anything the file does not state falls back to what its own palette
  // prescribes, not to the global default. Without this, a project saved
  // before a setting existed would inherit whichever palette happens to be
  // the current default — and render with the wrong palette's conventions.
  const declared = (THEMES[m.theme] || {}).style;
  if (declared) {
    for (const k of ['outline', 'shadow', 'windowBars']) {
      if (input?.style?.[k] === undefined && declared[k] !== undefined) m.style[k] = declared[k];
    }
    if (input?.plinth === undefined && declared.plinth !== undefined) m.plinth = declared.plinth;
    if (!input?.texture && declared.texture) m.texture = { ...m.texture, ...declared.texture };
  }

  m.storeys = Math.max(1, Math.min(4, Math.round(m.storeys) || 1));
  m.version = MODEL_VERSION;
  return m;
}

export const cellSet = (m) => new Set(m.cells);

/** Metres per grid cell. Everything outside the grid already speaks metres. */
export const cellSizeOf = (m) => m.grid?.cellSize || 1;

/** "10,5" rather than "10.5": dimensions are displayed in French. */
export const fmtMetres = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

/**
 * Change the drawing grid pitch, preserving the built house.
 *
 * Refining (1 m -> 0,50 m) is exact: every cell subdivides in place, and each
 * opening is re-anchored to the sub-cell that owns the same start corner, so
 * its metre offset keeps naming the same spot on the wall. Coarsening rounds
 * the footprint onto the larger grid and is only a best effort.
 */
export function withCellSize(m, size) {
  const old = cellSizeOf(m);
  if (size === old) return m;
  const ratio = old / size;
  const cells = new Set();
  const openings = [];
  if (Number.isInteger(ratio)) {
    for (const c of m.cells) {
      const [i, j] = c.split(',').map(Number);
      for (let dj = 0; dj < ratio; dj++) {
        for (let di = 0; di < ratio; di++) cells.add(`${i * ratio + di},${j * ratio + dj}`);
      }
    }
    for (const op of m.openings) {
      const [is, js, side] = op.edge.split(',');
      const i = Number(is), j = Number(js);
      const target = {
        S: [i * ratio, j * ratio],
        N: [(i + 1) * ratio - 1, (j + 1) * ratio - 1],
        E: [(i + 1) * ratio - 1, j * ratio],
        W: [i * ratio, (j + 1) * ratio - 1],
      }[side];
      openings.push({ ...op, edge: `${target[0]},${target[1]},${side}` });
    }
  } else {
    for (const c of m.cells) {
      const [i, j] = c.split(',').map(Number);
      cells.add(`${Math.floor(i * old / size)},${Math.floor(j * old / size)}`);
    }
    for (const op of m.openings) {
      const [is, js, side] = op.edge.split(',');
      openings.push({ ...op, edge: `${Math.floor(Number(is) * old / size)},${Math.floor(Number(js) * old / size)},${side}` });
    }
  }
  return { ...m, grid: { ...m.grid, cellSize: size }, cells: [...cells].sort(), openings };
}

export function setCells(m, set) {
  return { ...m, cells: [...set].sort() };
}

/** Total height of the walls, plinth included. */
export const wallTop = (m) => m.plinth + m.storeys * m.storeyHeight;

export function findById(m, list, id) {
  return (m[list] || []).find((it) => it.id === id) || null;
}

export { key };
