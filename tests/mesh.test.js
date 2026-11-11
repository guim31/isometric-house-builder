/** Maillage : fusion des faces coplanaires. */

import { check } from './harness.js';
import { near } from './helpers.js';
import { Mesh, mergeCoplanar } from '../src/core/mesh.js';

check('une boîte fusionne en six faces', () => {
  const m = new Mesh().box([0, 0, 0], [2, 3, 1], 'wall', 'wall');
  const f = mergeCoplanar(m.tris);
  return f.length === 6 || `obtenu ${f.length}`;
});

check('deux quads coplanaires disjoints restent deux faces', () => {
  const m = new Mesh();
  m.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], 'paving', 'paving');
  m.quad([5, 5, 0], [6, 5, 0], [6, 6, 0], [5, 6, 0], 'paving', 'paving');
  const f = mergeCoplanar(m.tris);
  if (f.length !== 2) return `obtenu ${f.length} face(s)`;
  // Distinct centroids are the point: a shared one would mean a shared depth.
  return !near(f[0].centroid[0], f[1].centroid[0]) || 'centres identiques';
});

check('deux quads coplanaires adjacents fusionnent en une face', () => {
  const m = new Mesh();
  m.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], 'paving', 'paving');
  m.quad([1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], 'paving', 'paving');
  const f = mergeCoplanar(m.tris);
  return (f.length === 1 && f[0].loops[0].length === 4) || `obtenu ${f.length} face(s)`;
});

check('un trou est rattaché à la face qui le contient', () => {
  const m = new Mesh();
  // Outer ring built from four strips around a central hole.
  const o = [[0, 0], [6, 0], [6, 6], [0, 6]];
  const i = [[2, 2], [4, 2], [4, 4], [2, 4]];
  const P = (p) => [p[0], p[1], 0];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    m.quad(P(o[k]), P(o[k2]), P(i[k2]), P(i[k]), 'paving', 'paving');
  }
  const f = mergeCoplanar(m.tris);
  return (f.length === 1 && f[0].loops.length === 2) || `${f.length} face(s), ${f[0]?.loops.length} boucle(s)`;
});
