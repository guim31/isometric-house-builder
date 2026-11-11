/**
 * Ce que les lots 2 (le plan) et 3 (le rendu, les équipements) se doivent :
 * les transformations de corps emportent les équipements muraux et le sens du
 * faîtage ; le plan sait poser, montrer et manipuler les équipements ; la même
 * action donne le même modèle, qu'elle soit faite dans le plan ou dans le rendu.
 */

import { check } from './harness.js';
import { near, pointer, topFaceAt } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import {
  emptyModel, normalise, makeBuilding, LIMITS, quarterTurn, propFootprint, PROP_DEFAULTS,
  FIXTURE_DEFAULTS, ROOF_ITEM_DEFAULTS, cellSizeOf,
} from '../src/core/model.js';
import { moveBody, rotateBody, mirrorBody, duplicateBody } from '../src/core/bodies.js';
import { renderScene } from '../src/render/svg.js';
import { Store } from '../src/ui/store.js';
import { nudgeSelection, LINEAR_KINDS } from '../src/ui/actions.js';
import { handlesOf } from '../src/ui/plan-edit.js';
import { stagePlan, fireOn } from './plan-view.test.js';
import { stage, clickAt, visible, dragFrom, targetOf } from './rendu-gestes.test.js';
import { equippedHouse } from './equipements.test.js';

const fire = (view, wx, wy, type, extra) => view.svg.dispatchEvent(pointer(view, wx, wy, type, extra));
const canon = (m) => JSON.stringify(m);
const edgeCell = (e) => e.split(',').slice(0, 2).join(',');
const withoutIds = (list) => list.map(({ id, ...rest }) => rest);

/**
 * An L-shaped body on two levels, with a fixture on three of its walls, a
 * window, a chimney and a gable whose ridge is told which way to run; a
 * garage apart, with a camera of its own.
 */
const equippedBody = (roof = { type: 'gable', pitch: 30, ridge: 'ew' }) => normalise({
  ...emptyModel(),
  buildings: [
    makeBuilding({
      id: 'bmain', name: 'Maison', storeys: 2, roof: { ...makeBuilding().roof, ...roof },
      cells: [...rectCells(10, 10, 16, 13), ...rectCells(10, 14, 12, 17)],
    }),
    makeBuilding({ id: 'bgar', name: 'Garage', cells: [...rectCells(22, 10, 25, 13)] }),
  ],
  openings: [{ id: 'o1', edge: '12,10,S', kind: 'window', offset: 0.35, width: 1.3 }],
  fixtures: [
    { id: 'f1', kind: 'wallLight', edge: '14,10,S', storey: 0, offset: 0.3, z: 2 },
    { id: 'f2', kind: 'camera', edge: '16,12,E', storey: 1, offset: 0.7, z: 2.3 },
    { id: 'f3', kind: 'charger', edge: '10,15,W', storey: 0, offset: 0.5, z: 1.1 },
    { id: 'fg', kind: 'camera', edge: '23,10,S', storey: 0, offset: 0.5, z: 2.3 },
  ],
  roofItems: [{ id: 'r1', kind: 'chimney', x: 11.5, y: 15.3, w: 0.8, d: 0.6, h: 1.1 }],
});

/* ---------------- 1. les corps emportent leurs équipements ---------------- */

check('quatre quarts de tour d’un corps équipé redonnent exactement le modèle, faîtage compris', () => {
  const m = equippedBody();
  let r = m;
  const ridges = [];
  for (let k = 0; k < 4; k++) {
    r = rotateBody(r, 'bmain');
    if (!r) return `tour ${k + 1} refusé`;
    ridges.push(r.buildings[0].roof.ridge);
    const cells = new Set(r.buildings[0].cells);
    for (const f of r.fixtures.filter((x) => x.id !== 'fg')) {
      if (!cells.has(edgeCell(f.edge))) return `tour ${k + 1} : ${f.id} resté hors du corps, sur ${f.edge}`;
    }
  }
  if (ridges.join(' ') !== 'ns ew ns ew') return `faîtage : ${ridges.join(' → ')}`;
  if (canon(r.fixtures.find((f) => f.id === 'fg')) !== canon(m.fixtures.find((f) => f.id === 'fg'))) {
    return 'la caméra du garage a bougé';
  }
  return canon(r) === canon(m) || 'le modèle a dérivé';
});

check('deux retournements d’un corps équipé redonnent exactement le modèle, faîtage inchangé', () => {
  const m = equippedBody({ type: 'gable', pitch: 30, ridge: 'ns' });
  const once = mirrorBody(m, 'bmain');
  if (once.buildings[0].roof.ridge !== 'ns') return `faîtage retourné : ${once.buildings[0].roof.ridge}`;
  const f1 = once.fixtures.find((f) => f.id === 'f1');
  // The wall light 0,30 m from the west end of its edge is 0,70 m from it once mirrored.
  if (f1.edge !== '12,10,S' || !near(f1.offset, 0.7)) return `applique en ${f1.edge} à ${f1.offset}`;
  return canon(mirrorBody(once, 'bmain')) === canon(m) || 'le modèle a dérivé';
});

check('« auto » reste « auto » à chaque quart de tour : il suit déjà le côté le plus long', () => {
  const r = rotateBody(equippedBody({ type: 'gable', pitch: 30, ridge: 'auto' }), 'bmain');
  return r.buildings[0].roof.ridge === 'auto' || r.buildings[0].roof.ridge;
});

