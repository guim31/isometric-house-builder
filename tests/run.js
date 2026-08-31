/**
 * Test suite. No framework, no build: it runs in any browser and reports into
 * the page, which also makes it readable by a headless run.
 */

import { Mesh, mergeCoplanar } from '../src/core/mesh.js';
import { decomposeRects, boundaryEdges, boundaryRuns, rectCells, key } from '../src/core/grid.js';
import { heightField, snapOverhang, STEP } from '../src/core/roof.js';
import {
  Camera, rotatePoint, project, projectionFor, PROJECTIONS, PITCH_RANGE,
  VIEWPOINTS, viewpointLabel, rotateDir, depthOf, facingOf, DEFAULT_PITCH,
  normaliseYaw, ROLL_RANGE,
} from '../src/core/iso.js';
import { focusModel, focusRect, focusFrame } from '../src/core/focus.js';
import {
  defaultModel, emptyModel, normalise, cellSet, wallTop, withCellSize, fmtMetres,
  makeBuilding, buildingOfEdge, storeyBase, storeyHeightOf,
} from '../src/core/model.js';

/** First (or nth) volume of a model — most tests only ever have one. */
const B = (m, i = 0) => m.buildings[i];
const cellsOf = (m, i = 0) => m.buildings[i].cells;
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { hitLayer, screenToGround } from '../src/render/hit.js';
import { textureSegments, textureTiles, tilePalette, specFor, ROOF_TEXTURES, WALL_TEXTURES } from '../src/render/texture.js';
import { THEMES, faceColour, materialColour, hexToRgb, rgbToHsl, nightColour, NIGHT } from '../src/core/palette.js';
import { PRESETS, getPreset } from '../src/data/presets.js';
import { Gallery } from '../src/ui/gallery.js';
import { Store } from '../src/ui/store.js';
import { placeRun, placeProp, nearestMuret, LINEAR_KINDS } from '../src/ui/actions.js';
import { PlanView } from '../src/ui/plan.js';
import { Viewport } from '../src/ui/viewport.js';
import { Inspector } from '../src/ui/panels.js';
import { toShareUrl, fromShareUrl, clearLocal } from '../src/io/project.js';
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

check('l’axe de vue reste (1, 1, lambda) à toutes les hauteurs de caméra', () => {
  // The invariant the whole depth sort rests on: moving a point along the view
  // axis must not move it on screen, so depth is a plain linear form. If this
  // breaks, faces stop sorting and nothing else in the renderer is trustworthy.
  for (const name of Object.keys(PROJECTIONS)) {
    for (const pitch of [PITCH_RANGE[0], 20, DEFAULT_PITCH, 55, PITCH_RANGE[1]]) {
      const proj = projectionFor(name, pitch);
      // Two points one view-axis step apart. The axis is (1, 1, lambda), so
      // advancing x and y by 2 means advancing z by 2*lambda.
      const a = project([1, 2, 3], proj);
      const b = project([3, 4, 3 + 2 * proj.lambda], proj);
      if (!near(a[0], b[0], 1e-9) || !near(a[1], b[1], 1e-9)) {
        return `${name} @ ${Math.round(pitch)}° dévie`;
      }
      if (!near(depthOf([1, 1, 1], proj.lambda), 2 + proj.lambda, 1e-9)) return 'depthOf incohérent';
    }
  }
  return true;
});

check('la projection par défaut reproduit exactement les constantes d’origine', () => {
  // sqrt(3)/2 : 1/2 : 1 — the values hard-coded before the pitch was a dial.
  const p = projectionFor('iso30', DEFAULT_PITCH);
  return (near(p.kx, Math.cos(Math.PI / 6), 1e-12)
    && near(p.ky, 0.5, 1e-12) && near(p.kz, 1, 1e-12) && near(p.lambda, 1, 1e-12))
    || `obtenu ${p.kx}, ${p.ky}, ${p.kz}`;
});

check('quatre quarts de tour ramènent exactement au point de départ', () => {
  // Exactly, not nearly: cos(90°) is 6e-17 in floating point, and the four
  // default views have to stay pixel-identical from one release to the next.
  let p = [3, 7, 2];
  for (let i = 0; i < 4; i++) p = rotatePoint(p, 90, 5, 5);
  return (p[0] === 3 && p[1] === 7 && p[2] === 2) || `obtenu ${p.join(', ')}`;
});

check('une rotation libre est réversible et conserve les distances', () => {
  const p = rotatePoint([3, 7, 2], 37, 5, 5);
  const back = rotatePoint(p, -37, 5, 5);
  const d = (a) => Math.hypot(a[0] - 5, a[1] - 5);
  if (!near(d(p), d([3, 7, 2]), 1e-9)) return 'la rotation change la distance au centre';
  return (near(back[0], 3) && near(back[1], 7)) || 'aller-retour non nul';
});

check('à un lacet quelconque, deux volumes disjoints se trient dans le bon ordre', () => {
  // The claim that made free orbit possible: for axis-aligned geometry, any
  // yaw keeps the painter's order exact, because the separating plane between
  // two disjoint boxes is perpendicular to a world axis. Checked directly —
  // the near box must sort after the far one at every angle tried.
  for (const yaw of [0, 17, 45, 63, 90, 128, 180, 233, 271, 344]) {
    for (const pitch of [15, DEFAULT_PITCH, 65]) {
      const cam = new Camera({ yaw, pitch, centre: [0, 0] });
      // Two boxes separated along x only. Which one is nearer depends on the
      // sign of the view axis' x component, so derive it rather than assume.
      const far = cam.depth([0, 0, 0]);
      const near2 = cam.depth([10, 0, 0]);
      const expectNearer = rotateDir([1, 0, 0], yaw);
      const sign = expectNearer[0] + expectNearer[1];
      if (Math.abs(sign) < 1e-9) continue; // camera looks straight down that axis
      if (Math.sign(near2 - far) !== Math.sign(sign)) {
        return `lacet ${yaw}° : ordre inversé sur x`;
      }
    }
  }
  return true;
});

check('une face regardant la caméra est visible à tout angle', () => {
  for (const yaw of [0, 33, 90, 150, 200, 300]) {
    const cam = new Camera({ yaw, centre: [0, 0] });
    // The roof always faces up, and up is always towards the camera.
    if (facingOf(rotateDir([0, 0, 1], yaw), cam.lambda) <= 0) return `lacet ${yaw}° : toit invisible`;
    // A wall and its opposite can never both be visible.
    const a = facingOf(rotateDir([1, 0, 0], yaw), cam.lambda);
    const b = facingOf(rotateDir([-1, 0, 0], yaw), cam.lambda);
    if (a > 1e-9 && b > 1e-9) return `lacet ${yaw}° : deux façades opposées visibles`;
  }
  return true;
});

check('le libellé de point de vue suit le lacet en continu', () => {
  const cases = [[0, 'Nord-Est'], [90, 'Sud-Est'], [180, 'Sud-Ouest'], [270, 'Nord-Ouest'],
    [45, 'Est'], [315, 'Nord'], [22, 'Est-Nord-Est']];
  for (const [yaw, want] of cases) {
    if (viewpointLabel(yaw) !== want) return `${yaw}° donne ${viewpointLabel(yaw)}, attendu ${want}`;
  }
  return true;
});

check('écran → sol est bien la réciproque de sol → écran', () => {
  // Dropping a tree straight onto the render inverts this mapping, so it has
  // to hold at the free angles too, not only on the four quarter turns.
  for (const yaw of [0, 90, 180, 270, 23, 137, 291]) {
    for (const pitch of [18, DEFAULT_PITCH, 62]) {
      const cam = new Camera({ yaw, pitch, centre: [10, 10] });
      cam.scale = 24;
      cam.offset = [300, 200];
      const s = cam.toScreen([13, 7, 0]);
      const g = screenToGround(cam, s[0], s[1]);
      if (!near(g[0], 13, 1e-6) || !near(g[1], 7, 1e-6)) return `lacet ${yaw}°/${pitch}° → ${g}`;
    }
  }
  return true;
});

/* ---------------- dimensions and grid pitch ---------------- */

check('les murs droits fusionnent en une cote par pan', () => {
  // A 5×3 rectangle has exactly four straight runs: 5, 5, 3 and 3 metres.
  const runs = boundaryRuns(rectCells(0, 0, 4, 2));
  if (runs.length !== 4) return `${runs.length} cotes`;
  const lens = runs.map((r) => r.cells).sort().join(',');
  if (lens !== '3,3,5,5') return `longueurs ${lens}`;
  // An L adds two inner runs.
  const l = boundaryRuns(new Set([...rectCells(0, 0, 9, 3), ...rectCells(6, 4, 9, 8)]));
  return l.length === 6 || `forme en L : ${l.length} cotes`;
});

check('en trame 0,50 m, un mur de 10 cases mesure 5 m', () => {
  const m = normalise({
    ...emptyModel(),
    grid: { w: 40, d: 40, cellSize: 0.5 },
    cells: [...rectCells(0, 0, 9, 5)],
    roof: { type: 'gable', pitch: 45, overhang: 0, fascia: 0.14, shedDir: 'S' },
  });
  const built = buildMesh(m);
  let maxX = -Infinity, maxY = -Infinity;
  for (const t of built.mesh.tris) {
    if (t.mat !== 'wall') continue;
    for (const p of [t.a, t.b, t.c]) { maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
  }
  if (!near(maxX, 5, 1e-6) || !near(maxY, 3, 1e-6)) return `emprise ${maxX} × ${maxY} m`;
  // Depth 3 m at 45° → the ridge rises 1.5 m above the eaves. If cells were
  // still read as metres, the rise would be 3 m.
  return near(built.roof.apex, wallTop(B(m)) + 1.5, 1e-6)
    || `faîtage à ${(built.roof.apex - wallTop(B(m))).toFixed(2)} m au-dessus de l'égout`;
});

check('le pinceau vise la bonne case en trame fine', () => {
  const s = new Store(normalise({ ...emptyModel(), grid: { w: 40, d: 40, cellSize: 0.5 } }));
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('paint');
  view.svg.dispatchEvent(pointer(view, 7.3, 7.2, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 7.3, 7.2, 'pointerup'));
  return cellsOf(s.model).includes('14,14') || `cases : ${JSON.stringify(cellsOf(s.model))}`;
});

check('affiner la trame préserve la maison et ses ouvertures', () => {
  const m = normalise({
    ...emptyModel(),
    cells: [...rectCells(10, 10, 15, 13)],
    openings: [
      { id: 'a', edge: '12,10,S', storey: 0, kind: 'window', offset: 0.7, width: 1.3, height: 1.3, sill: 0.95 },
      { id: 'b', edge: '15,12,E', storey: 0, kind: 'door', offset: 0.4, width: 1, height: 2.1, sill: 0 },
    ],
  });
  const fine = withCellSize(m, 0.5);
  if (cellsOf(fine).length !== cellsOf(m).length * 4) return `${cellsOf(fine).length} cases`;
  const a = fine.openings.find((o) => o.id === 'a');
  const b = fine.openings.find((o) => o.id === 'b');
  if (a.edge !== '24,20,S') return `fenêtre ré-ancrée sur ${a.edge}`;
  if (b.edge !== '31,24,E') return `porte ré-ancrée sur ${b.edge}`;
  if (!near(a.offset, 0.7)) return 'décalage perdu';
  // Both anchors must exist as walls of the refined footprint.
  const walls = new Set(boundaryEdges(cellSet(fine)).map((e) => e.id));
  return (walls.has(a.edge) && walls.has(b.edge)) || 'ancrage sur un mur inexistant';
});

check('le plan affiche les cotes des murs', () => {
  const s = new Store(normalise({ ...emptyModel(), cells: [...rectCells(10, 10, 18, 14)] }));
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  const labels = [...view.svg.querySelectorAll('.plan-dims text')].map((t) => t.textContent);
  return (labels.includes('9 m') && labels.includes('5 m'))
    || `cotes affichées : ${JSON.stringify(labels)}`;
});

check('l’outil rectangle affiche la dimension pendant le tracé', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('rect');
  view.svg.dispatchEvent(pointer(view, 10.2, 10.2, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 13.8, 12.8, 'pointermove'));
  const label = view.svg.querySelector('.rect-size');
  const text = label ? label.textContent : '(absent)';
  view.svg.dispatchEvent(pointer(view, 13.8, 12.8, 'pointerup'));
  return text === '4 × 3 m' || `étiquette « ${text} »`;
});

check('fmtMetres écrit les dimensions à la française', () => {
  return fmtMetres(10.5) === '10,5' && fmtMetres(9) === '9' && fmtMetres(0.25) === '0,25';
});

/* ---------------- viewpoints ---------------- */

check('le rendu n’est pas l’image miroir du plan', () => {
  // The regression this pins: the video-game iso formula (x - y) forms a
  // left-handed basis once the near side is +x+y, and every render came out
  // mirrored — a pool west of the house on the plan appeared on the wrong
  // side. From the north-east camera of rotation 0, east must extend to the
  // screen LEFT and north to the RIGHT.
  const cam = new Camera({ rotation: 0, centre: [0, 0] });
  cam.scale = 10;
  cam.offset = [0, 0];
  const o = cam.toScreen([0, 0, 0]);
  const e = cam.toScreen([1, 0, 0]);
  const n = cam.toScreen([0, 1, 0]);
  if (e[0] >= o[0]) return 'l’est part vers la droite : vue en miroir';
  if (n[0] <= o[0]) return 'le nord part vers la gauche : vue en miroir';
  return true;
});


