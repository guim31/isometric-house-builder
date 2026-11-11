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

/* ---------------- 2. le plan sait faire avec les équipements ---------------- */

const house = () => equippedHouse({ fixtures: [] });

/** Centre of a plan circle, in pixels. */
const centreOf = (n) => [Number(n.getAttribute('cx')), Number(n.getAttribute('cy'))];

check('chaque équipement mural a son aperçu dans le plan, là où le clic le pose', () => {
  const out = [];
  for (const kind of Object.keys(FIXTURE_DEFAULTS)) {
    const { s, view } = stagePlan(house());
    s.setTool(kind);
    // Just outside the north wall (y = 7), 0,70 m along edge 5,6,N.
    fire(view, 5.3, 7.4, 'pointermove');
    const ghost = view.svg.querySelector('.plan-overlay .fixture.ghost');
    const wall = view.svg.querySelector('.plan-overlay .plan-wall-hover');
    const label = [...view.svg.querySelectorAll('.plan-overlay text')].find((t) => /de l’angle/.test(t.textContent));
    if (!ghost || !wall || !label) { out.push(`${kind} : aperçu incomplet`); continue; }
    const at = centreOf(ghost);
    fire(view, 5.3, 7.4, 'pointerdown');
    fire(view, 5.3, 7.4, 'pointerup');
    const f = s.model.fixtures[0];
    if (!f || f.kind !== kind || f.edge !== '5,6,N' || !near(f.offset, 0.7) || f.z !== FIXTURE_DEFAULTS[kind].z) {
      out.push(`${kind} posé : ${JSON.stringify(f)}`);
      continue;
    }
    const dot = view.svg.querySelector(`circle.fixture[data-id="${f.id}"]`);
    const d = centreOf(dot);
    if (Math.hypot(d[0] - at[0], d[1] - at[1]) > 0.5) out.push(`${kind} : aperçu à ${at}, posé à ${d}`);
  }
  return !out.length || out.join(' ; ');
});

check('loin de tout mur, un outil d’équipement mural n’a pas d’aperçu, et le clic le dit', () => {
  const { s, view } = stagePlan(house());
  const said = [];
  s.onNotice = (x) => said.push(x);
  s.setTool('camera');
  fire(view, 20, 20, 'pointermove');
  if (view.svg.querySelector('.plan-overlay .fixture.ghost')) return 'un aperçu loin des murs';
  fire(view, 20, 20, 'pointerdown');
  fire(view, 20, 20, 'pointerup');
  return (s.model.fixtures.length === 0 && said.length === 1) || `${s.model.fixtures.length} posé(s), ${said.length} message(s)`;
});

/** Pixel box of a plan rect or circle. */
function boxPx(n) {
  if (n.tagName === 'circle') {
    const [cx, cy] = centreOf(n), r = Number(n.getAttribute('r'));
    return [cx - r, cy - r, cx + r, cy + r];
  }
  const x = Number(n.getAttribute('x')), y = Number(n.getAttribute('y'));
  return [x, y, x + Number(n.getAttribute('width')), y + Number(n.getAttribute('height'))];
}

check('chaque équipement au sol a son emprise fantôme, égale à ce que le clic pose', () => {
  const out = [];
  for (const kind of ['lamppost', 'heatpump', 'mailbox', 'carport']) {
    const { s, view } = stagePlan(house());
    s.setTool(kind);
    fire(view, 15.1, 3.1, 'pointermove');
    const ghost = view.svg.querySelector(`.plan-overlay .prop-${kind}.ghost`);
    if (!ghost) { out.push(`${kind} sans aperçu`); continue; }
    const g = boxPx(ghost);
    fire(view, 15.1, 3.1, 'pointerdown');
    fire(view, 15.1, 3.1, 'pointerup');
    const p = s.model.props.at(-1);
    const drawn = view.svg.querySelector(`.plan-props [data-id="${p?.id}"]`);
    if (!drawn || drawn.tagName !== ghost.tagName) { out.push(`${kind} : dessiné autrement que son aperçu`); continue; }
    const d = boxPx(drawn);
    if (d.some((v, k) => Math.abs(v - g[k]) > 0.5)) out.push(`${kind} : aperçu ${g.map(Math.round)}, posé ${d.map(Math.round)}`);
  }
  return !out.length || out.join(' ; ');
});

