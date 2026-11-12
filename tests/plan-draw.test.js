/**
 * Plan : dessiner — traits sans trou, Échap, aperçus avant le clic, cotes et
 * coordonnées, refus dits.
 */

import { check } from './harness.js';
import { near, pointer } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { emptyModel, normalise, makeBuilding, propFootprint } from '../src/core/model.js';
import { cellsAlong } from '../src/ui/plan-edit.js';
import { stagePlan, fireOn } from './plan-view.test.js';

const fire = (view, wx, wy, type, extra) => view.svg.dispatchEvent(pointer(view, wx, wy, type, extra));
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

/** A house on a 1 m grid, 10 × 6, with one window and the given extras. */
const house = (extra = {}) => normalise({
  ...emptyModel(),
  buildings: [makeBuilding({ id: 'bmain', name: 'Maison', cells: [...rectCells(10, 10, 19, 15)] })],
  openings: [{ id: 'o1', edge: '12,10,S', kind: 'window', offset: 0.5, width: 1.3 }],
  ...extra,
});

/** Collect the store's notices while `fn` runs. */
function notices(s, fn) {
  const seen = [];
  s.onNotice = (m) => seen.push(m);
  fn();
  s.onNotice = null;
  return seen;
}

check('cellsAlong passe par chaque case traversée, sans trou ni doublon', () => {
  const path = cellsAlong([0.5, 0.5], [7.5, 3.2]);
  for (let k = 1; k < path.length; k++) {
    const d = Math.abs(path[k][0] - path[k - 1][0]) + Math.abs(path[k][1] - path[k - 1][1]);
    if (d !== 1) return `saut entre ${path[k - 1]} et ${path[k]}`;
  }
  const last = path[path.length - 1];
  return (last[0] === 7 && last[1] === 3 && path.length === 11) || `chemin ${JSON.stringify(path)}`;
});

check('un trait rapide de pinceau peint toutes les cases entre deux positions du pointeur', () => {
  const { s, view } = stagePlan(normalise(emptyModel()));
  s.setTool('paint');
  fire(view, 10.5, 10.5, 'pointerdown');
  fire(view, 22.5, 14.5, 'pointermove'); // one event, twelve cells away
  fire(view, 22.5, 14.5, 'pointerup');
  // From cell (10, 10) to cell (22, 14), touching side to side: a path of
  // exactly 12 + 4 + 1 cells, whichever way it turns at a corner.
  const cells = s.model.buildings[0].cells.map((k) => k.split(',').map(Number));
  const has = (i, j) => cells.some(([a, b]) => a === i && b === j);
  const linked = cells.every(([i, j]) => (i === 10 && j === 10) || (i === 22 && j === 14)
    || [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => has(i + di, j + dj)).length === 2);
  return (cells.length === 17 && has(10, 10) && has(22, 14) && linked)
    || `${cells.length} cases : ${cells.map((c) => c.join(',')).join(' ')}`;
});

check('la gomme rapide efface aussi chaque case traversée', () => {
  const { s, view } = stagePlan(house());
  s.setTool('erase');
  fire(view, 10.5, 12.5, 'pointerdown');
  fire(view, 19.5, 12.5, 'pointermove');
  fire(view, 19.5, 12.5, 'pointerup');
  const left = s.model.buildings[0].cells.filter((k) => k.endsWith(',12'));
  return !left.length || `restent ${left.join(' ')}`;
});

check('un trait, même long et interrompu de pauses, est une seule étape d’annulation', () => {
  const { s, view } = stagePlan(normalise(emptyModel()));
  s.setTool('paint');
  fire(view, 5.5, 5.5, 'pointerdown');
  for (let x = 6.5; x < 15; x += 1) {
    // A pause longer than the coalescing window, as a hand that hesitates.
    s.lastEditAt -= 5000;
    fire(view, x, 5.5, 'pointermove');
  }
  fire(view, 14.5, 5.5, 'pointerup');
  const painted = s.model.buildings[0].cells.length;
  s.undo();
  return (painted === 10 && s.model.buildings[0].cells.length === 0 && !s.canUndo)
    || `${painted} cases peintes, ${s.model.buildings[0].cells.length} après une annulation`;
});

