/**
 * The footprint lives on an integer grid of cells. Everything else — walls,
 * roof, openings — is derived from it, so this module is the single source of
 * truth for "what shape is the house".
 */

export const key = (i, j) => `${i},${j}`;
export const parseKey = (k) => k.split(',').map(Number);

export function bounds(cells) {
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const k of cells) {
    const [i, j] = parseKey(k);
    if (i < i0) i0 = i;
    if (j < j0) j0 = j;
    if (i > i1) i1 = i;
    if (j > j1) j1 = j;
  }
  if (!Number.isFinite(i0)) return { i0: 0, j0: 0, i1: -1, j1: -1, w: 0, d: 0, empty: true };
  return { i0, j0, i1, j1, w: i1 - i0 + 1, d: j1 - j0 + 1, empty: false };
}

/**
 * Sides of a cell, given as the edge walked so that extruding it upward
 * produces an outward-facing wall.
 *
 *   a -> b is the ground edge; the wall quad is (a0, b0, b1, a1).
 */
export const SIDES = {
  S: { d: [0, -1], a: (i, j) => [i, j], b: (i, j) => [i + 1, j] },
  E: { d: [1, 0], a: (i, j) => [i + 1, j], b: (i, j) => [i + 1, j + 1] },
  N: { d: [0, 1], a: (i, j) => [i + 1, j + 1], b: (i, j) => [i, j + 1] },
  W: { d: [-1, 0], a: (i, j) => [i, j + 1], b: (i, j) => [i, j] },
};

export const SIDE_NAMES = ['S', 'E', 'N', 'W'];

/** Every cell edge that faces the outside world — i.e. every exterior wall. */
export function boundaryEdges(cells) {
  const out = [];
  for (const k of cells) {
    const [i, j] = parseKey(k);
    for (const side of SIDE_NAMES) {
      const s = SIDES[side];
      if (cells.has(key(i + s.d[0], j + s.d[1]))) continue;
      out.push({ i, j, side, id: `${i},${j},${side}`, a: s.a(i, j), b: s.b(i, j), n: s.d });
    }
  }
  out.sort((p, q) => p.id.localeCompare(q.id));
  return out;
}

/**
 * Cover the footprint with maximal rectangles.
 *
 * The roof is built as the upper envelope of one hip roof per rectangle, so
 * this decomposition is what decides where ridges and valleys fall. Maximal
 * rectangles are allowed to overlap: overlap costs nothing in an upper
 * envelope and yields far more natural ridge lines than a disjoint partition.
 */
export function decomposeRects(cells) {
  const b = bounds(cells);
  if (b.empty) return [];
  const W = b.w, D = b.d;
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < D && cells.has(key(x + b.i0, y + b.j0)) ? 1 : 0);

  // Prefix sums make "is this rectangle entirely filled" an O(1) test.
  const ps = new Int32Array((W + 1) * (D + 1));
  const P = (x, y) => ps[y * (W + 1) + x];
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < W; x++) {
      ps[(y + 1) * (W + 1) + (x + 1)] = at(x, y) + P(x + 1, y) + P(x, y + 1) - P(x, y);
    }
  }
  const full = (x0, y0, x1, y1) => {
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    return P(x1 + 1, y1 + 1) - P(x0, y1 + 1) - P(x1 + 1, y0) + P(x0, y0) === area;
  };

  const maximal = [];
  for (let y0 = 0; y0 < D; y0++) {
    for (let x0 = 0; x0 < W; x0++) {
      if (!at(x0, y0)) continue;
      for (let y1 = y0; y1 < D; y1++) {
        if (!full(x0, y0, x0, y1)) break;
        for (let x1 = x0; x1 < W; x1++) {
          if (!full(x0, y0, x1, y1)) break;
          // Keep only rectangles that cannot grow in any direction.
          if (x0 > 0 && full(x0 - 1, y0, x0 - 1, y1)) continue;
          if (x1 < W - 1 && full(x1 + 1, y0, x1 + 1, y1)) continue;
          if (y0 > 0 && full(x0, y0 - 1, x1, y0 - 1)) continue;
          if (y1 < D - 1 && full(x0, y1 + 1, x1, y1 + 1)) continue;
          maximal.push({ x0, y0, x1, y1, area: (x1 - x0 + 1) * (y1 - y0 + 1) });
        }
      }
    }
  }

  // Greedily keep the biggest rectangles until every cell is covered.
  maximal.sort((p, q) => q.area - p.area);
  const covered = new Set();
  const chosen = [];
  const total = cells.size;
  for (const r of maximal) {
    if (covered.size >= total) break;
    let gains = 0;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) if (!covered.has(key(x, y))) gains++;
    }
    if (!gains) continue;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) covered.add(key(x, y));
    }
    chosen.push({
      x0: r.x0 + b.i0, y0: r.y0 + b.j0,
      x1: r.x1 + b.i0 + 1, y1: r.y1 + b.j0 + 1, // exclusive upper bound, in world units
    });
  }
  return chosen;
}

/** Rectangle of cells, inclusive, as a Set of keys. */
export function rectCells(i0, j0, i1, j1) {
  const out = new Set();
  const [a, b] = i0 <= i1 ? [i0, i1] : [i1, i0];
  const [c, d] = j0 <= j1 ? [j0, j1] : [j1, j0];
  for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) out.add(key(i, j));
  return out;
}