check('les libellés de point de vue désignent bien les façades visibles', () => {
  // The regression this guards: rotation 0 shows the north and east facades,
  // so the camera stands to the north-east — yet the labels once started at
  // « Sud-Est », and the four exported files carried the wrong names.
  const DIRS = { Nord: [0, 1, 0], Sud: [0, -1, 0], Est: [1, 0, 0], Ouest: [-1, 0, 0] };
  for (let r = 0; r < 4; r++) {
    for (const part of VIEWPOINTS[r].split('-')) {
      const n = rotateDir(DIRS[part], r * 90);
      if (n[0] + n[1] + n[2] <= 0) {
        return `${VIEWPOINTS[r]} : la façade ${part} n'est pas visible en rotation ${r}`;
      }
    }
  }
  return true;
});

/* ---------------- scene and rendering ---------------- */

check('un rendu peut réutiliser les faces déjà fusionnées', () => {
  // What the viewport's pan/zoom cache relies on.
  const m = normalise({ ...emptyModel(), cells: [...rectCells(10, 10, 16, 14)] });
  const first = renderScene(m, { width: 400, height: 300 });
  const second = renderScene(m, { width: 400, height: 300, built: first.built, faces: first.merged });
  return first.svg === second.svg || 'rendus différents';
});


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
  const tall = normalise({ ...base, buildings: base.buildings.map((b) => ({ ...b, storeys: 2 })) });
  return wallTop(B(tall)) > wallTop(B(base)) + 2;
});

check('le pignon monte au-dessus de la ligne de rive', () => {
  const d = defaultModel();
  const m = normalise({ ...d, buildings: d.buildings.map((b) => ({ ...b, roof: { ...b.roof, type: 'gable' } })) });
  const { mesh } = buildMesh(m);
  const top = wallTop(B(m));
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

check('les tuiles canal couvrent la face et restent dans son plan', () => {
  const face = slopeFace();
  const tiles = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  if (tiles.length < 200) return `${tiles.length} tuiles seulement`;
  const d0 = face.normal[0] * face.loops[0][0][0] + face.normal[1] * face.loops[0][0][1]
    + face.normal[2] * face.loops[0][0][2];
  for (const t of tiles) {
    if (t.pts.length !== 4) return 'tuile non quadrangulaire';
    for (const p of t.pts) {
      const d = face.normal[0] * p[0] + face.normal[1] * p[1] + face.normal[2] * p[2];
      if (!near(d, d0, 1e-6)) return 'tuile hors du plan de la face';
    }
  }
  return true;
});

check('le panachage est déterministe', () => {
  // An export must match the preview, and re-exporting tomorrow must give the
  // same image — hence a positional hash rather than Math.random.
  const face = slopeFace();
  const a = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  const b = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  for (let i = 0; i < a.length; i++) {
    if (a[i].colour !== b[i].colour) return `tuile ${i} : ${a[i].colour} puis ${b[i].colour}`;
  }
  const m = normalise({ ...defaultModel(), texture: { roof: 'canal', wall: 'none' } });
  // Clip-path ids are deliberately unique per render, so they are normalised
  // out: what must be identical is the geometry and the shades.
  const strip = (svg) => svg.replace(/t\d+-\d+/g, 'id');
  return strip(renderScene(m, { width: 500, height: 380 }).svg)
    === strip(renderScene(m, { width: 500, height: 380 }).svg) || 'deux rendus divergent';
});

check('le camaïeu reste discret et proche de la teinte du toit', () => {
  // Shades must vary, but a tile straying far would read as a defect rather
  // than as a fired-clay variation. The bounds are deliberately tight: the
  // first version of this material was judged too vivid.
  const fill = '#d98d64';
  const [h0, s0, l0] = rgbToHsl(...hexToRgb(fill));
  const shades = tilePalette(fill);
  if (shades.length < 12) return `${shades.length} nuances`;
  if (new Set(shades).size < 12) return 'nuances dupliquées';
  for (const c of shades) {
    const [h, sat, l] = rgbToHsl(...hexToRgb(c));
    let dh = Math.abs(h - h0); if (dh > 180) dh = 360 - dh;
    if (dh > 12) return `teinte à ${dh.toFixed(0)}° de la base : ${c}`;
    if (Math.abs(l - l0) > 0.085) return `clarté trop écartée : ${c}`;
    if (sat > s0 * 1.1) return `nuance plus vive que la base : ${c}`;
  }
  return true;
});

check('les tuiles canal sont allongées et assez grandes', () => {
  const t = ROOF_TEXTURES.canal.tile;
  if (t.slope / t.width < 1.7) return `rapport ${(t.slope / t.width).toFixed(2)} : pas assez allongée`;
  // Fewer, larger tiles: a roof should not dissolve into speckle.
  const perM2 = 1 / (t.slope * t.width);
  return perM2 < 7 || `${perM2.toFixed(1)} tuiles au m², trop nombreuses`;
});

check('les tuiles canal courent dans le sens de la pente', () => {
  // A canal tile is a channel from ridge to eaves. Laid the other way the
  // roof is shingled sideways, which is what this pins down: the long side of
  // a tile must climb, never follow the eaves line.
  const face = slopeFace();
  const tiles = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  if (!tiles.length) return 'aucune tuile';
  const t = tiles[Math.floor(tiles.length / 2)];
  // Edge lengths of the quad, and how much height each one gains.
  const edge = (p, q) => ({
    len: Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]),
    rise: Math.abs(q[2] - p[2]),
  });
  const e1 = edge(t.pts[0], t.pts[1]);
  const e2 = edge(t.pts[1], t.pts[2]);
  const long = e1.len >= e2.len ? e1 : e2;
  const short = e1.len >= e2.len ? e2 : e1;
  if (long.len / short.len < 1.5) return 'la tuile n’est pas franchement allongée';
  // The long edge climbs; the short one stays level with the eaves.
  return (long.rise > short.rise + 0.05)
    || `côté long à ${long.rise.toFixed(3)} m de dénivelé contre ${short.rise.toFixed(3)} : posée en travers`;
});

check('les tuiles disparaissent quand elles deviennent illisibles', () => {
  return textureTiles(slopeFace(), ROOF_TEXTURES.canal, 3, '#d98d64').length === 0;
});

check('les tuiles sont regroupées par nuance, pas émises une à une', () => {
  // Thousands of tiles, a score of shades: without the grouping the SVG would
  // carry one path per tile and grow by an order of magnitude.
  const m = normalise({ ...defaultModel(), texture: { roof: 'canal', wall: 'none' } });
  const svg = renderScene(m, { width: 1200, height: 800 }).svg;
  const paths = (svg.match(/<path/g) || []).length;
  const tiles = (svg.match(/Z/g) || []).length;
  if (tiles < 500) return `${tiles} tuiles : le panachage ne s'est pas déclenché`;
  return paths < 400 || `${paths} chemins pour ${tiles} facettes`;
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
    const field = heightField(decomposeRects(cellSet(m)), B(m).roof);
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
    seen.add(`${B(m).roof.type}|${B(m).storeys}`);
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
  return (picked && cellsOf(picked).length > 0) || 'le choix ne renvoie aucun modèle';
});

/* ---------------- overlapping and depth ordering ---------------- */

/** The face drawn last at a screen point — what the eye actually sees. */
function topFaceAt(out, pt) {
  const { camera, faces } = out;
  const inside = (loop) => {
    const s2 = loop.map((p) => camera.toScreen(p));
    let c = false;
    for (let i = 0, j = s2.length - 1; i < s2.length; j = i++) {
      if ((s2[i][1] > pt[1]) !== (s2[j][1] > pt[1])
        && pt[0] < ((s2[j][0] - s2[i][0]) * (pt[1] - s2[i][1])) / (s2[j][1] - s2[i][1]) + s2[i][0]) c = !c;
    }
    return c;
  };
  let top = null;
  for (const f of faces) {
    let hit = false;
    f.loops.forEach((l, li) => { if (inside(l)) hit = li === 0 ? true : !hit; });
    if (hit) top = f;
  }
  return top;
}

const roofHouse = (extra) => normalise({
  ...emptyModel(),
  buildings: [makeBuilding({ cells: [...rectCells(18, 14, 27, 21)], storeyHeight: 2.6 })],
  texture: { roof: 'none', wall: 'none' },
  ...extra,
});

check('une cheminée près du faîtage n’est pas tranchée par le toit', () => {
  // It used to anchor to one slope while the other, drawn later, painted over
  // it — so any chimney near a ridge came out sliced in half.
  for (const [label, x, y] of [['faîtage', 22.5, 17.5], ['milieu de pan', 22.5, 19.5], ['près de l’égout', 22.5, 20.6]]) {
    const m = roofHouse({ roofItems: [{ id: 'c', kind: 'chimney', x, y, w: 0.8, d: 0.8, h: 1.3 }] });
    const out = renderScene(m, { width: 600, height: 460 });
    const shaft = out.faces.filter((f) => f.group === 'chimney');
    if (!shaft.length) return `${label} : cheminée absente`;
    // Its own top, well above the roof, must be the face on top there.
    const apex = shaft.reduce((a, f) => (f.centroid[2] > a.centroid[2] ? f : a), shaft[0]);
    const top = topFaceAt(out, out.camera.toScreen(apex.centroid));
    if (!top) return `${label} : rien à cet endroit`;
    if (top.group !== 'chimney') return `${label} : recouverte par « ${top.mat} »`;
  }
  return true;
});

check('un objet de toiture épouse la pente', () => {
  const m = roofHouse({ roofItems: [{ id: 's', kind: 'solar', x: 21, y: 19, w: 3.2, d: 2.4 }] });
  const built = buildMesh(m);
  const part = built.parts[0];
  const zRoof = (x, y) => part.top + Math.max(0, part.field.h(x, y));
  let worst = 0;
  for (const t of built.mesh.tris) {
    if (t.mat !== 'solar') continue;
    for (const p of [t.a, t.b, t.c]) worst = Math.max(worst, Math.abs(p[2] - zRoof(p[0], p[1])));
  }
  // Astride a hip a single flat quad kept its own plane and tore through the
  // roof; the panel is now subdivided and never leaves the surface.
  return worst < 0.12 || `le panneau s'écarte de ${worst.toFixed(2)} m de la toiture`;
});

check('une haie longue est découpée en tronçons de profondeurs distinctes', () => {
  // One centroid for a twenty-metre run means one depth, so the whole hedge
  // sorts either in front of the house or behind it, never partly each.
  const m = roofHouse({
    props: [{ id: 'h', kind: 'hedge', x: 10, y: 23, w: 20, d: 0.6, h: 1.6 }],
  });
  const out = renderScene(m, { width: 700, height: 500 });
  const parts = out.faces.filter((f) => f.group.startsWith('hedge:'));
  if (parts.length < 6) return `${parts.length} faces seulement`;
  const depths = new Set(parts.map((f) => Math.round(f.depth * 4)));
  return depths.size >= 4 || `${depths.size} profondeurs distinctes`;
});

check('les tronçons se recouvrent, sans jour entre eux', () => {
  const m = roofHouse({ props: [{ id: 'h', kind: 'hedge', x: 10, y: 23, w: 12, d: 0.6, h: 1.6 }] });
  const xs = buildMesh(m).mesh.tris
    .filter((t) => t.group && t.group.startsWith('hedge:'))
    .map((t) => [Math.min(t.a[0], t.b[0], t.c[0]), Math.max(t.a[0], t.b[0], t.c[0])]);
  const starts = [...new Set(xs.map(([lo]) => Math.round(lo * 1000) / 1000))].sort((a, b) => a - b);
  const ends = [...new Set(xs.map(([, hi]) => Math.round(hi * 1000) / 1000))].sort((a, b) => a - b);
  // Every segment boundary must be covered: the next start comes before the
  // previous end, or an anti-aliased seam shows through.
  for (let i = 1; i < starts.length; i++) {
    const prevEnd = ends.filter((e) => e > starts[i - 1] && e <= starts[i] + 0.06).pop();
    if (prevEnd === undefined) continue;
    if (prevEnd < starts[i]) return `jour de ${(starts[i] - prevEnd).toFixed(3)} m entre deux tronçons`;
  }
  return true;
});

/* ---------------- separate building volumes ---------------- */

check('un ancien fichier se scinde en corps distincts', () => {
  // The house and a shed drawn away from it were always two volumes; the old
  // shape simply had no way of saying so. Opening such a file separates them,
  // so the shed can be re-roofed without touching the house.
  const legacy = {
    cells: [...rectCells(10, 10, 15, 14), ...rectCells(24, 10, 26, 12)],
    storeys: 2, storeyHeight: 2.5,
    roof: { type: 'gable', pitch: 40 },
  };
  const m = normalise(legacy);
  if (m.buildings.length !== 2) return `${m.buildings.length} corps`;
  const [house, shed] = m.buildings;
  if (house.cells.length <= shed.cells.length) return 'le plus grand volume n’est pas le premier';
  // Each inherits the old settings, then goes its own way.
  for (const b of m.buildings) {
    if (b.roof.type !== 'gable' || b.storeys !== 2 || b.storeyHeight !== 2.5) {
      return `${b.name} n’a pas hérité des réglages`;
    }
  }
  return house.id !== shed.id || 'identifiants confondus';
});

check('une emprise d’un seul tenant reste un seul corps', () => {
  const m = normalise({ cells: [...rectCells(10, 10, 20, 16)] });
  return m.buildings.length === 1 || `${m.buildings.length} corps`;
});

