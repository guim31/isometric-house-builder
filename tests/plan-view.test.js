/**
 * Plan : une vue qui ne bouge que quand on le demande.
 *
 * Real pointer and wheel events on a PlanView; the view is read through the
 * size of a cell on screen, which is what a hand feels slipping.
 */

import { check } from './harness.js';
import { near, pointer } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise, makeBuilding } from '../src/core/model.js';
import { Store } from '../src/ui/store.js';
import { PlanView, PLAN_SCALE } from '../src/ui/plan.js';

/** A plan in its own box of the test stage. */
export function stagePlan(model = defaultModel(), w = 440, h = 600) {
  const div = document.createElement('div');
  div.style.cssText = `position:relative;width:${w}px;height:${h}px`;
  document.getElementById('stage').appendChild(div);
  const s = new Store(model);
  const view = new PlanView(div, s);
  view.render();
  return { s, view, div };
}

/** Width of a cell on screen, in pixels. */
const cellPx = (view) => Number(view.svg.querySelector('.cell')?.getAttribute('width'));

const fire = (view, wx, wy, type, extra) => view.svg.dispatchEvent(pointer(view, wx, wy, type, extra));

/** The same, on the element drawn for `id` — what a click on it would hit. */
export const fireOn = (view, sel, wx, wy, type, extra) => {
  const target = view.svg.querySelector(sel);
  if (!target) throw new Error(`rien à saisir pour ${sel}`);
  target.dispatchEvent(pointer(view, wx, wy, type, extra));
};

check('la taille d’une case ne change ni pendant ni après un trait qui sort de l’emprise', () => {
  const { s, view } = stagePlan();
  s.setTool('paint');
  const before = cellPx(view);
  const sizes = [];
  // Out from the house towards the far edge of the panel, step by step.
  const pts = [[20.5, 14.5], [26.5, 14.5], [32.5, 14.5], [38.5, 14.5]];
  fire(view, ...pts[0], 'pointerdown');
  for (const p of pts.slice(1)) {
    fire(view, ...p, 'pointermove');
    view.render();
    sizes.push(cellPx(view));
  }
  fire(view, ...pts[pts.length - 1], 'pointerup');
  sizes.push(cellPx(view));
  if (!s.model.buildings[0].cells.includes('38,14')) return 'le trait n’a pas atteint le bout';
  return sizes.every((v) => near(v, before, 1e-9)) || `case de ${before} px devenue ${sizes.join(', ')} px`;
});

check('la taille d’une case ne change pas en déplaçant un objet vers le bord', () => {
  const { s, view } = stagePlan();
  s.setTool('select');
  const before = cellPx(view);
  const tree = s.model.props.find((p) => p.kind === 'tree');
  fireOn(view, `[data-id="${tree.id}"]`, tree.x, tree.y, 'pointerdown');
  if (s.selection?.id !== tree.id) return 'arbre non saisi';
  const sizes = [];
  for (const dx of [5, 15, 30]) {
    fire(view, tree.x + dx, tree.y, 'pointermove');
    view.render();
    sizes.push(cellPx(view));
  }
  fire(view, tree.x + 30, tree.y, 'pointerup');
  sizes.push(cellPx(view));
  if (s.selected.x < tree.x + 29) return `arbre resté à x = ${s.selected.x}`;
  return sizes.every((v) => near(v, before, 1e-9)) || `case de ${before} px devenue ${sizes.join(', ')} px`;
});

check('une modification du modèle ne recadre pas le plan ; ouvrir un projet, si', () => {
  const { s, view } = stagePlan();
  const before = { ...view.view };
  s.update((m) => ({ ...m, buildings: [...m.buildings, makeBuilding({ id: 'bfar', cells: [...rectCells(60, 60, 64, 64)] })] }));
  view.render();
  if (view.view.scale !== before.scale || view.view.cx !== before.cx) return 'la vue a suivi la modification';
  view.refit();
  view.render();
  return view.view.scale < before.scale || 'la vue n’a pas été ajustée au nouveau contenu';
});

check('la molette zoome sous le curseur, dans des bornes', () => {
  const { view } = stagePlan();
  const r = view.svg.getBoundingClientRect();
  const wheel = (dy) => view.svg.dispatchEvent(new WheelEvent('wheel', {
    clientX: r.left + 100, clientY: r.top + 150, deltaY: dy, bubbles: true, cancelable: true,
  }));
  const anchor = view.toWorld(100, 150);
  wheel(-100);
  const after = view.toWorld(100, 150);
  if (!near(anchor[0], after[0], 1e-6) || !near(anchor[1], after[1], 1e-6)) return 'le point sous le curseur a glissé';
  for (let k = 0; k < 80; k++) wheel(-100);
  if (view.view.scale > PLAN_SCALE[1] + 1e-9) return `zoom avant sans borne : ${view.view.scale}`;
  for (let k = 0; k < 160; k++) wheel(100);
  return view.view.scale >= PLAN_SCALE[0] - 1e-9 || `zoom arrière sans borne : ${view.view.scale}`;
});

