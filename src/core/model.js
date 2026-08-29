/**
 * The project model. One plain JSON object, serialisable as-is: it is what the
 * save file, the undo stack and the shareable URL all carry.
 */

import { key, rectCells, connectedComponents } from './grid.js';
import { DEFAULT_PROJECTION, DEFAULT_PITCH, clampPitch, normaliseYaw } from './iso.js';
import { THEMES } from './palette.js';
import { PRESETS } from '../data/presets.js';

export const MODEL_VERSION = 1;
export const GRID = 40; // cells per side; 1 cell = 1 metre

let seq = 0;
export const newId = (prefix) => `${prefix}${(seq++).toString(36)}${Math.floor(performance.now() % 1e6).toString(36)}`;

/** Items positioned by their centre rather than their minimum corner. */
export const CENTRED_KINDS = new Set(['tree', 'bush', 'car']);

/** Ground footprint of an outdoor item, in metres: [x0, y0, x1, y1]. */
export function propFootprint(p) {
  const w = p.r ? p.r * 2 : p.w ?? 2;
  const d = p.r ? p.r * 2 : p.d ?? 2;
  const x0 = CENTRED_KINDS.has(p.kind) ? p.x - w / 2 : p.x;
  const y0 = CENTRED_KINDS.has(p.kind) ? p.y - d / 2 : p.y;
  return [x0, y0, x0 + w, y0 + d];
}

/**
 * The framing rectangle: which part of the model an export shows.
 *
 * Off by default — a whole house is what most people want. It earns its keep
 * on a dashboard widget that drives one thing, where the useful image is the
 * gate and the wall it sits in, not the garden it happens to stand at the end
 * of. Distances are metres, `x`/`y` the lower-left corner, as for props.
 */
export const DEFAULT_CAMERA = { yaw: 0, pitch: DEFAULT_PITCH, projection: DEFAULT_PROJECTION };

export const DEFAULT_FOCUS = {
  enabled: false,
  x: 0, y: 0, w: 12, d: 10,
  margin: 1.5,
  hide: true,     // drop what falls outside instead of merely cropping it
  vignette: 0.3,  // 0 = hard edge; otherwise how much of the frame fades out
};

/**
 * One building volume: its own footprint, its own height, its own roof.
 *
 * A garden shed is not the house with a smaller footprint — it has a flat roof
 * and timber walls of its own. Keeping the roof on the model meant every
 * volume shared one, so adding a shed re-roofed the house.
 */
export function makeBuilding(patch = {}) {
  return {
    id: newId('b'),
    name: 'Corps principal',
    cells: [],
    storeys: 1,
    storeyHeight: 2.7,
    plinth: 0,
    roof: { type: 'hip', pitch: 30, overhang: 0.5, fascia: 0.18, shedDir: 'S' },
    overrides: {},
    texture: null, // null = follow the model's materials
    ...patch,
  };
}