check('changer le toit d’un corps ne touche pas l’autre', () => {
  // The whole point of the request: a flat-roofed shed beside a hipped house.
  const m = normalise({
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(10, 10, 16, 15)] }),
      makeBuilding({ id: 'abri', cells: [...rectCells(22, 10, 25, 13)], storeyHeight: 2.2 }),
    ],
  });
  const changed = {
    ...m,
    buildings: m.buildings.map((b) => (b.id === 'abri'
      ? { ...b, roof: { ...b.roof, type: 'flat' } } : b)),
  };
  const apexOf = (model, id) => {
    const part = buildMesh(normalise(model)).parts.find((p) => p.building.id === id);
    return part.roof.apex - part.top;
  };
  if (apexOf(m, 'abri') < 0.5) return 'le toit initial de l’abri n’a pas de pente';
  if (apexOf(changed, 'abri') > 0.01) return 'le toit de l’abri n’est pas devenu plat';
  return near(apexOf(m, 'maison'), apexOf(changed, 'maison'), 1e-9)
    || 'le toit de la maison a bougé avec celui de l’abri';
});

check('un corps peut avoir ses propres couleurs', () => {
  const m = normalise({
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(10, 10, 16, 15)] }),
      makeBuilding({ id: 'abri', cells: [...rectCells(22, 10, 25, 13)], overrides: { wall: '#ffffff' } }),
    ],
  });
  const out = renderScene(m, { width: 600, height: 420 });
  const mats = new Set(out.faces.map((f) => f.mat));
  if (!mats.has('wall#abri')) return 'le corps recoloré ne porte pas son propre matériau';
  if (!mats.has('wall')) return 'l’autre corps a perdu le matériau commun';
  const shed = out.faces.find((f) => f.mat === 'wall#abri');
  const house = out.faces.find((f) => f.mat === 'wall');
  return shed.fill !== house.fill || 'les deux corps rendent la même couleur';
});

check('un corps peut porter ses propres matières', () => {
  // A timber shed should not be roofed in the house's canal tiles.
  const m = normalise({
    texture: { roof: 'canal', wall: 'none' },
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(10, 10, 18, 16)] }),
      makeBuilding({
        id: 'abri', cells: [...rectCells(24, 10, 28, 14)],
        roof: { type: 'flat', pitch: 5, overhang: 0.25, fascia: 0.12, shedDir: 'S' },
        texture: { roof: 'none', wall: 'siding' },
      }),
    ],
  });
  const out = renderScene(m, { width: 900, height: 640 });
  const tiles = (svgOf) => (svgOf.match(/Z/g) || []).length;
  // The house is tiled; the shed's own flat material must produce none.
  const houseRoof = out.faces.filter((f) => f.mat === 'roof');
  const shedRoof = out.faces.filter((f) => f.mat === 'roof#abri');
  if (!houseRoof.length) return 'toiture de la maison absente';
  if (!shedRoof.length) return 'l’abri ne porte pas ses propres matériaux';
  if (!specFor('roof', m.texture)) return 'la matière du modèle ne se résout plus';
  // Without a per-building texture the shed would inherit the canal spec.
  return specFor('roof#abri', m.buildings[1].texture).label === ROOF_TEXTURES.none.label
    || 'l’abri hérite encore de la matière de la maison';
});

check('le pinceau ne peint que dans le corps actif', () => {
  const s = new Store(normalise({
    buildings: [
      makeBuilding({ id: 'a', cells: [...rectCells(10, 10, 12, 12)] }),
      makeBuilding({ id: 'b', cells: [...rectCells(20, 10, 22, 12)] }),
    ],
  }));
  const view = new PlanView(document.getElementById('plan'), s);
  s.setActiveBuilding('b');
  s.setTool('paint');
  view.render();
  view.svg.dispatchEvent(pointer(view, 23.5, 11.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 23.5, 11.5, 'pointerup'));
  const a = s.model.buildings.find((x) => x.id === 'a');
  const b = s.model.buildings.find((x) => x.id === 'b');
  if (!b.cells.includes('23,11')) return 'la case n’a pas été ajoutée au corps actif';
  return a.cells.length === 9 || 'le corps inactif a été modifié';
});

check('supprimer un corps emporte ses ouvertures', () => {
  const s = new Store(normalise({
    buildings: [
      makeBuilding({ id: 'a', cells: [...rectCells(10, 10, 14, 13)] }),
      makeBuilding({ id: 'b', cells: [...rectCells(20, 10, 23, 13)] }),
    ],
    openings: [
      { id: 'oa', edge: '12,10,S', storey: 0, kind: 'window', offset: 0.5, width: 1, height: 1, sill: 1 },
      { id: 'ob', edge: '21,10,S', storey: 0, kind: 'window', offset: 0.5, width: 1, height: 1, sill: 1 },
    ],
  }));
  if (buildingOfEdge(s.model, '21,10,S').id !== 'b') return 'ouverture rattachée au mauvais corps';
  s.removeBuilding('b');
  if (s.model.buildings.length !== 1) return 'corps non supprimé';
  const ids = s.model.openings.map((o) => o.id);
  return (ids.includes('oa') && !ids.includes('ob'))
    || `ouvertures restantes : ${JSON.stringify(ids)}`;
});

check('le dernier corps ne peut pas être supprimé', () => {
  const s = new Store(normalise({ cells: [...rectCells(10, 10, 14, 13)] }));
  s.removeBuilding(s.model.buildings[0].id);
  return s.model.buildings.length === 1 || 'le modèle s’est retrouvé sans bâtiment';
});

/* ---------------- garden wall and gates ---------------- */

/** Span covered by the wall's own masonry along the x axis. */
function muretSpans(model) {
  // Segmented for depth sorting, so the group carries the run and the piece.
  return buildMesh(normalise(model)).mesh.tris
    .filter((t) => t.group && t.group.startsWith('muret:') && !t.group.includes(':cap'))
    .map((t) => [Math.min(t.a[0], t.b[0], t.c[0]), Math.max(t.a[0], t.b[0], t.c[0])]);
}

/* ---------------- per-level heights, recesses, raised slabs ---------------- */

check('chaque niveau peut avoir sa propre hauteur', () => {
  // The recurring real house: two full storeys and a short one under the
  // roof — the level where the slopes already start. One shared height cannot
  // say that, and rounding to whole storeys misses the house either way.
  const b = makeBuilding({ storeys: 3, storeyHeight: 2.7, storeyHeights: [2.5, 2.5, 1.1] });
  if (!near(wallTop(b), 2.5 + 2.5 + 1.1)) return `sommet à ${wallTop(b)}`;
  if (!near(storeyBase(b, 2), 5)) return `l’étage 2 démarre à ${storeyBase(b, 2)}`;
  // Unstated levels fall back to the shared height.
  const c = makeBuilding({ storeys: 3, storeyHeight: 2.7, storeyHeights: [2.5] });
  if (!near(storeyHeightOf(c, 1), 2.7)) return 'le repli sur la hauteur commune a disparu';
  // And normalise clamps what a hand-edited file may carry.
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: ['0,0'], storeys: 2, storeyHeights: [12, 'x'] })] });
  const hs = m.buildings[0].storeyHeights;
  return (hs[0] === 4 && hs[1] === m.buildings[0].storeyHeight)
    || `normalisation : ${JSON.stringify(hs)}`;
});

check('une fenêtre d’un étage sous combles se pose à la bonne hauteur', () => {
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({
      cells: [...rectCells(0, 0, 6, 4)], storeys: 3, storeyHeights: [2.5, 2.5, 1.1],
      roof: { type: 'gable', pitch: 40, overhang: 0.3, fascia: 0.16, shedDir: 'S' },
    })],
    openings: [{ id: 'o1', edge: '0,2,W', kind: 'window', storey: 2, offset: 0.5, width: 0.8, height: 0.7, sill: 0.2 }],
  });
  const glass = mergeCoplanar(buildMesh(m).mesh.tris).find((f) => f.mat === 'glass');
  if (!glass) return 'fenêtre absente du maillage';
  const z = glass.centroid[2];
  // Floor of level 2 at 5 m, sill 0.2, height 0.7 -> centre near 5.55.
  return (z > 5.4 && z < 5.7) || `vitrage centré à ${z.toFixed(2)} m`;
});

check('un renfoncement creuse un vrai trou dans le mur', () => {
  // The recess is geometry, not shading: the wall plane must be open where
  // the niche is, and the door drawn on the back panel. Checked in world
  // coordinates on the built mesh, not on pixels.
  const mk = (depth) => normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    // Wider than a cell on purpose: boundary edges are one cell long, and the
    // hole once stopped at its anchor edge — the wall next door kept covering
    // half the niche. Centred on its edge, so the sample points below hold
    // whichever way the edge runs.
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5, width: 1.7, height: 2.15, sill: 0, depth }] });
  const facesAt = (m) => mergeCoplanar(buildMesh(m).mesh.tris)
    .filter((f) => f.mat.startsWith('wall') && Math.abs(f.normal[0] + 1) < 1e-6
      && Math.abs(f.centroid[0]) < 1e-6);
  // Sample points across the hole (the wall is the x=0 plane; use y, z).
  // Edge '0,1,W' spans y 1..2; centred, the 1.7 m hole spans y 0.65..2.35.
  const inHole = [[1.5, 1], [0.9, 1], [2.1, 1], [1.5, 0.1], [1.5, 2.0]];
  const contains = (f, y, z) => {
    let c = false;
    for (const l of f.loops) {
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
        if ((l[i][2] > z) !== (l[j][2] > z)
          && y < ((l[j][1] - l[i][1]) * (z - l[i][2])) / (l[j][2] - l[i][2]) + l[i][1]) c = !c;
      }
    }
    return c;
  };
  for (const [y, z] of inHole) {
    if (facesAt(mk(0.6)).some((f) => contains(f, y, z))) {
      return `le mur couvre encore le trou en (${y}, ${z})`;
    }
  }
  // Flush, the wall is whole there — the hole must cost nothing by default.
  const whole = facesAt(mk(0));
  return inHole.every(([y, z]) => whole.some((f) => contains(f, y, z)))
    || 'sans renfoncement, le mur devrait être plein';
});

check('la niche d’un renfoncement est fermée : fond et quatre tableaux', () => {
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5, width: 1.7, height: 2.15, sill: 0, depth: 0.6 }] });
  const faces = mergeCoplanar(buildMesh(m).mesh.tris).filter((f) => f.mat.startsWith('wall'));
  // Back panel: wall-material face at x = +0.6 facing out.
  if (!faces.some((f) => Math.abs(f.centroid[0] - 0.6) < 0.05 && f.normal[0] < -0.9)) {
    return 'pas de fond de niche';
  }
  const reveal = (test) => faces.some((f) => f.centroid[0] > 0.05 && f.centroid[0] < 0.55 && test(f.normal));
  if (!reveal((n) => n[1] > 0.9)) return 'tableau latéral manquant (+y)';
  if (!reveal((n) => n[1] < -0.9)) return 'tableau latéral manquant (-y)';
  if (!reveal((n) => n[2] < -0.9)) return 'sous-face de linteau manquante';
  return reveal((n) => n[2] > 0.9) || 'seuil manquant';
});

check('un renfoncement peut être plus large que la porte', () => {
  // Asked for by a user with a porch: eighty centimetres of recessed wall on
  // either side of his front door. The hole and the niche follow the widened
  // extent; the leaf, its frame and its glass keep the door's own size.
  const mk = (extra) => normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5,
      width: 1.2, height: 2.15, sill: 0, depth: 0.6, ...extra }] });
  // Edge '0,1,W' spans y 1..2; centred, a 1.2 m opening spans y 0.9..2.1, and
  // widened by 0.5 either side, y 0.4..2.6.
  const wallAt = (m) => mergeCoplanar(buildMesh(m).mesh.tris)
    .filter((f) => f.mat.startsWith('wall') && Math.abs(f.normal[0] + 1) < 1e-6
      && Math.abs(f.centroid[0]) < 1e-6);
  const contains = (f, y, z) => {
    let c = false;
    for (const l of f.loops) {
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
        if ((l[i][2] > z) !== (l[j][2] > z)
          && y < ((l[j][1] - l[i][1]) * (z - l[i][2])) / (l[j][2] - l[i][2]) + l[i][1]) c = !c;
      }
    }
    return c;
  };
  // Just outside the door, inside the widening: wall before, open after.
  const flanks = [[0.6, 1], [2.4, 1]];
  const plain = wallAt(mk({}));
  if (!flanks.every(([y, z]) => plain.some((f) => contains(f, y, z)))) {
    return 'sans débord, le mur devrait être plein de part et d’autre';
  }
  const wide = wallAt(mk({ sides: 0.5 }));
  for (const [y, z] of flanks) {
    if (wide.some((f) => contains(f, y, z))) return `le mur couvre encore le débord en (${y}, ${z})`;
  }
  // The niche's back panel grew with it, so nothing shows through the hole.
  const back = mergeCoplanar(buildMesh(mk({ sides: 0.5 })).mesh.tris)
    .find((f) => f.mat.startsWith('wall') && Math.abs(f.centroid[0] - 0.6) < 0.05 && f.normal[0] < -0.9);
  if (!back) return 'pas de fond de niche';
  const ys = back.loops[0].map((q) => q[1]);
  if (Math.max(...ys) - Math.min(...ys) < 2.2 - 1e-6) return 'le fond de niche n’a pas suivi le débord';
  // And the door itself did not grow with the hole.
  const leaf = mergeCoplanar(buildMesh(mk({ sides: 0.5 })).mesh.tris).find((f) => f.mat === 'door');
  if (!leaf) return 'porte introuvable';
  const ly = leaf.loops[0].map((q) => q[1]);
  return Math.max(...ly) - Math.min(...ly) < 1.2 + 1e-6
    || 'la porte a grandi avec le renfoncement';
});

