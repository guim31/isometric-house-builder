/**
 * Plan : manipuler — corps déplacés, dupliqués, tournés, retournés ;
 * poignées ; aimantation ; flèches du clavier.
 */

import { check } from './harness.js';
import { near, pointer, topFaceAt } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { emptyModel, normalise, makeBuilding, limitBreach } from '../src/core/model.js';
import { moveBody, rotateBody, mirrorBody, duplicateBody } from '../src/core/bodies.js';
import { renderScene } from '../src/render/svg.js';
import { Store } from '../src/ui/store.js';
import { nudgeSelection } from '../src/ui/actions.js';
import { stagePlan, fireOn } from './plan-view.test.js';

const fire = (view, wx, wy, type, extra) => view.svg.dispatchEvent(pointer(view, wx, wy, type, extra));
const canon = (m) => JSON.stringify(m);

/**
 * An L-shaped body with something on every wall and a shed roof, a second
 * body standing apart, and one item outside: everything a transform must
 * carry, or leave alone.
 */
const estate = (roof = { type: 'shed', shedDir: 'S', pitch: 20 }) => normalise({
  ...emptyModel(),
  buildings: [
    makeBuilding({
      id: 'bmain', name: 'Maison', roof: { ...makeBuilding().roof, ...roof },
      cells: [...rectCells(10, 10, 16, 13), ...rectCells(10, 14, 12, 17)],
    }),
    makeBuilding({ id: 'bgar', name: 'Garage', cells: [...rectCells(22, 10, 25, 13)] }),
  ],
  openings: [
    { id: 'o1', edge: '12,10,S', kind: 'window', offset: 0.35, width: 1.3 },
    { id: 'o2', edge: '16,12,E', kind: 'door', offset: 0.5, width: 1 },
    { id: 'o3', edge: '11,17,N', kind: 'window', offset: 0.65, width: 0.9 },
    { id: 'o4', edge: '10,15,W', kind: 'garage', offset: 0.2, width: 2.6 },
    { id: 'og', edge: '23,10,S', kind: 'door', offset: 0.5, width: 1 },
  ],
  roofItems: [
    { id: 'r1', kind: 'chimney', x: 11.5, y: 15.3, w: 0.8, d: 0.6, h: 1.1 },
    { id: 'r2', kind: 'solar', x: 14.25, y: 11.7, w: 3, d: 1.8 },
  ],
  props: [{ id: 'pt', kind: 'terrace', x: 2, y: 2, w: 5.5, d: 3.25 }],
});

check('quatre quarts de tour redonnent exactement le modèle de départ', () => {
  const m = estate();
  let r = m;
  const seen = [];
  for (let k = 0; k < 4; k++) {
    r = rotateBody(r, 'bmain');
    if (!r) return `tour ${k + 1} refusé`;
    seen.push(r.buildings[0].roof.shedDir);
  }
  if (seen.join('') !== 'WNES') return `pente de l’appentis : ${seen.join(' → ')}`;
  return canon(r) === canon(m) || 'le modèle a dérivé';
});

check('deux retournements redonnent exactement le modèle de départ', () => {
  const m = estate({ type: 'shed', shedDir: 'E' });
  const once = mirrorBody(m, 'bmain');
  if (once.buildings[0].roof.shedDir !== 'W') return `pente retournée : ${once.buildings[0].roof.shedDir}`;
  if (canon(once) === canon(m)) return 'le retournement n’a rien changé';
  return canon(mirrorBody(once, 'bmain')) === canon(m) || 'le modèle a dérivé';
});

check('un quart de tour emporte ouvertures et objets de toit, et laisse le reste', () => {
  const m = estate();
  const r = rotateBody(m, 'bmain');
  const cells = new Set(r.buildings[0].cells);
  const cs = 1;
  const out = [];
  for (const o of r.openings.filter((x) => x.id !== 'og')) {
    if (!cells.has(o.edge.split(',').slice(0, 2).join(','))) out.push(`${o.id} hors du corps`);
  }
  for (const it of r.roofItems) {
    if (!cells.has(`${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`)) out.push(`${it.id} hors du toit`);
  }
  const solar = r.roofItems.find((it) => it.id === 'r2');
  if (solar.w !== 1.8 || solar.d !== 3) out.push('panneaux non tournés');
  if (canon(r.buildings[1]) !== canon(m.buildings[1])) out.push('le garage a bougé');
  if (canon(r.openings.find((o) => o.id === 'og')) !== canon(m.openings.find((o) => o.id === 'og'))) out.push('la porte du garage a bougé');
  if (canon(r.props) !== canon(m.props)) out.push('la terrasse a bougé');
  return !out.length || out.join(' ; ');
});

/**
 * Two fills, equal to a shade: a face's normal carries rounding noise of its
 * own, and the shading turns it into one unit of a channel here and there.
 */
