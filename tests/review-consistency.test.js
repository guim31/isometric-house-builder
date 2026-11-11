/** Revue d'octobre : incohérences. */

import { check } from './harness.js';
import { B, near } from './helpers.js';
import { boundaryRuns, rectCells, runExtents } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise, withCellSize, makeBuilding, storeyHeightOf } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { hitLayer } from '../src/render/hit.js';
import { PRESETS } from '../src/data/presets.js';
import { Store } from '../src/ui/store.js';
import { Inspector } from '../src/ui/panels.js';

/* ---------------- revue d'octobre : incohérences ---------------- */

check('une ouverture d’un niveau supprimé n’est plus dessinée, et revient avec lui', () => {
  const mk = (storeys) => normalise({ ...emptyModel(),
    buildings: [makeBuilding({ id: 'b1', cells: [...rectCells(0, 0, 5, 3)], storeys })],
    openings: [{ id: 'o1', edge: '2,0,S', kind: 'window', storey: 1, offset: 0.5, width: 1, height: 1, sill: 0.9 }] });
  const glass = (m) => buildMesh(m).mesh.tris.filter((t) => t.mat === 'glass').length;
  if (!glass(mk(2))) return 'fenêtre absente à deux niveaux';
  if (glass(mk(1))) return 'fenêtre dessinée au-dessus de l’égout';
  const one = mk(1);
  const out = renderScene(one, { width: 300, height: 200 });
  if (hitLayer(one, out.camera, out.built).includes('data-id="o1"')) return 'cible de sélection fantôme';
  return one.openings.length === 1 || 'ouverture perdue';
});

check('l’étage d’une ouverture orpheline reste réglable', () => {
  const s = new Store(normalise({ ...emptyModel(),
    buildings: [makeBuilding({ id: 'b1', cells: [...rectCells(0, 0, 5, 3)], storeys: 1 })],
    openings: [{ id: 'o1', edge: '2,0,S', kind: 'window', storey: 1 }] }));
  s.select({ type: 'opening', id: 'o1' });
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const label = [...div.querySelectorAll('.field-label')].some((l) => l.textContent === 'Étage');
  div.remove();
  return label || 'aucun sélecteur d’étage';
});

check('repasser à un niveau garde la hauteur affichée et celle des autres niveaux', () => {
  const m = normalise({ ...emptyModel(), buildings: [makeBuilding({
    cells: ['0,0'], storeys: 1, storeyHeight: 2.7, storeyHeights: [2.5, 2.2] })] });
  if (B(m).storeyHeights?.length !== 2) return 'hauteurs du niveau retiré perdues';
  return near(storeyHeightOf(B(m), 0), 2.5) || 'hauteur du rez-de-chaussée';
});

check('une trame plus grossière laisse les ouvertures en place', () => {
  // Half-metre grid, window centred 1,75 m along the south wall.
  const fine = normalise({ ...emptyModel(), grid: { cellSize: 0.5 },
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 11, 7)] })],
    openings: [{ id: 'o1', edge: '3,0,S', kind: 'window', offset: 0.25, width: 1 }] });
  const coarse = withCellSize(fine, 1);
  const op = coarse.openings[0];
  const [i] = op.edge.split(',').map(Number);
  return near(i * 1 + op.offset, 1.75) || `centre à ${i + op.offset} m`;
});

check('un fichier en trame de 0,25 m s’ouvre sur la trame de 0,50 m', () => {
  const m = normalise({ ...emptyModel(), grid: { cellSize: 0.25 },
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 15, 11)] })] });
  return (m.grid.cellSize === 0.5 && B(m).cells.length === 8 * 6) || `${m.grid.cellSize} m, ${B(m).cells.length} cases`;
});