check('une terrasse peut monter au niveau de l’étage', () => {
  // Sloping ground, approximated: the garage opens below, the terrace sits
  // level with the first floor. The slab keeps its skirts at that height.
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [{ id: 't', kind: 'terrace', x: 7, y: 0, w: 5, d: 4, z: 2.5, material: 'paving' }] });
  const faces = mergeCoplanar(buildMesh(m).mesh.tris);
  const topFace = faces.find((f) => f.mat === 'paving' && f.normal[2] > 0.9 && f.centroid[2] > 2.4);
  if (!topFace) return 'pas de plateau à 2,50 m';
  const skirt = faces.some((f) => f.mat === 'paving' && Math.abs(f.normal[2]) < 0.1
    && f.centroid[2] > 1 && f.centroid[2] < 2.5);
  return skirt || 'pas de joue sous le plateau';
});

check('un escalier monte jusqu’en haut, marche par marche', () => {
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [{ id: 's1', kind: 'stairs', x: 8, y: 0, w: 1.5, d: 1.5, h: 1.2, dir: 'N', material: 'paving' }] });
  const faces = mergeCoplanar(buildMesh(m).mesh.tris).filter((f) => f.mat === 'paving');
  const treads = faces.filter((f) => f.normal[2] > 0.9);
  if (treads.length < 4) return `${treads.length} marches seulement`;
  const top = Math.max(...treads.map((f) => f.centroid[2]));
  if (Math.abs(top - 1.2) > 1e-6) return `la dernière marche est à ${top.toFixed(2)} m au lieu de 1,20`;
  // Rising towards the north: the higher the tread, the further along +y.
  const sorted = [...treads].sort((a, b) => a.centroid[2] - b.centroid[2]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].centroid[1] <= sorted[i - 1].centroid[1]) return 'les marches ne montent pas vers le nord';
  }
  // Nothing underneath: the flight is closed, not a set of floating slabs.
  return !faces.some((f) => f.normal[2] < -0.9) || 'des sous-faces sont émises';
});

check('un escalier posé au pied d’une terrasse se tourne vers elle', () => {
  // Steps exist to reach something; turned the wrong way by default they would
  // have to be reoriented every time.
  const s = new Store(normalise({ ...emptyModel(),
    props: [{ id: 't1', kind: 'terrace', x: 0, y: 0, w: 6, d: 4, material: 'paving', z: 1.5 }] }));
  placeProp(s, 'stairs', [3, -1]); // just south of the terrace
  const a = s.model.props.find((p) => p.kind === 'stairs');
  if (!a) return 'pas d’escalier';
  if (a.dir !== 'N') return `monte vers ${a.dir} au lieu du nord`;
  if (Math.abs(a.h - 1.5) > 1e-9) return `hauteur ${a.h} au lieu de 1,5`;
  // And on the other side, the other way round.
  placeProp(s, 'stairs', [7.5, 2]);
  const b = s.model.props.filter((p) => p.kind === 'stairs')[1];
  return b.dir === 'W' || `monte vers ${b.dir} au lieu de l’ouest`;
});

check('le surlignage d’une ouverture sélectionnée existe et est fini', () => {
  // It read plinth and storey height off the model, fields the multi-building
  // migration deleted — the dashes quietly became NaN and vanished.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  const op = s.model.openings[0];
  if (!op) return 'le modèle par défaut n’a pas d’ouverture';
  s.select({ type: 'opening', id: op.id });
  vp.render();
  const html = div.innerHTML;
  if (!html.includes('selection-outline')) return 'pas de surlignage';
  return !html.includes('NaN') || 'le surlignage contient NaN';
});

check('un portail ouvre le muret à l’endroit où il est posé', () => {
  const wall = { id: 'w', kind: 'muret', x: 4, y: 10, w: 12, d: 0.24, h: 1.5 };
  const base = { ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)] };
  const solid = muretSpans({ ...base, props: [wall] });
  if (!solid.length) return 'muret absent';
  const withGate = muretSpans({
    ...base,
    props: [wall, { id: 'g', kind: 'gate', x: 9, y: 9.96, w: 2, d: 0.16, h: 1.5 }],
  });
  // Nothing of the wall may remain inside the gate's span.
  const inGap = withGate.filter(([lo, hi]) => hi > 9.05 && lo < 10.95);
  if (inGap.length) return `${inGap.length} morceaux de muret dans l'ouverture`;
  // And the wall must survive on both sides of it.
  const left = withGate.some(([lo]) => lo < 8.5);
  const right = withGate.some(([, hi]) => hi > 11.5);
  return (left && right) || `muret restant à gauche : ${left}, à droite : ${right}`;
});

check('deux portails ouvrent le muret en deux endroits distincts', () => {
  const spans = muretSpans({
    ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)],
    props: [
      { id: 'w', kind: 'muret', x: 4, y: 10, w: 14, d: 0.24, h: 1.5 },
      { id: 'a', kind: 'gate', x: 7, y: 9.96, w: 1.2, d: 0.16, h: 1.5 },
      { id: 'b', kind: 'gate', x: 13, y: 9.96, w: 3.5, d: 0.16, h: 1.5, style: 'sliding' },
    ],
  });
  for (const [lo, hi] of [[7.05, 8.15], [13.05, 16.45]]) {
    if (spans.some(([a, b]) => b > lo && a < hi)) return `ouverture ${lo}–${hi} non dégagée`;
  }
  // Three runs of masonry remain: before, between and after.
  const starts = new Set(spans.map(([a]) => Math.round(a * 4) / 4));
  return starts.size >= 3 || `${starts.size} tronçons seulement`;
});

check('un portail posé près d’un muret s’y aligne tout seul', () => {
  const s = new Store(normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)],
    props: [{ id: 'w', kind: 'muret', x: 4, y: 10, w: 12, d: 0.24, h: 1.5 }],
  }));
  s.setTool('gate');
  placeProp(s, 'gate', [9.4, 10.9]); // dropped a good half-metre off the wall
  const g = s.model.props.find((p) => p.kind === 'gate');
  if (!g) return 'portail non créé';
  // Centred on the wall's own line, not where the pointer happened to land.
  const centre = g.y + g.d / 2;
  return near(centre, 10.12, 0.13) || `axe du portail à ${centre.toFixed(2)} au lieu de 10,12`;
});

check('un muret se trace en glissant, à la longueur voulue', () => {
  const s = new Store(emptyModel());
  placeRun(s, 'muret', [6.1, 12.2], [15.9, 12.4]);
  const w = s.model.props.find((p) => p.kind === 'muret');
  if (!w) return 'muret non créé';
  if (!near(w.w, 10, 0.3)) return `longueur ${w.w} m`;
  if (!(w.d < 0.4)) return `épaisseur ${w.d} m`;
  // A mostly-vertical drag gives a run along the other axis.
  placeRun(s, 'muret', [20, 6], [20.2, 14]);
  const v = s.model.props.filter((p) => p.kind === 'muret')[1];
  return (v.d > 7 && v.w < 0.4) || `run vertical : ${v.w} × ${v.d}`;
});

check('portail coulissant et portillon se distinguent au rendu', () => {
  const of = (style) => {
    const m = normalise({
      ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)],
      props: [{ id: 'g', kind: 'gate', x: 8, y: 10, w: 3.2, d: 0.16, h: 1.5, style }],
    });
    return buildMesh(m).mesh.tris.filter((t) => t.group === 'gate:g').length;
  };
  const swing = of('swing');
  const sliding = of('sliding');
  if (!swing) return 'portillon vide';
  return sliding > swing || 'le coulissant ne se distingue pas du battant';
});

check('les éléments linéaires sont bien déclarés comme tels', () => {
  return LINEAR_KINDS.has('muret') && LINEAR_KINDS.has('fence') && LINEAR_KINDS.has('hedge')
    && !LINEAR_KINDS.has('pool');
});

/* ---------------- ground-level stacking ---------------- */

/** Draw order of the first face of each material in a render. */
function orderOf(model, width = 700, height = 500) {
  const out = renderScene(normalise(model), { width, height });
  const at = {};
  out.faces.forEach((f, i) => { if (!(f.mat in at)) at[f.mat] = i; });
  return at;
}

check('une piscine reste visible où qu’elle soit posée sur la terrasse', () => {
  // The bug: terrace and pool are large, near-coplanar faces, so their depth
  // is driven by position on the ground rather than by the millimetres of
  // height between them. A pool at the far end of a terrace was painted over.
  const base = {
    ...emptyModel(),
    cells: [...rectCells(20, 20, 28, 26)],
    props: [{ id: 't', kind: 'terrace', x: 4, y: 4, w: 12, d: 12, material: 'paving' }],
  };
  for (const [label, x, y] of [['fond', 5, 5], ['centre', 9, 9], ['avant', 12, 12]]) {
    const m = { ...base, props: [...base.props, { id: 'p', kind: 'pool', x, y, w: 4, d: 3 }] };
    const at = orderOf(m);
    if (at.water === undefined) return `${label} : eau absente du rendu`;
    if (!(at.water > at.paving)) return `${label} : eau dessinée avant la terrasse`;
    if (!(at.poolRim > at.paving)) return `${label} : margelle dessinée avant la terrasse`;
    if (!(at.water > at.poolRim)) return `${label} : eau dessinée avant sa margelle`;
  }
  return true;
});

check('une terrasse surélevée reçoit ses joues et redevient un volume', () => {
  const flat = normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 26, 25)],
    props: [{ id: 't', kind: 'terrace', x: 6, y: 6, w: 6, d: 4, material: 'paving' }],
  });
  const raised = normalise({ ...flat, props: [{ ...flat.props[0], z: 0.6 }] });
  const zTop = (m) => buildMesh(m).mesh.tris
    .filter((t) => t.mat === 'paving')
    .reduce((acc, t) => Math.max(acc, t.a[2], t.b[2], t.c[2]), 0);
  if (!near(zTop(flat), 0.012, 1e-6)) return `à plat, dalle à ${zTop(flat)} m`;
  if (!near(zTop(raised), 0.6, 1e-6)) return `surélevée, dalle à ${zTop(raised)} m`;
  // Sides exist: some paving faces must now be vertical.
  const built = buildMesh(raised);
  const vertical = built.mesh.tris.filter((t) => t.mat === 'paving' && Math.abs(t.n[2]) < 0.01);
  if (!vertical.length) return 'aucune joue verticale';
  // And it leaves the decal tiers, or it would sink behind the house.
  const faces = mergeCoplanar(built.mesh.tris).filter((f) => f.mat === 'paving');
  return faces.every((f) => !f.group.startsWith('decal')) || 'reste traitée comme un décalque plat';
});

check('une dalle surélevée masque bien ce qui reste au sol dessous', () => {
  // Deliberate, not an oversight: at ground level the pool now always wins,
  // but once the terrace is raised the pool really is underneath it. Raising
  // the pool too is the way to bring it back, which the inspector spells out.
  const m = normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 26, 25)],
    props: [
      { id: 't', kind: 'terrace', x: 4, y: 4, w: 12, d: 12, material: 'paving', z: 0.5 },
      { id: 'p', kind: 'pool', x: 6, y: 6, w: 4, d: 3 },
    ],
  });
  const at = orderOf(m);
  if (at.water === undefined) return 'eau absente du rendu';
  if (!(at.paving > at.water)) return 'la dalle surélevée ne recouvre pas la piscine';
  // And raising the pool as well brings it back on top.
  const both = normalise({ ...m, props: m.props.map((p) => ({ ...p, z: 0.5 })) });
  const at2 = orderOf(both);
  return at2.water > at2.paving || 'piscine surélevée toujours masquée';
});

check('une piscine surélevée garde son eau au-dessus de la margelle', () => {
  const m = normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 26, 25)],
    props: [{ id: 'p', kind: 'pool', x: 6, y: 6, w: 5, d: 3, z: 0.5 }],
  });
  const at = orderOf(m);
  return (at.water !== undefined && at.poolRim !== undefined && at.water > at.poolRim)
    || 'eau masquée par la margelle';
});

/* ---------------- palettes ---------------- */

