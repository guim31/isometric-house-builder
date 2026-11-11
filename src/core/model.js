/**
 * The project model. One plain JSON object, serialisable as-is: it is what the
 * save file, the undo stack and the shareable URL all carry.
 */

import { key, rectCells, connectedComponents, SIDES, runExtents } from './grid.js';
import { DEFAULT_PROJECTION, DEFAULT_PITCH, clampPitch, clampRoll, normaliseYaw } from './iso.js';
import { THEMES } from './palette.js';
import { PRESETS } from '../data/presets.js';

// 2: per-level heights, recessed openings, raised slabs, steps. Older files
// open unchanged; the number is what tells a newer file apart.
export const MODEL_VERSION = 2;

/** Drawing pitches the plan offers, in metres per cell. */
export const CELL_SIZES = [1, 0.5];

/** Range of one level's height, in metres — the inspector's and the files'. */
export const STOREY_HEIGHT_RANGE = [0.6, 4];

/**
 * A fresh id, unused in `model` when one is given.
 *
 * Drawn at random rather than from a counter and the page clock: both start
 * again at every load, so an item added after reopening a project could be
 * given the id of one already in it — and then edited, selected and deleted
 * along with it.
 */
export function newId(prefix, model = null) {
  const taken = model ? idsOf(model) : null;
  for (;;) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const id = prefix + [...bytes].map((b) => (b % 36).toString(36)).join('');
    if (!taken || !taken.has(id)) return id;
  }
}

/** Every id a model carries, whatever list it is in. */
export function idsOf(m) {
  const out = new Set();
  for (const list of ['buildings', 'openings', 'roofItems', 'props', 'views']) {
    for (const it of m?.[list] || []) if (it?.id) out.add(it.id);
  }
  return out;
}

/*
 * A model also arrives from a share link or a file someone else wrote, and its
 * ids and colours end up inside SVG attributes. Anything that is not plainly an
 * id or a colour is replaced rather than escaped at every place it is written.
 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOUR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const safeId = (id, prefix) => (typeof id === 'string' && ID_RE.test(id) ? id : newId(prefix));
const safeColours = (o) => Object.fromEntries(
  Object.entries(o && typeof o === 'object' ? o : {})
    .filter(([k, v]) => ID_RE.test(k.replace('#', '')) && COLOUR_RE.test(v)),
);
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Spreading a source that carries explicit `undefined` would overwrite the
// defaults with it — a file that simply omits a storey height would then
// build a roof at NaN. Only stated keys are taken.
const stated = (o) => Object.fromEntries(
  Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null),
);

/** Items positioned by their centre rather than their minimum corner. */
export const CENTRED_KINDS = new Set(['tree', 'bush', 'car']);

/**
 * Size and height of a newly placed opening, by kind. Also what a file that
 * leaves a field out gets: the renderer, the pick layer and the inspector each
 * carried their own fallbacks, and a window without a sill was drawn at 0,95 m
 * and outlined on the ground.
 */
export const OPENING_DEFAULTS = {
  window: { width: 1.3, height: 1.3, sill: 0.95 },
  shutter: { width: 1.3, height: 1.3, sill: 0.95 },
  door: { width: 1.0, height: 2.1, sill: 0 },
  garage: { width: 2.6, height: 2.1, sill: 0 },
};

/**
 * Size and look of a newly placed outdoor item, by kind — filled, like the
 * opening defaults, into files that leave a field out. The renderer, the pick
 * layer and the framing each had their own fallbacks, and had drifted: a
 * stair without a size was 1,2 m in one and 2 m in another.
 */
export const PROP_DEFAULTS = {
  muret: { w: 6, d: 0.24, h: 1.5 },
  gate: { w: 1.1, d: 0.16, h: 1.5, style: 'swing' },
  pool: { w: 7, d: 4, shape: 'rounded' },
  terrace: { w: 6, d: 4, material: 'paving' },
  stairs: { w: 1.25, d: 1.25, h: 0.5, dir: 'N', material: 'paving' },
  path: { w: 3, d: 2, material: 'gravel' },
  deck: { w: 5, d: 3 },
  hedge: { w: 4, d: 0.6, h: 0.8 },
  fence: { w: 6, d: 0.2, h: 1.1 },
  tree: { r: 1.5 },
  bush: { r: 1.1 },
  car: { w: 1.8, d: 4.2 },
};

/** About eighteen centimetres a riser, which is what a stair is. */
export const stairsSteps = (h) => Math.max(1, Math.min(24, Math.round(h / 0.18)));

/**
 * Length a flight needs to climb `h` metres comfortably: a tread of about
 * twenty-eight centimetres a step, rounded up to the quarter-metre grid.
 */
export const stairsRun = (h) => Math.max(1.25, Math.ceil((stairsSteps(h) * 0.28) * 4) / 4);

