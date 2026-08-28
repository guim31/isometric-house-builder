/**
 * Test suite. No framework, no build: it runs in any browser and reports into
 * the page, which also makes it readable by a headless run.
 */

import { Mesh, mergeCoplanar } from '../src/core/mesh.js';
import { decomposeRects, boundaryEdges, rectCells, key } from '../src/core/grid.js';
import { heightField, snapOverhang, STEP } from '../src/core/roof.js';
import { Camera, rotatePoint, project, PROJECTIONS } from '../src/core/iso.js';
import { defaultModel, emptyModel, normalise, cellSet, wallTop } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { hitLayer, screenToGround } from '../src/render/hit.js';
import { textureSegments, specFor, ROOF_TEXTURES, WALL_TEXTURES } from '../src/render/texture.js';
import { THEMES, faceColour, materialColour } from '../src/core/palette.js';
import { PRESETS, getPreset } from '../src/data/presets.js';
import { Gallery } from '../src/ui/gallery.js';
import { Store } from '../src/ui/store.js';
import { PlanView } from '../src/ui/plan.js';
import { Viewport } from '../src/ui/viewport.js';
import { Inspector } from '../src/ui/panels.js';
import { toShareUrl, fromShareUrl } from '../src/io/project.js';
import { svgFor, SIZES, svgToPng } from '../src/io/export.js';

const results = document.getElementById('results');
let passed = 0, failed = 0;

function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true || r === undefined;
    if (!ok) detail = ` — ${r}`;
  } catch (e) {
    detail = ` — ${e.message}`;
  }
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'ko';
  li.textContent = name + detail;
  results.appendChild(li);
  ok ? passed++ : failed++;
}

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* ---------------- geometry ---------------- */

check('un rectangle plein se décompose en un seul rectangle', () => {
  const r = decomposeRects(rectCells(0, 0, 5, 3));
  return r.length === 1 || `obtenu ${r.length}`;
});

check('une forme en L est entièrement couverte par les rectangles', () => {
  const cells = new Set([...rectCells(0, 0, 9, 3), ...rectCells(6, 4, 9, 8)]);
  const rects = decomposeRects(cells);
  const covered = new Set();
  for (const r of rects) {
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) covered.add(key(x, y));
  }
  for (const c of cells) if (!covered.has(c)) return `case non couverte ${c}`;
  for (const c of covered) if (!cells.has(c)) return `case en trop ${c}`;
  return true;
});

check('un carré de 2×2 a huit murs extérieurs', () => {
  const e = boundaryEdges(rectCells(0, 0, 1, 1));
  return e.length === 8 || `obtenu ${e.length}`;
});

check('une boîte fusionne en six faces', () => {
  const m = new Mesh().box([0, 0, 0], [2, 3, 1], 'wall', 'wall');
  const f = mergeCoplanar(m.tris);
  return f.length === 6 || `obtenu ${f.length}`;
});

check('deux quads coplanaires disjoints restent deux faces', () => {
  const m = new Mesh();
  m.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], 'paving', 'paving');
  m.quad([5, 5, 0], [6, 5, 0], [6, 6, 0], [5, 6, 0], 'paving', 'paving');
  const f = mergeCoplanar(m.tris);
  if (f.length !== 2) return `obtenu ${f.length} face(s)`;
  // Distinct centroids are the point: a shared one would mean a shared depth.
  return !near(f[0].centroid[0], f[1].centroid[0]) || 'centres identiques';
});

check('deux quads coplanaires adjacents fusionnent en une face', () => {
  const m = new Mesh();
  m.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], 'paving', 'paving');
  m.quad([1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], 'paving', 'paving');
  const f = mergeCoplanar(m.tris);
  return (f.length === 1 && f[0].loops[0].length === 4) || `obtenu ${f.length} face(s)`;
});

check('un trou est rattaché à la face qui le contient', () => {
  const m = new Mesh();
  // Outer ring built from four strips around a central hole.
  const o = [[0, 0], [6, 0], [6, 6], [0, 6]];
  const i = [[2, 2], [4, 2], [4, 4], [2, 4]];
  const P = (p) => [p[0], p[1], 0];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    m.quad(P(o[k]), P(o[k2]), P(i[k2]), P(i[k]), 'paving', 'paving');
  }
  const f = mergeCoplanar(m.tris);
  return (f.length === 1 && f[0].loops.length === 2) || `${f.length} face(s), ${f[0]?.loops.length} boucle(s)`;
});