check('poignées : là où l’inspecteur règle une dimension, et nulle part ailleurs', () => {
  const m = equippedHouse();
  const out = [];
  const want = { cp: 8, perg: 8, pac: 8, lamp: 0, bal: 0 };
  for (const [id, n] of Object.entries(want)) {
    const { s, view } = stagePlan(m);
    s.setTool('select');
    s.select({ type: 'prop', id });
    view.render();
    const got = view.svg.querySelectorAll('.plan-overlay .plan-handle').length;
    if (got !== n) out.push(`${id} : ${got} poignées au lieu de ${n}`);
  }
  const { s, view } = stagePlan(m);
  s.setTool('select');
  s.select({ type: 'fixture', id: 'ap' });
  view.render();
  if (view.svg.querySelectorAll('.plan-overlay .plan-handle').length) out.push('des poignées sur une applique');
  return !out.length || out.join(' ; ');
});

check('un équipement mural sélectionné a ses cotes : distance à l’angle et hauteur', () => {
  const { s, view } = stagePlan(equippedHouse());
  s.setTool('select');
  s.select({ type: 'fixture', id: 'bo' });
  view.render();
  const texts = [...view.svg.querySelectorAll('.plan-overlay text')].map((t) => t.textContent);
  // The charger is 2,5 m from the south-east corner, 1,10 m above the floor.
  const ok = texts.some((t) => t === '2,5 m de l’angle') && texts.some((t) => t === 'à 1,1 m du plancher');
  return ok || texts.join(' | ');
});

/** Pull handle `handle` of a selected prop to (x, y). */
function pullHandle(s, view, id, handle, x, y) {
  s.setTool('select');
  s.select({ type: 'prop', id });
  view.render();
  const h = view.svg.querySelector(`.plan-handle[data-handle="${handle}"]`);
  if (!h) throw new Error(`poignée ${handle} absente`);
  const [wx, wy] = view.toWorld(Number(h.getAttribute('x')) + 4.5, Number(h.getAttribute('y')) + 4.5);
  fireOn(view, `.plan-handle[data-handle="${handle}"]`, wx, wy, 'pointerdown', { altKey: true });
  fire(view, x, y, 'pointermove', { altKey: true });
  fire(view, x, y, 'pointerup', { altKey: true });
}

check('un carport se redimensionne par ses poignées, au quart de mètre, en une étape', () => {
  const { s, view } = stagePlan(equippedHouse());
  const before = s.model;
  pullHandle(s, view, 'perg', 'e', 21.1, 7);
  const p = s.model.props.find((x) => x.id === 'perg');
  if (p.w !== 7 || p.x !== 14 || p.d !== 3) return `pergola ${p.x} + ${p.w} × ${p.d}`;
  s.undo();
  return canon(s.model) === canon(before) || 'plus d’une étape';
});

check('le quart de tour d’un objet et ses poignées s’accordent', () => {
  const out = [];
  for (const id of ['cp', 'pac', 'auto']) {
    const { s, view } = stagePlan(equippedHouse());
    s.setTool('select');
    s.select({ type: 'prop', id });
    s.patchSelected((it) => quarterTurn(it));
    view.render();
    const it = s.selected;
    const [x0, y0, x1, y1] = propFootprint(it);
    const hs = handlesOf('prop', it);
    const xs = hs.map((h) => h.x), ys = hs.map((h) => h.y);
    if (Math.min(...xs) !== x0 || Math.max(...xs) !== x1 || Math.min(...ys) !== y0 || Math.max(...ys) !== y1) {
      out.push(`${id} : poignées hors de son emprise tournée`);
    }
    const drawn = boxPx(view.svg.querySelector(`.plan-props [data-id="${id}"]`));
    const [a, b] = [view.toPx(x0, y1), view.toPx(x1, y0)];
    if ([a[0], a[1], b[0], b[1]].some((v, k) => Math.abs(v - drawn[k]) > 0.5)) out.push(`${id} : dessin et emprise diffèrent`);
  }
  // A car turned across is long along x: its handles keep it a car, but no
  // longer force two metres of width onto it.
  const { s, view } = stagePlan(equippedHouse());
  s.setTool('select');
  s.select({ type: 'prop', id: 'auto' });
  s.patchSelected((it) => quarterTurn(it));
  const turned = s.selected;
  const [, y0] = propFootprint(turned);
  pullHandle(s, view, 'auto', 'n', turned.x, y0 + 0.4);
  const car = s.model.props.find((x) => x.id === 'auto');
  if (car.dir !== 'E' || car.d !== 1) out.push(`voiture tournée réduite à ${car.w} × ${car.d}, sens ${car.dir}`);
  return !out.length || out.join(' ; ');
});

