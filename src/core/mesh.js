/**
 * Triangle soup in, clean flat polygons out.
 *
 * Every part of the house is emitted as small triangles on a lattice, which
 * keeps the geometry code trivial. This module then merges coplanar triangles
 * that share a material back into single polygons, which is what gives the
 * flat-illustration look: no seams between coplanar pieces, and the merged
 * outline is exactly the silhouette to stroke.
 */

const Q = 1e4; // vertex quantisation, in units of 1/10000

const vkey = (p) => `${Math.round(p[0] * Q)},${Math.round(p[1] * Q)},${Math.round(p[2] * Q)}`;

export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export class Mesh {
  constructor() { this.tris = []; }

  /**
   * Add a triangle.
   *
   * `mat` is a material key and `group` forbids merging across groups.
   * `after` optionally anchors the triangle to the surface it rests on, as
   * { mat, group, point }: the sorter will then always draw it after whichever
   * face of that material carries `point`. This is what keeps a chimney in
   * front of its own roof slope while still letting the opposite slope hide it.
   */
  tri(a, b, c, mat, group = '', after = null) {
    const n = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) return this; // degenerate, contributes nothing
    this.tris.push({ a, b, c, mat, group, after, n: [n[0] / len, n[1] / len, n[2] / len] });
    return this;
  }

  /** Add a planar quad given in order around its rim. */
  quad(a, b, c, d, mat, group = '', after = null) {
    this.tri(a, b, c, mat, group, after);
    this.tri(a, c, d, mat, group, after);
    return this;
  }

  /** Add a convex polygon as a fan. */
  poly(pts, mat, group = '', after = null) {
    for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1], mat, group, after);
    return this;
  }

  /**
   * Add an axis-aligned box. Faces are emitted outward-facing; `skip` may list
   * face names to omit ('top', 'bottom', 'x-', 'x+', 'y-', 'y+').
   */
  box([x0, y0, z0], [x1, y1, z1], mat, group = '', skip = [], after = null) {
    const s = new Set(skip);
    const quad = (a, b, c, d) => this.quad(a, b, c, d, mat, group, after);
    const p = (x, y, z) => [x, y, z];
    if (!s.has('bottom')) quad(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0));
    if (!s.has('top')) quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1));
    if (!s.has('y-')) quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1));
    if (!s.has('y+')) quad(p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1));
    if (!s.has('x-')) quad(p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1));
    if (!s.has('x+')) quad(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1));
    return this;
  }
}

/**
 * Merge coplanar, same-material triangles into polygons.
 *
 * Returns faces of the shape { loops, normal, mat, group, centroid }.
 * `loops` is a list of closed rings: the first is the outline, any others are
 * holes. They are meant to be emitted as SVG subpaths with fill-rule evenodd,
 * which resolves holes without any extra work.
 */