check('la croupe culmine à la bonne hauteur', () => {
  const field = heightField([{ x0: 0, y0: 0, x1: 6, y1: 6 }], { type: 'hip', pitch: 45, overhang: 0 });
  return near(field.h(3, 3), 3, 1e-9) || `obtenu ${field.h(3, 3)}`;
});

check('la hauteur du toit est nulle à la rive', () => {
  const field = heightField([{ x0: 0, y0: 0, x1: 6, y1: 4 }], { type: 'hip', pitch: 30, overhang: 0 });
  return near(field.h(0, 2), 0, 1e-9) && near(field.h(3, 4), 0, 1e-9);
});

check('le débord est calé sur la trame', () => {
  return near(snapOverhang(0.37), 0.25) && near(snapOverhang(0.5), 0.5) && snapOverhang(-1) === 0;
});

check('deux ailes perpendiculaires ne créent pas de falaise dans le toit', () => {
  // The bug that produced a shredded fan at the junction of two gables.
  const cells = new Set([...rectCells(0, 0, 16, 6), ...rectCells(10, 7, 16, 12)]);
  const field = heightField(decomposeRects(cells), { type: 'gable', pitch: 30, overhang: 0.5 });
  let worst = 0;
  for (let y = -1; y <= 14; y += STEP) {
    for (let x = -1; x <= 18; x += STEP) {
      if (!field.inside(x, y) || !field.inside(x + STEP, y)) continue;
      worst = Math.max(worst, Math.abs(field.h(x + STEP, y) - field.h(x, y)));
    }
  }
  // One lattice step may not climb more than one step times the slope.
  const limit = STEP * Math.tan((30 * Math.PI) / 180) + 1e-9;
  return worst <= limit || `saut de ${worst.toFixed(3)} m pour ${limit.toFixed(3)} m permis`;
});

/* ---------------- projection ---------------- */

check('la profondeur isométrique vaut x+y+z dans les deux projections', () => {
  for (const [name, proj] of Object.entries(PROJECTIONS)) {
    // Moving along (1,1,1) must not move the point on screen.
    const a = project([1, 2, 3], proj);
    const b = project([1 + 2, 2 + 2, 3 + 2], proj);
    if (!near(a[0], b[0], 1e-9) || !near(a[1], b[1], 1e-9)) return `${name} dévie`;
  }
  return true;
});

check('quatre quarts de tour ramènent au point de départ', () => {
  let p = [3, 7, 2];
  for (let i = 0; i < 4; i++) p = rotatePoint(p, 1, 5, 5);
  return near(p[0], 3) && near(p[1], 7) && near(p[2], 2);
});

check('écran → sol est bien la réciproque de sol → écran', () => {
  for (let rot = 0; rot < 4; rot++) {
    const cam = new Camera({ rotation: rot, centre: [10, 10] });
    cam.scale = 24;
    cam.offset = [300, 200];
    const s = cam.toScreen([13, 7, 0]);
    const g = screenToGround(cam, s[0], s[1]);
    if (!near(g[0], 13, 1e-6) || !near(g[1], 7, 1e-6)) return `rotation ${rot} → ${g}`;
  }
  return true;
});

/* ---------------- scene and rendering ---------------- */

check('tous les types de toit et toutes les rotations se rendent sans erreur', () => {
  for (const type of ['hip', 'gable', 'flat', 'shed']) {
    for (let rot = 0; rot < 4; rot++) {
      const m = normalise({
        ...defaultModel(),
        roof: { ...defaultModel().roof, type },
        camera: { rotation: rot, projection: 'iso30' },
      });
      const out = renderScene(m, { width: 400, height: 300 });
      if (!out.svg.startsWith('<svg')) return `${type}/${rot} : SVG invalide`;
      if (out.svg.includes('NaN')) return `${type}/${rot} : coordonnée NaN`;
      if (out.faces.length < 5) return `${type}/${rot} : ${out.faces.length} faces seulement`;
    }
  }
  return true;
});

check('un modèle vide ne fait pas planter le rendu', () => {
  const out = renderScene(normalise(emptyModel()), { width: 200, height: 150 });
  return out.svg.startsWith('<svg');
});

