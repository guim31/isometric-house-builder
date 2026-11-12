/**
 * The project model. One plain JSON object, serialisable as-is: it is what the
 * save file, the undo stack and the shareable URL all carry.
 */

import { key, rectCells, connectedComponents, SIDES, runExtents } from './grid.js';
import {
  DEFAULT_PROJECTION, DEFAULT_PITCH, PROJECTIONS, clampPitch, clampRoll, normaliseYaw,
} from './iso.js';
import { ROOF_TYPES, RIDGES } from './roof.js';
import { ROOF_TEXTURES, WALL_TEXTURES } from '../render/texture.js';
import { THEMES } from './palette.js';
import { PRESETS } from '../data/presets.js';

// 2: per-level heights, recessed openings, raised slabs, steps.
// 3: wall fixtures (a list of their own), equipment on the ground, the ridge
// of a gable, a car's direction, a tree's silhouette. Older files open
// unchanged; the number is what tells a newer file apart.
export const MODEL_VERSION = 3;

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
  for (const list of ['buildings', 'openings', 'fixtures', 'roofItems', 'props', 'views']) {
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
const safeColours = (o) => Object.fromEntries(
  Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {})
    .filter(([k, v]) => ID_RE.test(k.replace('#', '')) && COLOUR_RE.test(v))
    .slice(0, LIMITS.overrides),
);
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);


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
  // Equipment on the ground — what a home dashboard puts a badge on. `dir` is
  // the side they face: the fan of a heat pump, the slot of a letter box.
  lamppost: { w: 0.4, d: 0.4, h: 2.2 },
  heatpump: { w: 1, d: 0.4, h: 0.8, dir: 'S' },
  mailbox: { w: 0.4, d: 0.3, h: 1.15, dir: 'S' },
  carport: { w: 3, d: 5.5, h: 2.3, cover: 'flat' },
};

/**
 * Equipment fixed to a wall, anchored as openings are: an edge, metres along
 * it from its start, a level — and `z`, the height of its centre above that
 * level's floor. `width` is what it takes up along the wall, for keeping it
 * whole on its run; it is a property of the kind, not a setting.
 *
 * In a list of their own rather than among the openings: a version of the
 * application that predates them reads any opening kind it does not know as a
 * window, and would have hung a window where the camera was.
 */
export const FIXTURE_DEFAULTS = {
  wallLight: { z: 2, width: 0.28 },
  camera: { z: 2.3, width: 0.2 },
  charger: { z: 1.1, width: 0.44 },
};

/**
 * Ground equipment drawn to one shape: no width and depth to set, in the
 * inspector or by a handle in the plan.
 */
export const FIXED_SHAPE_KINDS = new Set(['lamppost', 'mailbox']);

/** What an opening or a fixture takes up along its wall, in metres. */
export const wallSpan = (op) => op.width ?? OPENING_DEFAULTS[op.kind]?.width ?? FIXTURE_DEFAULTS[op.kind]?.width ?? 1.2;

/** Range of a fixture's height above its level's floor, and how close to it. */
export const fixtureZRange = (levelHeight) => [0.25, Math.max(0.25, levelHeight - 0.25)];

/**
 * Size of a newly placed roof item, by kind — and what a file that leaves a
 * field out gets, as for openings and outdoor items.
 */
export const ROOF_ITEM_DEFAULTS = {
  solar: { w: 4, d: 2.4 },
  chimney: { w: 0.8, d: 0.8, h: 1.1 },
  velux: { w: 1, d: 1.2 },
  dish: { w: 0.8, d: 0.8 },
};

/** About eighteen centimetres a riser, which is what a stair is. */
export const stairsSteps = (h) => Math.max(1, Math.min(24, Math.round(h / 0.18)));

/**
 * Length a flight needs to climb `h` metres comfortably: a tread of about
 * twenty-eight centimetres a step, rounded up to the quarter-metre grid.
 */
