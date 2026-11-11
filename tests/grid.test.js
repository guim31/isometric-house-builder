/** Grille : emprise, murs, rectangles. */

import { check } from './harness.js';
import { decomposeRects, boundaryEdges, rectCells, key } from '../src/core/grid.js';

/* ---------------- geometry ---------------- */

check('un rectangle plein se décompose en un seul rectangle', () => {
  const r = decomposeRects(rectCells(0, 0, 5, 3));
  return r.length === 1 || `obtenu ${r.length}`;
});

check('une forme en L est entièrement couverte par les rectangles', () => {
  const cells = new Set([...rectCells(0, 0, 9, 3), ...rectCells(6, 4, 9, 8)]);
  const rects = decomposeRects(cells);
  const covered = new Set();
  for (const r of rects) {
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) covered.add(key(x, y));
  }
  for (const c of cells) if (!covered.has(c)) return `case non couverte ${c}`;
  for (const c of covered) if (!cells.has(c)) return `case en trop ${c}`;
  return true;
});

check('un carré de 2×2 a huit murs extérieurs', () => {
  const e = boundaryEdges(rectCells(0, 0, 1, 1));
  return e.length === 8 || `obtenu ${e.length}`;
});

check('une emprise de 200 × 200 cases se décompose en un instant', () => {
  const t0 = performance.now();
  const r = decomposeRects(rectCells(0, 0, 199, 199));
  const ms = performance.now() - t0;
  if (r.length !== 1) return `${r.length} rectangles`;
  return ms < 1000 || `${Math.round(ms)} ms`;
});

check('la décomposition retient les mêmes rectangles qu’une recherche exhaustive', () => {
  // The exhaustive search the histogram method replaced, kept as the oracle.
  const slow = (cells) => {
    const ks = [...cells].map((k) => k.split(',').map(Number));
    const xs = ks.map((k) => k[0]), ys = ks.map((k) => k[1]);
    const [i0, j0, W, D] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
    const at = (x, y) => x >= 0 && y >= 0 && x < W && y < D && cells.has(key(x + i0, y + j0));
    const full = (x0, y0, x1, y1) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!at(x, y)) return false;
      return true;
    };
    const out = [];
    for (let y0 = 0; y0 < D; y0++) for (let x0 = 0; x0 < W; x0++) {
      if (!at(x0, y0)) continue;
      for (let y1 = y0; y1 < D && full(x0, y0, x0, y1); y1++) {
        for (let x1 = x0; x1 < W && full(x0, y0, x1, y1); x1++) {
          if (x0 > 0 && full(x0 - 1, y0, x0 - 1, y1)) continue;
          if (x1 < W - 1 && full(x1 + 1, y0, x1 + 1, y1)) continue;
          if (y0 > 0 && full(x0, y0 - 1, x1, y0 - 1)) continue;
          if (y1 < D - 1 && full(x0, y1 + 1, x1, y1 + 1)) continue;
          out.push(`${x0 + i0},${y0 + j0},${x1 + i0 + 1},${y1 + j0 + 1}`);
        }
      }
    }
    return out.sort();
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 200; n++) {
    const cells = new Set();
    for (let r = 0; r < 4; r++) {
      const x0 = Math.floor(rnd() * 10), y0 = Math.floor(rnd() * 10);
      for (const c of rectCells(x0, y0, x0 + Math.floor(rnd() * 6), y0 + Math.floor(rnd() * 6))) cells.add(c);
    }
    const chosen = decomposeRects(cells).map((r) => `${r.x0},${r.y0},${r.x1},${r.y1}`);
    const all = new Set(slow(cells));
    const stray = chosen.find((c) => !all.has(c));
    if (stray) return `rectangle non maximal ${stray}`;
    const covered = new Set();
    for (const r of decomposeRects(cells)) for (const c of rectCells(r.x0, r.y0, r.x1 - 1, r.y1 - 1)) covered.add(c);
    if (covered.size !== cells.size) return 'couverture incomplète';
  }
  return true;
});
