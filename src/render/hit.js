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
import { wallTop, storeyBase, cellSizeOf, openingShown, openingSpan, CENTRED_KINDS } from '../core/model.js';
import { unrotatePoint } from '../core/iso.js';

// The layer is parsed as markup, and ids come from files and share links.
const escapeAttr = (v) => String(v).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

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
        const z0 = storeyBase(b, st);
        const z1 = storeyBase(b, st + 1);
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
    if (!e || !b || !openingShown(op, b)) continue;
    const a = [e.a[0] * cs, e.a[1] * cs];
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
    const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
    const o = 0.05;
    const p = (s, z) => [a[0] + u[0] * s + e.n[0] * o, a[1] + u[1] * s + e.n[1] * o, z];
    const w = op.width ?? 1.2, c = op.offset ?? 0.5;
    const { z0, z1 } = openingSpan(op, b);
    add([p(c - w / 2, z0), p(c + w / 2, z0), p(c + w / 2, z1), p(c - w / 2, z1)],
      { 'data-pick': 'opening', 'data-id': op.id });
  }

  // Roof items, flat on the slope of whichever volume carries them.
  for (const it of model.roofItems) {
    const pts = roofItemCorners(model, it, built);
    if (pts) add(pts, { 'data-pick': 'roofItem', 'data-id': it.id });
  }

  // Props: a horizontal patch at roughly half their height reads well enough
  // for picking and keeps them ordered against the house. A raised slab and a
  // flight of steps are solids standing metres high, though, and get their
  // sides as well: with only a patch on top, half of what is drawn of them
  // picked nothing, or the wall behind.
  for (const p of model.props) {
    const centred = CENTRED_KINDS.has(p.kind);
    const w = centred ? (p.r ? p.r * 2 : p.w ?? 2) : p.w ?? 2;
    const d = centred ? (p.r ? p.r * 2 : p.d ?? 2) : p.d ?? 2;
    const x0 = centred ? p.x - w / 2 : p.x;
    const y0 = centred ? p.y - d / 2 : p.y;
    const x1 = x0 + w, y1 = y0 + d;
    const attrs = { 'data-pick': 'prop', 'data-id': p.id };
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
    const solid = p.kind === 'stairs' ? Math.max(0.15, p.h ?? 0.5)
      : ['terrace', 'path', 'deck', 'pool'].includes(p.kind) && (p.z ?? 0) > 0.05 ? p.z : 0;
    if (solid) {
      // Height of the top at a ground point: flat for a slab, rising towards
      // its landing for a flight of steps.
      const up = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }[p.dir || 'N'];
      const top = p.kind !== 'stairs' ? () => solid : (x, y) => {
        const t = up[0] ? (up[0] > 0 ? (x - x0) / w : (x1 - x) / w) : (up[1] > 0 ? (y - y0) / d : (y1 - y) / d);
        return Math.max(0.05, solid * t);
      };
      const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      for (let k = 0; k < 4; k++) {
        const [a, b] = [c[k], c[(k + 1) % 4]];
        add([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], top(...b)], [a[0], a[1], top(...a)]], attrs);
      }
      add(c.map(([x, y]) => [x, y, top(x, y) + 0.02]), attrs);
      continue;
    }
    const z = p.kind === 'tree' ? (p.r ?? 1.4) * 1.6
      : p.kind === 'bush' ? (p.r ?? 1.1) * 0.5
        : p.kind === 'car' ? 0.7 : p.kind === 'muret' || p.kind === 'gate' ? (p.h ?? 1.5)
        : (p.z ?? 0) + 0.06;
    add([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], attrs);
  }

  targets.sort((a, b) => a.depth - b.depth);
  return targets.map((t) => {
    const attrs = Object.entries(t.attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
    return `<path d="${t.d}" ${attrs} fill="transparent" stroke="none"/>`;
  }).join('');
}

/**
 * The four corners of a roof item, lying on the slope of the volume under it —
 * shared with the selection outline, which drew them at a fixed height.
 */