export const stairsRun = (h) => Math.max(1.25, Math.ceil((stairsSteps(h) * 0.28) * 4) / 4);

/** Outdoor items a quarter turn makes sense for: rectangles, and the car. */
export const TURNABLE_KINDS = new Set([
  'terrace', 'path', 'deck', 'pool', 'stairs', 'gate', 'muret', 'hedge', 'fence', 'car',
  'heatpump', 'mailbox', 'carport',
]);

const NEXT_DIR = { N: 'E', E: 'S', S: 'W', W: 'N' };

/**
 * An outdoor item turned a quarter turn clockwise, seen from above, about the
 * centre of its footprint. Width and depth trade places; what has a way of
 * facing — the climb of a flight of steps, the front of a car — turns with
 * it. Not snapped: two turns bring it back exactly where it was.
 */
export function quarterTurn(p) {
  const def = PROP_DEFAULTS[p.kind] || {};
  const w = p.w ?? def.w ?? 2, d = p.d ?? def.d ?? 2;
  const out = { ...p, w: d, d: w };
  if (!CENTRED_KINDS.has(p.kind)) {
    out.x = p.x + w / 2 - d / 2;
    out.y = p.y + d / 2 - w / 2;
  }
  if (p.kind === 'stairs' || p.kind === 'car' || p.dir) out.dir = NEXT_DIR[p.dir || (PROP_DEFAULTS[p.kind]?.dir) || 'N'];
  return out;
}

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
    roof: { type: 'hip', pitch: 30, overhang: 0.5, fascia: 0.18, shedDir: 'S', ridge: 'auto' },
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
    fixtures: [],
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

/**
 * How much a project may hold.
 *
 * A model arrives from files and links anyone can write, and is saved as soon
 * as it opens: a footprint of 200 × 200 cells froze the tab for fifteen
 * seconds, a hundred-kilometre hedge made 6,5 MB of SVG, a fifty-metre eave a
 * second per frame — at every reload. These ceilings keep the worst accepted
 * file to about a second of building and drawing on a modest machine, while
 * a real house with its garden passes with room to spare: a 60 × 40 m plot on
 * the half-metre grid, fifty items outside. The plan applies the same ones as
 * it draws.
 */
export const LIMITS = {
  buildings: 12,
  /** Cells of one building, and of all of them together. */
  cells: 3000,
  totalCells: 6000,
  /**
   * Exterior wall edges of all the buildings together. What costs is the
   * outline, not the area: a solid 60 × 40 m block draws in no time, the same
   * cells laid out as a chequerboard in fifteen seconds. A real house, even a
   * complicated one on the fine grid, has a few hundred.
   */
  edges: 800,
  /**
   * Total length of hedges, fences, walls and gates, in metres — a gate
   * counting five times its width, being all bars.
   */
  runLength: 600,
  /** Widest gate, in metres: past that it is a fence. */
  gate: 12,
  /** Footprint of one building, in metres along either axis. */
  extent: 60,
  /** Any position, in metres from the origin. */
  coord: 250,
  openings: 200,
  fixtures: 100,
  /**
   * Roof items, by number and by what they actually cost. A panel or a roof
   * window is laid as a patch subdivided every eighteen centimetres, so its
   * price is its area — about a third of a millisecond a square metre — and a
   * chimney or a dish costs next to nothing. Twenty items was a ceiling for
   * someone laying panels one at a time; the area keeps the worst file where
   * that ceiling had it.
   */
  roofItems: 100,
  /** Square metres of panels and roof windows, all roofs together. */
  roofArea: 800,
  props: 150,
  views: 30,
  name: 120,
  overrides: 64,
};

/*
 * Ranges of every number a file may carry, as [min, max] — at least those of
 * the inspector's own controls, so nothing set through the interface is ever
 * pulled back.
 */
