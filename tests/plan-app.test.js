/**
 * Plan, dans l'application réelle : clavier, inspecteur, recadrage à
 * l'ouverture — ce qui ne se voit qu'une fois tout câblé.
 */

import { checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { appStore } from './app.test.js';
import { rectCells } from '../src/core/grid.js';
import { emptyModel, makeBuilding, normalise } from '../src/core/model.js';

const stage = () => normalise({
  ...emptyModel(),
  buildings: [
    makeBuilding({ id: 'bmain', name: 'Maison', cells: [...rectCells(10, 10, 15, 14)] }),
    makeBuilding({ id: 'bgar', name: 'Garage', cells: [...rectCells(20, 10, 23, 13)] }),
  ],
  props: [{ id: 'pt', kind: 'terrace', x: 2, y: 2, w: 4, d: 3 }],
});

/** A key press as the page receives it, on `target`. */
const key = (win, target, k, extra = {}) => target.dispatchEvent(new win.KeyboardEvent('keydown', {
  key: k, bubbles: true, cancelable: true, ...extra,
}));

await checkAsync('dans l’application, les flèches déplacent la sélection, sauf depuis un champ', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  store.reset(stage());
  store.setTool('select');
  store.select({ type: 'prop', id: 'pt' });
  win.__app.render();
  key(win, doc.body, 'ArrowRight');
  key(win, doc.body, 'ArrowUp', { shiftKey: true });
  const t = store.selected;
  const moved = t.x === 2.25 && t.y === 3;
  const field = doc.querySelector('#inspector .panel-selected input[type="range"], #inspector .panel-selected input');
  if (field) key(win, field, 'ArrowRight');
  const kept = store.selected.x === 2.25;
  store.reset(before);
  if (!moved) return `terrasse en ${t.x}, ${t.y}`;
  return (field && kept) || 'un champ a perdu ses flèches au profit de la sélection';
});

await checkAsync('dans l’application, Échap annule le geste du plan sans désélectionner, puis désélectionne', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  store.reset(stage());
  store.setTool('select');
  win.__app.render();
  const plan = win.__app.plan;
  const r = plan.svg.getBoundingClientRect();
  const at = (wx, wy) => { const p = plan.toPx(wx, wy); return { clientX: r.left + p[0], clientY: r.top + p[1] }; };
  const ev = (target, type, wx, wy) => target.dispatchEvent(new win.PointerEvent(type, {
    ...at(wx, wy), bubbles: true, pointerId: 41, isPrimary: true, button: 0,
  }));
  const cell = plan.svg.querySelector('[data-building="bmain"]');
  ev(cell, 'pointerdown', 12.5, 12.5);
  ev(plan.svg, 'pointermove', 15.5, 12.5);
  const moved = store.model !== stage() && store.model.buildings[0].cells.includes('18,10');
  key(win, doc.body, 'Escape');
  ev(plan.svg, 'pointerup', 15.5, 12.5);
  const back = store.model.buildings[0].cells.includes('10,10') && !store.canUndo;
  const stillSelected = store.selection?.id === 'bmain';
  key(win, doc.body, 'Escape');
  const cleared = store.selection === null;
  store.reset(before);
  if (!moved) return 'le corps n’a pas suivi le glisser';
  if (!back) return 'le corps n’est pas revenu';
  if (!stillSelected) return 'Échap a aussi désélectionné';
  return cleared || 'le second Échap n’a pas désélectionné';
});

await checkAsync('dans l’application, Ctrl+D et les boutons du corps dupliquent, tournent, retournent', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  store.reset(stage());
  store.setTool('select');
  store.setActiveBuilding('bmain');
  store.select({ type: 'building', id: 'bmain' });
  win.__app.render();
  key(win, doc.body, 'd', { ctrlKey: true });
  const out = [];
  if (store.model.buildings.length !== 3) out.push('Ctrl+D sans copie');
  win.__app.render();
  const button = (label) => [...doc.querySelectorAll('#inspector .body-action')].find((b) => b.textContent === label);
  for (const label of ['Dupliquer', 'Tourner ¼', 'Miroir']) {
    const b = button(label);
    if (!b) { out.push(`bouton ${label} absent`); continue; }
    const m = store.model;
    b.click();
    win.__app.render();
    if (store.model === m) out.push(`${label} sans effet`);
  }
  store.reset(before);
  return !out.length || out.join(' ; ');
});

await checkAsync('dans l’application, le plan se recadre sur un nouveau projet, pas sur une modification', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  store.reset(stage());
  win.__app.render();
  const plan = win.__app.plan;
  plan.fit();
  plan.zoomBy(2);
  const zoomed = plan.view.scale;
  store.update((m) => ({ ...m, props: [...m.props, { id: 'far', kind: 'tree', x: 80, y: 80, r: 1 }] }));
  win.__app.render();
  const kept = plan.view.scale === zoomed;
  const confirm = win.confirm;
  win.confirm = () => true;
  doc.getElementById('btn-new').click();
  win.confirm = confirm;
  win.__app.render();
  const refitted = plan.view.scale !== zoomed;
  store.reset(before);
  if (!kept) return 'une modification a recadré le plan';
  return refitted || 'Nouveau n’a pas recadré le plan';
});
