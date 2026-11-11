/** Revue d'octobre : reste. */

import { check } from './harness.js';
import { cellsOf, near, pointer } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise, fmtMetres, makeBuilding, stairsRun } from '../src/core/model.js';
import { faceColour } from '../src/core/palette.js';
import { Store } from '../src/ui/store.js';
import { placeProp } from '../src/ui/actions.js';
import { PlanView } from '../src/ui/plan.js';
import { Viewport } from '../src/ui/viewport.js';
import { Inspector } from '../src/ui/panels.js';

/* ---------------- revue d'octobre : reste ---------------- */

check('un escalier posé contre une terrasse haute a la longueur de sa hauteur', () => {
  const s = new Store(normalise({ ...emptyModel(),
    props: [{ id: 't1', kind: 'terrace', x: 0, y: 4, w: 6, d: 4, z: 2.5 }] }));
  placeProp(s, 'stairs', [3, 3]);
  const st = s.model.props.find((p) => p.kind === 'stairs');
  if (st.dir !== 'N' || !near(st.h, 2.5)) return `escalier ${st.dir} ${st.h}`;
  const steps = Math.round(2.5 / 0.18);
  if (st.d / steps < 0.27) return `giron de ${Math.round((st.d / steps) * 100)} cm`;
  return st.d === stairsRun(2.5) || `volée de ${st.d} m`;
});

check('la cote d’un muret en cours de tracé est celle du muret posé', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('muret');
  view.svg.dispatchEvent(pointer(view, 0.1, 5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 1.2, 5, 'pointermove'));
  const label = view.svg.querySelector('.rect-size')?.textContent;
  view.svg.dispatchEvent(pointer(view, 1.2, 5, 'pointerup'));
  const wall = s.model.props.find((p) => p.kind === 'muret');
  return (label === `${fmtMetres(wall.w)} m`) || `annoncé ${label}, posé ${wall.w} m`;
});

check('Alt inverse aussi la gomme', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('erase');
  view.svg.dispatchEvent(pointer(view, 7.3, 7.2, 'pointerdown', { altKey: true }));
  view.svg.dispatchEvent(pointer(view, 7.3, 7.2, 'pointerup', { altKey: true }));
  return cellsOf(s.model).length === 1 || 'la gomme avec Alt n’a pas peint';
});

check('cliquer un volume dans le plan le rend actif', () => {
  const m = normalise({ ...emptyModel(), buildings: [
    makeBuilding({ id: 'b1', cells: [...rectCells(2, 2, 5, 5)] }),
    makeBuilding({ id: 'b2', cells: [...rectCells(10, 2, 12, 4)] })] });
  const s = new Store(m);
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  s.setTool('select');
  const cell = view.svg.querySelector('rect.cell[data-building="b2"]');
  if (!cell) return 'les cases ne portent pas leur volume';
  cell.dispatchEvent(pointer(view, 11, 3, 'pointerdown'));
  cell.dispatchEvent(pointer(view, 11, 3, 'pointerup'));
  return s.activeBuildingId === 'b2' || `actif : ${s.activeBuildingId}`;
});

check('une palette inconnue retombe sur la palette par défaut', () => {
  return faceColour('wall', 'inconnue', {}, [0, -1, 0]) === faceColour('wall', 'horizons', {}, [0, -1, 0])
    && normalise({ theme: 'inconnue' }).theme === 'horizons';
});

check('un objet extérieur incomplet prend les valeurs de son type', () => {
  const m = normalise({ ...emptyModel(), props: [
    { kind: 'stairs', x: 0, y: 0 }, { kind: 'soucoupe', x: 1, y: 1 }, { kind: 'tree', x: 'a', y: 2 }] });
  if (m.props.length !== 1) return `${m.props.length} objets gardés`;
  const st = m.props[0];
  return (st.w === 1.25 && st.d === 1.25 && st.h === 0.5 && st.dir === 'N') || JSON.stringify(st);
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