check('la palette Horizons rend ses teintes exactes sur les faces d’axe', () => {
  // The values are those of the Gladys v5 house-view gallery; drifting from
  // them is exactly what this test is for.
  // The lit tone sits on +x: at rotation 0 the east facade lands on the
  // screen left, which is the side the reference drawing lights.
  const cases = [
    ['wall', [1, 0, 0], '#efe8dc'], ['wall', [0, 1, 0], '#e0d6c6'], ['wall', [0, 0, 1], '#f8f4ed'],
    ['roof', [1, 0, 0], '#e8a37c'], ['roof', [0, 1, 0], '#c97e56'],
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
  // Bounded by the two anchors it blends: yNeg #bf7550 and up #eeb08d.
  return (between(r, 0xbf, 0xee) && between(g, 0x75, 0xb0) && between(b, 0x50, 0x8d))
    || `teinte hors bornes : ${got}`;
});

check('recolorer un matériau conserve la structure d’ombrage', () => {
  const ov = { wall: '#8fb3d9' };
  const lit = faceColour('wall', 'horizons', ov, [1, 0, 0]);
  const shaded = faceColour('wall', 'horizons', ov, [0, 1, 0]);
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
  return B(m).roof.type === 'hip' && B(m).storeys === 4 && Array.isArray(m.props) && m.version === 1;
});

check('un lien de partage refait le modèle à l’identique', () => {
  const m = normalise(defaultModel());
  const url = toShareUrl(m);
  const hash = url.slice(url.indexOf('#'));
  const saved = location.hash;
  location.hash = hash;
  const back = fromShareUrl();
  location.hash = saved;
  return (back && cellsOf(back).length === cellsOf(m).length && B(back).roof.pitch === B(m).roof.pitch)
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
  const n0 = B(s.model).storeyHeight;
  for (const v of [2.8, 2.9, 3.0]) s.patchBuilding({ storeyHeight: v }, 'h');
  s.undo();
  return near(B(s.model).storeyHeight, n0) || `revenu à ${B(s.model).storeyHeight}`;
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
  const before = cellsOf(s.model).length;
  view.svg.dispatchEvent(pointer(view, 20.5, 20.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 20.5, 20.5, 'pointerup'));
  return (cellsOf(s.model).length === before + 1 && cellsOf(s.model).includes('20,20'))
    || `cases : ${JSON.stringify(cellsOf(s.model))}`;
});

check('l’outil rectangle remplit toute la zone tracée', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('rect');
  view.svg.dispatchEvent(pointer(view, 10.2, 10.2, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 13.8, 12.8, 'pointermove'));
  view.svg.dispatchEvent(pointer(view, 13.8, 12.8, 'pointerup'));
  return cellsOf(s.model).length === 4 * 3 || `obtenu ${cellsOf(s.model).length} cases`;
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

check('glisser une fenêtre la fait coulisser le long du mur', () => {
  const s = new Store(normalise({ ...emptyModel(), cells: [...rectCells(10, 10, 14, 13)] }));
  const view = new PlanView(document.getElementById('plan'), s);
  s.setTool('window');
  view.render();
  view.svg.dispatchEvent(pointer(view, 12.5, 9.8, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 12.5, 9.8, 'pointerup'));
  const op = () => s.model.openings[0];
  if (!op() || op().edge !== '12,10,S') return `pose initiale sur ${op()?.edge}`;
  s.setTool('select');
  view.render();
  const line = view.svg.querySelector('.opening');
  if (!line) return 'ouverture absente du plan';
  line.dispatchEvent(pointer(view, 12.5, 9.9, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 14.4, 9.9, 'pointermove'));
  view.svg.dispatchEvent(pointer(view, 14.4, 9.9, 'pointerup'));
  if (op().edge !== '14,10,S') return `restée sur ${op().edge}`;
  // The old drag path wrote {x: NaN, y: NaN} onto the opening.
  return !('x' in op()) || 'des coordonnées x/y parasites ont été écrites';
});

check('le zoom à la molette garde le point sous le curseur', () => {
  const s = new Store(defaultModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  const r = view.svg.getBoundingClientRect();
  const before = view.toWorld(120, 90);
  view.svg.dispatchEvent(new WheelEvent('wheel', {
    clientX: r.left + 120, clientY: r.top + 90, deltaY: -120, bubbles: true, cancelable: true,
  }));
  const after = view.toWorld(120, 90);
  return (near(before[0], after[0], 0.05) && near(before[1], after[1], 0.05))
    || `le point a dérivé de (${(after[0] - before[0]).toFixed(2)}, ${(after[1] - before[1]).toFixed(2)})`;
});

check('le pincement à deux doigts zoome le plan', () => {
  const s = new Store(defaultModel());
  const view = new PlanView(document.getElementById('plan'), s);
  s.setTool('select');
  view.render();
  const r = view.svg.getBoundingClientRect();
  const pev = (id, x, y, type) => new PointerEvent(type, {
    pointerId: id, clientX: r.left + x, clientY: r.top + y,
    bubbles: true, isPrimary: id === 1, button: 0,
  });
  view.svg.dispatchEvent(pev(1, 100, 100, 'pointerdown'));
  view.svg.dispatchEvent(pev(2, 200, 100, 'pointerdown'));
  view.svg.dispatchEvent(pev(2, 260, 100, 'pointermove'));
  const zoomed = view.zoom > 1.2;
  view.svg.dispatchEvent(pev(1, 100, 100, 'pointerup'));
  view.svg.dispatchEvent(pev(2, 260, 100, 'pointerup'));
  return zoomed || `zoom resté à ${view.zoom.toFixed(2)}`;
});

check('dupliquer la sélection crée une copie décalée', () => {
  const s = new Store(defaultModel());
  const first = s.model.props[0];
  const count = s.model.props.length;
  s.select({ type: 'prop', id: first.id });
  s.duplicateSelected();
  if (s.model.props.length !== count + 1) return 'aucune copie créée';
  const copy = s.selected;
  return (copy && copy.id !== first.id && copy.kind === first.kind && near(copy.x, first.x + 1.5))
    || 'copie mal positionnée';
});

check('un extérieur peut se poser directement sur le rendu', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  s.setTool('tree');
  const before = s.model.props.length;
  const r = div.getBoundingClientRect();
  div.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    bubbles: true, pointerId: 9, isPrimary: true, button: 0,
  }));
  div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
  return s.model.props.length === before + 1 || 'aucun arbre posé';
});

/** A viewport in the test stage, with its hit layer drawn. */
function stageViewport() {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  return { s, div, vp };
}

/** Press, move, release — on `target`, so the pick layer is exercised. */
function dragOn(target, div, id, dx, dy = 0) {
  const r = div.getBoundingClientRect();
  const at = (ox, type) => target.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + 120 + ox, clientY: r.top + 140 + (ox ? dy : 0),
    bubbles: true, pointerId: id, isPrimary: true, button: 0,
  }));
  at(0, 'pointerdown'); at(dx, 'pointermove'); at(dx, 'pointerup');
}

check('glisser sur la maison elle-même la fait tourner', () => {
  // Reported in use: both modes appeared to do the same thing, because both
  // did nothing. Grabbing the house — the obvious way to turn it — was read
  // as a selection and stopped there; only the background navigated.
  const { s, div, vp } = stageViewport();
  const target = div.querySelector('.hit-layer [data-pick]');
  if (!target) return 'aucune cible de sélection dans le rendu';
  const yaw0 = s.model.camera.yaw;
  dragOn(target, div, 61, 70);
  if (s.model.camera.yaw === yaw0) return 'la maison n’a pas tourné';
  // Twice in a row: each press starts from the camera as it stands, and a
  // gesture that only works once is worse than one that never works.
  const yaw1 = s.model.camera.yaw;
  dragOn(target, div, 611, -40);
  if (s.model.camera.yaw === yaw1) return 'le deuxième glisser n’a rien fait';
  // And the same grab in the other mode slides the picture instead.
  vp.setDragMode('pan');
  const yaw2 = s.model.camera.yaw;
  const pan0 = vp.pan[0];
  dragOn(target, div, 62, 70);
  if (s.model.camera.yaw !== yaw2) return 'le mode déplacement a fait tourner';
  return vp.pan[0] !== pan0 || 'le mode déplacement n’a rien déplacé';
});

check('un clic sans mouvement sélectionne toujours', () => {
  // The other half of the bargain: the press only becomes a gesture once the
  // pointer has actually travelled.
  const { s, div } = stageViewport();
  const target = div.querySelector('.hit-layer [data-pick="prop"]');
  if (!target) return 'aucun extérieur à sélectionner';
  const yaw0 = s.model.camera.yaw;
  dragOn(target, div, 63, 2);
  if (s.model.camera.yaw !== yaw0) return 'un simple clic a fait tourner la maison';
  return (s.selection?.type === 'prop' && s.selection.id === target.dataset.id)
    || `sélection : ${JSON.stringify(s.selection)}`;
});

check('cliquer un mur dans le rendu choisit son corps', () => {
  const { s, div } = stageViewport();
  const target = div.querySelector('.hit-layer [data-pick="wall"]');
  if (!target) return 'aucun mur dans la couche de sélection';
  dragOn(target, div, 64, 1);
  if (s.selection?.type !== 'building') return `sélection : ${JSON.stringify(s.selection)}`;
  return s.activeBuildingId === target.dataset.building || 'le corps actif n’a pas suivi';
});

check('un clic dans le vide désélectionne', () => {
  const { s, div } = stageViewport();
  const prop = div.querySelector('.hit-layer [data-pick="prop"]');
  dragOn(prop, div, 65, 1);
  if (!s.selection) return 'rien n’a été sélectionné au départ';
  dragOn(div, div, 66, 1);
  return s.selection === null || `sélection restante : ${JSON.stringify(s.selection)}`;
});

check('le pavé de navigation tourne, incline et zoome', () => {
  // The gestures already did all of this; what the buttons add is that anyone
  // can find it. They drive the same code, so this checks the code they drive.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  const c0 = { ...s.model.camera };
  vp.nudge(15, 0);
  if (s.model.camera.yaw !== normaliseYaw(c0.yaw + 15)) return `lacet ${s.model.camera.yaw}`;
  vp.nudge(0, 6);
  if (!near(s.model.camera.pitch, c0.pitch + 6, 1e-9)) return `hauteur ${s.model.camera.pitch}`;
  const z0 = vp.zoom;
  vp.zoomBy(1.25);
  if (!(vp.zoom > z0)) return 'le zoom n’a pas bougé';
  vp.resetView();
  return vp.zoom === 1 || 'recadrer n’a pas remis le zoom à 1';
});

check('le mode « déplacer » échange ce que font glisser et Maj + glisser', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const drag = (id, shift) => {
    const at = (dx, type) => div.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2,
      bubbles: true, pointerId: id, isPrimary: true, button: 0, shiftKey: shift,
    }));
    at(0, 'pointerdown'); at(50, 'pointermove'); at(50, 'pointerup');
  };
  vp.setDragMode('pan');
  const yaw0 = s.model.camera.yaw;
  const pan0 = vp.pan[0];
  drag(21, false);
  if (s.model.camera.yaw !== yaw0) return 'un glisser simple a fait pivoter en mode déplacement';
  if (vp.pan[0] === pan0) return 'un glisser simple n’a pas déplacé la vue';
  drag(22, true);
  if (s.model.camera.yaw === yaw0) return 'Maj + glisser n’a pas fait pivoter';
  vp.setDragMode('orbit');
  return true;
});

check('Alt + glisser incline l’image', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const at = (dx, type) => div.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2,
    bubbles: true, pointerId: 31, isPrimary: true, button: 0, altKey: true,
  }));
  const yaw0 = s.model.camera.yaw;
  at(0, 'pointerdown'); at(60, 'pointermove'); at(60, 'pointerup');
  if (s.model.camera.roll === 0) return 'l’inclinaison n’a pas bougé';
  return s.model.camera.yaw === yaw0 || 'incliner a aussi fait pivoter';
});

check('l’inclinaison tourne le dessin sans toucher au tri des faces', () => {
  // The third rotation happens after the projection, so it can change where
  // things land on screen but never which of them is in front.
  const m = normalise(defaultModel());
  const flat = renderScene(m, { width: 400, height: 300 });
  const tilted = renderScene({ ...m, camera: { ...m.camera, roll: 22 } },
    { width: 400, height: 300 });
  const order = (o) => o.faces.map((f) => `${f.mat}|${f.group}`).join(',');
  if (order(flat) !== order(tilted)) return 'l’ordre des faces a changé';
  if (flat.svg === tilted.svg) return 'le dessin n’a pas tourné';
  // And zero must be exactly the identity, not merely close to it.
  const zero = renderScene({ ...m, camera: { ...m.camera, roll: 0 } },
    { width: 400, height: 300 });
  return zero.svg.replace(/t\d+/g, 't') === flat.svg.replace(/t\d+/g, 't')
    || 'une inclinaison nulle modifie le rendu';
});

check('écran → sol tient compte de l’inclinaison', () => {
  // Dropping a tree onto a tilted render has to land where it was aimed.
  for (const roll of [ROLL_RANGE[0], -17, 0, 23, ROLL_RANGE[1]]) {
    const cam = new Camera({ yaw: 47, pitch: 28, roll, centre: [10, 10] });
    cam.scale = 24;
    cam.offset = [300, 200];
    const p = cam.toScreen([13, 7, 0]);
    const g = screenToGround(cam, p[0], p[1]);
    if (!near(g[0], 13, 1e-6) || !near(g[1], 7, 1e-6)) return `inclinaison ${roll}° → ${g}`;
  }
  return true;
});

check('glisser sur le rendu fait pivoter la maison', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const at = (dx, dy, type, extra = {}) => div.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy,
    bubbles: true, pointerId: 11, isPrimary: true, button: 0, ...extra,
  }));
  const yaw0 = s.model.camera.yaw, pitch0 = s.model.camera.pitch;
  at(0, 0, 'pointerdown');
  at(60, -30, 'pointermove');
  at(60, -30, 'pointerup');
  const c = s.model.camera;
  if (c.yaw === yaw0) return 'le lacet n’a pas bougé';
  if (c.pitch <= pitch0) return 'monter la souris n’a pas levé la caméra';
  // One gesture, one undo step — not sixty.
  s.undo();
  return (s.model.camera.yaw === yaw0) || `annuler laisse le lacet à ${s.model.camera.yaw}`;
});

check('avec Maj, glisser déplace la vue sans la faire pivoter', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const at = (dx, type) => div.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2,
    bubbles: true, pointerId: 12, isPrimary: true, button: 0, shiftKey: true,
  }));
  const yaw0 = s.model.camera.yaw;
  at(0, 'pointerdown');
  at(50, 'pointermove');
  at(50, 'pointerup');
  if (s.model.camera.yaw !== yaw0) return 'la vue a pivoté malgré Maj';
  return vp.pan[0] !== 0 || 'la vue ne s’est pas déplacée';
});

check('pivoter ne reconstruit pas le maillage', () => {
  // The cache that makes the orbit usable: a new camera on a new model object
  // must not rebuild the house. Sixty times a second, it would be unusable.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  const built = vp.cache.built;
  s.update((m) => ({ ...m, camera: { ...m.camera, yaw: 33, pitch: 28 } }));
  vp.render();
  if (vp.cache.built !== built) return 'le maillage a été reconstruit';
  // But moving a wall must.
  s.update((m) => ({
    ...m,
    buildings: m.buildings.map((b, i) => (i ? b : { ...b, cells: [...b.cells, '99,99'] })),
  }));
  vp.render();
  return vp.cache.built !== built || 'le maillage n’a pas suivi la modification';
});

