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
import { heightField } from '../core/roof.js';
import { decomposeRects } from '../core/grid.js';

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
  const cells = cellSet(model);
  const edges = built?.edges ?? boundaryEdges(cells);
  const field = built ? (built.roof?.field ?? null) : (() => {
    const rects = decomposeRects(cells).map((r) => ({
      x0: r.x0 * cs, y0: r.y0 * cs, x1: r.x1 * cs, y1: r.y1 * cs,
    }));
    return rects.length ? heightField(rects, model.roof) : null;
  })();
  const top = wallTop(model);
  const targets = [];

  const add = (pts, attrs) => targets.push({ d: quadPath(camera, pts), attrs, depth: depthOf(camera, pts) });

  // Wall segments, one per exterior edge and storey.
  for (const e of edges) {
    const a = [e.a[0] * cs, e.a[1] * cs];
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
    const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
    const p = (s, z) => [a[0] + u[0] * s, a[1] + u[1] * s, z];
    for (let st = 0; st < model.storeys; st++) {
      const z0 = model.plinth + st * model.storeyHeight;
      const z1 = z0 + model.storeyHeight;
      add([p(0, z0), p(len, z0), p(len, z1), p(0, z1)],
        { 'data-pick': 'wall', 'data-edge': e.id, 'data-storey': String(st) });
    }
  }

  // Openings sit slightly proud of their wall so they win the hit test.
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (const op of model.openings) {
    const e = edgeById.get(op.edge);
    if (!e) continue;
    const a = [e.a[0] * cs, e.a[1] * cs];
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
    const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
    const o = 0.05;
    const p = (s, z) => [a[0] + u[0] * s + e.n[0] * o, a[1] + u[1] * s + e.n[1] * o, z];
    const w = op.width ?? 1.2, h = op.height ?? 1.25;
    const c = op.offset ?? 0.5, sill = op.sill ?? 0.95;
    const zb = model.plinth + (op.storey || 0) * model.storeyHeight + sill;
    add([p(c - w / 2, zb), p(c + w / 2, zb), p(c + w / 2, zb + h), p(c - w / 2, zb + h)],
      { 'data-pick': 'opening', 'data-id': op.id });
  }

  // Roof items, flat on the slope.
  for (const it of model.roofItems) {
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
    const z = p.kind === 'tree' ? (p.r ?? 1.4) * 1.6 : p.kind === 'bush' ? (p.r ?? 1.1) * 0.5 : p.kind === 'car' ? 0.7 : 0.06;
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
  const x = (sx - camera.offset[0]) / camera.scale;
  const y = (sy - camera.offset[1]) / camera.scale;
  // Invert the projection at z = 0.
  const a = x / proj.kx;      // = vy - vx
  const b = y / proj.ky;      // = vx + vy
  const vx = (b - a) / 2, vy = (a + b) / 2;
  // Undo the camera rotation.
  const [cx, cy] = camera.centre;
  const dx = vx - cx, dy = vy - cy;
  switch (((camera.rotation % 4) + 4) % 4) {
    case 0: return [cx + dx, cy + dy];
    case 1: return [cx + dy, cy - dx];
    case 2: return [cx - dx, cy - dy];
    default: return [cx - dy, cy + dx];
  }
}