const R = {
  storeyHeight: STOREY_HEIGHT_RANGE,
  plinth: [0, 1],
  pitch: [1, 70],
  overhang: [0, 2],
  fascia: [0, 0.6],
  outlineWidth: [0.1, 4],
  groundMargin: [0, 10],
  focusSize: [2, 200],
  focusMargin: [0, 10],
  // Openings, in metres.
  opWidth: [0.2, 10],
  opHeight: [0.2, 6],
  opSill: [0, 6],
  opDepth: [0, 1],
  opSides: [0, 2],
  opHead: [0, 1],
  // Roof items.
  riW: [0.2, 10],
  riD: [0.2, 8],
  riH: [0.1, 5],
  // Outdoor items.
  propSize: [0.05, 60],
  propR: [0.1, 8],
  propH: [0.05, 6],
  propZ: [0, 6],
  propRadius: [0, 5],
  fixtureZ: [0.25, 3.75],
};

const SIDES_RE = /^[NSEW]$/;
const isBool = (v) => typeof v === 'boolean';
const bool = (v, fallback) => (isBool(v) ? v : fallback);
const num = (v, [lo, hi], fallback) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const text = (v, fallback, max = LIMITS.name) => (typeof v === 'string' && v ? v.slice(0, max) : fallback);
const coord = (v, fallback) => num(v, [-LIMITS.coord, LIMITS.coord], fallback);
const KINDS = {
  ground: ['grass', 'paving', 'gravel'],
  slab: ['paving', 'gravel', 'deck'],
  shape: ['rounded', 'rect'],
  gate: ['swing', 'sliding'],
  tree: ['leafy', 'conifer'],
  cover: ['flat', 'slats'],
};

/** Ids made safe, and unique within their list: a second item of the same id
 * would be selected, edited and deleted along with the first. */
function uniqueIds(list, prefix) {
  const seen = new Set();
  for (const it of list) {
    let id = typeof it.id === 'string' && ID_RE.test(it.id) ? it.id : null;
    if (!id || seen.has(id)) {
      do { id = newId(prefix); } while (seen.has(id));
    }
    it.id = id;
    seen.add(id);
  }
  return list;
}

/** Materials of a building or of the project, from the lists the renderer has. */
function materials(input, fallback) {
  const t = isRecord(input) ? input : {};
  return {
    roof: oneOf(t.roof, Object.keys(ROOF_TEXTURES), fallback.roof),
    wall: oneOf(t.wall, Object.keys(WALL_TEXTURES), fallback.wall),
  };
}

/**
 * Rebuild a model from whatever it was given, field by field.
 *
 * Nothing is copied wholesale: every field is read, checked against its type
 * and its range, and anything else is left behind. A value that fails takes
 * its type's default; an item that cannot be made sense of is dropped. The
 * reason is that a model also arrives from a share link or a file someone
 * else wrote, and its values end up in SVG attributes and in loops — an
 * outline width of `"><…` went straight into the markup, a fifty-metre eave
 * into the roof lattice.
 *
 * Older shapes still open on the same house: the single legacy footprint, the
 * quarter-turn camera, the quarter-metre grid, the settings a palette
 * prescribes when a file predates them.
 */
