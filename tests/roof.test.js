/** Toiture : champ de hauteur. */

import { check } from './harness.js';
import { near } from './helpers.js';
import { decomposeRects, rectCells } from '../src/core/grid.js';
import { heightField, snapOverhang, STEP } from '../src/core/roof.js';

check('la croupe culmine à la bonne hauteur', () => {
  const field = heightField([{ x0: 0, y0: 0, x1: 6, y1: 6 }], { type: 'hip', pitch: 45, overhang: 0 });
  return near(field.h(3, 3), 3, 1e-9) || `obtenu ${field.h(3, 3)}`;
});

check('la hauteur du toit est nulle à la rive', () => {
  const field = heightField([{ x0: 0, y0: 0, x1: 6, y1: 4 }], { type: 'hip', pitch: 30, overhang: 0 });
  return near(field.h(0, 2), 0, 1e-9) && near(field.h(3, 4), 0, 1e-9);
});

check('le débord est calé sur la trame', () => {
  return near(snapOverhang(0.37), 0.25) && near(snapOverhang(0.5), 0.5) && snapOverhang(-1) === 0;
});

check('deux ailes perpendiculaires ne créent pas de falaise dans le toit', () => {
  // The bug that produced a shredded fan at the junction of two gables.
  const cells = new Set([...rectCells(0, 0, 16, 6), ...rectCells(10, 7, 16, 12)]);
  const field = heightField(decomposeRects(cells), { type: 'gable', pitch: 30, overhang: 0.5 });
  let worst = 0;
  for (let y = -1; y <= 14; y += STEP) {
    for (let x = -1; x <= 18; x += STEP) {
      if (!field.inside(x, y) || !field.inside(x + STEP, y)) continue;
      worst = Math.max(worst, Math.abs(field.h(x + STEP, y) - field.h(x, y)));
    }
  }
  // One lattice step may not climb more than one step times the slope.
  const limit = STEP * Math.tan((30 * Math.PI) / 180) + 1e-9;
  return worst <= limit || `saut de ${worst.toFixed(3)} m pour ${limit.toFixed(3)} m permis`;
});