check('plusieurs étages surélèvent bien la toiture', () => {
  const base = normalise(defaultModel());
  const tall = normalise({ ...base, storeys: 2 });
  return wallTop(tall) > wallTop(base) + 2;
});

check('le pignon monte au-dessus de la ligne de rive', () => {
  const m = normalise({ ...defaultModel(), roof: { ...defaultModel().roof, type: 'gable' } });
  const { mesh } = buildMesh(m);
  const top = wallTop(m);
  const highest = mesh.tris
    .filter((t) => t.mat === 'wall')
    .reduce((acc, t) => Math.max(acc, t.a[2], t.b[2], t.c[2]), 0);
  return highest > top + 0.5 || `mur le plus haut : ${highest.toFixed(2)} m pour une rive à ${top} m`;
});

check('la couche de sélection expose murs, ouvertures et objets', () => {
  const m = normalise(defaultModel());
  const { camera } = renderScene(m, { width: 400, height: 300 });
  const html = hitLayer(m, camera);
  for (const kind of ['wall', 'opening', 'roofItem', 'prop']) {
    if (!html.includes(`data-pick="${kind}"`)) return `cible « ${kind} » absente`;
  }
  return true;
});

check('l’export applique la densité de pixels sans toucher au viewBox', () => {
  const m = normalise(defaultModel());
  const svg = svgFor(m, SIZES.find((s) => s.id === 'uhd'));
  return (svg.includes('width="4800"') && svg.includes('viewBox="0 0 1200 800"'))
    || 'dimensions ou viewBox inattendus';
});

check('le fond transparent n’ajoute aucun rectangle de fond', () => {
  const m = normalise(defaultModel());
  const opaque = normalise({ ...m, style: { ...m.style, background: '#ffffff' } });
  return !svgFor(m, SIZES[0]).includes('<rect') && svgFor(opaque, SIZES[0]).includes('<rect');
});

/* ---------------- textures ---------------- */