export function normalise(input) {
  if (!isRecord(input)) input = {};
  const base = emptyModel();
  const theme = THEMES[input.theme] ? input.theme : base.theme;
  const declared = THEMES[theme].style || {};
  const size = Number(isRecord(input.grid) ? input.grid.cellSize : undefined);
  const cellSize = [...CELL_SIZES, 0.25].includes(size) ? size : 1;

  const ground = isRecord(input.ground) ? input.ground : {};
  const style = isRecord(input.style) ? input.style : {};
  const m = {
    version: MODEL_VERSION,
    name: typeof input.name === 'string' ? input.name.slice(0, LIMITS.name) : base.name,
    grid: { cellSize },
    buildings: normaliseBuildings(input, declared.plinth, cellSize),
    theme,
    // Anything the file does not state falls back to what its own palette
    // prescribes, not to the global default. Without this, a project saved
    // before a setting existed would inherit whichever palette happens to be
    // the current default — and render with the wrong palette's conventions.
    texture: materials(input.texture, isRecord(input.texture) ? base.texture
      : { ...base.texture, ...(declared.texture || {}) }),
    overrides: safeColours(input.overrides),
    openings: normaliseOpenings(input.openings),
    fixtures: normaliseFixtures(input.fixtures),
    roofItems: normaliseRoofItems(input.roofItems),
    props: normaliseProps(input.props),
    ground: {
      enabled: bool(ground.enabled, base.ground.enabled),
      material: oneOf(ground.material, KINDS.ground, base.ground.material),
      margin: num(ground.margin, R.groundMargin, base.ground.margin),
    },
    camera: normaliseCamera(input.camera, base.camera),
    focus: normaliseFocus(input.focus, base.focus),
    views: normaliseViews(input.views),
    style: {
      outline: bool(style.outline, bool(declared.outline, base.style.outline)),
      outlineWidth: num(style.outlineWidth, R.outlineWidth, base.style.outlineWidth),
      background: style.background === 'transparent' || COLOUR_RE.test(style.background)
        ? style.background : base.style.background,
      shadow: bool(style.shadow, bool(declared.shadow, base.style.shadow)),
      windowBars: bool(style.windowBars, bool(declared.windowBars, base.style.windowBars)),
      night: bool(style.night, base.style.night),
    },
  };
  // A quarter-metre grid was accepted on input but never offered, and the roof
  // lattice cannot hold it: a ridge over an odd number of quarter cells falls
  // between its points. Such a file opens on the half-metre grid instead.
  return cellSize === 0.25 ? withCellSize(m, 0.5) : m;
}

/**
 * The first ceiling a model goes past — or null. Said as `{ key, max }`:
 * which ceiling (a key of LIMITS) and its value, for the interface to put
 * into words in its own language.
 *
 * normalise cuts a file down to the ceilings; the interface refuses the edit
 * that would cross one instead, and says which, rather than accepting a
 * stroke that the next reload would quietly take back.
 */
export function limitBreach(m) {
  const cs = cellSizeOf(m);
  const over = (key) => ({ key, max: LIMITS[key] });
  if (m.buildings.length > LIMITS.buildings) return over('buildings');
  let total = 0, edges = 0;
  for (const b of m.buildings) {
    if (b.cells.length > LIMITS.cells) return over('cells');
    total += b.cells.length;
    if (b.cells.length) {
      let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
      for (const c of b.cells) {
        const [i, j] = c.split(',').map(Number);
        i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j);
        if (Math.abs(i) * cs > LIMITS.coord || Math.abs(j) * cs > LIMITS.coord) return over('coord');
      }
      if ((i1 - i0 + 1) * cs > LIMITS.extent || (j1 - j0 + 1) * cs > LIMITS.extent) {
        return over('extent');
      }
    }
    edges += outlineLength(b.cells);
  }
  if (total > LIMITS.totalCells) return over('totalCells');
  if (edges > LIMITS.edges) return over('edges');
  if (m.openings.length > LIMITS.openings) return over('openings');
  if ((m.fixtures || []).length > LIMITS.fixtures) return over('fixtures');
  if (m.roofItems.length > LIMITS.roofItems) return over('roofItems');
  if (roofArea(m.roofItems) > LIMITS.roofArea) return over('roofArea');
  if (m.props.length > LIMITS.props) return over('props');
  if (m.views.length > LIMITS.views) return over('views');
  let run = 0;
  for (const p of m.props) {
    if (['hedge', 'fence', 'muret', 'gate'].includes(p.kind)) run += Math.max(p.w ?? 0, p.d ?? 0) * (p.kind === 'gate' ? 5 : 1);
    if (Math.abs(p.x) > LIMITS.coord || Math.abs(p.y) > LIMITS.coord) return over('coord');
  }
  if (run > LIMITS.runLength) return over('runLength');
  return null;
}