const sameColour = (a, b) => {
  if (!a || !b) return a === b;
  const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return x.every((v, k) => Math.abs(v - y[k]) <= 2);
};

check('le rendu d’un corps tourné d’un quart de tour est celui du corps d’origine vu à 90° de lacet', () => {
  // Hip roof, so no ridge direction is left to a tie between equal sides.
  const base = normalise({
    ...estate({ type: 'hip', pitch: 30 }),
    buildings: [estate({ type: 'hip', pitch: 30 }).buildings[0]],
    props: [],
    openings: estate().openings.filter((o) => o.id !== 'og'),
  });
  const turned = rotateBody(base, 'bmain');
  const W = 420, H = 320;
  const a = renderScene({ ...turned, camera: { ...turned.camera, yaw: 0 } }, { width: W, height: H });
  const b = renderScene({ ...base, camera: { ...base.camera, yaw: 270 } }, { width: W, height: H });
  let diff = 0, compared = 0;
  for (let y = 3.37; y < H; y += 7) {
    for (let x = 2.61; x < W; x += 7) {
      const fa = topFaceAt(a, [x, y]), fb = topFaceAt(b, [x, y]);
      compared++;
      if (!sameColour(fa?.fill, fb?.fill)) diff++;
    }
  }
  return diff === 0 || `${diff} points sur ${compared} diffèrent`;
});

check('déplacer un corps l’emporte avec ce qu’il porte, et refuse de recouvrir un autre corps', () => {
  const m = estate();
  const r = moveBody(m, 'bmain', 3, -2);
  const o1 = r.openings.find((o) => o.id === 'o1');
  const ch = r.roofItems.find((it) => it.id === 'r1');
  if (o1.edge !== '15,8,S' || o1.offset !== 0.35) return `fenêtre en ${o1.edge}`;
  if (ch.x !== 14.5 || ch.y !== 13.3) return `cheminée en ${ch.x}, ${ch.y}`;
  return moveBody(m, 'bmain', 7, 0) === null || 'recouvrement accepté';
});

check('dupliquer un corps le pose à côté, avec ses ouvertures et ses objets de toit, ids neufs', () => {
  const m = estate();
  const { model: d, id } = duplicateBody(m, 'bmain');
  const copy = d.buildings.find((b) => b.id === id);
  if (!copy || d.buildings.length !== 3) return 'pas de copie';
  if (copy.name !== 'Maison (copie)') return `nom : ${copy.name}`;
  const all = d.buildings.flatMap((b) => b.cells);
  if (new Set(all).size !== all.length) return 'la copie recouvre un corps';
  if (d.openings.length !== m.openings.length + 4 || d.roofItems.length !== m.roofItems.length + 2) {
    return `${d.openings.length} ouvertures, ${d.roofItems.length} objets de toit`;
  }
  const ids = [...d.buildings, ...d.openings, ...d.roofItems].map((x) => x.id);
  if (new Set(ids).size !== ids.length) return 'ids en double';
  const again = normalise(JSON.parse(JSON.stringify(d)));
  return (canon(again.buildings) === canon(d.buildings) && again.openings.length === d.openings.length && !limitBreach(d))
    || 'la copie ne survit pas à une réouverture';
});

check('le magasin refuse et dit un quart de tour qui recouvrirait un autre corps', () => {
  const m = normalise({
    ...emptyModel(),
    buildings: [
      makeBuilding({ id: 'ba', cells: [...rectCells(0, 0, 7, 1)] }),
      makeBuilding({ id: 'bb', cells: [...rectCells(3, 3, 4, 4)] }),
    ],
  });
  const s = new Store(m);
  const said = [];
  s.onNotice = (x) => said.push(x);
  const done = s.rotateBuilding('ba');
  return (!done && s.model === s.model && canon(s.model) === canon(normalise(m)) && said.length === 1 && !s.canUndo)
    || `tourné : ${done}, messages : ${said.length}`;
});

check('Ctrl+D sur un corps sélectionné le duplique, et la copie devient le corps actif', () => {
  const s = new Store(estate());
  s.select({ type: 'building', id: 'bmain' });
  s.duplicateSelected();
  const copy = s.model.buildings[2];
  return (copy && s.activeBuildingId === copy.id && s.selection.id === copy.id) || 'copie absente ou non sélectionnée';
});