check('un panneau replié le reste après une modification du modèle', () => {
  // The inspector is rebuilt from scratch on every change. If the fold state
  // lived in the DOM it would spring open under the hand at the first drag of
  // a slider, which is why it is held on the inspector instead.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  insp.render();
  const first = div.querySelector('details.panel');
  if (!first) return 'aucun panneau repliable';
  if (!first.open) return 'le premier panneau devrait s’ouvrir par défaut';
  first.open = false;
  first.dispatchEvent(new Event('toggle'));
  s.update((m) => ({ ...m, name: 'Autre' }));
  insp.render();
  const again = div.querySelector('details.panel');
  if (again.open) return 'le panneau s’est rouvert tout seul';
  // And the other way round: unfolding something closed by default must stick.
  const shut = [...div.querySelectorAll('details.panel')].find((d) => !d.open && d !== again);
  if (!shut) return 'tous les panneaux sont ouverts';
  const title = shut.querySelector('.panel-name').textContent;
  shut.open = true;
  shut.dispatchEvent(new Event('toggle'));
  s.update((m) => ({ ...m, name: 'Encore' }));
  insp.render();
  const back = [...div.querySelectorAll('details.panel')]
    .find((d) => d.querySelector('.panel-name').textContent === title);
  return back?.open || `« ${title} » s’est refermé`;
});

check('un panneau replié dit ce qu’il contient', () => {
  // A closed section that shows only its title forces everything open to be
  // read, which defeats the folding.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const shut = [...div.querySelectorAll('details.panel')].filter((d) => !d.open);
  if (!shut.length) return 'aucun panneau replié par défaut';
  const mute = shut.filter((d) => !d.querySelector('.panel-badge')?.textContent.trim());
  return mute.length === 0
    || `${mute.length} panneau(x) replié(s) sans indication : `
      + mute.map((d) => d.querySelector('.panel-name').textContent).join(', ');
});

check('les réglages sont rangés en familles', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const groups = [...div.querySelectorAll('.panel-group')].map((g) => g.textContent);
  const want = ['Sélection', 'Bâtiment', 'Projet', 'Vue et export'];
  return want.every((w) => groups.includes(w)) || `familles trouvées : ${groups.join(', ')}`;
});

check('la position d’une ouverture se compte depuis l’angle du mur', () => {
  // A user's report: "0 should intuitively be the corner where the wall
  // begins. But it isn't." It was the start of a one-cell boundary edge, and
  // his own file has a window at -0.75 because that is what it took to move
  // one a little to the left.
  //
  // Body 6 cells wide, so its south wall runs from x = 0 to x = 6. The opening
  // is anchored to the edge at i = 4, four metres along — the case where an
  // edge-relative offset and a wall-relative one differ most visibly.
  const s = new Store(normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 3)] })],
    openings: [{ id: 'o1', edge: '4,0,S', kind: 'window', storey: 0,
      offset: 0.5, width: 1.2, height: 1.15, sill: 1 }] }));
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  s.select({ type: 'opening', id: 'o1' });
  insp.render();
  const row = [...div.querySelectorAll('label.field')]
    .find((r) => r.querySelector('.field-label').textContent === 'Position');
  if (!row) return 'pas de champ Position';
  const input = row.querySelector('input[type="range"]');
  if (Number(input.min) !== 0) return `le minimum est ${input.min}, pas 0`;
  // The wall is 6 m long and the window 1.20 m, so it can slide 4.80 m.
  if (Math.abs(Number(input.max) - 4.8) > 1e-9) return `course de ${input.max} m au lieu de 4,80`;
  const edgeOffset = () => s.model.openings[0].offset;
  // At 0 the window's near edge sits on the corner: on edge '4,0,S' the wall
  // starts 4 m back, so the centre lands at -4 + 0.60.
  input.value = '0';
  input.dispatchEvent(new Event('input'));
  if (Math.abs(edgeOffset() - (-3.4)) > 1e-9) return `position 0 donne ${edgeOffset()} au lieu de -3,4`;
  // And at the far end it stops flush with the other corner.
  input.value = String(4.8);
  input.dispatchEvent(new Event('input'));
  return Math.abs(edgeOffset() - 1.4) < 1e-9
    || `position 4,80 donne ${edgeOffset()} au lieu de 1,4`;
});

check('une terrasse se dimensionne en quarts de mètre ronds', () => {
  // A slider offers min + k x step and nothing else, so a minimum off the grid
  // takes every round size with it. At 0.40 wide by 0.20 deep a terrace could
  // be 3.15 by 3.95 but never 3 by 4 — reported by a user who could not line
  // his up with the wall it runs along.
  const s = new Store(normalise({ ...emptyModel(),
    props: [{ id: 'p1', kind: 'terrace', x: 2, y: 2, w: 6, d: 4, material: 'paving', z: 0 }] }));
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  s.select({ type: 'prop', id: 'p1' });
  insp.render();
  const rows = [...div.querySelectorAll('label.field')]
    .filter((r) => ['Largeur', 'Profondeur'].includes(r.querySelector('.field-label').textContent));
  if (rows.length !== 2) return `${rows.length} curseurs de taille au lieu de 2`;
  for (const row of rows) {
    const input = row.querySelector('input[type="range"]');
    const min = Number(input.min), step = Number(input.step);
    for (const want of [1, 3, 4, 6]) {
      const k = (want - min) / step;
      if (Math.abs(k - Math.round(k)) > 1e-9) {
        return `${row.querySelector('.field-label').textContent} : ${want} m hors trame (min ${min}, pas ${step})`;
      }
    }
  }
  return true;
});

check('un curseur en cours de réglage survit au rafraîchissement', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  insp.render();
  const input = div.querySelector('input[type="range"]');
  input.focus();
  // If the environment refuses focus, the guard cannot be exercised here.
  if (document.activeElement !== input) return true;
  insp.render();
  return div.contains(input) || 'le curseur a été détruit pendant son réglage';
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

/* ---------------- night ---------------- */

check('la nuit assombrit et désature, sans toucher aux fenêtres', () => {
  const lum = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const sat = (hex) => { const [r, g, b] = hexToRgb(hex); return rgbToHsl(r, g, b)[1]; };
  for (const day of ['#e9c98d', '#c8663c', '#eceff1', '#5fa855']) {
    const n = nightColour('wall', day);
    if (lum(n) >= lum(day) * 0.6) return `${day} → ${n} : à peine assombri`;
    if (sat(n) > sat(day) + 0.02) return `${day} → ${n} : plus saturé qu'en plein jour`;
  }
  // A lawn goes darker still: nothing lights it, whereas a wall catches the
  // moon. Graded alike, the lawn came out brighter than the house on it.
  if (lum(nightColour('grass', '#9ccb7a')) >= lum(nightColour('wall', '#9ccb7a'))) {
    return 'le terrain n’est pas plus sombre que les murs';
  }
  // Windows are the whole point: they say whether the house is awake.
  const glass = nightColour('glass', '#bfe3f2');
  if (glass !== NIGHT.lit.glass) return 'les fenêtres ne sont pas allumées';
  return lum(glass) > 150 || 'les fenêtres allumées sont trop sombres';
});

check('la nuit s’applique aussi aux matériaux d’un corps donné', () => {
  // Per-building materials carry a suffix; the grade has to see through it.
  return nightColour('wall#b3', '#e9c98d') === nightColour('wall', '#e9c98d')
    || 'le suffixe de corps échappe au traitement de nuit';
});

check('le ciel étoilé est identique d’un rendu à l’autre', () => {
  // Same reason as the roof tiles: the export has to match the preview, and
  // re-exporting tomorrow has to give the same image.
  const m = normalise({ ...defaultModel(), style: { ...defaultModel().style, night: true } });
  const a = renderScene(m, { width: 400, height: 300 }).svg;
  const b = renderScene(m, { width: 400, height: 300 }).svg;
  if (a.replace(/id="t\d+/g, '').replace(/#t\d+/g, '') !== b.replace(/id="t\d+/g, '').replace(/#t\d+/g, '')) {
    return 'deux rendus successifs diffèrent';
  }
  return (a.match(/<circle/g) || []).length > 30 || 'aucune étoile';
});

check('les étoiles s’arrêtent avant le bas de l’image', () => {
  // Reported in use: a starfield under the garden reads as a house floating in
  // space. The plot is finite, so there is sky all round it — but only what is
  // overhead should be starry.
  const m = normalise({ ...defaultModel(), style: { ...defaultModel().style, night: true } });
  const svg = renderScene(m, { width: 400, height: 400 }).svg;
  let low = 0, high = 0;
  for (const [, cy] of [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r=/g)].map((x) => x)) {
    (Number(cy) > 340 ? () => { low++; } : () => { high++; })();
  }
  if (!high) return 'aucune étoile';
  return low === 0 || `${low} étoiles dans le dernier dixième de l’image`;
});

check('sous cadrage, la nuit garde son ciel', () => {
  // The daytime frame is backed by a plain fill of the ground colour, to stop
  // a tight crop showing a wedge of nothing. At night that fill hid the sky
  // entirely. Worth stating why they cannot both apply: an unbounded ground
  // plane projects over the whole image in axonometry, so a sky exists only
  // because the plot is finite.
  const base = defaultModel();
  const focus = { enabled: true, x: 12, y: 12, w: 8, d: 6, margin: 1, hide: true };
  const day = renderScene(normalise({ ...base, focus }), { width: 300, height: 220 }).svg;
  const dark = renderScene(normalise({
    ...base, focus, style: { ...base.style, night: true },
  }), { width: 300, height: 220 }).svg;
  if (!/linearGradient/.test(dark)) return 'pas de ciel sous cadrage';
  // Exactly one full-frame rectangle at night — the sky — and none by day,
  // where the ground is a pad and everything round it stays transparent.
  const rects = (svg) => (svg.match(/<rect width="300" height="220"/g) || []).length;
  if (rects(dark) !== 1) return `${rects(dark)} fonds pleins de nuit`;
  return rects(day) === 0 || `${rects(day)} fonds pleins de jour`;
});

await checkAsync('une vue de nuit a un ciel, même en fond transparent', async () => {
  // The one setting this mode overrides, and on purpose: a transparent picture
  // of a dark house is not a night view. Checked on pixels — the sky is a
  // gradient, and gradients are the part of SVG worth distrusting on export.
  const W = 160, H = 120;
  const base = defaultModel();
  const m = normalise({ ...base, style: { ...base.style, background: 'transparent', night: true } });
  const blob = await svgToPng(svgFor(m, { width: W, height: H, ratio: 1 }), W, H);
  const img = await loadBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const top = ctx.getImageData(W - 4, 2, 1, 1).data;
  const horizon = ctx.getImageData(W - 4, Math.round(H * 0.46), 1, 1).data;
  const bottom = ctx.getImageData(W - 4, H - 3, 1, 1).data;
  if (top[3] !== 255 || bottom[3] !== 255) return `ciel absent (alpha ${top[3]}, ${bottom[3]})`;
  if (top[2] <= top[0]) return 'le ciel n’est pas bleu';
  // Three stops: dark at the zenith, lighter at the horizon, dark again below.
  // Sampling only the two ends would now compare two near-identical darks and
  // pass whether or not the gradient survived — which is how the first version
  // of this check would have missed it.
  if (horizon[2] <= top[2] + 6) return 'le dégradé du ciel n’a pas survécu';
  return horizon[2] > bottom[2] + 6 || 'le ciel ne s’assombrit pas sous l’horizon';
});

/* ---------------- occlusion ---------------- */

/**
 * Faces drawn over something nearer than themselves.
 *
 * For each sampled pixel, work out where the view ray meets the *plane* of
 * every face covering it. The one that should be visible is the one whose
 * intersection is nearest; if the renderer drew another last, that is an
 * occlusion error and not a matter of taste. Reporting it in metres of
 * overshoot is what separates a real inversion from a tie along a shared edge.
 */
const STACKED = new Set(['solar', 'solarFrame', 'solarCell']);

function occlusionErrors(model, W, H, step = 3) {
  const out = renderScene(model, { width: W, height: H });
  const cam = out.camera, proj = cam.proj, L = cam.lambda;
  const faces = out.faces.map((f, i) => {
    const v = cam.toView(f.centroid);
    const n = f.nCam;
    return {
      i, f, n,
      loops: f.loops.map((l) => l.map((p) => cam.toScreen(p))),
      d: n[0] * v[0] + n[1] * v[1] + n[2] * v[2],
    };
  });
  const covers = (F, x, y) => {
    let c = false;
    for (const l of F.loops) {
      for (let a = 0, b = l.length - 1; a < l.length; b = a++) {
        if ((l[a][1] > y) !== (l[b][1] > y)
          && x < ((l[b][0] - l[a][0]) * (y - l[a][1])) / (l[b][1] - l[a][1]) + l[a][0]) c = !c;
      }
    }
    return c;
  };
  const depthAt = (F, x, y) => {
    const sx = (x - cam.offset[0]) / cam.scale;
    const sy = (y - cam.offset[1]) / cam.scale;
    const u = sx / proj.kx;
    const k = (F.n[0] + F.n[1] + L * F.n[2]) / L;
    if (Math.abs(k) < 1e-9) return null;
    const qz = (F.d - (u * (F.n[1] - F.n[0])) / 2 - (sy * (F.n[0] + F.n[1])) / (2 * proj.ky)) / k;
    return (sy + qz * proj.kz) / proj.ky + L * qz;
  };
  const bad = new Map();
  for (let y = 2; y < H; y += step) {
    for (let x = 2; x < W; x += step) {
      let top = null, best = null;
      for (const F of faces) {
        if (!covers(F, x, y)) continue;
        if (!top || F.i > top.i) top = F;
        const dp = depthAt(F, x, y);
        if (dp !== null && (!best || dp > best.dp)) best = { F, dp };
      }
      if (!top || !best || best.F === top) continue;
      const dTop = depthAt(top, x, y);
      if (dTop === null || best.dp - dTop < 0.03) continue;
      // A solar array is three deliberately stacked decals a centimetre apart:
      // backing, cells, then the grid lines. Their order is set by insertion,
      // not by depth, and a plane test on faces that nearly coincide answers a
      // question nobody asked. Everything else is fair game.
      if (STACKED.has(best.F.f.group) && STACKED.has(top.f.group)) continue;
      const key = `${best.F.f.group} masqué par ${top.f.group}`;
      // How deep the inversion runs matters as much as how wide: a pixel at a
      // shared silhouette edge overshoots by centimetres, a panel seen through
      // a roof by metres. Reporting only the count cannot tell them apart.
      const e = bad.get(key) || { n: 0, gap: 0 };
      e.n++;
      e.gap = Math.max(e.gap, best.dp - dTop);
      bad.set(key, e);
    }
  }
  return bad;
}

check('un panneau solaire ne traverse jamais le toit', () => {
  // Reported in use: from some angles the panels on the far slope showed
  // through the near one. An item resting on a surface was anchored to
  // whichever surface covered it on screen, nearest first — which, for a panel
  // beyond the ridge, is the slope that ought to hide it.
  const cells = [...rectCells(0, 0, 15, 8), ...rectCells(0, 9, 8, 12)];
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({
      cells,
      roof: { type: 'hip', pitch: 30, overhang: 0.5, fascia: 0.16, shedDir: 'S' },
    })],
    // Near the crease of the L, where two slopes meet — the placement that
    // put a panel on one slope and a covering surface on the other.
    roofItems: [
      { id: 'p1', kind: 'solar', x: 5, y: 6.5, w: 4, d: 2.4 },
      { id: 'p2', kind: 'solar', x: 9, y: 8.5, w: 4, d: 2.4 },
      { id: 'p3', kind: 'solar', x: 3, y: 10, w: 3, d: 2 },
    ],
  });
  for (const pitch of [10, 16, 24, 35]) {
    for (const yaw of [0, 75, 90, 105, 135, 225, 255, 270]) {
      const bad = occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4);
      for (const [k, e] of bad) {
        // Half a metre: deep enough that it cannot be an edge, shallow enough
        // that the fault this guards — metres of roof — cannot slip under it.
        if (/^roof.* masqué par solar/.test(k) && e.gap > 0.5) {
          return `${yaw}°/${pitch}° : ${e.n} px, ${e.gap.toFixed(1)} m — ${k}`;
        }
      }
    }
  }
  return true;
});