/** Number of exterior wall edges of a set of cells. */
function outlineLength(cells) {
  const set = new Set(cells);
  let n = 0;
  for (const c of cells) {
    const [i, j] = c.split(',').map(Number);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!set.has(`${i + di},${j + dj}`)) n++;
  }
  return n;
}

/** Openings: on a wall edge that can at least be named, with every size set. */
function normaliseOpenings(input) {
  const list = (Array.isArray(input) ? input : []).filter(isRecord)
    .filter((op) => typeof op.edge === 'string' && /^-?\d{1,4},-?\d{1,4},[SENW]$/.test(op.edge))
    .slice(0, LIMITS.openings)
    .map((op) => {
      const kind = OPENING_DEFAULTS[op.kind] ? op.kind : 'window';
      const def = OPENING_DEFAULTS[kind];
      const out = {
        id: op.id,
        edge: op.edge,
        storey: Number.isFinite(op.storey) ? Math.max(0, Math.min(3, Math.round(op.storey))) : 0,
        kind,
        offset: coord(op.offset, 0.5),
        width: num(op.width, R.opWidth, def.width),
        height: num(op.height, R.opHeight, def.height),
        sill: num(op.sill, R.opSill, def.sill),
      };
      // Recess settings only when stated, as files have always had them.
      if (Number.isFinite(op.depth)) out.depth = num(op.depth, R.opDepth, 0);
      if (Number.isFinite(op.sides)) out.sides = num(op.sides, R.opSides, 0);
      if (Number.isFinite(op.head)) out.head = num(op.head, R.opHead, 0);
      return out;
    });
  return uniqueIds(list, 'o');
}

/** Wall fixtures: on an edge that can be named, at a height within reason. */
function normaliseFixtures(input) {
  const list = (Array.isArray(input) ? input : []).filter(isRecord)
    .filter((f) => FIXTURE_DEFAULTS[f.kind] && typeof f.edge === 'string' && /^-?\d{1,4},-?\d{1,4},[SENW]$/.test(f.edge))
    .slice(0, LIMITS.fixtures)
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      edge: f.edge,
      storey: Number.isFinite(f.storey) ? Math.max(0, Math.min(3, Math.round(f.storey))) : 0,
      offset: coord(f.offset, 0.5),
      z: num(f.z, R.fixtureZ, FIXTURE_DEFAULTS[f.kind].z),
    }));
  return uniqueIds(list, 'f');
}

/** Kinds laid flat on the slope as a subdivided patch: what costs, by area. */
const PATCH_KINDS = new Set(['solar', 'velux']);

/** Area of the patch-laid roof items of a list, in square metres. */
export function roofArea(items) {
  let a = 0;
  for (const it of items) if (PATCH_KINDS.has(it.kind)) a += (it.w ?? 0) * (it.d ?? 0);
  return a;
}

/** Roof items: a kind something draws, a position, and sizes within reason. */
function normaliseRoofItems(input) {
  let area = 0;
  const list = (Array.isArray(input) ? input : []).filter(isRecord)
    .filter((it) => ROOF_ITEM_DEFAULTS[it.kind] && Number.isFinite(it.x) && Number.isFinite(it.y))
    .slice(0, LIMITS.roofItems)
    .map((it) => {
      const def = ROOF_ITEM_DEFAULTS[it.kind];
      const out = {
        id: it.id, kind: it.kind, x: coord(it.x, 0), y: coord(it.y, 0),
        w: num(it.w, R.riW, def.w), d: num(it.d, R.riD, def.d),
      };
      if (Number.isFinite(it.h) || def.h !== undefined) out.h = num(it.h, R.riH, def.h);
      return out;
    })
    // Past the area, the later panels are left out, as the later runs of
    // hedge are past their length.
    .filter((it) => {
      if (!PATCH_KINDS.has(it.kind)) return true;
      area += it.w * it.d;
      return area <= LIMITS.roofArea;
    });
  return uniqueIds(list, 'r');
}

