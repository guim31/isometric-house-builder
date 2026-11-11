/** Fichiers hostiles ou cassés : ni exception, ni balisage, ni gel. */

import { check } from './harness.js';
import { normalise, defaultModel, LIMITS } from '../src/core/model.js';
import { Store } from '../src/ui/store.js';
import { PlanView } from '../src/ui/plan.js';
import { placeProp } from '../src/ui/actions.js';
import { pointer } from './helpers.js';
import { initialModel, clearLocal, saveLocal, REJECTED_KEY } from '../src/io/project.js';
import { renderScene } from '../src/render/svg.js';
import { hitLayer } from '../src/render/hit.js';
import { buildMesh } from '../src/core/scene.js';

/**
 * The worst file the ceilings let through: one block as large as a building
 * may be, then isolated cells up to the outline budget, and every list full,
 * each item at its largest.
 */
export function worstFile() {
  const block = [];
  for (let j = 0; j < 50; j++) for (let i = 0; i < 80; i++) block.push(`${i},${j}`);
  const spare = [];
  for (let k = 0; k < 2000; k++) spare.push(`${100 + (k % 40) * 2},${(Math.floor(k / 40)) * 2}`);
  const roof = { type: 'hip', pitch: 70, overhang: 2, fascia: 0.6 };
  const buildings = [{ id: 'b0', storeys: 4, storeyHeight: 4, cells: block, roof, texture: { roof: 'canal', wall: 'brick' } }];
  for (let b = 1; b < 12; b++) {
    buildings.push({ id: `b${b}`, storeys: 4, storeyHeight: 4, cells: spare.slice((b - 1) * 20, b * 20), roof, texture: { roof: 'canal', wall: 'stone' } });
  }
  const props = [];
  const kinds = ['fence', 'hedge', 'muret', 'tree', 'stairs', 'pool', 'terrace', 'car', 'gate', 'bush'];
  for (let k = 0; k < 400; k++) {
    props.push({ kind: kinds[k % kinds.length], x: -200 + (k % 20) * 20, y: -200 + Math.floor(k / 20) * 20, w: 60, d: 0.3, h: 6, r: 8, z: 6 });
  }
  const roofItems = [];
  for (let k = 0; k < 100; k++) roofItems.push({ kind: ['solar', 'chimney', 'velux', 'dish'][k % 4], x: 4 + (k % 10) * 7, y: 4 + Math.floor(k / 10) * 4, w: 12, d: 10, h: 5 });
  return {
    grid: { cellSize: 1 }, buildings, props, roofItems,
    openings: Array.from({ length: 400 }, (_, k) => ({ kind: ['window', 'shutter', 'door', 'garage'][k % 4], edge: `${k % 80},49,N`, storey: k % 4, offset: 0.5, width: 10, height: 6, depth: 1, sides: 2, head: 1 })),
    style: { outline: true, shadow: true, windowBars: true, night: true },
    focus: { enabled: false },
  };
}

/** Build, draw and pick a raw file; what came out, and how long it took. */
function run(raw, size = [800, 560]) {
  const t0 = performance.now();
  const m = normalise(raw);
  const built = buildMesh(m);
  const out = renderScene(m, { width: size[0], height: size[1], built });
  const hits = hitLayer(m, out.camera, built);
  return { m, svg: out.svg, hits, ms: performance.now() - t0 };
}

/**
 * What must never reach the markup: an element or an attribute the renderer
 * does not write, or a value that is not a finite number where one belongs.
 * Parsed, not searched: `"><` is ordinary between two tags.
 */