check('un renfoncement ne crée pas de recouvrement grossier', () => {
  // Both shapes: the niche exactly the size of the opening, and the porch a
  // user asked for, wider and taller than the door standing in it.
  const mk = (extra) => normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5,
      width: 1.7, height: 2.15, sill: 0, depth: 0.6, ...extra }] });
  for (const extra of [{}, { sides: 0.8 }, { head: 0.3 }, { sides: 0.8, head: 0.3 }]) {
    const m = mk(extra);
    for (const yaw of [180, 210, 250, 275, 300, 0]) {
      for (const [k, e] of occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch: 24 } }, 260, 200, 4)) {
        if (e.gap > 0.5 && e.n > 2) {
          return `${JSON.stringify(extra)} ${yaw}° : ${e.n} px, ${e.gap.toFixed(1)} m — ${k}`;
        }
      }
    }
  }
  return true;
});

check('une terrasse surélevée reste du bon côté des murs', () => {
  // Reported by a user, on his own house: a terrace at storey height was drawn
  // behind the wall it stands against at nineteen of thirty-six orientations,
  // by up to twelve metres. Two faults, one on top of the other. A raised slab
  // never entered the exact ordering pass, and a horizontal slab and a vertical
  // wall are separated by neither one's plane, so nothing could have ordered
  // them there either. And four coplanar terraces of the same material merged
  // into a single face wrapping around the house, for which no draw order is
  // right at all.
  //
  // His arrangement, reduced: terraces on three sides of the body, meeting at
  // its corners, at the height of the first floor.
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(11, 20, 20, 27)], storeys: 3,
      storeyHeights: [2.5, 2.5, 1],
      roof: { type: 'gable', pitch: 40, overhang: 0.5, fascia: 0.18, shedDir: 'S' } })],
    props: [
      { id: 'pa', kind: 'terrace', x: 11, y: 18, w: 6.5, d: 2, material: 'paving', z: 2.5 },
      { id: 'pb', kind: 'terrace', x: 9, y: 18, w: 2, d: 10, material: 'paving', z: 2.5 },
      { id: 'pc', kind: 'terrace', x: 9, y: 28, w: 13, d: 2, material: 'paving', z: 2.5 },
      { id: 'pd', kind: 'terrace', x: 21, y: 22, w: 1, d: 6, material: 'paving', z: 2.5 },
      // And the steps down from it, which are solids of the same family.
      { id: 'pe', kind: 'stairs', x: 9, y: 16, w: 1.5, d: 2, h: 2.5, dir: 'N', material: 'paving' },
    ] });
  for (let yaw = 0; yaw < 360; yaw += 30) {
    for (const pitch of [13, 30, 60]) {
      for (const [k, e] of occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4)) {
        if (/^(slab|stairs)/.test(k) && e.gap > 0.5 && e.n > 2) {
          return `${yaw}°/${pitch}° : ${e.n} px, ${e.gap.toFixed(1)} m — ${k}`;
        }
      }
    }
  }
  return true;
});

check('un mur ne passe jamais devant le toit qui le couvre', () => {
  // What the free camera exposed, twice over. Sorting faces on their centres
  // held at one fixed angle and stopped holding once the angle was free: a roof
  // slope tilts away, so its centre sits behind its eave while the wall below
  // has its centre on its own plane, and the wall painted over the overhang.
  // Swept on both axes, because the first version of this check swept the
  // camera height alone and passed while the fault was plainly visible at 8°
  // from the orientations the user actually uses.
  for (const id of ['provence', 'chalet']) {
    const m = normalise({ ...PRESETS.find((p) => p.id === id).model });
    for (const pitch of [8, 14, 24, 40]) {
      for (const yaw of [0, 67, 146, 220, 310]) {
        const bad = occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4);
        for (const [k, e] of bad) {
          if (/^roof.* masqué par wall/.test(k)) {
            return `${id} ${yaw}°/${pitch}° : ${e.n} px — ${k}`;
          }
        }
      }
    }
  }
  return true;
});

check('aucun recouvrement grossier, à tout angle de caméra', () => {
  // A budget rather than zero: a few pixels still invert along shared
  // silhouette edges — a chimney against its own roof, the frame of a solar
  // panel against its cells. Those predate the free camera. The budget exists
  // to catch the next one that is not of that kind.
  let worst = 0, name = '';
  for (const id of ['provence', 'chalet', 'pavillon']) {
    const m = normalise({ ...PRESETS.find((p) => p.id === id).model });
    for (const pitch of [8, 20, 40]) {
      for (const yaw of [0, 45, 146, 220, 310]) {
        for (const [k, e] of occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4)) {
          if (e.n > worst) { worst = e.n; name = `${id} ${k} (${yaw}°/${pitch}°)`; }
        }
      }
    }
  }
  return worst <= 20 || `${worst} px : ${name}`;
});

/* ---------------- framing ---------------- */

check('un ancien fichier retrouve sa vue : rotation 2 devient 180°', () => {
  // Share links already in circulation carry `rotation`. They must open on the
  // same view they were saved from, not silently swing round to the front.
  const m = normalise({ ...emptyModel(), camera: { rotation: 2, projection: 'iso30' } });
  if (m.camera.yaw !== 180) return `lacet ${m.camera.yaw}`;
  if (m.camera.rotation !== undefined) return 'le champ hérité subsiste';
  return near(m.camera.pitch, DEFAULT_PITCH) || `hauteur ${m.camera.pitch}`;
});

check('sans cadrage, le modèle traverse le filtre intact', () => {
  // Identity, not just equality: the viewport compares by reference to decide
  // whether its built mesh is still good.
  const m = normalise(defaultModel());
  return focusModel(m) === m || 'le modèle a été recopié sans raison';
});

check('le cadrage retire ce qui est hors zone et coupe ce qui la traverse', () => {
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [
      { id: 'p1', kind: 'tree', x: 40, y: 40, r: 1.5 },      // far away
      { id: 'p2', kind: 'hedge', x: 3, y: -2, w: 12, d: 0.6 }, // starts inside, runs out
      { id: 'p3', kind: 'bush', x: 2, y: 2, r: 1 },           // inside
    ],
    focus: { enabled: true, hide: true, x: 0, y: -3, w: 8, d: 8, margin: 1 },
  });
  const out = focusModel(m);
  const kinds = out.props.map((p) => p.kind).sort().join(',');
  if (kinds !== 'bush,hedge') return `restants : ${kinds || 'aucun'}`;
  // Cut at the frame, not kept whole. The ground is a pad with transparency
  // around it, so a hedge kept whole runs off the pad and ends in mid-air —
  // and widening the pad to meet it turns the export back into a green tile.
  const hedge = out.props.find((p) => p.kind === 'hedge');
  if (hedge.w >= 12) return `la haie n’a pas été coupée (${hedge.w} m)`;
  if (hedge.x < 0 - 1e-9) return `la haie déborde encore du cadre (x = ${hedge.x})`;
  // A compact object is not cut: half a tree is not a smaller tree.
  const bush = out.props.find((p) => p.kind === 'bush');
  return bush.r === 1 || 'le buisson a été rogné';
});

check('le cadrage emporte les ouvertures du corps qu’il retire', () => {
  const m = normalise({
    ...emptyModel(),
    buildings: [
      makeBuilding({ id: 'b1', cells: [...rectCells(0, 0, 4, 4)] }),
      makeBuilding({ id: 'b2', cells: [...rectCells(30, 30, 33, 33)] }),
    ],
    openings: [
      { id: 'o1', edge: '0,0,S', kind: 'door', offset: 0.5 },
      { id: 'o2', edge: '30,30,S', kind: 'door', offset: 0.5 },
    ],
    focus: { enabled: true, hide: true, x: -1, y: -1, w: 8, d: 8, margin: 1 },
  });
  const out = focusModel(m);
  if (out.buildings.length !== 1) return `${out.buildings.length} corps restants`;
  return out.openings.map((o) => o.id).join(',') === 'o1' || 'porte orpheline conservée';
});

check('le dessin est centré dans l’image, cadré ou non', () => {
  // Reported in use: the export sat low and to the right, with white above it.
  // The camera was fitted on the zone's eight corners — its ground rectangle
  // and that rectangle raised to the height of the tallest thing in it. Most
  // of that box was imaginary: a corner six metres over an empty patch of lawn
  // projects above anything actually there, and the camera made room for it.
  const base = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    props: [{ id: 'm', kind: 'muret', x: -2, y: 8, w: 16, d: 0.24, h: 1.5 }],
    ground: { enabled: true, material: 'grass', margin: 1 },
  });
  const W = 600, H = 420;
  const offset = (patch) => {
    const out = renderScene({ ...base, ...patch }, { width: W, height: H });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of out.faces) {
      for (const l of f.loops) {
        for (const p of l) {
          const s2 = out.camera.toScreen(p);
          x0 = Math.min(x0, s2[0]); x1 = Math.max(x1, s2[0]);
          y0 = Math.min(y0, s2[1]); y1 = Math.max(y1, s2[1]);
        }
      }
    }
    return [(x0 + x1) / 2 - W / 2, (y0 + y1) / 2 - H / 2];
  };
  const cases = [
    ['sans cadrage', {}],
    ['cadré serré', { focus: { enabled: true, x: 2, y: 7, w: 6, d: 3, margin: 1 } }],
    ['cadré large', { focus: { enabled: true, x: -1, y: -1, w: 12, d: 12, margin: 4 } }],
  ];
  for (const [label, patch] of cases) {
    const [dx, dy] = offset(patch);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return `${label} : décalé de ${Math.round(dx)}, ${Math.round(dy)} px`;
    }
  }
  return true;
});

check('la marge du cadrage laisse de l’air autour du dessin', () => {
  // It is padding, not geometry: it must shrink the drawing, not shift it.
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    ground: { enabled: true, material: 'grass', margin: 0 },
  });
  const width = (margin) => {
    const out = renderScene({
      ...m, focus: { enabled: true, x: -1, y: -1, w: 12, d: 9, margin },
    }, { width: 600, height: 420 });
    let x0 = Infinity, x1 = -Infinity;
    for (const f of out.faces) {
      for (const l of f.loops) for (const p of l) {
        const s2 = out.camera.toScreen(p)[0];
        x0 = Math.min(x0, s2); x1 = Math.max(x1, s2);
      }
    }
    return x1 - x0;
  };
  const tight = width(0.5), airy = width(6);
  return airy < tight * 0.8 || `${Math.round(tight)} px puis ${Math.round(airy)} px`;
});

