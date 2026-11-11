/**
 * Moving, turning, mirroring and duplicating a whole building volume.
 *
 * A body is more than its cells: the openings and the fixtures on its walls
 * and the items on its roof belong to it, a shed roof slopes one way and a
 * gable's ridge may be told which way to run. Each transformation
 * here carries all of them along, so that what comes out is the same building
 * somewhere else — not a footprint that left its windows behind.
 *
 * Every function is pure and returns a new model, or null when the result
 * would overlap another body: a cell belongs to one body only, and moving one
 * onto another is refused rather than merged.
 */

import { key, parseKey, SIDES, bounds } from './grid.js';
import { cellSizeOf, newId, idsOf } from './model.js';

/** Clean decimals: a transform must not leave 3.6999999999999997 behind. */
const tidy = (v) => Math.round(v * 1e6) / 1e6 || 0;

/** The cell an edge id names, as a key. */
const edgeCell = (edgeId) => edgeId.split(',').slice(0, 2).join(',');

/** The building whose cell holds a roof item's centre, as the renderer decides. */
function roofOwner(m, it) {
  const cs = cellSizeOf(m);
  const k = key(Math.floor(it.x / cs), Math.floor(it.y / cs));
  return m.buildings.find((b) => b.cells.includes(k)) || null;
}

/** What belongs to a body: its openings, its fixtures and its roof items. */
export function bodyParts(m, id) {
  const b = m.buildings.find((x) => x.id === id);
  if (!b) return null;
  const cells = new Set(b.cells);
  return {
    body: b,
    openings: m.openings.filter((o) => cells.has(edgeCell(o.edge))),
    fixtures: (m.fixtures || []).filter((f) => cells.has(edgeCell(f.edge))),
    roofItems: m.roofItems.filter((it) => roofOwner(m, it) === b),
  };
}

/** Do these cells land on a cell some other body already owns? */
export function collides(m, id, cells) {
  const mine = new Set(cells);
  return m.buildings.some((b) => b.id !== id && b.cells.some((c) => mine.has(c)));
}

/**
 * Apply a rigid map of the grid to one body.
 *
 * `cell(i, j)` gives the image of a cell, `point(x, y)` the image of a point
 * in metres, `side(s)` the image of a wall side; `flips` says whether the map
 * reverses orientation, which turns an opening's distance along its edge
 * around; `turns` whether it swaps the two horizontal axes — and with them
 * the way a forced ridge runs.
 */
function mapBody(m, id, { cell, point, side, flips = false, turns = false, shed = null }) {
  const parts = bodyParts(m, id);
  if (!parts) return null;
  const cs = cellSizeOf(m);
  const cells = parts.body.cells.map((c) => {
    const [i, j] = parseKey(c);
    return key(...cell(i, j));
  });
  if (collides(m, id, cells)) return null;
  const ops = new Set([...parts.openings, ...parts.fixtures].map((o) => o.id));
  const items = new Set(parts.roofItems.map((it) => it.id));
  // Fixtures hang off an edge exactly as openings do, and go where they go.
  const onWall = (o) => {
    if (!ops.has(o.id)) return o;
    const [i, j, s] = o.edge.split(',');
    const [ni, nj] = cell(Number(i), Number(j));
    // A rotation sends an edge's start to the new edge's start, so the
    // distance along it holds; a mirror sends it to the far end.
    return { ...o, edge: `${ni},${nj},${side(s)}`, offset: flips ? tidy(cs - (o.offset ?? 0.5)) : o.offset };
  };
  const roofOf = (r) => {
    let out = r;
    if (shed) out = { ...out, shedDir: shed(r.shedDir) };
    // East-west becomes north-south on a quarter turn; « auto » follows the
    // longer side, which turns by itself.
    if (turns && RIDGE_TURN[r.ridge]) out = { ...out, ridge: RIDGE_TURN[r.ridge] };
    return out;
  };
  const out = {
    ...m,
    buildings: m.buildings.map((b) => (b.id !== id ? b : {
      ...b,
      cells: [...cells].sort(),
      roof: roofOf(b.roof),
    })),
    openings: m.openings.map(onWall),
    roofItems: m.roofItems.map((it) => {
      if (!items.has(it.id)) return it;
      const [x, y] = point(it.x, it.y);
      const out = { ...it, x: tidy(x), y: tidy(y) };
      if (turns) { out.w = it.d; out.d = it.w; }
      return out;
    }),
  };
  if (m.fixtures) out.fixtures = m.fixtures.map(onWall);
  return out;
}

const RIDGE_TURN = { ew: 'ns', ns: 'ew' };

