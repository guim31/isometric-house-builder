/** Plan. */

import { check } from './harness.js';
import { cellsOf, near, pointer } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise } from '../src/core/model.js';
import { Store } from '../src/ui/store.js';
import { PlanView } from '../src/ui/plan.js';

/* ---------------- interface ---------------- */


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
  // Along the same wall it keeps its edge, the distance growing — as the
  // arrows and the render's drag keep it; what counts is where it stands.
  const [i, , side] = op().edge.split(',');
  const centre = Number(i) + op().offset;
  if (side !== 'S' || Math.abs(centre - 14.4) > 0.051) return `centre en x = ${centre} sur ${op().edge}`;
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
  const before = view.view.scale;
  view.svg.dispatchEvent(pev(1, 100, 100, 'pointerdown'));
  view.svg.dispatchEvent(pev(2, 200, 100, 'pointerdown'));
  view.svg.dispatchEvent(pev(2, 260, 100, 'pointermove'));
  const zoom = view.view.scale / before;
  const zoomed = zoom > 1.2;
  view.svg.dispatchEvent(pev(1, 100, 100, 'pointerup'));
  view.svg.dispatchEvent(pev(2, 260, 100, 'pointerup'));
  return zoomed || `zoom resté à ${zoom.toFixed(2)}`;
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