/** An opening on a level its building no longer has is kept, but not built. */
export const openingShown = (op, b) => (op.storey || 0) < b.storeys;

/** Ground footprint of an outdoor item, in metres: [x0, y0, x1, y1]. */
export function propFootprint(p) {
  const def = PROP_DEFAULTS[p.kind] || {};
  const r = p.r ?? def.r;
  const w = r ? r * 2 : p.w ?? def.w ?? 2;
  const d = r ? r * 2 : p.d ?? def.d ?? 2;
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
export const DEFAULT_CAMERA = { yaw: 0, pitch: DEFAULT_PITCH, roll: 0, projection: DEFAULT_PROJECTION };

export const DEFAULT_FOCUS = {
  enabled: false,
  x: 0, y: 0, w: 12, d: 10,
  margin: 1.5,
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
    // Optional per-level heights; each entry overrides storeyHeight for its
    // level. The common case is an attic level shorter than the ones below —
    // the storey where the roof already begins.
    storeyHeights: null,
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
    grid: { cellSize: 1 },
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
    style: {
      outline: false, outlineWidth: 1.1, background: 'transparent',
      shadow: false, windowBars: false, night: false,
    },
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
  if (!isRecord(input)) input = {};
  const base = emptyModel();
  const m = { ...base, ...input };
  if (!THEMES[m.theme]) m.theme = base.theme;
  if (typeof m.name !== 'string') m.name = base.name;
  // Only the pitch is a setting; the extent the grid once declared was never
  // read, and is not written back.
  const size = Number(input?.grid?.cellSize);
  m.grid = { cellSize: [...CELL_SIZES, 0.25].includes(size) ? size : 1 };
  m.ground = { ...base.ground, ...(input?.ground || {}) };
  m.camera = normaliseCamera(input?.camera, base.camera);
  m.focus = normaliseFocus(input?.focus, base.focus);
  m.views = normaliseViews(input?.views);
  m.texture = { ...base.texture, ...(input?.texture || {}) };
  m.style = { ...base.style, ...(input?.style || {}) };
  if (m.style.background !== 'transparent' && !COLOUR_RE.test(m.style.background)) {
    m.style.background = base.style.background;
  }
  m.overrides = safeColours(input?.overrides);
  // Anything the file does not state falls back to what its own palette
  // prescribes, not to the global default. Without this, a project saved
  // before a setting existed would inherit whichever palette happens to be
  // the current default — and render with the wrong palette's conventions.
  const declared = THEMES[m.theme].style || {};
  m.buildings = normaliseBuildings(input, declared.plinth);
  delete m.cells; delete m.storeys; delete m.storeyHeight; delete m.plinth; delete m.roof;
  for (const list of ['openings', 'roofItems', 'props']) {
    m[list] = Array.isArray(m[list]) ? m[list].filter(isRecord) : [];
    for (const it of m[list]) it.id = safeId(it.id, list[0]);
  }
  // Missing fields take their kind's defaults; a kind nobody knows is dropped,
  // as nothing would draw it.
  m.props = m.props
    .filter((p) => PROP_DEFAULTS[p.kind] && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ ...PROP_DEFAULTS[p.kind], ...stated(p) }));
  m.openings = m.openings
    .filter((op) => typeof op.edge === 'string' && /^-?\d+,-?\d+,[SENW]$/.test(op.edge))
    .map((op) => {
      const kind = OPENING_DEFAULTS[op.kind] ? op.kind : 'window';
      const out = { storey: 0, offset: 0.5, ...OPENING_DEFAULTS[kind], ...op, kind };
      for (const k of ['storey', 'offset', 'width', 'height', 'sill']) {
        if (!Number.isFinite(out[k])) out[k] = k === 'storey' ? 0 : k === 'offset' ? 0.5 : OPENING_DEFAULTS[kind][k];
      }
      out.storey = Math.max(0, Math.min(3, Math.round(out.storey)));
      return out;
    });
  for (const k of ['outline', 'shadow', 'windowBars']) {
    if (input?.style?.[k] === undefined && declared[k] !== undefined) m.style[k] = declared[k];
  }
  if (!input?.texture && declared.texture) m.texture = { ...m.texture, ...declared.texture };

  m.version = MODEL_VERSION;
  // A quarter-metre grid was accepted on input but never offered, and the roof
  // lattice cannot hold it: a ridge over an odd number of quarter cells falls
  // between its points. Such a file opens on the half-metre grid instead.
  return m.grid.cellSize === 0.25 ? withCellSize(m, 0.5) : m;
}

/**
 * Buildings, migrating the older single-footprint shape.
 *
 * A legacy file carried one `cells` set and one roof. Its disconnected parts
 * become separate buildings straight away — that is what they always were —
 * so a shed drawn apart from the house can be re-roofed the moment the file
 * is opened, without any manual re-splitting.
 */