check('peindre sur la case d’un autre corps est refusé, et dit une fois par geste', () => {
  const m = house({ buildings: [
    makeBuilding({ id: 'bmain', name: 'Maison', cells: [...rectCells(10, 10, 14, 14)] }),
    makeBuilding({ id: 'bgar', name: 'Garage', cells: [...rectCells(15, 10, 18, 14)] }),
  ] });
  const { s, view } = stagePlan(m);
  s.setActiveBuilding('bmain');
  s.setTool('paint');
  const said = notices(s, () => {
    fire(view, 14.5, 16.5, 'pointerdown');
    fire(view, 16.5, 12.5, 'pointermove'); // across two of the garage's cells
    fire(view, 17.5, 11.5, 'pointermove');
    fire(view, 17.5, 11.5, 'pointerup');
  });
  const garage = s.model.buildings.find((b) => b.id === 'bgar').cells.length;
  if (garage !== 20) return `le garage a perdu ou gagné des cases (${garage})`;
  return (said.length === 1 && /Garage/.test(said[0])) || `messages : ${JSON.stringify(said)}`;
});

check('Échap annule le rectangle, le muret, le cadrage en cours de tracé', () => {
  const out = [];
  for (const tool of ['rect', 'muret', 'frame']) {
    const { s, view } = stagePlan(house());
    s.setTool(tool);
    const before = s.model;
    fire(view, 2.2, 2.2, 'pointerdown');
    fire(view, 8.8, 6.8, 'pointermove');
    escape();
    fire(view, 9.8, 7.8, 'pointermove');
    fire(view, 9.8, 7.8, 'pointerup');
    if (s.model !== before) out.push(`${tool} : modèle modifié`);
    if (view.svg.querySelector('.rect-preview, .run-preview, .focus-zone.drawing')) out.push(`${tool} : aperçu resté`);
  }
  return !out.length || out.join(' ; ');
});

check('Échap annule un trait, un déplacement, un glissement d’ouverture, sans rien laisser dans l’historique', () => {
  const out = [];
  const cases = {
    paint: (view) => { fire(view, 3.5, 3.5, 'pointerdown'); fire(view, 8.5, 3.5, 'pointermove'); },
    move: (view, s) => {
      const t = s.model.props[0];
      fireOn(view, '[data-id="pt"]', t.x, t.y, 'pointerdown'); fire(view, t.x + 4, t.y + 2, 'pointermove');
    },
    slide: (view) => {
      const line = view.svg.querySelector('.opening');
      line.dispatchEvent(pointer(view, 12.5, 9.95, 'pointerdown'));
      fire(view, 16.5, 9.9, 'pointermove');
    },
  };
  for (const [name, run] of Object.entries(cases)) {
    const { s, view } = stagePlan(house({ props: [{ id: 'pt', kind: 'tree', x: 4, y: 4, r: 1 }] }));
    s.setTool(name === 'paint' ? 'paint' : 'select');
    const before = s.model;
    run(view, s);
    if (s.model === before) { out.push(`${name} : le geste n’a rien fait`); continue; }
    const selected = s.selection;
    escape();
    fire(view, 9, 9, 'pointermove');
    fire(view, 9, 9, 'pointerup');
    if (JSON.stringify(s.model) !== JSON.stringify(before)) out.push(`${name} : modèle non rétabli`);
    if (s.canUndo) out.push(`${name} : une entrée reste dans l’historique`);
    if (JSON.stringify(s.selection) !== JSON.stringify(selected)) out.push(`${name} : sélection perdue`);
  }
  return !out.length || out.join(' ; ');
});

check('outil d’ouverture : le pan visé et le gabarit s’affichent là où le clic posera', () => {
  const { s, view } = stagePlan(house());
  s.setTool('door');
  // Near the south-east corner: the door has to be held back within the wall.
  fire(view, 19.8, 9.8, 'pointermove');
  const wall = view.svg.querySelector('.plan-wall-hover');
  const ghost = view.svg.querySelector('.opening.ghost');
  const label = [...view.svg.querySelectorAll('.plan-overlay text')].find((t) => /de l’angle/.test(t.textContent));
  if (!wall || !ghost || !label) return 'pan, gabarit ou distance absents';
  const at = [ghost.getAttribute('x1'), ghost.getAttribute('x2')].map(Number);
  fire(view, 19.8, 9.8, 'pointerdown');
  fire(view, 19.8, 9.8, 'pointerup');
  const placed = view.svg.querySelector('.opening-door:not(.ghost)');
  const got = [placed.getAttribute('x1'), placed.getAttribute('x2')].map(Number);
  if (!near(at[0], got[0], 1e-6) || !near(at[1], got[1], 1e-6)) return `gabarit ${at} ≠ ouverture ${got}`;
  return /^0 m/.test(label.textContent) || `distance : ${label.textContent}`;
});