/**
 * Two fills, equal to a shade — a face's normal carries rounding noise, as
 * plan-edit.test.js explains.
 */
const sameColour = (a, b) => {
  if (!a || !b) return a === b;
  const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return x.every((v, k) => Math.abs(v - y[k]) <= 2);
};

check('un corps équipé au faîtage imposé, tourné d’un quart, rend comme l’original vu à 90° de lacet', () => {
  const full = equippedBody();
  const base = normalise({
    ...full,
    buildings: [full.buildings[0]],
    fixtures: full.fixtures.filter((f) => f.id !== 'fg'),
  });
  const turned = rotateBody(base, 'bmain');
  const W = 420, H = 320;
  const a = renderScene({ ...turned, camera: { ...turned.camera, yaw: 0 } }, { width: W, height: H });
  const b = renderScene({ ...base, camera: { ...base.camera, yaw: 270 } }, { width: W, height: H });
  const equipA = a.faces.filter((f) => f.group?.startsWith('equip:')).length;
  if (equipA === 0 || equipA !== b.faces.filter((f) => f.group?.startsWith('equip:')).length) {
    return `équipements dessinés : ${equipA} contre ${b.faces.filter((f) => f.group?.startsWith('equip:')).length}`;
  }
  let diff = 0, compared = 0;
  for (let y = 3.37; y < H; y += 6) {
    for (let x = 2.61; x < W; x += 6) {
      const fa = topFaceAt(a, [x, y]), fb = topFaceAt(b, [x, y]);
      compared++;
      if (!sameColour(fa?.fill, fb?.fill)) diff++;
    }
  }
  return diff === 0 || `${diff} points sur ${compared} diffèrent`;
});

check('déplacer et dupliquer un corps emportent ses équipements muraux, ids neufs pour la copie', () => {
  const m = equippedBody();
  const moved = moveBody(m, 'bmain', 3, -2);
  const f2 = moved.fixtures.find((f) => f.id === 'f2');
  if (f2.edge !== '19,10,E' || f2.offset !== 0.7 || f2.z !== 2.3 || f2.storey !== 1) return `caméra en ${JSON.stringify(f2)}`;
  const { model: d, id } = duplicateBody(m, 'bmain');
  const copy = d.buildings.find((b) => b.id === id);
  const cells = new Set(copy.cells);
  const copies = d.fixtures.filter((f) => cells.has(edgeCell(f.edge)));
  if (copies.length !== 3) return `${copies.length} équipements sur la copie`;
  const ids = [...d.buildings, ...d.openings, ...d.fixtures, ...d.roofItems].map((x) => x.id);
  if (new Set(ids).size !== ids.length) return 'ids en double';
  if (copies.some((f) => !/^f/.test(f.id))) return 'préfixe d’id inattendu';
  const again = normalise(JSON.parse(JSON.stringify(d)));
  return canon(again.fixtures) === canon(d.fixtures) || 'la copie ne survit pas à une réouverture';
});

check('glisser un corps dans le plan emporte ses équipements muraux, en une étape', () => {
  const { s, view } = stagePlan(equippedBody());
  s.setTool('select');
  const before = s.model;
  fireOn(view, '[data-building="bmain"]', 12.4, 12.4, 'pointerdown');
  fire(view, 13.6, 12.6, 'pointermove');
  fire(view, 14.4, 12.4, 'pointermove');
  fire(view, 14.4, 12.4, 'pointerup');
  const f1 = s.model.fixtures.find((f) => f.id === 'f1');
  if (f1.edge !== '16,10,S') return `applique restée en ${f1.edge}`;
  // The plan draws it on its wall's new place.
  const dot = view.svg.querySelector('circle.fixture[data-id="f1"]');
  const [px] = view.toPx(16.3, 10);
  if (!dot || Math.abs(Number(dot.getAttribute('cx')) - px) > 0.5) return 'la pastille n’a pas suivi';
  s.undo();
  return canon(s.model) === canon(before) || 'plus d’une étape';
});

check('dupliquer un corps qui ferait passer les équipements muraux au-delà du plafond est refusé, et dit', () => {
  const m = equippedBody();
  // The garage carries enough cameras to leave room for two more, not three.
  const filler = Array.from({ length: LIMITS.fixtures - m.fixtures.length - 2 }, (_, k) => ({
    id: `fx${k}`, kind: 'camera', edge: `${22 + (k % 4)},10,S`, storey: 0, offset: 0.5, z: 2.3,
  }));
  const full = normalise({ ...m, fixtures: [...m.fixtures, ...filler] });
  if (full.fixtures.length !== LIMITS.fixtures - 2) return `${full.fixtures.length} équipements au départ`;
  const s = new Store(full);
  const said = [];
  s.onLimit = (x) => said.push(x);
  s.onNotice = (x) => said.push(x);
  s.select({ type: 'building', id: 'bmain' });
  s.duplicateSelected();
  if (s.model.buildings.length !== 2 || s.canUndo) return 'la copie a été acceptée';
  if (!said.some((x) => /équipements muraux/.test(x))) return `messages : ${said.join(' | ')}`;
  // One fixture fewer on the garage, and the copy fits.
  const roomy = new Store(normalise({ ...full, fixtures: full.fixtures.slice(0, -1) }));
  roomy.select({ type: 'building', id: 'bmain' });
  roomy.duplicateSelected();
  return (roomy.model.buildings.length === 3 && roomy.model.fixtures.length === LIMITS.fixtures)
    || `${roomy.model.fixtures.length} équipements après la copie`;
});