function normaliseBuildings(input, themePlinth) {
  const proto = makeBuilding();
  const clean = (b, fallbackName) => {
    const out = { ...proto, ...stated(b) };
    out.id = safeId(b.id, 'b');
    out.name = typeof b.name === 'string' && b.name ? b.name : fallbackName;
    // A file that says nothing about the plinth gets its palette's: brick and
    // stone houses stand on one, the flat Horizons look does not.
    if (!Number.isFinite(b.plinth)) out.plinth = Number.isFinite(themePlinth) ? themePlinth : 0;
    out.cells = Array.isArray(b.cells) ? b.cells.filter((c) => /^-?\d+,-?\d+$/.test(c)).sort() : [];
    out.roof = { ...proto.roof, ...(b.roof || {}) };
    out.overrides = safeColours(b.overrides);
    out.texture = b.texture ? { ...b.texture } : null;
    out.storeys = Math.max(1, Math.min(4, Math.round(out.storeys) || 1));
    const [lo, hi] = STOREY_HEIGHT_RANGE;
    out.storeyHeight = Number.isFinite(out.storeyHeight) ? Math.max(lo, Math.min(hi, out.storeyHeight)) : proto.storeyHeight;
    out.plinth = Number.isFinite(out.plinth) ? Math.max(0, Math.min(1, out.plinth)) : 0;
    // All four kept, not only the levels in use: taking a level away and
    // putting it back should find its height where it was left.
    out.storeyHeights = Array.isArray(b.storeyHeights)
      ? b.storeyHeights.slice(0, 4)
        .map((v) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : out.storeyHeight))
      : null;
    return out;
  };

  // Empty volumes never win over a legacy footprint: a caller that spreads a
  // blank model and then sets `cells` means the cells, and silently dropping
  // them would lose the whole house.
  const declared = Array.isArray(input?.buildings) ? input.buildings.filter(isRecord) : null;
  const declaredHasCells = declared && declared.some((b) => (b.cells || []).length);
  const legacyCells = Array.isArray(input?.cells) && input.cells.length;
  if (declared && declared.length && (declaredHasCells || !legacyCells)) {
    // A cell belongs to one body. A file in which two claim it — painted over
    // before the plan prevented it — keeps it with the first.
    const owned = new Set();
    return declared.map((b, i) => {
      const out = clean(b, i ? `Bâtiment ${i + 1}` : 'Corps principal');
      out.cells = out.cells.filter((c) => !owned.has(c) && owned.add(c));
      return out;
    });
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
  c.roll = clampRoll(c.roll);
  return c;
}

/** A framing rectangle that is at least a rectangle. */
function normaliseFocus(input, base) {
  const f = { ...base, ...(input || {}) };
  const num = (v, min, fallback) =>
    (Number.isFinite(v) ? Math.max(min, v) : fallback);
  // Two metres, as the plan and the inspector have it: below that the zone
  // holds nothing and the camera zooms to a blur.
  f.w = num(f.w, 2, base.w);
  f.d = num(f.d, 2, base.d);
  f.margin = num(f.margin, 0, base.margin);
  f.x = Number.isFinite(f.x) ? f.x : base.x;
  f.y = Number.isFinite(f.y) ? f.y : base.y;
  // Older files carry `hide` and `vignette`. Neither is a setting any more:
  // both softened a crop by the picture's own border, and the camera no longer
  // makes one — it fits what is drawn, whole.
  delete f.hide;
  delete f.vignette;
  return f;
}

/** Saved framings: a named camera and focus, re-exportable in one click. */
function normaliseViews(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(isRecord).map((v, i) => ({
    id: safeId(v.id, 'v'),
    name: typeof v.name === 'string' && v.name ? v.name : `Vue ${i + 1}`,
    camera: normaliseCamera(v.camera, DEFAULT_CAMERA),
    focus: normaliseFocus(v.focus, DEFAULT_FOCUS),
  }));
}

/**
 * Switch palettes, along with the look the palette is drawn for.
 *
 * Horizons without outlines or a plinth, the brick palette with both: a
 * palette is a style as much as a set of colours, and switching only the
 * colours gave a Horizons house with black outlines. The plinth now lives on
 * each building, so it is set on all of them. The user's own recolourings —
 * project-wide or per building — and a building's own materials are left as
 * they are: those are choices, not part of a palette.
 */