export function mergeCoplanar(tris) {
  const groups = new Map();
  for (const t of tris) {
    const n = t.n;
    // Quantise the plane so that numerically-identical planes land in one bucket.
    const nk = `${Math.round(n[0] * 1e3)},${Math.round(n[1] * 1e3)},${Math.round(n[2] * 1e3)}`;
    const d = Math.round(dot(n, t.a) * 1e3);
    const planeId = `${t.mat}|${t.group}|${nk}|${d}`;
    const key = t.after ? `${planeId}|@${t.after.mat}/${t.after.group}` : planeId;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat: t.mat, group: t.group, n, planeId, after: t.after, tris: [] }));
    g.tris.push(t);
  }

  const faces = [];
  for (const g of groups.values()) {
    // Cancel every interior edge: it appears once in each direction.
    const edges = new Map(); // "from|to" -> [fromPoint, toPoint]
    const push = (p, q) => {
      const kp = vkey(p), kq = vkey(q);
      if (kp === kq) return;
      const opposite = `${kq}|${kp}`;
      if (edges.has(opposite)) edges.delete(opposite);
      else edges.set(`${kp}|${kq}`, [p, q]);
    };
    for (const t of g.tris) { push(t.a, t.b); push(t.b, t.c); push(t.c, t.a); }

    // Chain the surviving boundary edges into closed rings.
    const outgoing = new Map();
    for (const [k, e] of edges) {
      const from = k.split('|')[0];
      if (!outgoing.has(from)) outgoing.set(from, []);
      outgoing.get(from).push({ k, e });
    }
    const used = new Set();
    const loops = [];
    for (const [k0, e0] of edges) {
      if (used.has(k0)) continue;
      const ring = [];
      let curK = k0, curE = e0;
      // Walking is bounded by the edge count; a malformed ring simply stops early.
      for (let guard = 0; guard < edges.size + 2; guard++) {
        used.add(curK);
        ring.push(curE[0]);
        const nextFrom = vkey(curE[1]);
        const cands = (outgoing.get(nextFrom) || []).filter((c) => !used.has(c.k));
        if (!cands.length) break;
        curK = cands[0].k;
        curE = cands[0].e;
        if (curK === k0) break;
      }
      if (ring.length >= 3) loops.push(simplifyRing(ring));
    }
    if (!loops.length) continue;

    // Split into connected components.
    //
    // Two disjoint pieces can be coplanar and share a material — a terrace and
    // a garden path, or two wall segments in line with each other. Merged into
    // one face they would also share one centroid, and therefore one depth:
    // whichever piece is nearer would drag the other in front of the house
    // with it. Each component gets its own face, and therefore its own depth.
    const basis = planeBasis(g.n, loops[0][0]);
    const outers = [], holes = [];
    for (const ring of loops) {
      (signedArea(ring, g.n) >= 0 ? outers : holes).push(ring);
    }
    const assigned = outers.map(() => []);
    for (const hole of holes) {
      const probe = basis.to2d(hole[0]);
      let bestIdx = -1, bestArea = Infinity;
      outers.forEach((o, i) => {
        const a = Math.abs(signedArea(o, g.n));
        if (a < bestArea && contains2d(o.map(basis.to2d), probe)) { bestArea = a; bestIdx = i; }
      });
      // A ring with no container is a component of its own, wound inward.
      if (bestIdx < 0) { outers.push(hole.slice().reverse()); assigned.push([]); }
      else assigned[bestIdx].push(hole);
    }

    outers.forEach((outer, i) => {
      let cx = 0, cy = 0, cz = 0;
      for (const p of outer) { cx += p[0]; cy += p[1]; cz += p[2]; }
      const n = outer.length;
      faces.push({
        loops: [outer, ...assigned[i]],
        normal: g.n,
        mat: g.mat,
        group: g.group,
        planeId: g.planeId,
        after: g.after,
        centroid: [cx / n, cy / n, cz / n],
      });
    });
  }
  return faces;
}

/** Drop vertices that lie on the segment between their neighbours. */
function simplifyRing(ring) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur = ring[i];
    const next = ring[(i + 1) % n];
    const a = sub(cur, prev);
    const b = sub(next, cur);
    const c = cross(a, b);
    if (Math.hypot(c[0], c[1], c[2]) > 1e-7) out.push(cur);
  }
  return out.length >= 3 ? out : ring;
}

/** An orthonormal 2D frame in the plane of a face. */
function planeBasis(n, origin) {
  const seed = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(n, seed));
  const v = cross(n, u);
  return {
    to2d: (p) => {
      const d = sub(p, origin);
      return [dot(d, u), dot(d, v)];
    },
  };
}

/** Even-odd point-in-polygon, on 2D coordinates. */
function contains2d(poly, pt) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1]) &&
        pt[0] < ((poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed area of a planar ring: positive when wound counter-clockwise about n. */
export function signedArea(ring, n) {
  let sum = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const c = cross(ring[i], ring[(i + 1) % ring.length]);
    sum = [sum[0] + c[0], sum[1] + c[1], sum[2] + c[2]];
  }
  return dot(sum, n) / 2;
}

/** Unsigned area of a planar ring with known normal. */
export function ringArea(ring, n) {
  let sum = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const c = cross(a, b);
    sum = [sum[0] + c[0], sum[1] + c[1], sum[2] + c[2]];
  }
  return Math.abs(dot(sum, n)) / 2;
}