check('glisser un corps en mode Sélection le déplace par cases entières, en une étape, et s’arrête avant un autre', () => {
  const { s, view } = stagePlan(estate());
  s.setTool('select');
  const before = s.model;
  fireOn(view, '[data-building="bmain"]', 12.4, 12.4, 'pointerdown');
  if (s.selection?.id !== 'bmain') return 'corps non sélectionné';
  fire(view, 13.6, 12.6, 'pointermove');
  fire(view, 15.3, 12.6, 'pointermove'); // three cells east
  const at3 = s.model.buildings[0].cells.includes('19,10') && !s.model.buildings[0].cells.includes('10,10');
  fire(view, 19.4, 12.4, 'pointermove'); // seven: onto the garage
  fire(view, 19.4, 12.4, 'pointerup');
  if (!at3) return 'pas déplacé de trois cases';
  const o1 = s.model.openings.find((o) => o.id === 'o1');
  if (o1.edge !== '15,10,S') return `fenêtre restée en ${o1.edge}`;
  if (!s.model.buildings[0].cells.includes('19,10') || s.model.buildings[0].cells.includes('22,10')) {
    return 'le corps a recouvert le garage ou n’est pas resté au dernier endroit libre';
  }
  s.undo();
  return (canon(s.model) === canon(before) && !s.canUndo) || 'plus d’une étape d’annulation';
});

/** Select a prop and pull one of its handles from where it is to (x, y). */
function pull(s, view, id, handle, x, y, extra = {}) {
  s.setTool('select');
  s.select({ type: 'prop', id });
  view.render();
  const h = view.svg.querySelector(`.plan-handle[data-handle="${handle}"]`);
  if (!h) throw new Error(`poignée ${handle} absente`);
  const hx = Number(h.getAttribute('x')) + 4.5, hy = Number(h.getAttribute('y')) + 4.5;
  const [wx, wy] = view.toWorld(hx, hy);
  fireOn(view, `.plan-handle[data-handle="${handle}"]`, wx, wy, 'pointerdown', extra);
  fire(view, x, y, 'pointermove', extra);
  fire(view, x, y, 'pointerup', extra);
}

check('les poignées d’un objet rectangulaire le redimensionnent au pas de 0,25 m, sans passer sous sa taille minimale', () => {
  const { s, view } = stagePlan(estate());
  const handles = (() => { s.setTool('select'); s.select({ type: 'prop', id: 'pt' }); view.render(); return view.svg.querySelectorAll('.plan-handle').length; })();
  if (handles !== 8) return `${handles} poignées`;
  pull(s, view, 'pt', 'ne', 8.6, 6.1);
  let t = s.model.props[0];
  if (!(t.x === 2 && t.y === 2 && t.w === 6.5 && t.d === 4)) return `après ne : ${JSON.stringify(t)}`;
  pull(s, view, 'pt', 'w', 30, 4);
  t = s.model.props[0];
  if (!(t.w === 0.25 && t.x === 8.25)) return `après w au-delà : ${JSON.stringify(t)}`;
  s.undo();
  return s.model.props[0].w === 6.5 || 'un redimensionnement fait plus d’une étape';
});

check('muret : une poignée à chaque bout, la longueur change, l’épaisseur non', () => {
  const m = normalise({ ...emptyModel(), props: [{ id: 'mu', kind: 'muret', x: 0, y: 5, w: 6, d: 0.24, h: 1.5 }] });
  const { s, view } = stagePlan(m);
  s.setTool('select');
  s.select({ type: 'prop', id: 'mu' });
  view.render();
  if (view.svg.querySelectorAll('.plan-handle').length !== 2) return 'pas deux poignées';
  pull(s, view, 'mu', 'b', 9.1, 7);
  const w = s.model.props[0];
  return (w.w === 9 && w.d === 0.24 && w.x === 0 && w.y === 5) || JSON.stringify(w);
});

check('arbre : une poignée de rayon', () => {
  const m = normalise({ ...emptyModel(), props: [{ id: 'tr', kind: 'tree', x: 5, y: 5, r: 1.5 }] });
  const { s, view } = stagePlan(m);
  pull(s, view, 'tr', 'r', 5, 7.43);
  if (s.model.props[0].r !== 2.4) return `rayon ${s.model.props[0].r}`;
  // No further than the inspector's slider goes, which would sit pinned.
  pull(s, view, 'tr', 'r', 5, 25);
  return s.model.props[0].r === 4 || `rayon ${s.model.props[0].r} au-delà du curseur`;
});

check('objet de toit : des poignées aux coins', () => {
  const { s, view } = stagePlan(estate());
  s.setTool('select');
  s.select({ type: 'roofItem', id: 'r2' });
  view.render();
  const ids = [...view.svg.querySelectorAll('.plan-handle')].map((h) => h.dataset.handle).sort().join(',');
  if (ids !== 'ne,nw,se,sw') return ids;
  const h = view.svg.querySelector('.plan-handle[data-handle="sw"]');
  const [wx, wy] = view.toWorld(Number(h.getAttribute('x')) + 4.5, Number(h.getAttribute('y')) + 4.5);
  fireOn(view, '.plan-handle[data-handle="sw"]', wx, wy, 'pointerdown');
  fire(view, 12.45, 10.6, 'pointermove');
  fire(view, 12.45, 10.6, 'pointerup');
  const it = s.model.roofItems.find((x) => x.id === 'r2');
  // East and north sides stay at 15,75 and 12,6.
  return (near(it.x + it.w / 2, 15.75) && near(it.y + it.d / 2, 12.6) && near(it.x - it.w / 2, 12.5)
    && near(it.y - it.d / 2, 10.5)) || JSON.stringify(it);
});

