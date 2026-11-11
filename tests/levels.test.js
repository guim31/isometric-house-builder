/** Niveaux, renfoncements, dalles surélevées. */

import { check } from './harness.js';
import { near } from './helpers.js';
import { mergeCoplanar } from '../src/core/mesh.js';
import { rectCells } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise, wallTop, makeBuilding, storeyBase, storeyHeightOf } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { Store } from '../src/ui/store.js';
import { placeProp } from '../src/ui/actions.js';
import { Viewport } from '../src/ui/viewport.js';

/* ---------------- per-level heights, recesses, raised slabs ---------------- */

check('chaque niveau peut avoir sa propre hauteur', () => {
  // The recurring real house: two full storeys and a short one under the
  // roof — the level where the slopes already start. One shared height cannot
  // say that, and rounding to whole storeys misses the house either way.
  const b = makeBuilding({ storeys: 3, storeyHeight: 2.7, storeyHeights: [2.5, 2.5, 1.1] });
  if (!near(wallTop(b), 2.5 + 2.5 + 1.1)) return `sommet à ${wallTop(b)}`;
  if (!near(storeyBase(b, 2), 5)) return `l’étage 2 démarre à ${storeyBase(b, 2)}`;
  // Unstated levels fall back to the shared height.
  const c = makeBuilding({ storeys: 3, storeyHeight: 2.7, storeyHeights: [2.5] });
  if (!near(storeyHeightOf(c, 1), 2.7)) return 'le repli sur la hauteur commune a disparu';
  // And normalise clamps what a hand-edited file may carry.
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: ['0,0'], storeys: 2, storeyHeights: [12, 'x'] })] });
  const hs = m.buildings[0].storeyHeights;
  return (hs[0] === 4 && hs[1] === m.buildings[0].storeyHeight)
    || `normalisation : ${JSON.stringify(hs)}`;
});

check('une fenêtre d’un étage sous combles se pose à la bonne hauteur', () => {
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({
      cells: [...rectCells(0, 0, 6, 4)], storeys: 3, storeyHeights: [2.5, 2.5, 1.1],
      roof: { type: 'gable', pitch: 40, overhang: 0.3, fascia: 0.16, shedDir: 'S' },
    })],
    openings: [{ id: 'o1', edge: '0,2,W', kind: 'window', storey: 2, offset: 0.5, width: 0.8, height: 0.7, sill: 0.2 }],
  });
  const glass = mergeCoplanar(buildMesh(m).mesh.tris).find((f) => f.mat === 'glass');
  if (!glass) return 'fenêtre absente du maillage';
  const z = glass.centroid[2];
  // Floor of level 2 at 5 m, sill 0.2, height 0.7 -> centre near 5.55.
  return (z > 5.4 && z < 5.7) || `vitrage centré à ${z.toFixed(2)} m`;
});

check('un renfoncement creuse un vrai trou dans le mur', () => {
  // The recess is geometry, not shading: the wall plane must be open where
  // the niche is, and the door drawn on the back panel. Checked in world
  // coordinates on the built mesh, not on pixels.
  const mk = (depth) => normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    // Wider than a cell on purpose: boundary edges are one cell long, and the
    // hole once stopped at its anchor edge — the wall next door kept covering
    // half the niche. Centred on its edge, so the sample points below hold
    // whichever way the edge runs.
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5, width: 1.7, height: 2.15, sill: 0, depth }] });
  const facesAt = (m) => mergeCoplanar(buildMesh(m).mesh.tris)
    .filter((f) => f.mat.startsWith('wall') && Math.abs(f.normal[0] + 1) < 1e-6
      && Math.abs(f.centroid[0]) < 1e-6);
  // Sample points across the hole (the wall is the x=0 plane; use y, z).
  // Edge '0,1,W' spans y 1..2; centred, the 1.7 m hole spans y 0.65..2.35.
  const inHole = [[1.5, 1], [0.9, 1], [2.1, 1], [1.5, 0.1], [1.5, 2.0]];
  const contains = (f, y, z) => {
    let c = false;
    for (const l of f.loops) {
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
        if ((l[i][2] > z) !== (l[j][2] > z)
          && y < ((l[j][1] - l[i][1]) * (z - l[i][2])) / (l[j][2] - l[i][2]) + l[i][1]) c = !c;
      }
    }
    return c;
  };
  for (const [y, z] of inHole) {
    if (facesAt(mk(0.6)).some((f) => contains(f, y, z))) {
      return `le mur couvre encore le trou en (${y}, ${z})`;
    }
  }
  // Flush, the wall is whole there — the hole must cost nothing by default.
  const whole = facesAt(mk(0));
  return inHole.every(([y, z]) => whole.some((f) => contains(f, y, z)))
    || 'sans renfoncement, le mur devrait être plein';
});