export function emptyModel() {
  return {
    version: MODEL_VERSION,
    name: 'Ma maison',
    grid: { w: GRID, d: GRID, cellSize: 1 },
    buildings: [makeBuilding()],
    // Defaults to the Gladys Assistant v5 look, which is what this tool is
    // primarily meant to feed. Every other palette is one click away.
    theme: 'horizons',
    texture: { roof: 'none', wall: 'none' },
    overrides: {},
    openings: [],
    roofItems: [],
    props: [],
    ground: { enabled: true, material: 'grass', margin: 3 },
    camera: { ...DEFAULT_CAMERA },
    focus: { ...DEFAULT_FOCUS },
    views: [],
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
  m.camera = normaliseCamera(input?.camera, base.camera);
  m.focus = normaliseFocus(input?.focus, base.focus);
  m.views = normaliseViews(input?.views);
  m.texture = { ...base.texture, ...(input?.texture || {}) };
  m.style = { ...base.style, ...(input?.style || {}) };
  m.overrides = { ...(input?.overrides || {}) };
  m.buildings = normaliseBuildings(input, m);
  delete m.cells; delete m.storeys; delete m.storeyHeight; delete m.plinth; delete m.roof;
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

  m.version = MODEL_VERSION;
  return m;
}

/**
 * Buildings, migrating the older single-footprint shape.
 *
 * A legacy file carried one `cells` set and one roof. Its disconnected parts
 * become separate buildings straight away — that is what they always were —
 * so a shed drawn apart from the house can be re-roofed the moment the file
 * is opened, without any manual re-splitting.
 */
function normaliseBuildings(input, m) {
  const proto = makeBuilding();
  // Spreading a source that carries explicit `undefined` would overwrite the
  // defaults with it — a file that simply omits a storey height would then
  // build a roof at NaN. Only stated keys are taken.
  const stated = (o) => Object.fromEntries(
    Object.entries(o || {}).filter(([, v]) => v !== undefined),
  );
  const clean = (b, fallbackName) => {
    const out = { ...proto, ...stated(b) };
    out.id = b.id || newId('b');
    out.name = b.name || fallbackName;
    out.cells = Array.isArray(b.cells) ? b.cells.filter((c) => /^-?\d+,-?\d+$/.test(c)).sort() : [];
    out.roof = { ...proto.roof, ...(b.roof || {}) };
    out.overrides = { ...(b.overrides || {}) };
    out.texture = b.texture ? { ...b.texture } : null;
    out.storeys = Math.max(1, Math.min(4, Math.round(out.storeys) || 1));
    return out;
  };

  // Empty volumes never win over a legacy footprint: a caller that spreads a
  // blank model and then sets `cells` means the cells, and silently dropping
  // them would lose the whole house.
  const declared = Array.isArray(input?.buildings) ? input.buildings : null;
  const declaredHasCells = declared && declared.some((b) => (b.cells || []).length);
  const legacyCells = Array.isArray(input?.cells) && input.cells.length;
  if (declared && declared.length && (declaredHasCells || !legacyCells)) {
    return declared.map((b, i) => clean(b, i ? `Bâtiment ${i + 1}` : 'Corps principal'));
  }

  const legacy = clean({
    cells: input?.cells, storeys: input?.storeys, storeyHeight: input?.storeyHeight,
    plinth: input?.plinth, roof: input?.roof,
  }, 'Corps principal');
  if (!legacy.cells.length) return [makeBuilding()];

  const parts = connectedComponents(new Set(legacy.cells));
  if (parts.length <= 1) return [legacy];
  return parts.map((cells, i) => clean(
    { ...legacy, id: i ? newId('b') : legacy.id, cells },
    i ? `Bâtiment ${i + 1}` : 'Corps principal',
  ));
}

/**
 * The camera, migrating the older quarter-turn field.
 *
 * `rotation` was an index in 0..3 back when only four viewpoints existed. Files
 * saved then — and the share links already in circulation — must keep opening
 * on the view they were saved from, so the index is read as its yaw in degrees.
 */
function normaliseCamera(input, base) {
  const c = { ...base, ...(input || {}) };
  if (input && input.yaw === undefined && input.rotation !== undefined) {
    c.yaw = (((Math.round(input.rotation) % 4) + 4) % 4) * 90;
  }
  delete c.rotation;
  c.yaw = normaliseYaw(c.yaw);
  c.pitch = clampPitch(c.pitch);
  return c;
}

/** A framing rectangle that is at least a rectangle. */
function normaliseFocus(input, base) {
  const f = { ...base, ...(input || {}) };
  const num = (v, min, fallback) =>
    (Number.isFinite(v) ? Math.max(min, v) : fallback);
  f.w = num(f.w, 0.5, base.w);
  f.d = num(f.d, 0.5, base.d);
  f.margin = num(f.margin, 0, base.margin);
  f.vignette = Math.min(0.9, num(f.vignette, 0, base.vignette));
  f.x = Number.isFinite(f.x) ? f.x : base.x;
  f.y = Number.isFinite(f.y) ? f.y : base.y;
  return f;
}

/** Saved framings: a named camera and focus, re-exportable in one click. */
function normaliseViews(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(Boolean).map((v, i) => ({
    id: v.id || newId('v'),
    name: v.name || `Vue ${i + 1}`,
    camera: normaliseCamera(v.camera, DEFAULT_CAMERA),
    focus: normaliseFocus(v.focus, DEFAULT_FOCUS),
  }));
}

/** Every cell of every building, for framing and for the ground. */
export function allCells(m) {
  const out = new Set();
  for (const b of m.buildings) for (const c of b.cells) out.add(c);
  return out;
}

export const buildingCells = (b) => new Set(b.cells);

/** The building a wall edge belongs to, or null. */
export function buildingOfEdge(m, edgeId) {
  const cell = edgeId.split(',').slice(0, 2).join(',');
  return m.buildings.find((b) => b.cells.includes(cell)) || null;
}

export const cellSet = (m) => (m.buildings ? allCells(m) : new Set(m.cells || []));

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
  const exact = Number.isInteger(ratio);

  const convert = (list) => {
    const cells = new Set();
    for (const c of list) {
      const [i, j] = c.split(',').map(Number);
      if (exact) {
        for (let dj = 0; dj < ratio; dj++) {
          for (let di = 0; di < ratio; di++) cells.add(`${i * ratio + di},${j * ratio + dj}`);
        }
      } else {
        cells.add(`${Math.floor((i * old) / size)},${Math.floor((j * old) / size)}`);
      }
    }
    return [...cells].sort();
  };

  const reanchor = (op) => {
    const [is, js, side] = op.edge.split(',');
    const i = Number(is), j = Number(js);
    if (!exact) {
      return { ...op, edge: `${Math.floor((i * old) / size)},${Math.floor((j * old) / size)},${side}` };
    }
    // The sub-cell holding the same start corner, so the metre offset keeps
    // naming the same point of the wall.
    const t = {
      S: [i * ratio, j * ratio],
      N: [(i + 1) * ratio - 1, (j + 1) * ratio - 1],
      E: [(i + 1) * ratio - 1, j * ratio],
      W: [i * ratio, (j + 1) * ratio - 1],
    }[side];
    return { ...op, edge: `${t[0]},${t[1]},${side}` };
  };

  return {
    ...m,
    grid: { ...m.grid, cellSize: size },
    buildings: m.buildings.map((b) => ({ ...b, cells: convert(b.cells) })),
    openings: m.openings.map(reanchor),
  };
}

/** Replace the cells of one building. */
export function setBuildingCells(m, id, set) {
  return {
    ...m,
    buildings: m.buildings.map((b) => (b.id === id ? { ...b, cells: [...set].sort() } : b)),
  };
}

/** Total height of the walls, plinth included. Takes a building. */
export const wallTop = (b) => b.plinth + b.storeys * b.storeyHeight;

export function findById(m, list, id) {
  return (m[list] || []).find((it) => it.id === id) || null;
}

export { key };