/**
 * Outdoor items. Missing fields take their kind's defaults; a kind nobody
 * knows is dropped, as nothing would draw it.
 */
function normaliseProps(input) {
  let run = 0;
  const list = (Array.isArray(input) ? input : []).filter(isRecord)
    .filter((p) => PROP_DEFAULTS[p.kind] && Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice(0, LIMITS.props)
    .map((p) => {
      const def = PROP_DEFAULTS[p.kind];
      const out = { id: p.id, kind: p.kind, x: coord(p.x, 0), y: coord(p.y, 0) };
      const size = (k, range) => {
        if (Number.isFinite(p[k])) out[k] = num(p[k], range, def[k]);
        else if (def[k] !== undefined) out[k] = def[k];
      };
      const span = p.kind === 'gate' ? [R.propSize[0], LIMITS.gate] : R.propSize;
      size('w', span);
      size('d', span);
      size('h', R.propH);
      size('r', R.propR);
      size('z', R.propZ);
      size('radius', R.propRadius);
      const pick = (k, allowed) => {
        const v = oneOf(p[k], allowed, def[k]);
        if (v !== undefined) out[k] = v;
      };
      pick('material', KINDS.slab);
      pick('shape', KINDS.shape);
      // One field, a list of its own per kind: a gate swings or slides, a
      // tree is broad-leaved or a conifer.
      pick('style', KINDS[p.kind] || KINDS.gate);
      pick('dir', ['N', 'S', 'E', 'W']);
      pick('cover', KINDS.cover);
      return out;
    })
    .filter((p) => {
      // Runs are drawn in segments, posts and rails: their cost is their
      // length, and past the ceiling the later ones are left out.
      if (!['hedge', 'fence', 'muret', 'gate'].includes(p.kind)) return true;
      run += Math.max(p.w ?? 0, p.d ?? 0) * (p.kind === 'gate' ? 5 : 1);
      return run <= LIMITS.runLength;
    });
  return uniqueIds(list, 'p');
}

/**
 * Buildings, migrating the older single-footprint shape.
 *
 * A legacy file carried one `cells` set and one roof. Its disconnected parts
 * become separate buildings straight away — that is what they always were —
 * so a shed drawn apart from the house can be re-roofed the moment the file
 * is opened, without any manual re-splitting.
 */
function normaliseBuildings(input, themePlinth, cs) {
  const proto = makeBuilding();
  // Cells as the grid has them, within reach of the origin and within the
  // footprint one building may cover; past that a file is cut, not frozen.
  const reach = Math.floor(LIMITS.coord / cs);
  const span = Math.floor(LIMITS.extent / cs);
  const cellsOf = (list) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    let i0 = Infinity, j0 = Infinity;
    for (const c of list) {
      if (out.length >= LIMITS.cells) break;
      if (typeof c !== 'string' || !/^-?\d{1,5},-?\d{1,5}$/.test(c)) continue;
      const [i, j] = c.split(',').map(Number);
      if (Math.abs(i) > reach || Math.abs(j) > reach) continue;
      // Measured from the first cell kept: a file holding the far corners of
      // a huge square keeps the corner it starts with.
      if (!Number.isFinite(i0)) { i0 = i; j0 = j; }
      if (Math.abs(i - i0) >= span || Math.abs(j - j0) >= span) continue;
      out.push(`${i},${j}`);
    }
    return [...new Set(out)].sort();
  };
  const clean = (b, fallbackName) => {
    const roof = isRecord(b.roof) ? b.roof : {};
    const [lo, hi] = STOREY_HEIGHT_RANGE;
    const storeyHeight = num(b.storeyHeight, R.storeyHeight, proto.storeyHeight);
    return {
      id: b.id,
      name: text(b.name, fallbackName),
      cells: cellsOf(b.cells),
      storeys: Number.isFinite(b.storeys) ? Math.max(1, Math.min(4, Math.round(b.storeys) || 1)) : 1,
      storeyHeight,
      // All four kept, not only the levels in use: taking a level away and
      // putting it back should find its height where it was left.
      storeyHeights: Array.isArray(b.storeyHeights)
        ? b.storeyHeights.slice(0, 4).map((v) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : storeyHeight))
        : null,
      // A file that says nothing about the plinth gets its palette's: brick
      // and stone houses stand on one, the flat Horizons look does not.
      plinth: num(b.plinth, R.plinth, Number.isFinite(themePlinth) ? themePlinth : 0),
      roof: {
        type: oneOf(roof.type, ROOF_TYPES, proto.roof.type),
        pitch: num(roof.pitch, R.pitch, proto.roof.pitch),
        overhang: num(roof.overhang, R.overhang, proto.roof.overhang),
        fascia: num(roof.fascia, R.fascia, proto.roof.fascia),
        shedDir: SIDES_RE.test(roof.shedDir) ? roof.shedDir : proto.roof.shedDir,
        ridge: oneOf(roof.ridge, Object.keys(RIDGES), proto.roof.ridge),
      },
      overrides: safeColours(b.overrides),
      texture: isRecord(b.texture) ? materials(b.texture, { roof: 'none', wall: 'none' }) : null,
    };
  };

  // Empty volumes never win over a legacy footprint: a caller that spreads a
  // blank model and then sets `cells` means the cells, and silently dropping
  // them would lose the whole house.
  const declared = Array.isArray(input?.buildings) ? input.buildings.filter(isRecord) : null;
  const declaredHasCells = declared && declared.some((b) => Array.isArray(b.cells) && b.cells.length);
  const legacyCells = Array.isArray(input?.cells) && input.cells.length;
  let out;
  if (declared && declared.length && (declaredHasCells || !legacyCells)) {
    // A cell belongs to one body. A file in which two claim it — painted over
    // before the plan prevented it — keeps it with the first. And the whole
    // project holds so many cells, the later bodies giving way first.
    const owned = new Set();
    let edges = 0;
    out = declared.slice(0, LIMITS.buildings).map((b, i) => {
      const nb = clean(b, i ? `Bâtiment ${i + 1}` : 'Corps principal');
      nb.cells = nb.cells.filter((c) => !owned.has(c) && owned.size < LIMITS.totalCells && owned.add(c));
      return nb;
    }).filter((nb) => {
      // A body whose outline would take the project past its ceiling is left
      // out whole: trimming it would leave an arbitrary shape nobody drew.
      edges += outlineLength(nb.cells);
      return edges <= LIMITS.edges;
    });
    if (!out.length) out = [makeBuilding()];
  } else {
    const legacy = clean({
      cells: input?.cells, storeys: input?.storeys, storeyHeight: input?.storeyHeight,
      plinth: input?.plinth, roof: input?.roof,
    }, 'Corps principal');
    if (!legacy.cells.length) return [makeBuilding()];
    const parts = connectedComponents(new Set(legacy.cells));
    out = parts.length <= 1 ? [legacy] : parts.slice(0, LIMITS.buildings).map((cells, i) => ({
      ...legacy, id: i ? undefined : legacy.id, cells, name: i ? `Bâtiment ${i + 1}` : 'Corps principal',
    }));
  }
  return uniqueIds(out, 'b');
}