const ELEMENTS = new Set(['svg', 'defs', 'g', 'path', 'rect', 'circle', 'clipPath', 'linearGradient', 'radialGradient', 'stop']);
const ATTRS = new Set([
  'xmlns', 'width', 'height', 'viewBox', 'shape-rendering', 'stroke-linejoin', 'stroke-linecap', 'd', 'fill',
  'stroke', 'stroke-width', 'opacity', 'clip-path', 'id', 'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color',
  'stop-opacity', 'cx', 'cy', 'r', 'data-pick', 'data-id', 'data-edge', 'data-storey', 'data-building',
]);
function tainted(markup) {
  const doc = new DOMParser().parseFromString(markup.startsWith('<svg') ? markup : `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return 'balisage illisible';
  for (const el of doc.getElementsByTagName('*')) {
    if (!ELEMENTS.has(el.localName)) return `élément <${el.localName}>`;
    for (const at of el.attributes) {
      if (!ATTRS.has(at.name)) return `attribut ${at.name}`;
      if (!at.name.startsWith('data-') && /NaN|undefined|Infinity|null/.test(at.value)) return `${at.name}="${at.value.slice(0, 40)}"`;
      if (['width', 'height', 'stroke-width', 'opacity', 'cx', 'cy', 'r'].includes(at.name) && !Number.isFinite(Number(at.value))) {
        return `${at.name}="${at.value.slice(0, 40)}"`;
      }
      if (['fill', 'stroke', 'stop-color'].includes(at.name) && !/^(#[0-9a-f]{3,8}|none|transparent|url\(#[\w-]+\))$/i.test(at.value)) {
        return `${at.name}="${at.value.slice(0, 40)}"`;
      }
    }
  }
  return null;
}

/** A clean result, in time — or what went wrong. */
function sound(raw, budget = 1500, size) {
  const r = run(raw, size);
  // A file is a few hundred kilobytes; a hundred-kilometre hedge made 6,5 MB.
  if (r.svg.length > 2e6) return `SVG de ${(r.svg.length / 1e6).toFixed(1)} Mo`;
  const bad = tainted(r.svg) || tainted(r.hits);
  if (bad) return `${bad} dans le ${tainted(r.svg) ? 'SVG' : 'calque de sélection'}`;
  return r.ms <= budget || `${Math.round(r.ms)} ms`;
}

const house = () => ({
  ...defaultModel(),
  views: [{ id: 'v1', name: 'Portail', camera: { yaw: 30 }, focus: { enabled: true, x: 0, y: 0, w: 8, d: 8 } }],
  style: { ...defaultModel().style, outline: true },
});

const CORPUS = {
  'une épaisseur de contour qui ferme l’attribut': () => ({ ...house(), style: { outline: true, outlineWidth: '"><x onload=1>' } }),
  'un fond qui ferme l’attribut': () => ({ ...house(), style: { background: '#fff"><x>' } }),
  'une couleur et une clé de couleur piégées': () => ({ ...house(), overrides: { 'wall"><x': '#fff', roof: 'red"><x>', door: 'url(#a)' } }),
  'des identifiants piégés': () => ({
    ...house(),
    buildings: house().buildings.map((b) => ({ ...b, id: '"><x>' })),
    props: [{ id: '"><x onload=1>', kind: 'tree', x: 1, y: 1 }],
    openings: [{ id: 'a"b', kind: 'window', edge: house().openings[0]?.edge || '0,0,S' }],
  }),
  'un nom et un nom de corps démesurés': () => ({ ...house(), name: 'x'.repeat(100000), buildings: house().buildings.map((b) => ({ ...b, name: '<x>'.repeat(1000) })) }),
  'une emprise de 200 × 200 cases': () => ({
    buildings: [{ cells: Array.from({ length: 40000 }, (_, k) => `${k % 200},${Math.floor(k / 200)}`) }],
  }),
  'une haie de 100 km': () => ({ ...house(), props: [{ kind: 'hedge', x: 0, y: -5, w: 100000, d: 0.6 }] }),
  'un débord de toit de 50 m': () => ({ ...house(), buildings: house().buildings.map((b) => ({ ...b, roof: { ...b.roof, overhang: 50, pitch: 89 } })) }),
  'des coordonnées immenses': () => ({ ...house(), props: [{ kind: 'tree', x: 1e300, y: -1e300 }], focus: { enabled: true, x: 1e300, y: 0, w: 1e300, d: 2 } }),
  'des listes immenses': () => ({
    ...house(),
    props: Array.from({ length: 20000 }, (_, k) => ({ kind: 'bush', x: k % 100, y: Math.floor(k / 100) })),
    views: Array.from({ length: 5000 }, () => ({ name: 'v' })),
    overrides: Object.fromEntries(Array.from({ length: 5000 }, (_, k) => [`m${k}`, '#123456'])),
  }),
  'des cases hors de toute portée': () => ({ buildings: [{ cells: ['1000000000,5', '-99999,3', '1e9,2', '0,0', '0,1'] }] }),
  'le pire fichier accepté': worstFile,
  'un tableau à la place du projet': () => [1, 2, 3],
  'des listes qui sont des objets': () => ({ buildings: { a: 1 }, openings: 'x', props: 7, roofItems: null, views: {} }),
  'un prototype piégé': () => JSON.parse('{"__proto__": {"polluted": true}, "theme": "__proto__", "texture": {"roof": "__proto__"}}'),
};

for (const [name, make] of Object.entries(CORPUS)) {
  // The worst accepted file is allowed its second, and a margin for a slow
  // machine; anything else is an ordinary house and draws far quicker.
  const budget = make === worstFile ? 3000 : 1500;
  check(`fichier hostile — ${name} : ni exception, ni balisage, ni gel`, () => sound(make(), budget));
}

check('aucun modèle ne laisse de prototype pollué', () => ({}).polluted === undefined || 'Object.prototype pollué');

/**
 * Every field of a rich project, replaced in turn by values of every other
 * type: each time the file must still open and draw cleanly, and what comes
 * out must be of the right type.
 */
check('une valeur inattendue à n’importe quel champ ne casse rien', () => {
  // Small, so that a thousand renders stay quick, but with one of everything.
  const baseModel = normalise({
    ...house(),
    buildings: [{ id: 'b1', cells: ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'], storeys: 2, storeyHeights: [2.6, 2.2], texture: { roof: 'tiles', wall: 'brick' }, overrides: { wall: '#abcdef' } }],
    openings: [
      { id: 'o1', kind: 'window', edge: '1,1,N', depth: 0.3, sides: 0.2, head: 0.1 },
      { id: 'o2', kind: 'door', edge: '2,0,E', storey: 1 },
    ],
    roofItems: ['solar', 'chimney', 'velux', 'dish'].map((kind, i) => ({ id: `r${i}`, kind, x: 5 + i, y: 4 })),
    props: ['pool', 'terrace', 'stairs', 'tree', 'bush', 'hedge', 'fence', 'muret', 'gate', 'car', 'path', 'deck']
      .map((kind, i) => ({ id: `p${i}`, kind, x: -10 + i * 3, y: -6, z: 0.5, w: 2, d: 1 })),
    focus: { enabled: true, x: -12, y: -8, w: 30, d: 20, margin: 1 },
  });
  const paths = [];
  const walk = (o, path) => {
    if (Array.isArray(o)) {
      if (path[path.length - 1] === 'cells') { paths.push([...path, 0]); return; }
      o.slice(0, 2).forEach((v, i) => walk(v, [...path, i]));
      paths.push(path);
      return;
    }
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) walk(v, [...path, k]);
      paths.push(path);
      return;
    }
    paths.push(path);
  };
  walk(baseModel, []);
  const values = [null, '"><x>', 1e12, -1e12, {}, [], true, 'NaN'];
  const failures = [];
  const drawn = new Map();
  for (const path of paths.filter((p) => p.length)) {
    for (const v of values) {
      const raw = JSON.parse(JSON.stringify(baseModel));
      let o = raw;
      for (const k of path.slice(0, -1)) o = o[k];
      o[path[path.length - 1]] = v;
      let verdict;
      try {
        // Most substitutions normalise to a model already drawn — a default
        // is a default, whatever stood in its place. Drawn once each.
        const key = JSON.stringify(normalise(JSON.parse(JSON.stringify(raw))), (k, x) => (k === 'id' ? undefined : x));
        if (!drawn.has(key)) drawn.set(key, sound(raw, 3000, [240, 170]));
        verdict = drawn.get(key);
      } catch (e) {
        verdict = e.message;
      }
      if (verdict !== true) failures.push(`${path.join('.')} = ${JSON.stringify(v)} : ${verdict}`);
      if (failures.length > 5) return failures.join(' ; ');
    }
  }
  if (failures.length) return failures.join(' ; ');
  return paths.length > 80 || `${paths.length} champs seulement`;
});

check('le plan applique les mêmes plafonds en dessinant, avec un message', () => {
  const s = new Store(normalise({ buildings: [{ id: 'b', cells: ['0,0'] }] }));
  const told = [];
  s.onLimit = (msg) => told.push(msg);
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('rect');
  // A rectangle wider than a building may be.
  view.svg.dispatchEvent(pointer(view, 0.5, 0.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, LIMITS.extent + 10.5, 4.5, 'pointermove'));
  view.svg.dispatchEvent(pointer(view, LIMITS.extent + 10.5, 4.5, 'pointerup'));
  view.svg.remove();
  if (s.model.buildings[0].cells.length !== 1) return `${s.model.buildings[0].cells.length} cases acceptées`;
  if (!told.length || !/Limite atteinte/.test(told[0])) return 'aucun message';
  // And the list ceilings, whichever tool adds to them.
  const t = new Store(normalise({ props: Array.from({ length: LIMITS.props }, (_, k) => ({ kind: 'bush', x: k, y: 0 })) }));
  t.onLimit = (msg) => told.push(msg);
  placeProp(t, 'tree', [1, 1]);
  return t.model.props.length === LIMITS.props || `${t.model.props.length} objets`;
});

check('un projet à son plafond reste modifiable', () => {
  const s = new Store(normalise({ props: Array.from({ length: LIMITS.props }, (_, k) => ({ id: `p${k}`, kind: 'bush', x: k, y: 0 })) }));
  s.select({ type: 'prop', id: 'p3' });
  s.patchSelected({ x: 40 });
  return s.model.props[3].x === 40 || 'déplacement refusé';
});

/* ---------------- C5: a start that is never blank ---------------- */

check('un projet local illisible est mis de côté, et le modèle par défaut s’ouvre', () => {
  clearLocal();
  localStorage.setItem('isometric-house-builder/current', '{"buildings": [ tronqué');
  localStorage.removeItem(REJECTED_KEY);
  let boot;
  try {
    boot = initialModel();
  } finally {
    clearLocal();
  }
  const kept = localStorage.getItem(REJECTED_KEY);
  localStorage.removeItem(REJECTED_KEY);
  if (boot.rejected !== 'local') return `rejet signalé : ${boot.rejected}`;
  if (!boot.model.buildings[0].cells.length) return 'aucun modèle ouvert';
  return kept === '{"buildings": [ tronqué' || 'le projet fautif n’a pas été gardé';
});

check('un lien illisible est mis de côté sans toucher au projet local', () => {
  const local = normalise({ ...defaultModel(), name: 'Projet local' });
  saveLocal(local);
  const before = location.href;
  history.replaceState(null, '', '#m=pas-du-base64-valide');
  let boot;
  try {
    boot = initialModel();
  } finally {
    clearLocal();
    history.replaceState(null, '', before.replace(/#.*$/, ''));
  }
  localStorage.removeItem(REJECTED_KEY);
  if (boot.rejected !== 'link') return `rejet signalé : ${boot.rejected}`;
  return boot.model.name === 'Projet local' || `projet ouvert : ${boot.model.name}`;
});
