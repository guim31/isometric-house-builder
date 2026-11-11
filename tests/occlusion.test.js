/** Occlusion. */

import { check } from './harness.js';
import { near, occlusionErrors } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { emptyModel, normalise, makeBuilding } from '../src/core/model.js';
import { PRESETS } from '../src/data/presets.js';

/* ---------------- occlusion ---------------- */



check('un panneau solaire ne traverse jamais le toit', () => {
  // Reported in use: from some angles the panels on the far slope showed
  // through the near one. An item resting on a surface was anchored to
  // whichever surface covered it on screen, nearest first — which, for a panel
  // beyond the ridge, is the slope that ought to hide it.
  const cells = [...rectCells(0, 0, 15, 8), ...rectCells(0, 9, 8, 12)];
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({
      cells,
      roof: { type: 'hip', pitch: 30, overhang: 0.5, fascia: 0.16, shedDir: 'S' },
    })],
    // Near the crease of the L, where two slopes meet — the placement that
    // put a panel on one slope and a covering surface on the other.
    roofItems: [
      { id: 'p1', kind: 'solar', x: 5, y: 6.5, w: 4, d: 2.4 },
      { id: 'p2', kind: 'solar', x: 9, y: 8.5, w: 4, d: 2.4 },
      { id: 'p3', kind: 'solar', x: 3, y: 10, w: 3, d: 2 },
    ],
  });
  for (const pitch of [10, 16, 24, 35]) {
    for (const yaw of [0, 75, 90, 105, 135, 225, 255, 270]) {
      const bad = occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4);
      for (const [k, e] of bad) {
        // Half a metre: deep enough that it cannot be an edge, shallow enough
        // that the fault this guards — metres of roof — cannot slip under it.
        if (/^roof.* masqué par solar/.test(k) && e.gap > 0.5) {
          return `${yaw}°/${pitch}° : ${e.n} px, ${e.gap.toFixed(1)} m — ${k}`;
        }
      }
    }
  }
  return true;
});

check('un renfoncement ne crée pas de recouvrement grossier', () => {
  // Both shapes: the niche exactly the size of the opening, and the porch a
  // user asked for, wider and taller than the door standing in it.
  const mk = (extra) => normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5,
      width: 1.7, height: 2.15, sill: 0, depth: 0.6, ...extra }] });
  for (const extra of [{}, { sides: 0.8 }, { head: 0.3 }, { sides: 0.8, head: 0.3 }]) {
    const m = mk(extra);
    for (const yaw of [180, 210, 250, 275, 300, 0]) {
      for (const [k, e] of occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch: 24 } }, 260, 200, 4)) {
        if (e.gap > 0.5 && e.n > 2) {
          return `${JSON.stringify(extra)} ${yaw}° : ${e.n} px, ${e.gap.toFixed(1)} m — ${k}`;
        }
      }
    }
  }
  return true;
});

check('une terrasse surélevée reste du bon côté des murs', () => {
  // Reported by a user, on his own house: a terrace at storey height was drawn
  // behind the wall it stands against at nineteen of thirty-six orientations,
  // by up to twelve metres. Two faults, one on top of the other. A raised slab
  // never entered the exact ordering pass, and a horizontal slab and a vertical
  // wall are separated by neither one's plane, so nothing could have ordered
  // them there either. And four coplanar terraces of the same material merged
  // into a single face wrapping around the house, for which no draw order is
  // right at all.
  //
  // His arrangement, reduced: terraces on three sides of the body, meeting at
  // its corners, at the height of the first floor.
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(11, 20, 20, 27)], storeys: 3,
      storeyHeights: [2.5, 2.5, 1],
      roof: { type: 'gable', pitch: 40, overhang: 0.5, fascia: 0.18, shedDir: 'S' } })],
    props: [
      { id: 'pa', kind: 'terrace', x: 11, y: 18, w: 6.5, d: 2, material: 'paving', z: 2.5 },
      { id: 'pb', kind: 'terrace', x: 9, y: 18, w: 2, d: 10, material: 'paving', z: 2.5 },
      { id: 'pc', kind: 'terrace', x: 9, y: 28, w: 13, d: 2, material: 'paving', z: 2.5 },
      { id: 'pd', kind: 'terrace', x: 21, y: 22, w: 1, d: 6, material: 'paving', z: 2.5 },
      // And the steps down from it, which are solids of the same family.
      { id: 'pe', kind: 'stairs', x: 9, y: 16, w: 1.5, d: 2, h: 2.5, dir: 'N', material: 'paving' },
    ] });
  for (let yaw = 0; yaw < 360; yaw += 30) {
    for (const pitch of [13, 30, 60]) {
      for (const [k, e] of occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4)) {
        if (/^(slab|stairs)/.test(k) && e.gap > 0.5 && e.n > 2) {
          return `${yaw}°/${pitch}° : ${e.n} px, ${e.gap.toFixed(1)} m — ${k}`;
        }
      }
    }
  }
  return true;
});

check('un mur ne passe jamais devant le toit qui le couvre', () => {
  // What the free camera exposed, twice over. Sorting faces on their centres
  // held at one fixed angle and stopped holding once the angle was free: a roof
  // slope tilts away, so its centre sits behind its eave while the wall below
  // has its centre on its own plane, and the wall painted over the overhang.
  // Swept on both axes, because the first version of this check swept the
  // camera height alone and passed while the fault was plainly visible at 8°
  // from the orientations the user actually uses.
  for (const id of ['provence', 'chalet']) {
    const m = normalise({ ...PRESETS.find((p) => p.id === id).model });
    for (const pitch of [8, 14, 24, 40]) {
      for (const yaw of [0, 67, 146, 220, 310]) {
        const bad = occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4);
        for (const [k, e] of bad) {
          if (/^roof.* masqué par wall/.test(k)) {
            return `${id} ${yaw}°/${pitch}° : ${e.n} px — ${k}`;
          }
        }
      }
    }
  }
  return true;
});

check('aucun recouvrement grossier, à tout angle de caméra', () => {
  // A budget rather than zero: a few pixels still invert along shared
  // silhouette edges — a chimney against its own roof, the frame of a solar
  // panel against its cells. Those predate the free camera. The budget exists
  // to catch the next one that is not of that kind.
  let worst = 0, name = '';
  for (const id of ['provence', 'chalet', 'pavillon']) {
    const m = normalise({ ...PRESETS.find((p) => p.id === id).model });
    for (const pitch of [8, 20, 40]) {
      for (const yaw of [0, 45, 146, 220, 310]) {
        for (const [k, e] of occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 260, 200, 4)) {
          if (e.n > worst) { worst = e.n; name = `${id} ${k} (${yaw}°/${pitch}°)`; }
        }
      }
    }
  }
  return worst <= 20 || `${worst} px : ${name}`;
});