/**
 * The camera, migrating the older quarter-turn field.
 *
 * `rotation` was an index in 0..3 back when only four viewpoints existed. Files
 * saved then — and the share links already in circulation — must keep opening
 * on the view they were saved from, so the index is read as its yaw in degrees.
 */
function normaliseCamera(input, base) {
  const c = isRecord(input) ? input : {};
  let yaw = c.yaw;
  if (yaw === undefined && Number.isFinite(c.rotation)) yaw = (((Math.round(c.rotation) % 4) + 4) % 4) * 90;
  return {
    yaw: normaliseYaw(Number.isFinite(yaw) ? yaw : base.yaw),
    pitch: clampPitch(Number.isFinite(c.pitch) ? c.pitch : base.pitch),
    roll: clampRoll(Number.isFinite(c.roll) ? c.roll : base.roll),
    projection: oneOf(c.projection, Object.keys(PROJECTIONS), base.projection),
  };
}

/**
 * A framing rectangle that is at least a rectangle. Older files carry `hide`
 * and `vignette`; neither is a setting any more — both softened a crop by the
 * picture's own border, and the camera no longer makes one.
 */
function normaliseFocus(input, base) {
  const f = isRecord(input) ? input : {};
  return {
    enabled: bool(f.enabled, base.enabled),
    // Two metres, as the plan and the inspector have it: below that the zone
    // holds nothing and the camera zooms to a blur.
    x: coord(f.x, base.x),
    y: coord(f.y, base.y),
    w: num(f.w, R.focusSize, base.w),
    d: num(f.d, R.focusSize, base.d),
    margin: num(f.margin, R.focusMargin, base.margin),
  };
}

