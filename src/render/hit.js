/**
 * Invisible pick targets laid over the isometric view.
 *
 * Selection cannot use the rendered faces: those are merged, so a whole wall
 * plane is a single path with no idea which cell or which storey was clicked.
 * This layer re-emits the same geometry unmerged, one path per addressable
 * thing, sorted back-to-front so the browser's own hit testing picks the
 * nearest one.
 */

import { boundaryEdges, parseKey } from '../core/grid.js';
import { cellSet, wallTop, cellSizeOf } from '../core/model.js';
import { unrotatePoint } from '../core/iso.js';


function quadPath(camera, pts) {
  return pts.map((p, i) => {
    const s = camera.toScreen(p);
    return `${i === 0 ? 'M' : 'L'}${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
  }).join('') + 'Z';
}

const depthOf = (camera, pts) =>
  pts.reduce((acc, p) => acc + camera.depth(p), 0) / pts.length;

/**
 * Build the pick targets for a model. Returns SVG markup.
 *
 * `built` (a buildMesh result) is optional: when the caller already has one —
 * the viewport caches it per model — its edges and roof field are reused
 * instead of being recomputed on every pan frame.
 */
export function hitLayer(model, camera, built = null) {
  const cs = cellSizeOf(model);
  const targets = [];
  const add = (pts, attrs) => targets.push({ d: quadPath(camera, pts), attrs, depth: depthOf(camera, pts) });

  // Wall segments, one per exterior edge and storey — per building, since
  // heights and roofs now differ from one volume to the next.
  const allEdges = [];
  for (const b of model.buildings) {
    const cells = new Set(b.cells);
    if (!cells.size) continue;
    const part = built?.parts?.find((p) => p.building.id === b.id);
    const edges = part ? part.edges : boundaryEdges(cells);
    const top = wallTop(b);
    for (const e of edges) {
      allEdges.push(e);
      const a = [e.a[0] * cs, e.a[1] * cs];
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
      const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
      const p = (s, z) => [a[0] + u[0] * s, a[1] + u[1] * s, z];
      for (let st = 0; st < b.storeys; st++) {
        const z0 = b.plinth + st * b.storeyHeight;
        const z1 = z0 + b.storeyHeight;
        add([p(0, z0), p(len, z0), p(len, z1), p(0, z1)],
          { 'data-pick': 'wall', 'data-edge': e.id, 'data-storey': String(st), 'data-building': b.id });
      }
      // A roof face too, so a volume can be picked by its roof — often the
      // only part of a small shed the eye can reach.
      add([p(0, top), p(len, top), p(len, top + 0.02), p(0, top + 0.02)],
        { 'data-pick': 'building', 'data-id': b.id });
    }
  }

  // Openings sit slightly proud of their wall so they win the hit test.
  const edgeById = new Map(allEdges.map((e) => [e.id, e]));
  for (const op of model.openings) {
    const e = edgeById.get(op.edge);
    const b = model.buildings.find((bd) => bd.cells.includes(op.edge.split(',').slice(0, 2).join(',')));
    if (!e || !b) continue;
    const a = [e.a[0] * cs, e.a[1] * cs];
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
    const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
    const o = 0.05;
    const p = (s, z) => [a[0] + u[0] * s + e.n[0] * o, a[1] + u[1] * s + e.n[1] * o, z];
    const w = op.width ?? 1.2, h = op.height ?? 1.25;
    const c = op.offset ?? 0.5, sill = op.sill ?? 0.95;
    const zb = b.plinth + (op.storey || 0) * b.storeyHeight + sill;
    add([p(c - w / 2, zb), p(c + w / 2, zb), p(c + w / 2, zb + h), p(c - w / 2, zb + h)],
      { 'data-pick': 'opening', 'data-id': op.id });
  }

  // Roof items, flat on the slope of whichever volume carries them.
  for (const it of model.roofItems) {
    const cellKey = `${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`;
    const b = model.buildings.find((bd) => bd.cells.includes(cellKey));
    if (!b) continue;
    const part = built?.parts?.find((p) => p.building.id === b.id);
    const field = part ? part.field : null;
    const top = wallTop(b);
    const w = it.w ?? 2, d = it.d ?? 1.5;
    const z = (x, y) => top + (field ? Math.max(0, field.h(x, y)) : 0) + (it.h ?? 0.2);
    const x0 = it.x - w / 2, x1 = it.x + w / 2, y0 = it.y - d / 2, y1 = it.y + d / 2;
    add([[x0, y0, z(x0, y0)], [x1, y0, z(x1, y0)], [x1, y1, z(x1, y1)], [x0, y1, z(x0, y1)]],
      { 'data-pick': 'roofItem', 'data-id': it.id });
  }

  // Props: a horizontal patch at roughly half their height reads well enough
  // for picking and keeps them ordered against the house.
  for (const p of model.props) {
    const centred = p.kind === 'tree' || p.kind === 'bush' || p.kind === 'car';
    const w = centred ? (p.r ? p.r * 2 : p.w ?? 2) : p.w ?? 2;
    const d = centred ? (p.r ? p.r * 2 : p.d ?? 2) : p.d ?? 2;
    const x0 = centred ? p.x - w / 2 : p.x;
    const y0 = centred ? p.y - d / 2 : p.y;
    const z = p.kind === 'tree' ? (p.r ?? 1.4) * 1.6
      : p.kind === 'bush' ? (p.r ?? 1.1) * 0.5
        : p.kind === 'car' ? 0.7 : p.kind === 'muret' || p.kind === 'gate' ? (p.h ?? 1.5) : 0.06;
    add([[x0, y0, z], [x0 + w, y0, z], [x0 + w, y0 + d, z], [x0, y0 + d, z]],
      { 'data-pick': 'prop', 'data-id': p.id });
  }

  targets.sort((a, b) => a.depth - b.depth);
  return targets.map((t) => {
    const attrs = Object.entries(t.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<path d="${t.d}" ${attrs} fill="transparent" stroke="none"/>`;
  }).join('');
}

/**
 * Screen point -> ground cell, for the plan-independent placement of props by
 * clicking directly in the isometric view.
 */
export function screenToGround(camera, sx, sy) {
  const proj = camera.proj;
  const [x, y] = camera.untilt([
    (sx - camera.offset[0]) / camera.scale,
    (sy - camera.offset[1]) / camera.scale,
  ]);
  // Invert the projection at z = 0.
  const a = x / proj.kx;      // = vy - vx
  const b = y / proj.ky;      // = vx + vy
  const vx = (b - a) / 2, vy = (a + b) / 2;
  // Undo the camera rotation.
  return unrotatePoint(vx, vy, camera.yaw, camera.centre[0], camera.centre[1]);
}