// A face standing in for one slope of a 30-degree roof.
const slopeFace = () => {
  const k = Math.tan((30 * Math.PI) / 180);
  const n = [0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
  return {
    normal: n,
    loops: [[[0, 0, 3], [8, 0, 3], [8, 4, 3 + 4 * k], [0, 4, 3 + 4 * k]].map(
      (p) => [p[0], p[1], p[2]],
    )],
  };
};

check('les rangs de tuiles restent horizontaux sur une pente', () => {
  const segs = textureSegments(slopeFace(), ROOF_TEXTURES.tiles, 60);
  if (!segs.length) return 'aucun segment';
  // Courses follow the eaves, so both ends of a course sit at the same height.
  const courses = segs.filter(([a, b]) => Math.abs(a[0] - b[0]) > 0.5);
  if (!courses.length) return 'aucun rang trouvé';
  for (const [a, b] of courses) {
    if (!near(a[2], b[2], 1e-6)) return `rang non horizontal : ${a[2]} vs ${b[2]}`;
  }
  return true;
});

check('les segments de texture restent dans le plan de la face', () => {
  const face = slopeFace();
  const d0 = face.normal[0] * face.loops[0][0][0] + face.normal[1] * face.loops[0][0][1]
    + face.normal[2] * face.loops[0][0][2];
  for (const spec of [ROOF_TEXTURES.tiles, ROOF_TEXTURES.slate, ROOF_TEXTURES.seam]) {
    for (const [a, b] of textureSegments(face, spec, 60)) {
      for (const p of [a, b]) {
        const d = face.normal[0] * p[0] + face.normal[1] * p[1] + face.normal[2] * p[2];
        if (!near(d, d0, 1e-6)) return 'segment hors du plan';
      }
    }
  }
  return true;
});

check('une texture trop fine à l’écran n’est pas dessinée', () => {
  // At three pixels per metre a 0.38 m course would be sub-pixel noise.
  return textureSegments(slopeFace(), ROOF_TEXTURES.tiles, 3).length === 0;
});

check('les joints d’un appareillage sont décalés d’un rang à l’autre', () => {
  const wall = {
    normal: [0, 1, 0],
    loops: [[[0, 5, 0], [4, 5, 0], [4, 5, 2.5], [0, 5, 2.5]]],
  };
  const segs = textureSegments(wall, WALL_TEXTURES.brick, 80);
  const joints = segs.filter(([a, b]) => Math.abs(a[2] - b[2]) > 0.01);
  if (joints.length < 4) return `${joints.length} joints seulement`;
  const xs = new Set(joints.map(([a]) => Math.round(a[0] * 100) / 100));
  return xs.size > 2 || 'joints tous alignés';
});

check('seuls les murs et la toiture reçoivent une matière', () => {
  const t = { roof: 'tiles', wall: 'brick' };
  return specFor('roof', t) && specFor('wall', t)
    && !specFor('grass', t) && !specFor('water', t) && !specFor('glass', t);
});

check('le rendu texturé produit des chemins de découpe uniques', () => {
  const m = normalise({ ...defaultModel(), texture: { roof: 'tiles', wall: 'brick' } });
  const a = renderScene(m, { width: 600, height: 400 }).svg;
  const b = renderScene(m, { width: 600, height: 400 }).svg;
  const ids = (svg) => [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((x) => x[1]);
  const ia = ids(a), ib = ids(b);
  if (!ia.length) return 'aucune découpe émise';
  if (new Set(ia).size !== ia.length) return 'identifiants dupliqués dans un même rendu';
  // Two renders on one page must not share ids, or they clip each other.
  return ia.every((id) => !ib.includes(id)) || 'identifiants partagés entre deux rendus';
});

/* ---------------- starter models ---------------- */

check('la galerie propose dix modèles, tous identifiés', () => {
  if (PRESETS.length !== 10) return `${PRESETS.length} modèles`;
  const ids = PRESETS.map((p) => p.id);
  if (new Set(ids).size !== ids.length) return 'identifiants en double';
  for (const p of PRESETS) {
    if (!p.name || !p.note) return `${p.id} : nom ou description manquant`;
    if (!p.model.cells.length) return `${p.id} : emprise vide`;
  }
  return getPreset('chalet') !== null && getPreset('inconnu') === null;
});

check('chaque ouverture d’un modèle est posée sur un mur qui existe', () => {
  // A dangling wall reference fails silently: the opening is simply never
  // drawn, which is easy to miss when eyeballing a thumbnail.
  for (const p of PRESETS) {
    const m = normalise(p.model);
    const walls = new Set(boundaryEdges(cellSet(m)).map((e) => e.id));
    for (const op of m.openings) {
      if (!walls.has(op.edge)) return `${p.id} : ${op.kind} sur le mur inexistant ${op.edge}`;
      if ((op.storey || 0) >= m.storeys) return `${p.id} : ${op.kind} à l’étage ${op.storey} sur ${m.storeys}`;
    }
  }
  return true;
});

check('chaque objet de toiture d’un modèle repose bien sur le toit', () => {
  for (const p of PRESETS) {
    const m = normalise(p.model);
    const field = heightField(decomposeRects(cellSet(m)), m.roof);
    for (const it of m.roofItems) {
      if (!field.inside(it.x, it.y)) return `${p.id} : ${it.kind} hors toiture en (${it.x}, ${it.y})`;
    }
  }
  return true;
});

check('les dix modèles se rendent sans coordonnée invalide', () => {
  for (const p of PRESETS) {
    const out = renderScene(normalise(p.model), { width: 320, height: 220 });
    if (out.svg.includes('NaN')) return `${p.id} : coordonnée NaN`;
    if (out.faces.length < 12) return `${p.id} : ${out.faces.length} faces seulement`;
  }
  return true;
});

check('les modèles couvrent des formes réellement différentes', () => {
  // Ten variations on one shape would defeat the point of the gallery.
  const seen = new Set();
  for (const p of PRESETS) {
    const m = normalise(p.model);
    seen.add(`${m.roof.type}|${m.storeys}`);
  }
  return seen.size >= 6 || `seulement ${seen.size} combinaisons toit/étages`;
});

check('la galerie construit une vignette par modèle, plus la page blanche', () => {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<div class="gallery-grid"></div>';
  document.getElementById('stage').appendChild(dialog);
  let picked = null;
  const gallery = new Gallery(dialog, (m) => { picked = m; });
  gallery.build();
  const cards = dialog.querySelectorAll('.gallery-card');
  if (cards.length !== PRESETS.length + 1) return `${cards.length} cartes`;
  if (!dialog.querySelector('.gallery-thumb svg')) return 'vignette sans rendu';
  cards[0].click();
  return (picked && picked.cells.length > 0) || 'le choix ne renvoie aucun modèle';
});

/* ---------------- palettes ---------------- */

check('la palette Horizons rend ses teintes exactes sur les faces d’axe', () => {
  // The values are those of the Gladys v5 house-view gallery; drifting from
  // them is exactly what this test is for.
  const cases = [
    ['wall', [0, 1, 0], '#efe8dc'], ['wall', [1, 0, 0], '#e0d6c6'], ['wall', [0, 0, 1], '#f8f4ed'],
    ['roof', [0, 1, 0], '#e8a37c'], ['roof', [1, 0, 0], '#c97e56'],
    ['grass', [0, 0, 1], '#e3ecdf'],
  ];
  for (const [mat, n, expected] of cases) {
    const got = faceColour(mat, 'horizons', {}, n);
    if (got.toLowerCase() !== expected) return `${mat} ${JSON.stringify(n)} → ${got}, attendu ${expected}`;
  }
  return true;
});

check('une face inclinée reste entre les teintes voisines', () => {
  const n = [0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
  const got = faceColour('roof', 'horizons', {}, n);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(got.slice(i, i + 2), 16));
  const between = (v, lo, hi) => v >= Math.min(lo, hi) - 1 && v <= Math.max(lo, hi) + 1;
  // Bounded by the two anchors it blends: yNeg #d98d64 and up #eeb08d.
  return (between(r, 0xd9, 0xee) && between(g, 0x8d, 0xb0) && between(b, 0x64, 0x8d))
    || `teinte hors bornes : ${got}`;
});

check('recolorer un matériau conserve la structure d’ombrage', () => {
  const ov = { wall: '#8fb3d9' };
  const lit = faceColour('wall', 'horizons', ov, [0, 1, 0]);
  const shaded = faceColour('wall', 'horizons', ov, [1, 0, 0]);
  const top = faceColour('wall', 'horizons', ov, [0, 0, 1]);
  const lum = (h) => [1, 3, 5].reduce((a, i) => a + parseInt(h.slice(i, i + 2), 16), 0);
  // Still three distinct values, ordered as the palette orders them.
  if (lit === shaded || lit === top) return 'les faces ne se distinguent plus';
  return lum(top) > lum(lit) && lum(lit) > lum(shaded)
    || `ordre rompu : haut ${lum(top)}, gauche ${lum(lit)}, droite ${lum(shaded)}`;
});

check('chaque palette déclare le style qui va avec', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    if (!t.style) return `${name} ne déclare aucun style`;
    if (typeof t.style.outline !== 'boolean') return `${name} : contours non déclarés`;
  }
  return true;
});