/** Saved framings: a named camera and focus, re-exportable in one click. */
function normaliseViews(input) {
  if (!Array.isArray(input)) return [];
  const list = input.filter(isRecord).slice(0, LIMITS.views).map((v, i) => ({
    id: v.id,
    name: text(v.name, `Vue ${i + 1}`),
    camera: normaliseCamera(v.camera, DEFAULT_CAMERA),
    focus: normaliseFocus(v.focus, DEFAULT_FOCUS),
  }));
  return uniqueIds(list, 'v');
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
 * Where a point `offset` metres along edge `edgeId` stands on the straight run
 * of wall `op` hangs on, in metres from `op`'s own edge — or null when that
 * edge is not on the same run. Sliding along a wall then keeps the edge, as
 * the arrows and the render's drag already did; only crossing a corner
 * changes it, and the same slide gives the same values from either view.
 */
export function offsetOnRun(m, op, edgeId, offset) {
  if (edgeId === op.edge) return offset;
  const run = openingRun(m, op);
  if (!run) return null;
  const [i0, j0, s0] = op.edge.split(',');
  const [i1, j1, s1] = edgeId.split(',');
  if (s0 !== s1 || !SIDES[s0]) return null;
  const side = SIDES[s0];
  const a0 = side.a(Number(i0), Number(j0)), a1 = side.a(Number(i1), Number(j1));
  const b0 = side.b(Number(i0), Number(j0));
  const u = [b0[0] - a0[0], b0[1] - a0[1]];
  const d = [a1[0] - a0[0], a1[1] - a0[1]];
  // Not on the same line: a parallel wall further in or out.
  if (d[0] * u[1] - d[1] * u[0] !== 0) return null;
  const s = (d[0] * u[0] + d[1] * u[1]) * cellSizeOf(m) + offset;
  return s >= run.lo - 1e-9 && s <= run.hi + 1e-9 ? s : null;
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
  const offset = fitOffset(op.offset ?? 0.5, wallSpan(op), run);
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
 * Height of a fixture's centre above the ground, kept within its level: a
 * light set at 2,40 m on a level since lowered to 2,20 m stays on its wall.
 */
export function fixtureHeight(f, b) {
  const [lo, hi] = fixtureZRange(storeyHeightOf(b, f.storey || 0));
  return storeyBase(b, f.storey || 0) + Math.max(lo, Math.min(hi, f.z ?? FIXTURE_DEFAULTS[f.kind]?.z ?? 2));
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
    // Fixtures hang off an edge exactly as openings do.
    fixtures: (m.fixtures || []).map(reanchor),
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