check('cadrer sur une zone agrandit vraiment ce qu’elle contient', () => {
  // The whole point: the gate has to end up bigger on the image than it was.
  const base = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [{ id: 'p1', kind: 'tree', x: 40, y: 40, r: 1.5 }],
  });
  const framed = normalise({
    ...base,
    focus: { enabled: true, x: 0, y: 0, w: 6, d: 5, margin: 1, hide: true },
  });
  const a = renderScene(base, { width: 400, height: 300 });
  const b = renderScene(framed, { width: 400, height: 300 });
  if (!(b.camera.scale > a.camera.scale * 1.5)) {
    return `échelle ${a.camera.scale.toFixed(1)} → ${b.camera.scale.toFixed(1)}`;
  }
  return b.model.props.length === 0 || 'l’arbre lointain est resté';
});

check('une vue enregistrée survit à l’enregistrement du projet', () => {
  const m = normalise({
    ...emptyModel(),
    views: [{ name: 'Portail', camera: { yaw: 137, pitch: 24 }, focus: { enabled: true, w: 5, d: 4 } }],
  });
  const back = normalise(JSON.parse(JSON.stringify(m)));
  const v = back.views[0];
  if (!v || v.name !== 'Portail') return 'vue perdue';
  if (!v.id) return 'vue sans identifiant';
  return (near(v.camera.yaw, 137) && v.focus.enabled) || 'réglages perdus';
});

check('le sol est un tapis à coins arrondis, pas un rectangle', () => {
  // Four corners make a rectangle of lawn; a rounded outline reads as a base
  // the model sits on. It is the difference between an illustration that drops
  // onto a dashboard and one that covers it.
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    ground: { enabled: true, material: 'grass', margin: 2 },
  });
  const ground = mergeCoplanar(buildMesh(m).mesh.tris).filter((f) => f.group === 'ground');
  if (ground.length !== 1) return `${ground.length} faces de sol`;
  const n = ground[0].loops[0].length;
  return n > 8 || `${n} sommets : le sol est resté rectangulaire`;
});

check('la marge du cadrage est de l’air, pas de la pelouse', () => {
  // Reported in use: a generous margin filled the picture with empty lawn.
  // It is what the camera leaves round the zone, not part of the ground.
  const base = {
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 4, 3)] })],
    ground: { enabled: true, material: 'grass', margin: 0 },
  };
  const zone = { enabled: true, x: 20, y: 20, w: 5, d: 4 };
  const span = (margin) => {
    const g = mergeCoplanar(buildMesh(focusModel(normalise({
      ...base, focus: { ...zone, margin },
    }))).mesh.tris).find((f) => f.group === 'ground');
    const xs = g.loops[0].map((p) => p[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const tight = span(1), wide = span(8);
  return near(tight, wide, 1e-9) || `sol de ${tight.toFixed(1)} m à ${wide.toFixed(1)} m selon la marge`;
});

check('un corps qui effleure la zone n’est pas gardé', () => {
  // A house whose wall runs along the edge of a zone drawn in front of it
  // grazes it by a centimetre. Kept for that, it was drawn whole and then
  // sliced by the picture's own border.
  const b = makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] });
  const grazing = normalise({
    ...emptyModel(), buildings: [b],
    focus: { enabled: true, x: 9.9, y: 2, w: 6, d: 4, margin: 1 },
  });
  if (focusModel(grazing).buildings.some((x) => x.cells.length)) {
    return 'le corps effleuré est encore là';
  }
  const standing = normalise({
    ...emptyModel(), buildings: [b],
    focus: { enabled: true, x: 6, y: 2, w: 6, d: 4, margin: 1 },
  });
  return focusModel(standing).buildings.some((x) => x.cells.length)
    || 'un corps réellement dans la zone a été retiré';
});

check('sous cadrage, le sol suit le cadre et non la parcelle', () => {
  // The reported fault: a garden eighty metres long, cropped to the gate,
  // filled the picture with lawn — the very thing the framing was asked to
  // avoid. The pad follows what is shown.
  const b = makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] });
  const base = {
    ...emptyModel(),
    buildings: [b],
    props: [{ id: 'h', kind: 'hedge', x: -30, y: 20, w: 70, d: 0.6, h: 1 }],
    ground: { enabled: true, material: 'grass', margin: 1 },
  };
  // Through focusModel, as the renderer does: the frame first removes what it
  // excludes, and only then is the ground sized to what is left.
  const span = (model) => {
    const g = mergeCoplanar(buildMesh(focusModel(normalise(model))).mesh.tris)
      .find((f) => f.group === 'ground');
    const xs = g.loops[0].map((p) => p[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const wide = span(base);
  const framed = span({
    ...base,
    focus: { enabled: true, x: 18, y: 19, w: 6, d: 3, margin: 1, hide: true },
  });
  if (!(wide > 60)) return `sans cadrage le sol ne fait que ${wide.toFixed(0)} m`;
  return framed < 12 || `sous cadrage le sol fait encore ${framed.toFixed(0)} m`;
});

await checkAsync('un export cadré pose la scène sur un tapis, pas sur un aplat', async () => {
  // What makes an exported image sit on a dashboard rather than cover it: the
  // ground is a pad under what is shown, with transparency all round. Filling
  // the frame with lawn — which is what backing it with a plain rectangle did
  // — hands the dashboard a green tile with a house on it. Reported in use,
  // and only visible on real pixels.
  const W = 200, H = 150;
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    ground: { enabled: true, material: 'grass', margin: 0 },
    focus: { enabled: true, x: 1, y: 1, w: 4, d: 3, margin: 0.5, hide: true },
  });
  const blob = await svgToPng(svgFor(m, { width: W, height: H, ratio: 1 }), W, H);
  const img = await loadBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
  for (const [x, y] of [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]]) {
    if (alpha(x, y) !== 0) return `coin (${x}, ${y}) opaque (alpha ${alpha(x, y)})`;
  }
  return alpha(W >> 1, H >> 1) === 255 || 'le centre de l’image est vide';
});

check('rien n’est coupé par le bord de l’image', () => {
  // Why the fade went. It softened a crop by the picture's own border, and
  // there is no longer one to soften: the frame removes what falls outside and
  // cuts what crosses it, then the camera fits what is left, whole. Measured
  // rather than asserted — every drawn vertex has to land inside the canvas.
  const base = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    props: [{ id: 'm', kind: 'muret', x: -6, y: 8, w: 22, d: 0.24, h: 1.5 }],
    ground: { enabled: true, material: 'grass', margin: 1 },
  });
  const W = 400, H = 300;
  const cases = [
    ['sans cadrage', {}],
    ['cadré serré', { focus: { enabled: true, x: 2, y: 7, w: 6, d: 3, margin: 1 } }],
    ['cadré sur la maison', { focus: { enabled: true, x: 0, y: 0, w: 10, d: 7, margin: 2 } }],
  ];
  for (const [label, patch] of cases) {
    const out = renderScene({ ...base, ...patch }, { width: W, height: H });
    for (const f of out.faces) {
      for (const l of f.loops) {
        for (const p of l) {
          const [x, y] = out.camera.toScreen(p);
          if (x < -0.5 || x > W + 0.5 || y < -0.5 || y > H + 0.5) {
            return `${label} : un point tombe en (${Math.round(x)}, ${Math.round(y)})`;
          }
        }
      }
    }
  }
  return true;
});

check('un réglage de fondu hérité est simplement oublié', () => {
  const m = normalise({ ...emptyModel(), focus: { enabled: true, vignette: 0.4, hide: false } });
  return (m.focus.vignette === undefined && m.focus.hide === undefined)
    || `réglages hérités conservés : ${JSON.stringify(m.focus)}`;
});

/**
 * Load the real page in an iframe.
 *
 * The suite above exercises modules; this one exercises the assembled page,
 * which is where a purely-CSS regression hides. One did: the layout grew past
 * the viewport and pushed both drawings below the fold, and every module test
 * still passed.
 */
let bootError = null;

/** Longer than the store's autosave debounce, so no save can outlive the wipe. */
const AUTOSAVE_DEBOUNCE = 500;

async function loadAppOnce(width, height, deadline) {
  /*
   * The suite's own stores autosave, so the app would see a returning visitor
   * and skip the gallery. Clearing once was not enough: a store touched by an
   * earlier test has a save queued on a timer, and it lands *after* the wipe
   * and before the frame boots. The gallery test then failed for a reason
   * having nothing to do with the gallery — and it moved with the number of
   * tests before it, which is how a latent race passes for a flake.
   */
  clearLocal();
  await new Promise((r) => setTimeout(r, AUTOSAVE_DEBOUNCE));
  clearLocal();
  bootError = null;
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = `width:${width}px;height:${height}px`;
    frame.src = '../index.html';
    frame.onerror = () => reject(new Error('page non chargée'));
    // A throw during boot leaves a half-built interface that can still look
    // ready: catch it outright rather than waiting for the symptom.
    frame.addEventListener('load', () => {
      frame.contentWindow.addEventListener('error', (e) => {
        bootError = `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`;
      });
      const started = Date.now();
      const ready = () => {
        if (bootError) { reject(new Error(`erreur au démarrage : ${bootError}`)); return; }
        const doc = frame.contentDocument;
        const done = doc.querySelector('#inspector .panel') && doc.querySelector('#iso svg');
        if (done) resolve(frame);
        else if (Date.now() - started > deadline) reject(new Error('interface non prête'));
        else setTimeout(ready, 60);
      };
      ready();
    }, { once: true });
    // The frame lives at the top of the page and there is only ever one:
    // anywhere below the fold, Chrome throttles its animation frames to
    // nothing and the app inside never draws.
    document.getElementById('appframe').replaceChildren(frame);
  });
}

/**
 * Load the app, retrying once.
 *
 * Served from a cold CDN the first fetch of thirty-odd modules can be slow
 * enough to blow any reasonable deadline, and that first request is exactly
 * the one a verification run makes. A genuine fault fails both attempts, so
 * the retry buys tolerance without hiding anything.
 */
async function loadApp(width, height) {
  try {
    return await loadAppOnce(width, height, 12000);
  } catch (first) {
    if (bootError) throw first; // a real error, not slowness
    return loadAppOnce(width, height, 20000);
  }
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

await checkAsync('la galerie d’accueil s’ouvre à la première visite', async () => {
  // The boot sequence opens it, so this also catches a throw on the way there.
  const frame = await app();
  const dialog = frame.contentDocument.getElementById('gallery-dialog');
  if (!dialog) return 'dialogue absent de la page';
  return dialog.open || 'la galerie ne s’est pas ouverte';
});

await checkAsync('le guide se charge, et l’application y renvoie', async () => {
  // Meant to be handed to people who have never seen the tool, so a dead link
  // or a missing illustration is not a detail.
  const frame = await app();
  const link = frame.contentDocument.querySelector('a[href="guide.html"]');
  if (!link) return 'aucun lien vers le guide dans l’application';

  const doc = await new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'width:900px;height:600px;position:absolute;left:-9999px';
    f.onload = () => resolve(f.contentDocument);
    f.onerror = () => reject(new Error('guide illisible'));
    f.src = '../guide.html';
    document.getElementById('stage').appendChild(f);
  });
  const sections = doc.querySelectorAll('main h2[id]').length;
  if (sections < 8) return `${sections} sections dans le guide`;
  // Every entry in the table of contents must land somewhere.
  for (const a of doc.querySelectorAll('.toc a')) {
    const id = a.getAttribute('href').slice(1);
    if (!doc.getElementById(id)) return `le sommaire renvoie à « ${id} », qui n’existe pas`;
  }
  // And every illustration must exist: they are all repository assets.
  const shots = [...doc.querySelectorAll('main img')];
  if (shots.length < 3) return `${shots.length} illustration(s)`;
  for (const img of shots) {
    const ok = await new Promise((res) => {
      const probe = new Image();
      probe.onload = () => res(true);
      probe.onerror = () => res(false);
      probe.src = img.getAttribute('src').replace(/^assets\//, '../assets/');
    });
    if (!ok) return `illustration manquante : ${img.getAttribute('src')}`;
  }
  return true;
});

await checkAsync('la page s’amorce avec ses outils et un rendu visible', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  if (doc.querySelectorAll('.tool').length < 10) return 'palette d’outils incomplète';
  // Twenty-three tools in one column ran off the bottom of the panel; the
  // families fold, and enough of them start folded for the column to fit.
  // Every gesture the mouse can make has a button on the drawing.
  const nav = doc.getElementById('view-nav');
  const navBtns = nav ? nav.querySelectorAll('button').length : 0;
  if (navBtns < 8) return `pavé de navigation incomplet (${navBtns} boutons)`;
  const padBox = nav.getBoundingClientRect();
  const bodyBox = nav.parentElement.getBoundingClientRect();
  if (padBox.bottom > bodyBox.bottom + 1 || padBox.right > bodyBox.right + 1) {
    return 'le pavé de navigation déborde du rendu';
  }
  // The arrows do what the mode says they do.
  const arrow = nav.querySelector('.nav-pad [data-dir="up"]');
  const orbitTitle = arrow.title;
  nav.querySelector('.nav-modes button[data-mode="pan"]').click();
  if (arrow.title === orbitTitle) return 'les flèches ne suivent pas le mode';
  nav.querySelector('.nav-modes button[data-mode="orbit"]').click();
  const groups = [...doc.querySelectorAll('details.tool-group')];
  if (groups.length < 4) return `${groups.length} familles d’outils repliables`;
  if (!groups.some((g) => !g.open)) return 'aucune famille repliée au démarrage';
  const tools = doc.getElementById('tools');
  if (tools.scrollHeight > tools.clientHeight + 2) {
    return `la palette déborde de ${tools.scrollHeight - tools.clientHeight} px`;
  }
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