check('les poignées gardent leur taille à l’écran quel que soit le zoom', () => {
  const { s, view } = stagePlan(estate());
  s.setTool('select');
  s.select({ type: 'prop', id: 'pt' });
  view.render();
  const size = () => {
    const h = view.svg.querySelector('.plan-handle');
    const hit = view.svg.querySelector('.plan-handle-hit');
    return `${h.getAttribute('width')}/${hit.getAttribute('r')}`;
  };
  const a = size();
  view.zoomBy(2.5);
  return a === size() || `${a} devenu ${size()}`;
});

check('la zone de cadrage se déplace en la faisant glisser et se redimensionne par ses poignées', () => {
  const m = normalise({ ...emptyModel(), focus: { enabled: true, x: 2, y: 2, w: 8, d: 6, margin: 1.5 } });
  const { s, view } = stagePlan(m);
  s.setTool('frame');
  view.render();
  fireOn(view, '[data-focus="zone"]', 5, 5, 'pointerdown');
  fire(view, 8.1, 6.9, 'pointermove');
  fire(view, 8.1, 6.9, 'pointerup');
  let f = s.model.focus;
  if (!(f.x === 5 && f.y === 4 && f.w === 8 && f.d === 6)) return `après déplacement : ${JSON.stringify(f)}`;
  view.render();
  const h = view.svg.querySelector('.plan-handle[data-handle="e"]');
  const [wx, wy] = view.toWorld(Number(h.getAttribute('x')) + 4.5, Number(h.getAttribute('y')) + 4.5);
  fireOn(view, '.plan-handle[data-handle="e"]', wx, wy, 'pointerdown');
  fire(view, 20.4, 7, 'pointermove');
  fire(view, 20.4, 7, 'pointerup');
  f = s.model.focus;
  return (f.x === 5 && f.w === 15.5 && f.d === 6) || `après poignée : ${JSON.stringify(f)}`;
});

check('l’aimantation colle un bord à une ligne de mur à moins de 0,30 m, le dit d’un repère, et Alt la suspend', () => {
  const out = [];
  for (const alt of [false, true]) {
    const { s, view } = stagePlan(estate());
    s.setTool('select');
    fireOn(view, '[data-id="pt"]', 4, 3, 'pointerdown', { altKey: alt });
    // East edge from 7,5 to 9,8: twenty centimetres short of the wall at x = 10.
    fire(view, 6.3, 3, 'pointermove', { altKey: alt });
    const guide = !!view.svg.querySelector('.plan-guide');
    fire(view, 6.3, 3, 'pointerup', { altKey: alt });
    const t = s.model.props[0];
    if (!alt && !(t.x === 4.5 && guide)) out.push(`aimanté : x = ${t.x}, repère ${guide}`);
    if (alt && !(t.x === 4.25 && !guide)) out.push(`Alt : x = ${t.x}, repère ${guide}`);
  }
  return !out.length || out.join(' ; ');
});

check('les flèches déplacent la sélection, une ouverture le long de son mur, un corps d’une case — en une étape', () => {
  const s = new Store(estate());
  const out = [];
  s.select({ type: 'prop', id: 'pt' });
  nudgeSelection(s, 1, 0); nudgeSelection(s, 1, 0); nudgeSelection(s, 0, 1, true);
  const t = s.model.props[0];
  if (!(t.x === 2.5 && t.y === 3)) out.push(`terrasse en ${t.x}, ${t.y}`);
  s.undo();
  if (s.model.props[0].x !== 2) out.push('les pas de flèche ne sont pas groupés');
  s.select({ type: 'opening', id: 'o1' });
  nudgeSelection(s, 1, 0);
  nudgeSelection(s, 0, 1); // across the wall: nothing
  if (!near(s.selected.offset, 0.4)) out.push(`fenêtre à ${s.selected.offset}`);
  nudgeSelection(s, -1, 0, true);
  if (!near(s.selected.offset, 0.15)) out.push(`fenêtre (Maj) à ${s.selected.offset}`);
  s.select({ type: 'building', id: 'bmain' });
  nudgeSelection(s, 0, -1);
  if (!s.model.buildings[0].cells.includes('10,9')) out.push('le corps n’a pas bougé d’une case');
  return !out.length || out.join(' ; ');
});