check('la niche d’un renfoncement est fermée : fond et quatre tableaux', () => {
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5, width: 1.7, height: 2.15, sill: 0, depth: 0.6 }] });
  const faces = mergeCoplanar(buildMesh(m).mesh.tris).filter((f) => f.mat.startsWith('wall'));
  // Back panel: wall-material face at x = +0.6 facing out.
  if (!faces.some((f) => Math.abs(f.centroid[0] - 0.6) < 0.05 && f.normal[0] < -0.9)) {
    return 'pas de fond de niche';
  }
  const reveal = (test) => faces.some((f) => f.centroid[0] > 0.05 && f.centroid[0] < 0.55 && test(f.normal));
  if (!reveal((n) => n[1] > 0.9)) return 'tableau latéral manquant (+y)';
  if (!reveal((n) => n[1] < -0.9)) return 'tableau latéral manquant (-y)';
  if (!reveal((n) => n[2] < -0.9)) return 'sous-face de linteau manquante';
  return reveal((n) => n[2] > 0.9) || 'seuil manquant';
});

check('un renfoncement peut être plus large que la porte', () => {
  // Asked for by a user with a porch: eighty centimetres of recessed wall on
  // either side of his front door. The hole and the niche follow the widened
  // extent; the leaf, its frame and its glass keep the door's own size.
  const mk = (extra) => normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 6, 4)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.3, fascia: 0.16, shedDir: 'S' } })],
    openings: [{ id: 'o1', edge: '0,1,W', kind: 'door', storey: 0, offset: 0.5,
      width: 1.2, height: 2.15, sill: 0, depth: 0.6, ...extra }] });
  // Edge '0,1,W' spans y 1..2; centred, a 1.2 m opening spans y 0.9..2.1, and
  // widened by 0.5 either side, y 0.4..2.6.
  const wallAt = (m) => mergeCoplanar(buildMesh(m).mesh.tris)
    .filter((f) => f.mat.startsWith('wall') && Math.abs(f.normal[0] + 1) < 1e-6
      && Math.abs(f.centroid[0]) < 1e-6);
  const contains = (f, y, z) => {
    let c = false;
    for (const l of f.loops) {
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
        if ((l[i][2] > z) !== (l[j][2] > z)
          && y < ((l[j][1] - l[i][1]) * (z - l[i][2])) / (l[j][2] - l[i][2]) + l[i][1]) c = !c;
      }
    }
    return c;
  };
  // Just outside the door, inside the widening: wall before, open after.
  const flanks = [[0.6, 1], [2.4, 1]];
  const plain = wallAt(mk({}));
  if (!flanks.every(([y, z]) => plain.some((f) => contains(f, y, z)))) {
    return 'sans débord, le mur devrait être plein de part et d’autre';
  }
  const wide = wallAt(mk({ sides: 0.5 }));
  for (const [y, z] of flanks) {
    if (wide.some((f) => contains(f, y, z))) return `le mur couvre encore le débord en (${y}, ${z})`;
  }
  // The niche's back panel grew with it, so nothing shows through the hole.
  const back = mergeCoplanar(buildMesh(mk({ sides: 0.5 })).mesh.tris)
    .find((f) => f.mat.startsWith('wall') && Math.abs(f.centroid[0] - 0.6) < 0.05 && f.normal[0] < -0.9);
  if (!back) return 'pas de fond de niche';
  const ys = back.loops[0].map((q) => q[1]);
  if (Math.max(...ys) - Math.min(...ys) < 2.2 - 1e-6) return 'le fond de niche n’a pas suivi le débord';
  // And the door itself did not grow with the hole.
  const leaf = mergeCoplanar(buildMesh(mk({ sides: 0.5 })).mesh.tris).find((f) => f.mat === 'door');
  if (!leaf) return 'porte introuvable';
  const ly = leaf.loops[0].map((q) => q[1]);
  return Math.max(...ly) - Math.min(...ly) < 1.2 + 1e-6
    || 'la porte a grandi avec le renfoncement';
});