check('outils d’extérieur : emprise fantôme à la position du clic, cible du portail et de l’escalier', () => {
  const m = house({ props: [
    { id: 'mu', kind: 'muret', x: 0, y: 0, w: 8, d: 0.24, h: 1.5 },
    { id: 'te', kind: 'terrace', x: 24, y: 10, w: 5, d: 4, z: 0.6 },
  ] });
  const out = [];
  for (const [tool, at, target] of [['pool', [3.3, 22.1], null], ['gate', [4.2, 0.6], 'mu'], ['stairs', [26, 8.2], 'te'], ['tree', [2.1, 7.4], null]]) {
    const { s, view } = stagePlan(m);
    s.setTool(tool);
    fire(view, ...at, 'pointermove');
    const ghost = view.svg.querySelector('.plan-overlay .ghost');
    if (!ghost) { out.push(`${tool} : pas de fantôme`); continue; }
    const g = ghost.getBBox();
    const marked = view.svg.querySelectorAll('.plan-target').length;
    if (target && marked !== 1) out.push(`${tool} : cible non montrée`);
    fire(view, ...at, 'pointerdown');
    fire(view, ...at, 'pointerup');
    const placed = s.model.props[s.model.props.length - 1];
    const [x0, y0, x1, y1] = propFootprint(placed);
    const a = view.toPx(x0, y1), b = view.toPx(x1, y0);
    if (!near(g.x, a[0], 0.01) || !near(g.y, a[1], 0.01) || !near(g.x + g.width, b[0], 0.01) || !near(g.y + g.height, b[1], 0.01)) {
      out.push(`${tool} : fantôme ${[g.x, g.y, g.width, g.height].map((v) => v.toFixed(1))} ≠ objet posé`);
    }
  }
  return !out.length || out.join(' ; ');
});

check('objets de toit : gabarit, et refus visible et dit hors de tout toit', () => {
  const { s, view } = stagePlan(house());
  s.setTool('chimney');
  fire(view, 3, 3, 'pointermove');
  if (!view.svg.querySelector('.roof-item.ghost.refused')) return 'pas de refus visible hors toit';
  const said = notices(s, () => {
    fire(view, 3, 3, 'pointerdown');
    fire(view, 3, 3, 'pointerup');
  });
  if (s.model.roofItems.length) return 'un objet a été créé hors toit';
  if (said.length !== 1) return `messages : ${JSON.stringify(said)}`;
  fire(view, 13, 12, 'pointermove');
  if (!view.svg.querySelector('.roof-item.ghost:not(.refused)')) return 'pas de gabarit sur le toit';
  fire(view, 13, 12, 'pointerdown');
  fire(view, 13, 12, 'pointerup');
  return s.model.roofItems.length === 1 || 'pas d’objet posé sur le toit';
});

check('les coordonnées du pointeur s’affichent en mètres', () => {
  const { s, view } = stagePlan(house());
  s.setTool('select');
  fire(view, 12.31, 7.52, 'pointermove');
  const t = view.svg.querySelector('.plan-coords');
  return (t && t.textContent === 'x 12,3 m · y 7,5 m') || `affiché : ${t?.textContent}`;
});

check('l’objet sélectionné porte ses cotes sur ses côtés', () => {
  const { s, view } = stagePlan(house({ props: [
    { id: 'te', kind: 'terrace', x: 2, y: 2, w: 5.5, d: 3.25 },
    { id: 'mu', kind: 'muret', x: 0, y: 20, w: 7.75, d: 0.24 },
    { id: 'tr', kind: 'tree', x: 25, y: 25, r: 1.5 },
  ] }));
  s.setTool('select');
  const out = [];
  for (const [id, want] of [['te', ['5,5 m', '3,25 m']], ['mu', ['7,75 m']], ['tr', ['⌀ 3 m']]]) {
    s.select({ type: 'prop', id });
    view.render();
    const texts = [...view.svg.querySelectorAll('.plan-overlay .plan-dim')].map((t) => t.textContent);
    if (!want.every((w) => texts.includes(w))) out.push(`${id} : ${texts.join(', ')}`);
  }
  return !out.length || out.join(' ; ');
});