export function withTheme(m, name) {
  const theme = THEMES[name];
  if (!theme) return m;
  const preset = theme.style || {};
  const next = { ...m, theme: name };
  const style = { ...m.style };
  for (const k of ['outline', 'shadow', 'windowBars']) if (preset[k] !== undefined) style[k] = preset[k];
  next.style = style;
  if (preset.texture) next.texture = { ...m.texture, ...preset.texture };
  if (Number.isFinite(preset.plinth)) {
    next.buildings = m.buildings.map((b) => ({ ...b, plinth: preset.plinth }));
  }
  return next;
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

/**
 * The straight wall an opening stands on, in its edge's own frame:
 * `{ host, lo, hi }`, metres along the edge, or null for a wall since erased.
 */
export function openingRun(m, op) {
  const host = buildingOfEdge(m, op.edge);
  if (!host) return null;
  const run = runExtents(new Set(host.cells), cellSizeOf(m)).get(op.edge);
  return run ? { host, lo: run.lo, hi: run.hi } : null;
}

/**
 * An offset that keeps an opening of `width` whole on its run of wall —
 * centred on it when the wall is the shorter of the two.
 */
export function fitOffset(offset, width, run) {
  if (!run) return offset;
  if (run.hi - run.lo <= width) return (run.lo + run.hi) / 2;
  return Math.min(run.hi - width / 2, Math.max(run.lo + width / 2, offset));
}

/**
 * The opening moved back onto its wall, as placing, sliding, widening and
 * duplicating it do. Only ever applied to an edit: a file whose opening
 * already ran past a corner opens with it where it was.
 */
export function fitOpening(m, op) {
  const run = openingRun(m, op);
  if (!run) return op;
  const offset = fitOffset(op.offset ?? 0.5, op.width ?? OPENING_DEFAULTS[op.kind]?.width ?? 1.2, run);
  return offset === op.offset ? op : { ...op, offset };
}

/**
 * Bottom and top of an opening, in metres above the ground, kept within its
 * level: a window taller than its storey stops at the floor above instead of
 * running through it — and through the roof, outline and all.
 */
export function openingSpan(op, b) {
  const base = storeyBase(b, op.storey || 0);
  const level = storeyHeightOf(b, op.storey || 0);
  const sill = Math.max(0, Math.min(op.sill ?? 0.95, level - 0.1));
  const z0 = base + sill;
  return { z0, z1: Math.min(z0 + (op.height ?? 1.25), base + level) };
}

/**
 * Other openings sharing this one's stretch of wall and level, in metres of
 * overlap — what the inspector warns about. Positions are compared along the
 * run, since two openings may hang off different edges of the same wall.
 */
export function overlappingOpenings(m, op) {
  const mine = openingRun(m, op);
  if (!mine) return [];
  const span = (o, r) => {
    const c = (o.offset ?? 0.5) - r.lo, w = o.width ?? 1.2;
    return [c - w / 2, c + w / 2];
  };
  const corner = (o, r) => {
    const [i, j, side] = o.edge.split(',');
    const s = SIDES[side];
    const a = s.a(Number(i), Number(j)), b = s.b(Number(i), Number(j));
    const cs = cellSizeOf(m);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    return `${side}:${(a[0] * cs + u[0] * r.lo).toFixed(3)},${(a[1] * cs + u[1] * r.lo).toFixed(3)}`;
  };
  const here = corner(op, mine);
  const [a0, a1] = span(op, mine);
  const out = [];
  for (const o of m.openings) {
    if (o.id === op.id || (o.storey || 0) !== (op.storey || 0)) continue;
    const r = openingRun(m, o);
    if (!r || r.host !== mine.host || corner(o, r) !== here) continue;
    const [b0, b1] = span(o, r);
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap > 1e-6) out.push(o);
  }
  return out;
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
      // The coarser cell's edge starts somewhere else along the same wall, so
      // the offset is carried over by that distance — otherwise the opening
      // slid along the facade by up to a cell.
      const ni = Math.floor((i * old) / size), nj = Math.floor((j * old) / size);
      const s = SIDES[side];
      const a0 = s.a(i, j).map((v) => v * old), a1 = s.a(ni, nj).map((v) => v * size);
      const u = [s.b(0, 0)[0] - s.a(0, 0)[0], s.b(0, 0)[1] - s.a(0, 0)[1]];
      const shift = (a0[0] - a1[0]) * u[0] + (a0[1] - a1[1]) * u[1];
      return { ...op, edge: `${ni},${nj},${side}`, offset: (op.offset ?? 0.5) + shift };
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

/** Height of one level: its own entry when the building names one. */
export const storeyHeightOf = (b, i) => {
  const v = b.storeyHeights?.[i];
  return Number.isFinite(v) ? v : b.storeyHeight;
};

/** Height of a level's floor above the ground, plinth included. */
export function storeyBase(b, i) {
  let z = b.plinth;
  for (let k = 0; k < i; k++) z += storeyHeightOf(b, k);
  return z;
}

/** Total height of the walls, plinth included. Takes a building. */
export const wallTop = (b) => storeyBase(b, b.storeys);

export function findById(m, list, id) {
  return (m[list] || []).find((it) => it.id === id) || null;
}

export { key };
