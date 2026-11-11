/** Cotes et trame. */

import { check } from './harness.js';
import { B, cellsOf, near, pointer } from './helpers.js';
import { boundaryEdges, boundaryRuns, rectCells } from '../src/core/grid.js';
import { emptyModel, normalise, cellSet, wallTop, withCellSize, fmtMetres } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { Store } from '../src/ui/store.js';
import { PlanView } from '../src/ui/plan.js';

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