check('un fichier incomplet hérite du style de sa propre palette', () => {
  // No style block at all: the terracotta conventions must win, not whichever
  // palette happens to be the current default.
  const m = normalise({ theme: 'terracotta', cells: ['1,1'] });
  if (m.style.outline !== true) return 'contours non repris de la palette';
  if (m.plinth !== 0.2) return `soubassement ${m.plinth}`;
  if (m.texture.roof !== 'tiles') return `matière ${m.texture.roof}`;
  // An explicit choice in the file still wins over the palette.
  const forced = normalise({ theme: 'terracotta', cells: ['1,1'], style: { outline: false } });
  return forced.style.outline === false || 'le choix explicite du fichier a été écrasé';
});

check('la palette Horizons se passe de contours et de soubassement', () => {
  const st = THEMES.horizons.style;
  return st.outline === false && st.plinth === 0 && st.windowBars === false;
});

check('materialColour renvoie la teinte de référence d’un matériau orienté', () => {
  return materialColour('wall', 'horizons', {}) === '#efe8dc'
    && materialColour('wall', 'horizons', { wall: '#123456' }) === '#123456';
});

/* ---------------- model and storage ---------------- */

check('normalise complète un modèle incomplet', () => {
  const m = normalise({ cells: ['1,1'], storeys: 99 });
  return m.roof.type === 'hip' && m.storeys === 4 && Array.isArray(m.props) && m.version === 1;
});

check('un lien de partage refait le modèle à l’identique', () => {
  const m = normalise(defaultModel());
  const url = toShareUrl(m);
  const hash = url.slice(url.indexOf('#'));
  const saved = location.hash;
  location.hash = hash;
  const back = fromShareUrl();
  location.hash = saved;
  return (back && back.cells.length === m.cells.length && back.roof.pitch === m.roof.pitch)
    || 'modèle non restitué';
});