export function roofItemCorners(model, it, built = null) {
  const cs = cellSizeOf(model);
  const cellKey = `${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`;
  const b = model.buildings.find((bd) => bd.cells.includes(cellKey));
  if (!b) return null;
  const part = built?.parts?.find((p) => p.building.id === b.id);
  const field = part ? part.field : null;
  const top = wallTop(b);
  const w = it.w ?? 2, d = it.d ?? 1.5;
  const z = (x, y) => top + (field ? Math.max(0, field.h(x, y)) : 0) + (it.h ?? 0.2);
  const x0 = it.x - w / 2, x1 = it.x + w / 2, y0 = it.y - d / 2, y1 = it.y + d / 2;
  return [[x0, y0, z(x0, y0)], [x1, y0, z(x1, y0)], [x1, y1, z(x1, y1)], [x0, y1, z(x0, y1)]];
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

/*
 * --- Picking by the drawing itself -----------------------------------------
 *
 * The pick layer above is a set of proxies sorted on their centres, and a roof
 * has none: it is metres of slope with no address of its own. Clicking one
 * selected nothing, or the tree standing behind the house, and a tool for the
 * garden then dropped its item on the lawn underneath. What is actually seen
 * at a pixel is already known — the renderer drew it last — so the roof is
 * picked from the drawn faces, and the point clicked is solved on the plane of
 * the face hit.
 */

/** Groups of the faces that make a roof surface. */
const ROOF_GROUPS = new Set(['roof', 'roofEdge']);

/**
 * The view ray through a screen point, as world x and y for a given height.
 *
 * In view space the ray is (1, 1, λ) and the projection inverts exactly at any
 * height, so x and y are affine in z — which is what lets the intersection with
 * a plane or a height field be solved instead of searched for.
 */
export function screenRay(camera, sx, sy) {
  const proj = camera.proj;
  const [X, Y] = camera.untilt([
    (sx - camera.offset[0]) / camera.scale,
    (sy - camera.offset[1]) / camera.scale,
  ]);
  const a = X / proj.kx;
  return (z) => {
    const b = (Y + z * proj.kz) / proj.ky;
    const [x, y] = unrotatePoint((b - a) / 2, (a + b) / 2, camera.yaw, camera.centre[0], camera.centre[1]);
    return [x, y, z];
  };
}

/** Where the ray through a screen point meets a plane; null if it runs along it. */
export function screenToPlane(camera, sx, sy, normal, point) {
  const at = screenRay(camera, sx, sy);
  // The ray is affine in z, so the signed distance to the plane is too: two
  // samples give it exactly.
  const dist = (z) => {
    const p = at(z);
    return normal[0] * (p[0] - point[0]) + normal[1] * (p[1] - point[1]) + normal[2] * (p[2] - point[2]);
  };
  const d0 = dist(0), d1 = dist(1);
  if (Math.abs(d1 - d0) < 1e-12) return null;
  return at(-d0 / (d1 - d0));
}

/** Does a face cover a screen point? Even-odd, holes included. */
function covers(face, camera, sx, sy) {
  let inside = false;
  for (const loop of face.loops) {
    const s = loop.map((p) => camera.toScreen(p));
    for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
      if ((s[i][1] > sy) !== (s[j][1] > sy)
        && sx < ((s[j][0] - s[i][0]) * (sy - s[i][1])) / (s[j][1] - s[i][1]) + s[i][0]) inside = !inside;
    }
  }
  return inside;
}

/** The face drawn last at a screen point of a render — what the eye sees there. */
export function faceAt(render, sx, sy) {
  const { faces, camera } = render;
  for (let k = faces.length - 1; k >= 0; k--) {
    if (faces[k].group === 'ground') continue;
    if (covers(faces[k], camera, sx, sy)) return faces[k];
  }
  return null;
}

/** The volume whose roof surface passes closest to a world point, or null. */
export function roofOwner(built, p) {
  let best = null, bestD = Infinity;
  for (const part of built?.parts || []) {
    if (!part.field || !part.field.inside(p[0], p[1])) continue;
    const d = Math.abs(part.top + Math.max(0, part.field.h(p[0], p[1])) - p[2]);
    if (d < bestD) { bestD = d; best = part; }
  }
  return best;
}

