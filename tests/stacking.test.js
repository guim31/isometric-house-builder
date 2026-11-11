/** Empilement au sol. */

import { check } from './harness.js';
import { near, orderOf } from './helpers.js';
import { mergeCoplanar } from '../src/core/mesh.js';
import { rectCells } from '../src/core/grid.js';
import { emptyModel, normalise } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';

/* ---------------- ground-level stacking ---------------- */


check('une piscine reste visible où qu’elle soit posée sur la terrasse', () => {
  // The bug: terrace and pool are large, near-coplanar faces, so their depth
  // is driven by position on the ground rather than by the millimetres of
  // height between them. A pool at the far end of a terrace was painted over.
  const base = {
    ...emptyModel(),
    cells: [...rectCells(20, 20, 28, 26)],
    props: [{ id: 't', kind: 'terrace', x: 4, y: 4, w: 12, d: 12, material: 'paving' }],
  };
  for (const [label, x, y] of [['fond', 5, 5], ['centre', 9, 9], ['avant', 12, 12]]) {
    const m = { ...base, props: [...base.props, { id: 'p', kind: 'pool', x, y, w: 4, d: 3 }] };
    const at = orderOf(m);
    if (at.water === undefined) return `${label} : eau absente du rendu`;
    if (!(at.water > at.paving)) return `${label} : eau dessinée avant la terrasse`;
    if (!(at.poolRim > at.paving)) return `${label} : margelle dessinée avant la terrasse`;
    if (!(at.water > at.poolRim)) return `${label} : eau dessinée avant sa margelle`;
  }
  return true;
});

check('une terrasse surélevée reçoit ses joues et redevient un volume', () => {
  const flat = normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 26, 25)],
    props: [{ id: 't', kind: 'terrace', x: 6, y: 6, w: 6, d: 4, material: 'paving' }],
  });
  const raised = normalise({ ...flat, props: [{ ...flat.props[0], z: 0.6 }] });
  const zTop = (m) => buildMesh(m).mesh.tris
    .filter((t) => t.mat === 'paving')
    .reduce((acc, t) => Math.max(acc, t.a[2], t.b[2], t.c[2]), 0);
  if (!near(zTop(flat), 0.012, 1e-6)) return `à plat, dalle à ${zTop(flat)} m`;
  if (!near(zTop(raised), 0.6, 1e-6)) return `surélevée, dalle à ${zTop(raised)} m`;
  // Sides exist: some paving faces must now be vertical.
  const built = buildMesh(raised);
  const vertical = built.mesh.tris.filter((t) => t.mat === 'paving' && Math.abs(t.n[2]) < 0.01);
  if (!vertical.length) return 'aucune joue verticale';
  // And it leaves the decal tiers, or it would sink behind the house.
  const faces = mergeCoplanar(built.mesh.tris).filter((f) => f.mat === 'paving');
  return faces.every((f) => !f.group.startsWith('decal')) || 'reste traitée comme un décalque plat';
});

check('une dalle surélevée masque bien ce qui reste au sol dessous', () => {
  // Deliberate, not an oversight: at ground level the pool now always wins,
  // but once the terrace is raised the pool really is underneath it. Raising
  // the pool too is the way to bring it back, which the inspector spells out.
  const m = normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 26, 25)],
    props: [
      { id: 't', kind: 'terrace', x: 4, y: 4, w: 12, d: 12, material: 'paving', z: 0.5 },
      { id: 'p', kind: 'pool', x: 6, y: 6, w: 4, d: 3 },
    ],
  });
  const at = orderOf(m);
  if (at.water === undefined) return 'eau absente du rendu';
  if (!(at.paving > at.water)) return 'la dalle surélevée ne recouvre pas la piscine';
  // And raising the pool as well brings it back on top.
  const both = normalise({ ...m, props: m.props.map((p) => ({ ...p, z: 0.5 })) });
  const at2 = orderOf(both);
  return at2.water > at2.paving || 'piscine surélevée toujours masquée';
});

check('une piscine surélevée garde son eau au-dessus de la margelle', () => {
  const m = normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 26, 25)],
    props: [{ id: 'p', kind: 'pool', x: 6, y: 6, w: 5, d: 3, z: 0.5 }],
  });
  const at = orderOf(m);
  return (at.water !== undefined && at.poolRim !== undefined && at.water > at.poolRim)
    || 'eau masquée par la margelle';
});