/* ---------------- store ---------------- */

check('annuler et rétablir reviennent au bon état', () => {
  const s = new Store(defaultModel());
  const n0 = s.model.storeys;
  s.update((m) => ({ ...m, storeys: 3 }));
  if (s.model.storeys !== 3) return 'modification non appliquée';
  s.undo();
  if (s.model.storeys !== n0) return 'annulation incorrecte';
  s.redo();
  return s.model.storeys === 3 || 'rétablissement incorrect';
});

check('les modifications continues se regroupent en une seule annulation', () => {
  const s = new Store(defaultModel());
  const n0 = s.model.storeyHeight;
  for (const v of [2.8, 2.9, 3.0]) s.update((m) => ({ ...m, storeyHeight: v }), { coalesce: 'h' });
  s.undo();
  return near(s.model.storeyHeight, n0) || `revenu à ${s.model.storeyHeight}`;
});

check('supprimer la sélection retire l’élément', () => {
  const s = new Store(defaultModel());
  const id = s.model.props[0].id;
  s.select({ type: 'prop', id });
  s.deleteSelected();
  return !s.model.props.some((p) => p.id === id);
});

/* ---------------- interface ---------------- */

function pointer(view, wx, wy, type, extra = {}) {
  const r = view.svg.getBoundingClientRect();
  const [px, py] = view.toPx(wx, wy);
  return new PointerEvent(type, {
    clientX: r.left + px, clientY: r.top + py,
    bubbles: true, pointerId: 1, isPrimary: true, button: 0, ...extra,
  });
}

check('le pinceau ajoute une case là où on clique', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('paint');
  const before = s.model.cells.length;
  view.svg.dispatchEvent(pointer(view, 20.5, 20.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 20.5, 20.5, 'pointerup'));
  return (s.model.cells.length === before + 1 && s.model.cells.includes('20,20'))
    || `cases : ${JSON.stringify(s.model.cells)}`;
});

check('l’outil rectangle remplit toute la zone tracée', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('rect');
  view.svg.dispatchEvent(pointer(view, 10.2, 10.2, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 13.8, 12.8, 'pointermove'));
  view.svg.dispatchEvent(pointer(view, 13.8, 12.8, 'pointerup'));
  return s.model.cells.length === 4 * 3 || `obtenu ${s.model.cells.length} cases`;
});

check('poser une fenêtre l’accroche au mur le plus proche', () => {
  const s = new Store(normalise({ ...emptyModel(), cells: [...rectCells(10, 10, 14, 13)] }));
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('window');
  // Just outside the south wall of the row j = 10.
  view.svg.dispatchEvent(pointer(view, 12.5, 9.8, 'pointerdown'));
  const op = s.model.openings[0];
  return (op && op.edge === '12,10,S') || `accroché à ${op ? op.edge : 'rien'}`;
});

check('le rendu isométrique et l’inspecteur se construisent sans erreur', () => {
  const s = new Store(defaultModel());
  const vp = new Viewport(document.getElementById('iso'), s);
  vp.render();
  const insp = new Inspector(document.getElementById('inspector'), s);
  insp.render();
  s.select({ type: 'prop', id: s.model.props[0].id });
  insp.render();
  vp.render();
  return document.getElementById('inspector').children.length > 0
    && document.getElementById('iso').querySelector('svg') !== null;
});

/* ---------------- asynchronous checks ---------------- */

async function checkAsync(name, fn) {
  let ok = false, detail = '';
  try {
    const r = await fn();
    ok = r === true || r === undefined;
    if (!ok) detail = ` — ${r}`;
  } catch (e) {
    detail = ` — ${e.message}`;
  }
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'ko';
  li.textContent = name + detail;
  results.appendChild(li);
  ok ? passed++ : failed++;
}

/**
 * Load a blob back as an <img>. Deliberately not createImageBitmap: an image
 * load is a resource load, which headless Chrome's virtual clock waits for,
 * whereas createImageBitmap is not and lets the run finish underneath us.
 */
function loadBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('PNG illisible')); };
    img.src = url;
  });
}