check('une ouverture incomplète prend les valeurs de son type', () => {
  const m = normalise({ ...emptyModel(), buildings: [makeBuilding({ cells: [...rectCells(0, 0, 3, 3)] })],
    openings: [{ edge: '1,0,S', kind: 'door' }, { edge: '2,0,S' }, { edge: 'n’importe quoi' }] });
  if (m.openings.length !== 2) return `${m.openings.length} ouvertures gardées`;
  const [door, win] = m.openings;
  if (door.sill !== 0 || door.height !== 2.1) return `porte : allège ${door.sill}`;
  return (win.kind === 'window' && win.sill === 0.95 && win.offset === 0.5) || JSON.stringify(win);
});

check('une terrasse surélevée et un escalier se sélectionnent par leurs côtés', () => {
  const m = normalise({ ...emptyModel(), props: [
    { id: 't1', kind: 'terrace', x: 0, y: 0, w: 4, d: 3, z: 2.5 },
    { id: 's1', kind: 'stairs', x: 4, y: 0, w: 1.25, d: 1.25, h: 2.5, dir: 'W' },
    { id: 'g1', kind: 'terrace', x: 0, y: 6, w: 4, d: 3 }] });
  const out = renderScene(m, { width: 400, height: 300 });
  const hits = hitLayer(m, out.camera, out.built);
  const count = (id) => hits.split(`data-id="${id}"`).length - 1;
  if (count('t1') < 5) return `terrasse : ${count('t1')} cible(s)`;
  if (count('s1') < 5) return `escalier : ${count('s1')} cible(s)`;
  return count('g1') === 1 || 'une terrasse au sol reste une simple dalle';
});

check('un champ numérique s’en tient à ses bornes', () => {
  const s = new Store(normalise({ ...defaultModel(), focus: { enabled: true, x: 0, y: 0, w: 10, d: 8 } }));
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const width = [...div.querySelectorAll('.field')]
    .find((f) => f.querySelector('.field-label')?.textContent === 'Largeur')?.querySelector('input');
  width.value = '';
  width.dispatchEvent(new Event('change', { bubbles: true }));
  const afterEmpty = s.model.focus.w;
  width.value = '-5';
  width.dispatchEvent(new Event('change', { bubbles: true }));
  const afterNeg = s.model.focus.w;
  div.remove();
  if (afterEmpty !== 10) return `champ vidé : largeur ${afterEmpty}`;
  return afterNeg === 2 || `largeur négative acceptée : ${afterNeg}`;
});

check('le curseur de position montre une ouverture qui dépasse son pan', () => {
  const s = new Store(normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 3)] })],
    openings: [{ id: 'o1', edge: '0,0,S', kind: 'window', offset: -0.75, width: 1 }] }));
  s.select({ type: 'opening', id: 'o1' });
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const pos = [...div.querySelectorAll('.field')]
    .find((f) => f.querySelector('.field-label')?.textContent === 'Position')?.querySelector('input');
  const v = Number(pos.value);
  div.remove();
  return near(v, -1.25, 0.01) || `affiché ${v}`;
});

check('aucun modèle de départ n’a d’ouvertures qui se chevauchent ou dépassent', () => {
  for (const p of PRESETS) {
    const m = normalise({ ...p.model, name: p.name });
    const cs = m.grid.cellSize;
    for (const b of m.buildings) {
      const cells = new Set(b.cells);
      const ext = runExtents(cells, cs);
      const runOf = new Map();
      boundaryRuns(cells).forEach((r, i) => r.ids.forEach((id) => runOf.set(id, i)));
      const spans = [];
      for (const op of m.openings) {
        const e = ext.get(op.edge);
        if (!e || (op.storey || 0) >= b.storeys) continue;
        const lo = op.offset - op.width / 2 - e.lo, hi = op.offset + op.width / 2 - e.lo;
        if (lo < -1e-6 || hi > e.hi - e.lo + 1e-6) return `${p.id} : ${op.edge} dépasse de son pan`;
        for (const t of spans) {
          if (t.run === runOf.get(op.edge) && t.st === op.storey && lo < t.hi - 1e-6 && t.lo < hi - 1e-6) {
            return `${p.id} : ${op.edge} chevauche ${t.edge}`;
          }
        }
        spans.push({ run: runOf.get(op.edge), st: op.storey, lo, hi, edge: op.edge });
      }
    }
  }
  return true;
});