check('flèches : un équipement mural coulisse sur son mur, un équipement au sol avance de 0,25 m', () => {
  const s = new Store(equippedHouse());
  const out = [];
  s.select({ type: 'fixture', id: 'bo' }); // east wall: arrows up and down run along it
  nudgeSelection(s, 0, 1);
  nudgeSelection(s, 0, 1);
  nudgeSelection(s, 1, 0); // across the wall: nothing
  if (!near(s.selected.offset, 0.6) || s.selected.edge !== '9,2,E') out.push(`borne à ${s.selected.offset} sur ${s.selected.edge}`);
  nudgeSelection(s, 0, -1, true);
  if (!near(s.selected.offset, 0.35)) out.push(`borne (Maj) à ${s.selected.offset}`);
  s.undo();
  if (s.model.fixtures.find((f) => f.id === 'bo').offset !== 0.5) out.push('les pas de flèche ne sont pas groupés');
  s.select({ type: 'prop', id: 'pac' });
  nudgeSelection(s, 1, 0);
  nudgeSelection(s, 0, -1);
  if (!(s.selected.x === 4.25 && s.selected.y === 6.8)) out.push(`pompe à chaleur en ${s.selected.x}, ${s.selected.y}`);
  return !out.length || out.join(' ; ');
});

check('dans le plan, un équipement mural glisse d’un mur à l’autre, et Échap le rend à sa place', () => {
  const { s, view } = stagePlan(equippedHouse());
  s.setTool('select');
  const before = s.model;
  // The charger on the east wall (x = 10, y = 2.5), dragged round the corner onto the south wall.
  fireOn(view, 'circle.fixture[data-id="bo"]', 10, 2.5, 'pointerdown');
  fire(view, 10, 1.2, 'pointermove');
  fire(view, 8.4, -0.3, 'pointermove');
  const moved = s.model.fixtures.find((f) => f.id === 'bo');
  if (moved.edge !== '8,0,S' || !near(moved.offset, 0.4) || moved.z !== 1.1) return `borne en ${JSON.stringify(moved)}`;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  fire(view, 8.4, -0.3, 'pointerup');
  if (canon(s.model) !== canon(before) || s.canUndo) return 'Échap n’a pas tout rendu';
  if (s.selection?.id !== 'bo') return 'Échap a désélectionné';
  // Again, to the end: one step.
  fireOn(view, 'circle.fixture[data-id="bo"]', 10, 2.5, 'pointerdown');
  fire(view, 10, 1.2, 'pointermove');
  fire(view, 8.4, -0.3, 'pointermove');
  fire(view, 8.4, -0.3, 'pointerup');
  s.undo();
  return canon(s.model) === canon(before) || 'plus d’une étape';
});

check('un équipement au sol s’aimante aux murs, et Alt suspend l’aimant', () => {
  const run = (alt) => {
    const { s, view } = stagePlan(equippedHouse());
    s.setTool('select');
    // The heat pump's south side, from 7,05 m dragged to 7,2: the wall is at 7.
    fireOn(view, '.plan-props [data-id="pac"]', 4.5, 7.25, 'pointerdown');
    fire(view, 4.5, 7.4, 'pointermove', { altKey: alt });
    const guides = view.svg.querySelectorAll('.plan-overlay .plan-guide').length;
    fire(view, 4.5, 7.4, 'pointerup', { altKey: alt });
    return { y: s.model.props.find((x) => x.id === 'pac').y, guides };
  };
  const on = run(false), off = run(true);
  if (on.y !== 7 || !on.guides) return `aimanté en y = ${on.y}, ${on.guides} repère(s)`;
  return (off.y === 7.25 && !off.guides) || `Alt : y = ${off.y}, ${off.guides} repère(s)`;
});

check('un objet de toit glissé ou poussé hors du toit dans le plan y reste, et le dit une fois', () => {
  const m = equippedHouse({ roofItems: [{ id: 'ch', kind: 'chimney', x: 8.5, y: 3.5, w: 0.8, d: 0.6, h: 1.1 }] });
  const { s, view } = stagePlan(m);
  const said = [];
  s.onNotice = (x) => said.push(x);
  s.setTool('select');
  fireOn(view, '[data-id="ch"]', 8.5, 3.5, 'pointerdown', { altKey: true });
  fire(view, 9.5, 3.5, 'pointermove', { altKey: true });
  fire(view, 11.5, 3.5, 'pointermove', { altKey: true });
  fire(view, 12.5, 3.5, 'pointermove', { altKey: true });
  fire(view, 12.5, 3.5, 'pointerup', { altKey: true });
  const ch = s.model.roofItems[0];
  if (ch.x !== 9.5 || said.length !== 1) return `cheminée en ${ch.x}, ${said.length} message(s)`;
  nudgeSelection(s, 1, 0, true);
  return (s.model.roofItems[0].x === 9.5 && said.length === 2) || `poussée en ${s.model.roofItems[0].x}`;
});