check('une terrasse peut monter au niveau de l’étage', () => {
  // Sloping ground, approximated: the garage opens below, the terrace sits
  // level with the first floor. The slab keeps its skirts at that height.
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [{ id: 't', kind: 'terrace', x: 7, y: 0, w: 5, d: 4, z: 2.5, material: 'paving' }] });
  const faces = mergeCoplanar(buildMesh(m).mesh.tris);
  const topFace = faces.find((f) => f.mat === 'paving' && f.normal[2] > 0.9 && f.centroid[2] > 2.4);
  if (!topFace) return 'pas de plateau à 2,50 m';
  const skirt = faces.some((f) => f.mat === 'paving' && Math.abs(f.normal[2]) < 0.1
    && f.centroid[2] > 1 && f.centroid[2] < 2.5);
  return skirt || 'pas de joue sous le plateau';
});

check('un escalier monte jusqu’en haut, marche par marche', () => {
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [{ id: 's1', kind: 'stairs', x: 8, y: 0, w: 1.5, d: 1.5, h: 1.2, dir: 'N', material: 'paving' }] });
  const faces = mergeCoplanar(buildMesh(m).mesh.tris).filter((f) => f.mat === 'paving');
  const treads = faces.filter((f) => f.normal[2] > 0.9);
  if (treads.length < 4) return `${treads.length} marches seulement`;
  const top = Math.max(...treads.map((f) => f.centroid[2]));
  if (Math.abs(top - 1.2) > 1e-6) return `la dernière marche est à ${top.toFixed(2)} m au lieu de 1,20`;
  // Rising towards the north: the higher the tread, the further along +y.
  const sorted = [...treads].sort((a, b) => a.centroid[2] - b.centroid[2]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].centroid[1] <= sorted[i - 1].centroid[1]) return 'les marches ne montent pas vers le nord';
  }
  // Nothing underneath: the flight is closed, not a set of floating slabs.
  return !faces.some((f) => f.normal[2] < -0.9) || 'des sous-faces sont émises';
});

check('un escalier posé au pied d’une terrasse se tourne vers elle', () => {
  // Steps exist to reach something; turned the wrong way by default they would
  // have to be reoriented every time.
  const s = new Store(normalise({ ...emptyModel(),
    props: [{ id: 't1', kind: 'terrace', x: 0, y: 0, w: 6, d: 4, material: 'paving', z: 1.5 }] }));
  placeProp(s, 'stairs', [3, -1]); // just south of the terrace
  const a = s.model.props.find((p) => p.kind === 'stairs');
  if (!a) return 'pas d’escalier';
  if (a.dir !== 'N') return `monte vers ${a.dir} au lieu du nord`;
  if (Math.abs(a.h - 1.5) > 1e-9) return `hauteur ${a.h} au lieu de 1,5`;
  // And on the other side, the other way round.
  placeProp(s, 'stairs', [7.5, 2]);
  const b = s.model.props.filter((p) => p.kind === 'stairs')[1];
  return b.dir === 'W' || `monte vers ${b.dir} au lieu de l’ouest`;
});

check('le surlignage d’une ouverture sélectionnée existe et est fini', () => {
  // It read plinth and storey height off the model, fields the multi-building
  // migration deleted — the dashes quietly became NaN and vanished.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  const op = s.model.openings[0];
  if (!op) return 'le modèle par défaut n’a pas d’ouverture';
  s.select({ type: 'opening', id: op.id });
  vp.render();
  const html = div.innerHTML;
  if (!html.includes('selection-outline')) return 'pas de surlignage';
  return !html.includes('NaN') || 'le surlignage contient NaN';
});