/** Move a body by whole cells, or null when it would land on another. */
export function moveBody(m, id, di, dj) {
  if (!di && !dj) return m;
  const cs = cellSizeOf(m);
  return mapBody(m, id, {
    cell: (i, j) => [i + di, j + dj],
    point: (x, y) => [x + di * cs, y + dj * cs],
    side: (s) => s,
  });
}

const CW = { S: 'W', W: 'N', N: 'E', E: 'S' };
const MIRROR = { E: 'W', W: 'E', N: 'N', S: 'S' };

/**
 * A quarter turn clockwise, as seen on the plan, about the body's own middle.
 *
 * The bounding box keeps its centre as nearly as whole cells allow. The
 * rounding goes towards zero, so that a box of odd difference between its
 * sides shifts one way on one turn and back on the next: four turns give back
 * the very same cells, which a floor would not.
 */
export function rotateBody(m, id) {
  const b = m.buildings.find((x) => x.id === id);
  if (!b || !b.cells.length) return null;
  const { i0, j0, i1, w, d } = bounds(new Set(b.cells));
  const ni0 = i0 + Math.trunc((w - d) / 2);
  const nj0 = j0 + Math.trunc((d - w) / 2);
  // Clockwise with y pointing north: (x, y) -> (X + y, Y - x).
  const X = ni0 - j0;
  const Y = nj0 + i1 + 1;
  const cs = cellSizeOf(m);
  return mapBody(m, id, {
    cell: (i, j) => [X + j, Y - i - 1],
    point: (x, y) => [X * cs + y, Y * cs - x],
    side: (s) => CW[s],
    turns: true,
    shed: (s) => CW[s] || s,
  });
}

/** East and west swapped, about the body's own middle. */
export function mirrorBody(m, id) {
  const b = m.buildings.find((x) => x.id === id);
  if (!b || !b.cells.length) return null;
  const { i0, i1 } = bounds(new Set(b.cells));
  const M = i0 + i1 + 1;
  const cs = cellSizeOf(m);
  return mapBody(m, id, {
    cell: (i, j) => [M - i - 1, j],
    point: (x, y) => [M * cs - x, y],
    side: (s) => MIRROR[s],
    flips: true,
    shed: (s) => MIRROR[s] || s,
  });
}

/** A fresh id that neither the model nor this batch already holds. */
function freshId(prefix, taken) {
  let id;
  do { id = newId(prefix); } while (taken.has(id));
  taken.add(id);
  return id;
}

/**
 * A copy of a body, with its openings, fixtures and roof items, set down
 * beside it.
 *
 * Beside, not on top: a copy in the same place would be refused anyway, a
 * cell belonging to one body. The first free spot is taken, east of the
 * original, then south, west, north, and further out if all four are taken.
 * Returns `{ model, id }`, or null when there is nothing to copy.
 */
export function duplicateBody(m, id) {
  const parts = bodyParts(m, id);
  if (!parts || !parts.body.cells.length) return null;
  const { w, d } = bounds(new Set(parts.body.cells));
  const taken = idsOf(m);
  const nid = freshId('b', taken);
  const cs = cellSizeOf(m);
  for (let ring = 1; ring <= 4; ring++) {
    for (const [si, sj] of [[w + 1, 0], [0, -(d + 1)], [-(w + 1), 0], [0, d + 1]]) {
      const di = si * ring, dj = sj * ring;
      const cells = parts.body.cells.map((c) => {
        const [i, j] = parseKey(c);
        return key(i + di, j + dj);
      });
      if (collides(m, null, cells)) continue;
      const ops = parts.openings.map((o) => {
        const [i, j, s] = o.edge.split(',');
        return { ...o, id: freshId('o', taken), edge: `${Number(i) + di},${Number(j) + dj},${s}` };
      });
      const fixtures = parts.fixtures.map((f) => {
        const [i, j, s] = f.edge.split(',');
        return { ...f, id: freshId('f', taken), edge: `${Number(i) + di},${Number(j) + dj},${s}` };
      });
      const items = parts.roofItems.map((it) => ({
        ...it, id: freshId('r', taken), x: tidy(it.x + di * cs), y: tidy(it.y + dj * cs),
      }));
      const copy = {
        ...parts.body, id: nid, cells: cells.sort(), name: `${parts.body.name} (copie)`.slice(0, 120),
      };
      return {
        id: nid,
        model: {
          ...m,
          buildings: [...m.buildings, copy],
          openings: [...m.openings, ...ops],
          fixtures: [...(m.fixtures || []), ...fixtures],
          roofItems: [...m.roofItems, ...items],
        },
      };
    }
  }
  return null;
}
