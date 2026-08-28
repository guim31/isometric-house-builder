/**
 * Roof generation.
 *
 * The roof is the upper envelope of one elementary roof per footprint
 * rectangle. Taking a max over rectangles is what produces correct ridges and
 * valleys where two wings meet, which is the whole reason the footprint is
 * decomposed into rectangles in the first place.
 *
 * The height field is sampled on a lattice, turned into triangles, and later
 * merged back into flat polygons by mesh.js. Because every rectangle edge and
 * every 45-degree hip crease lands exactly on lattice lines, the sampled
 * surface is not an approximation: it reproduces the analytic roof exactly.
 */

import { Mesh } from './mesh.js';

export const STEP = 0.25; // lattice resolution, in grid cells
export const ROOF_TYPES = ['hip', 'gable', 'flat', 'shed'];

const NEG = -1e9;

/** Snap an overhang so that the roof outline stays on the lattice. */
export function snapOverhang(v) {
  return Math.max(0, Math.round(v / STEP) * STEP);
}

/**
 * Build the height-above-eaves function for a set of rectangles.
 * Returns { h(x, y), inside(x, y), bbox }.
 */
export function heightField(rects, opts) {
  const { type = 'hip', pitch = 30, overhang = 0, shedDir = 'S' } = opts;
  const slope = type === 'flat' ? 0 : Math.tan((pitch * Math.PI) / 180);
  const o = snapOverhang(overhang);
  // The overhang is uniform on every side. Gable ends and the high side of a
  // shed are not special-cased here: walls rise to meet the roof underside, so
  // those vertical triangles come out of the wall builder instead. Keeping the
  // expansion uniform is what stops two overlapping rectangles from ending at
  // different places and tearing a cliff into the surface between them.
  const ex = rects.map((r) => ({
    x0: r.x0 - o, y0: r.y0 - o, x1: r.x1 + o, y1: r.y1 + o,
    alongX: r.x1 - r.x0 >= r.y1 - r.y0,
  }));

  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const r of ex) {
    bx0 = Math.min(bx0, r.x0); by0 = Math.min(by0, r.y0);
    bx1 = Math.max(bx1, r.x1); by1 = Math.max(by1, r.y1);
  }

  const inRect = (r, x, y) => x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && y >= r.y0 - 1e-9 && y <= r.y1 + 1e-9;

  function elementary(r, x, y) {
    const dW = x - r.x0, dE = r.x1 - x, dS = y - r.y0, dN = r.y1 - y;
    switch (type) {
      case 'flat':
        return 0;
      case 'shed': {
        const span = { S: r.y1 - r.y0, N: r.y1 - r.y0, W: r.x1 - r.x0, E: r.x1 - r.x0 }[shedDir];
        const d = { S: dN, N: dS, W: dE, E: dW }[shedDir];
        return (span - d) * slope;
      }
      case 'gable':
        // Ridge runs along the longer side, so the gable ends sit on the short walls.
        return (r.alongX ? Math.min(dS, dN) : Math.min(dW, dE)) * slope;
      default:
        return Math.min(dW, dE, dS, dN) * slope;
    }
  }

  function h(x, y) {
    let best = NEG;
    for (const r of ex) {
      if (!inRect(r, x, y)) continue;
      const v = elementary(r, x, y);
      if (v > best) best = v;
    }
    return best;
  }

  const inside = (x, y) => ex.some((r) => inRect(r, x, y));
  return { h, inside, bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, overhang: o, slope };
}

/**
 * Emit the roof into `mesh`.
 *
 * `wallTop` is the eaves height. Materials used: 'roof' for the slopes,
 * 'roofEdge' for the fascia band around the rim, and 'wall' for gable ends,
 * which is what the vertical part of a gable actually is.
 */
export function buildRoof(mesh, field, opts, wallTop) {
  if (!field) return null;
  const fascia = opts.fascia ?? 0.18;
  const { x0, y0, x1, y1 } = field.bbox;
  const nx = Math.round((x1 - x0) / STEP);
  const ny = Math.round((y1 - y0) / STEP);

  // Cache heights on lattice vertices; each is read by up to four cells.
  const H = new Float64Array((nx + 1) * (ny + 1));
  const hAt = (a, b) => H[b * (nx + 1) + a];
  for (let b = 0; b <= ny; b++) {
    for (let a = 0; a <= nx; a++) {
      H[b * (nx + 1) + a] = wallTop + Math.max(0, field.h(x0 + a * STEP, y0 + b * STEP));
    }
  }

  const cellInside = (a, b) => {
    if (a < 0 || b < 0 || a >= nx || b >= ny) return false;
    return field.inside(x0 + (a + 0.5) * STEP, y0 + (b + 0.5) * STEP);
  };

  let apex = wallTop;
  for (let b = 0; b < ny; b++) {
    for (let a = 0; a < nx; a++) {
      if (!cellInside(a, b)) continue;
      const px = x0 + a * STEP, py = y0 + b * STEP;
      const p00 = [px, py, hAt(a, b)];
      const p10 = [px + STEP, py, hAt(a + 1, b)];
      const p11 = [px + STEP, py + STEP, hAt(a + 1, b + 1)];
      const p01 = [px, py + STEP, hAt(a, b + 1)];
      apex = Math.max(apex, p00[2], p10[2], p11[2], p01[2]);

      // Pick the diagonal that reproduces the analytic surface at the centre:
      // this is what makes hip creases land exactly on the crease line.
      const centre = wallTop + Math.max(0, field.h(px + STEP / 2, py + STEP / 2));
      const dA = Math.abs((p00[2] + p11[2]) / 2 - centre);
      const dB = Math.abs((p10[2] + p01[2]) / 2 - centre);
      if (dA <= dB) {
        mesh.tri(p00, p10, p11, 'roof', 'roof');
        mesh.tri(p00, p11, p01, 'roof', 'roof');
      } else {
        mesh.tri(p00, p10, p01, 'roof', 'roof');
        mesh.tri(p10, p11, p01, 'roof', 'roof');
      }

      // Rim: the fascia band only. Anything vertical below it is wall, and
      // the wall builder already reaches up to the roof underside.
      const rim = [
        { on: !cellInside(a, b - 1), a: [px, py], b: [px + STEP, py], za: hAt(a, b), zb: hAt(a + 1, b) },
        { on: !cellInside(a + 1, b), a: [px + STEP, py], b: [px + STEP, py + STEP], za: hAt(a + 1, b), zb: hAt(a + 1, b + 1) },
        { on: !cellInside(a, b + 1), a: [px + STEP, py + STEP], b: [px, py + STEP], za: hAt(a + 1, b + 1), zb: hAt(a, b + 1) },
        { on: !cellInside(a - 1, b), a: [px, py + STEP], b: [px, py], za: hAt(a, b + 1), zb: hAt(a, b) },
      ];
      for (const e of rim) {
        if (!e.on) continue;
        const topA = e.za, topB = e.zb;
        const botA = topA - fascia, botB = topB - fascia;
        mesh.quad(
          [e.a[0], e.a[1], botA], [e.b[0], e.b[1], botB],
          [e.b[0], e.b[1], topB], [e.a[0], e.a[1], topA],
          'roofEdge', 'roofEdge',
        );
      }
    }
  }
  return { field, apex, wallTop, fascia };
}

/**
 * Height of the roof underside above a point, used by the wall builder.
 * Returns `wallTop` where there is no roof overhead.
 */
export function undersideAt(field, wallTop, fascia, x, y) {
  if (!field || !field.inside(x, y)) return wallTop;
  return Math.max(wallTop - fascia, wallTop + Math.max(0, field.h(x, y)) - fascia);
}