/**
 * Where the ray through a screen point meets one volume's roof, or null.
 *
 * The visible hit is the highest crossing, the ray rising towards the camera.
 * Walked down from the apex, then bisected: the roof is planar between its
 * creases, so the crossing found is the exact one to well under a millimetre.
 * Used while dragging an item across its roof, when what is under the pointer
 * is the item itself and not the slope it rests on.
 */
export function rayOnRoof(camera, sx, sy, part) {
  if (!part?.field || !part.roof) return null;
  const at = screenRay(camera, sx, sy);
  const { field, top } = part;
  const below = (z) => {
    const p = at(z);
    return field.inside(p[0], p[1]) && top + Math.max(0, field.h(p[0], p[1])) >= z;
  };
  const hi = part.roof.apex + 0.05, lo = top - (part.roof.fascia || 0) - 0.05;
  const step = 0.02;
  let prev = hi;
  for (let z = hi - step; z >= lo; z -= step) {
    if (below(z)) {
      let a = z, b = prev; // a under the surface, b above it
      for (let k = 0; k < 40; k++) {
        const mid = (a + b) / 2;
        if (below(mid)) a = mid; else b = mid;
      }
      return at(a);
    }
    prev = z;
  }
  return null;
}

/**
 * What a roof shows at a screen point: the volume it covers, the roof item
 * drawn there, and the point of the slope under the pointer — or null when
 * what is drawn there is not a roof, and the pick layer decides.
 *
 * Items lying on a roof are drawn on it, anchored to the slope that carries
 * them; one of them on top names its item by where it lies.
 */
export function roofAt(render, sx, sy) {
  const f = faceAt(render, sx, sy);
  if (!f) return null;
  const onRoof = ROOF_GROUPS.has(f.group);
  const carrier = onRoof ? f : (f.carrier && f.carrier.group === 'roof' ? f.carrier : null);
  if (!carrier) return null;
  const { camera, built, model } = render;
  const p = screenToPlane(camera, sx, sy, carrier.normal, carrier.centroid);
  if (!p) return null;
  const part = roofOwner(built, p);
  if (!part) return null;
  let item = null;
  if (!onRoof) {
    // On the item's own plane: a chimney stands metres above the slope, and
    // the slope behind it is not where it was clicked.
    const q = screenToPlane(camera, sx, sy, f.normal, f.centroid) || p;
    let bestD = Infinity;
    for (const it of model.roofItems) {
      const w = (it.w ?? 2) / 2 + 0.1, d = (it.d ?? 1.5) / 2 + 0.1;
      const dx = Math.abs(q[0] - it.x), dy = Math.abs(q[1] - it.y);
      if (dx > w || dy > d) continue;
      if (dx + dy < bestD) { bestD = dx + dy; item = it; }
    }
  }
  return { building: part.building, part, point: p, item };
}

/**
 * A roof point brought onto the quarter-metre grid items snap to, and kept on
 * the volume's own cells: an item whose centre falls past the eaves belongs to
 * no roof, and was simply not drawn.
 */
export function snapOntoBuilding(b, cs, x, y) {
  const snap = (v) => Math.round(v * 4) / 4;
  let sx = snap(x), sy = snap(y);
  const cells = new Set(b.cells);
  if (cells.has(`${Math.floor(sx / cs)},${Math.floor(sy / cs)}`)) return [sx, sy];
  let best = null, bestD = Infinity;
  for (const k of b.cells) {
    const [i, j] = k.split(',').map(Number);
    const cx = Math.min(Math.max(x, i * cs), (i + 1) * cs);
    const cy = Math.min(Math.max(y, j * cs), (j + 1) * cs);
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD) { bestD = d; best = [i, j]; }
  }
  if (!best) return null;
  const [i, j] = best;
  sx = Math.min(Math.max(sx, i * cs), (i + 1) * cs - 0.25);
  sy = Math.min(Math.max(sy, j * cs), (j + 1) * cs - 0.25);
  return [sx, sy];
}