check('Maj + glisser, le bouton du milieu et Espace + glisser déplacent le plan, quel que soit l’outil', () => {
  const out = [];
  for (const how of ['shift', 'middle', 'space']) {
    const { s, view } = stagePlan();
    s.setTool('paint');
    const cells = s.model.buildings[0].cells.length;
    const cx = view.view.cx;
    fire(view, 30.5, 30.5, 'pointermove');
    if (how === 'space') window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const extra = how === 'shift' ? { shiftKey: true } : how === 'middle' ? { button: 1 } : {};
    const r = view.svg.getBoundingClientRect();
    const [px, py] = view.toPx(30.5, 30.5);
    const ev = (type, x) => view.svg.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + x, clientY: r.top + py, bubbles: true, pointerId: 1, isPrimary: true, button: 0, ...extra,
    }));
    ev('pointerdown', px); ev('pointermove', px - 50); ev('pointerup', px - 50);
    if (how === 'space') window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    const moved = near(view.view.cx - cx, 50 / view.view.scale, 1e-6);
    if (!moved) out.push(`${how} : centre ${cx} → ${view.view.cx}`);
    if (s.model.buildings[0].cells.length !== cells) out.push(`${how} : a peint`);
  }
  return !out.length || out.join(' ; ');
});

check('glisser sur le vide en mode Sélection déplace le plan', () => {
  const { s, view } = stagePlan();
  s.setTool('select');
  const cy = view.view.cy;
  fire(view, 2, 2, 'pointerdown');
  fire(view, 2, 5, 'pointermove');
  fire(view, 2, 5, 'pointerup');
  return near(cy - view.view.cy, 3, 1e-6) || `centre ${cy} → ${view.view.cy}`;
});

check('deux doigts qui glissent ensemble déplacent le plan', () => {
  const { s, view } = stagePlan();
  s.setTool('select');
  const r = view.svg.getBoundingClientRect();
  const pev = (id, x, y, type) => view.svg.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1, button: 0, pointerType: 'touch',
  }));
  const grabbed = view.toWorld(150, 200);
  pev(1, 100, 200, 'pointerdown');
  pev(2, 200, 200, 'pointerdown');
  pev(1, 100, 260, 'pointermove');
  pev(2, 200, 260, 'pointermove');
  const now = view.toWorld(150, 260);
  pev(1, 100, 260, 'pointerup');
  pev(2, 200, 260, 'pointerup');
  return (near(now[0], grabbed[0], 1e-6) && near(now[1], grabbed[1], 1e-6))
    || `point saisi (${grabbed.map((v) => v.toFixed(2))}) retrouvé en (${now.map((v) => v.toFixed(2))})`;
});

check('un second doigt annule le trait que le premier venait de commencer', () => {
  const { s, view } = stagePlan(normalise(emptyModel()));
  s.setTool('paint');
  const r = view.svg.getBoundingClientRect();
  const [ax, ay] = view.toPx(10.5, 10.5);
  const pev = (id, x, y, type) => view.svg.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1, button: 0, pointerType: 'touch',
  }));
  pev(1, ax, ay, 'pointerdown');
  if (!s.model.buildings[0].cells.length) return 'le premier doigt n’a rien peint';
  pev(2, ax + 80, ay, 'pointerdown');
  pev(2, ax + 120, ay, 'pointermove');
  pev(1, ax, ay, 'pointerup');
  pev(2, ax + 120, ay, 'pointerup');
  return (!s.model.buildings[0].cells.length && !s.canUndo) || `cases restées : ${s.model.buildings[0].cells}`;
});

check('le pavé du plan zoome, dézoome et ajuste, et se commande au clavier', () => {
  const { view } = stagePlan();
  const buttons = [...view.pad.querySelectorAll('button')];
  if (buttons.length !== 3) return `${buttons.length} boutons`;
  if (!buttons.every((b) => b.type === 'button' && b.getAttribute('aria-label') && b.tabIndex === 0)) {
    return 'bouton sans libellé ou hors du parcours au clavier';
  }
  const fitted = view.view.scale;
  view.pad.querySelector('.plan-in').click();
  const zin = view.view.scale;
  view.pad.querySelector('.plan-out').click();
  view.pad.querySelector('.plan-out').click();
  const zout = view.view.scale;
  view.panBy(120, 40);
  view.pad.querySelector('.plan-fit').click();
  if (!(zin > fitted && zout < fitted)) return `zoom : ${fitted} → ${zin} → ${zout}`;
  return near(view.view.scale, fitted, 1e-9) || 'ajuster ne revient pas à la vue d’ensemble';
});

check('un redimensionnement du panneau garde le centre du plan', () => {
  const { view, div } = stagePlan();
  view.zoomBy(1.5);
  view.panBy(37, -21);
  const centre = view.toWorld(220, 300);
  const scale = view.view.scale;
  div.style.width = '300px';
  div.style.height = '420px';
  view.render();
  const now = view.toWorld(150, 210);
  return (near(now[0], centre[0], 1e-6) && near(now[1], centre[1], 1e-6) && view.view.scale === scale)
    || `centre (${centre.map((v) => v.toFixed(2))}) devenu (${now.map((v) => v.toFixed(2))})`;
});