// The whole export path in one test: model -> SVG -> raster -> PNG blob.
await checkAsync('le SVG se rasterise en PNG à la bonne taille', async () => {
  const m = normalise(defaultModel());
  const size = { width: 320, height: 240, ratio: 2 };
  const blob = await svgToPng(svgFor(m, size), size.width * size.ratio, size.height * size.ratio);
  if (blob.type !== 'image/png') return `type ${blob.type}`;
  if (blob.size < 1000) return `PNG suspect : ${blob.size} octets`;
  const img = await loadBlob(blob);
  return (img.naturalWidth === 640 && img.naturalHeight === 480)
    || `${img.naturalWidth}×${img.naturalHeight}`;
});

await checkAsync('le PNG conserve la transparence du fond', async () => {
  const m = normalise(defaultModel());
  const blob = await svgToPng(svgFor(m, { width: 200, height: 150, ratio: 1 }), 200, 150);
  const img = await loadBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 150;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  // The top-left corner falls outside the ground plane, so it must stay clear.
  const alpha = ctx.getImageData(1, 1, 1, 1).data[3];
  return alpha === 0 || `alpha du coin : ${alpha}`;
});

/**
 * Load the real page in an iframe.
 *
 * The suite above exercises modules; this one exercises the assembled page,
 * which is where a purely-CSS regression hides. One did: the layout grew past
 * the viewport and pushed both drawings below the fold, and every module test
 * still passed.
 */
function loadApp(width, height) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = `width:${width}px;height:${height}px`;
    frame.src = '../index.html';
    frame.onerror = () => reject(new Error('page non chargée'));
    frame.onload = () => {
      // Poll for readiness rather than guessing a delay: the app draws on an
      // animation frame, and the gallery renders ten thumbnails on first run,
      // so a fixed timeout is a race that fails on a slow machine only.
      const started = Date.now();
      const ready = () => {
        const doc = frame.contentDocument;
        const done = doc.querySelector('#inspector .panel') && doc.querySelector('#iso svg');
        if (done) resolve(frame);
        else if (Date.now() - started > 6000) reject(new Error('interface non prête après 6 s'));
        else setTimeout(ready, 60);
      };
      ready();
    };
    // The frame lives at the top of the page and there is only ever one:
    // anywhere below the fold, Chrome throttles its animation frames to
    // nothing and the app inside never draws.
    const host = document.getElementById('appframe');
    host.replaceChildren(frame);

  });
}

// Loaded once and shared: a second frame lands lower down the page, where
// Chrome throttles animation frames and the app never draws.
let appFramePromise = null;
const app = () => (appFramePromise ||= loadApp(1280, 800));

await checkAsync('la page tient dans la fenêtre, sans déborder', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  const view = doc.documentElement.clientHeight;
  const scroll = doc.body.scrollHeight;
  if (scroll > view + 2) return `contenu ${scroll}px pour une fenêtre de ${view}px`;
  // Both drawing panels must fit inside the viewport, not merely exist.
  for (const id of ['plan', 'iso']) {
    const r = doc.getElementById(id).getBoundingClientRect();
    if (r.height > view) return `le panneau « ${id} » fait ${Math.round(r.height)}px`;
    if (r.height < 120) return `le panneau « ${id} » est écrasé (${Math.round(r.height)}px)`;
  }
  return true;
});

await checkAsync('la page s’amorce avec ses outils et un rendu visible', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  if (doc.querySelectorAll('.tool').length < 10) return 'palette d’outils incomplète';
  const svg = doc.querySelector('#iso svg');
  if (svg.querySelectorAll('path').length < 20) return 'rendu isométrique vide';
  // The drawing must land inside the panel, not somewhere off-screen below it.
  const panel = doc.getElementById('iso').getBoundingClientRect();
  const box = svg.getBBox();
  return (box.y + box.height <= panel.height + 2 && box.height > 40)
    || `dessin en dehors du panneau : y=${Math.round(box.y)} h=${Math.round(box.height)} pour ${Math.round(panel.height)}px`;
});

/* ---------------- summary ---------------- */

const summary = document.getElementById('summary');
summary.textContent = failed === 0
  ? `${passed} tests réussis.`
  : `${passed} réussis, ${failed} en échec.`;
summary.className = failed === 0 ? 'green' : 'red';
document.title = failed === 0 ? `OK ${passed}/${passed}` : `ECHEC ${failed}`;
