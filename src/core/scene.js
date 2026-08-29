/**
 * Turns a model into a triangle mesh: ground, walls, openings, roof and
 * everything that sits on them. Geometry only — no colours, no projection.
 */

import { Mesh } from './mesh.js';
import { boundaryEdges, decomposeRects, bounds, parseKey, SIDES } from './grid.js';
import { buildRoof, heightField, undersideAt, STEP } from './roof.js';
import { cellSet, wallTop, cellSizeOf, buildingCells } from './model.js';
import { buildProps } from './props.js';

const LIFT = 0.015; // how far detail quads float off the surface they decorate

/**
 * Geometry of one exterior wall segment, in metres.
 *
 * The grid speaks in cells; everything else — wall heights, opening sizes,
 * roof pitch — speaks in metres. This is the single place where a wall edge
 * crosses that boundary, scaled by the grid pitch `cs`.
 */
function edgeGeometry(e, cs) {
  const a = [e.a[0] * cs, e.a[1] * cs];
  const b = [e.b[0] * cs, e.b[1] * cs];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { a, u, len, n: e.n, side: e.side };
}

/** A rectangle lying flat on a wall, positioned along the wall by `s0`..`s1`. */
function wallRect(mesh, g, s0, s1, z0, z1, mat, lift, after) {
  const off = [g.n[0] * lift, g.n[1] * lift];
  const p = (s, z) => [g.a[0] + g.u[0] * s + off[0], g.a[1] + g.u[1] * s + off[1], z];
  mesh.quad(p(s0, z0), p(s1, z0), p(s1, z1), p(s0, z1), mat, mat, after);
}

/** Draw one opening (window, door, garage door...) onto its wall. */
function buildOpening(mesh, op, g, b, m) {
  const zBase = b.plinth + (op.storey || 0) * b.storeyHeight;
  const w = op.width ?? 1.2;
  const h = op.height ?? 1.25;
  const sill = op.sill ?? 0.95;
  const c = op.offset ?? 0.5;
  const s0 = c - w / 2, s1 = c + w / 2;
  const z0 = zBase + sill, z1 = zBase + sill + h;
  // Anchored to this building's own wall material, which may be recoloured.
  const own = (b.overrides && Object.keys(b.overrides).length) || b.texture;
  const wallMat = own ? `wall#${b.id}` : 'wall';
  const after = { mat: wallMat, group: 'wall' };
  // Plain openings read as a broad frame around one clear pane. Some palettes
  // want that flatter treatment; the default keeps the mullions, which make a
  // window legible at small sizes.
  const bars = m.style.windowBars !== false;
  const F = bars ? 0.09 : 0.14; // frame thickness

  if (op.kind === 'shutter') {
    // Shutters flank the opening, so they are drawn before it.
    const sw = Math.min(w * 0.45, 0.5);
    wallRect(mesh, g, s0 - sw, s0, z0, z1, 'shutter', LIFT, after);
    wallRect(mesh, g, s1, s1 + sw, z0, z1, 'shutter', LIFT, after);
  }

  wallRect(mesh, g, s0, s1, z0, z1, 'trim', LIFT, after);

  const inner = (mat) => wallRect(mesh, g, s0 + F, s1 - F, z0 + F, z1 - F, mat, LIFT * 2, after);
  switch (op.kind) {
    case 'door':
      inner('door');
      // Handle.
      wallRect(mesh, g, s1 - F - 0.16, s1 - F - 0.06, z0 + h * 0.45, z0 + h * 0.55, 'garageLine', LIFT * 3, after);
      break;
    case 'garage':
      inner('garage');
      for (let k = 1; k < 5; k++) {
        const z = z0 + F + ((h - 2 * F) * k) / 5;
        wallRect(mesh, g, s0 + F, s1 - F, z - 0.02, z + 0.02, 'garageLine', LIFT * 3, after);
      }
      break;
    default: {
      inner('glass');
      if (!bars) break;
      // A single mullion reads as a window at illustration scale.
      const mid = (s0 + s1) / 2;
      wallRect(mesh, g, mid - 0.04, mid + 0.04, z0 + F, z1 - F, 'trim', LIFT * 3, after);
      if (h > 1.0) {
        const zm = z0 + h * 0.55;
        wallRect(mesh, g, s0 + F, s1 - F, zm - 0.04, zm + 0.04, 'trim', LIFT * 3, after);
      }
    }
  }
}

/** Roof-mounted items: solar arrays, chimneys, roof windows, satellite dishes. */
function buildRoofItems(mesh, b, roof, items, mat) {
  if (!roof) return;
  const { field } = roof;
  const top = wallTop(b);
  const zAt = (x, y) => top + Math.max(0, field.h(x, y));
  const after = { mat: mat('roof'), group: 'roof' };

  for (const it of items) {
    const w = it.w ?? 2, d = it.d ?? 1.5;
    const x0 = it.x - w / 2, x1 = it.x + w / 2;
    const y0 = it.y - d / 2, y1 = it.y + d / 2;
    if (!field.inside(it.x, it.y)) continue;

    if (it.kind === 'chimney') {
      const base = Math.min(zAt(x0, y0), zAt(x1, y0), zAt(x0, y1), zAt(x1, y1)) - 0.3;
      const h = it.h ?? 1.1;
      const capTop = zAt(it.x, it.y) + h;
      mesh.box([x0, y0, base], [x1, y1, capTop - 0.12], 'chimney', 'chimney', ['bottom'], after);
      mesh.box([x0 - 0.08, y0 - 0.08, capTop - 0.12], [x1 + 0.08, y1 + 0.08, capTop], 'chimneyCap', 'chimney', ['bottom'], after);
      continue;
    }

    // Everything else lies flat on the slope. The supporting plane is taken
    // once at the item's centre and the corners are projected onto it: reading
    // the field corner by corner would fold the panel in half wherever it
    // happens to straddle a hip or a ridge.
    const lift = 0.04;
    const eps = 0.05;
    const zc = zAt(it.x, it.y);
    const dzdx = (zAt(it.x + eps, it.y) - zAt(it.x - eps, it.y)) / (2 * eps);
    const dzdy = (zAt(it.x, it.y + eps) - zAt(it.x, it.y - eps)) / (2 * eps);
    const plane = (px, py, extra) => [px, py, zc + dzdx * (px - it.x) + dzdy * (py - it.y) + extra];
    const q = (px, py) => plane(px, py, lift);
    if (it.kind === 'solar') {
      mesh.quad(q(x0, y0), q(x1, y0), q(x1, y1), q(x0, y1), 'solarFrame', 'solarFrame', after);
      const b = 0.07;
      const p = (px, py) => plane(px, py, lift * 2);
      mesh.quad(p(x0 + b, y0 + b), p(x1 - b, y0 + b), p(x1 - b, y1 - b), p(x0 + b, y1 - b), 'solar', 'solar', after);
      const r = (px, py) => plane(px, py, lift * 3);
      const cell = 0.85; // roughly one photovoltaic cell across
      const cols = Math.max(2, Math.round((w - 2 * b) / cell));
      const rows = Math.max(2, Math.round((d - 2 * b) / cell));
      for (let k = 1; k < cols; k++) {
        const x = x0 + b + ((w - 2 * b) * k) / cols;
        mesh.quad(r(x - 0.02, y0 + b), r(x + 0.02, y0 + b), r(x + 0.02, y1 - b), r(x - 0.02, y1 - b), 'solarCell', 'solarCell', after);
      }
      for (let k = 1; k < rows; k++) {
        const y = y0 + b + ((d - 2 * b) * k) / rows;
        mesh.quad(r(x0 + b, y - 0.02), r(x1 - b, y - 0.02), r(x1 - b, y + 0.02), r(x0 + b, y + 0.02), 'solarCell', 'solarCell', after);
      }
    } else if (it.kind === 'velux') {
      mesh.quad(q(x0, y0), q(x1, y0), q(x1, y1), q(x0, y1), 'frame', 'frame', after);
      const b = 0.09;
      const p = (px, py) => plane(px, py, lift * 2);
      mesh.quad(p(x0 + b, y0 + b), p(x1 - b, y0 + b), p(x1 - b, y1 - b), p(x0 + b, y1 - b), 'glass', 'glass', after);
    } else if (it.kind === 'dish') {
      const r = Math.max(w, d) / 2;
      const zc = zAt(it.x, it.y) + 0.5;
      mesh.box([it.x - 0.05, it.y - 0.05, zAt(it.x, it.y)], [it.x + 0.05, it.y + 0.05, zc], 'chimneyCap', 'dish', ['bottom'], after);
      const pts = [];
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2;
        pts.push([it.x + Math.cos(t) * r, it.y + Math.sin(t) * r * 0.6, zc + Math.sin(t) * r * 0.5]);
      }
      mesh.poly(pts, 'garage', 'dish', after);
    }
  }
}

/**
 * Emit one building: its plinth, walls, openings, roof and roof items.
 *
 * Each volume carries its own roof and height, so this runs once per building
 * rather than once per model — a shed keeps its flat roof while the house
 * keeps its hips.
 */
function buildOne(mesh, m, b, cs, roofItems) {
  const cells = buildingCells(b);
  if (!cells.size) return null;
  const rects = decomposeRects(cells).map((r) => ({
    x0: r.x0 * cs, y0: r.y0 * cs, x1: r.x1 * cs, y1: r.y1 * cs,
  }));
  const top = wallTop(b);
  const field = rects.length ? heightField(rects, b.roof) : null;
  const fascia = b.roof.fascia ?? 0.18;
  // A building may recolour its materials or choose its own — a timber shed
  // wants neither the house's render nor its canal tiles. The suffix keeps
  // those apart without giving every volume a palette of its own; anything it
  // does not state still resolves to the shared material.
  const own = (b.overrides && Object.keys(b.overrides).length) || b.texture;
  const mat = (name) => (own ? `${name}#${b.id}` : name);

  const edges = boundaryEdges(cells);
  const geoms = new Map();
  for (const e of edges) {
    const g = edgeGeometry(e, cs);
    geoms.set(e.id, g);
    const p = (s, z, out = 0) => [
      g.a[0] + g.u[0] * s + g.n[0] * out,
      g.a[1] + g.u[1] * s + g.n[1] * out,
      z,
    ];
    if (b.plinth > 0) {
      mesh.quad(p(0, 0), p(g.len, 0), p(g.len, b.plinth), p(0, b.plinth), mat('plinth'), 'plinth');
    }
    const zTop = (s) => {
      const x = g.a[0] + g.u[0] * s;
      const y = g.a[1] + g.u[1] * s;
      return Math.max(b.plinth, undersideAt(field, top, fascia, x, y));
    };
    const steps = Math.max(1, Math.round(g.len / STEP));
    for (let k = 0; k < steps; k++) {
      const s0 = (g.len * k) / steps;
      const s1 = (g.len * (k + 1)) / steps;
      const z0 = zTop(s0), z1 = zTop(s1);
      if (z0 <= b.plinth + 1e-9 && z1 <= b.plinth + 1e-9) continue;
      mesh.quad(p(s0, b.plinth), p(s1, b.plinth), p(s1, z1), p(s0, z0), mat('wall'), 'wall');
    }
  }

  for (const op of m.openings) {
    const g = geoms.get(op.edge);
    if (g) buildOpening(mesh, op, g, b, m);
  }

  const roof = buildRoof(mesh, field, b.roof, top, mat);
  buildRoofItems(mesh, b, roof, roofItems, mat);
  return { building: b, edges, geoms, roof, field, top };
}

/** Build the complete mesh for a model. */
export function buildMesh(m) {
  const mesh = new Mesh();
  const cs = cellSizeOf(m);
  const cells = cellSet(m);
  const b = bounds(cells);

  // --- Ground -------------------------------------------------------------
  // Sized to the footprint *and* everything placed around it. A prop left
  // hanging off the edge of the ground reads as floating above the roof rather
  // than standing behind the house, because nothing anchors it to a surface.
  if (m.ground.enabled && !b.empty) {
    const g = m.ground.margin;
    let x0 = b.i0 * cs, y0 = b.j0 * cs, x1 = (b.i1 + 1) * cs, y1 = (b.j1 + 1) * cs;
    for (const p of m.props) {
      const centred = p.kind === 'tree' || p.kind === 'bush' || p.kind === 'car';
      const pw = p.r ? p.r * 2 : p.w ?? 2;
      const pd = p.r ? p.r * 2 : p.d ?? 2;
      const px = centred ? p.x - pw / 2 : p.x;
      const py = centred ? p.y - pd / 2 : p.y;
      x0 = Math.min(x0, px - 1); y0 = Math.min(y0, py - 1);
      x1 = Math.max(x1, px + pw + 1); y1 = Math.max(y1, py + pd + 1);
    }
    mesh.quad(
      [x0 - g, y0 - g, 0], [x1 + g, y0 - g, 0],
      [x1 + g, y1 + g, 0], [x0 - g, y1 + g, 0],
      m.ground.material, 'ground',
    );
  }

  // --- Contact shadow -----------------------------------------------------
  if (m.style.shadow && !b.empty) {
    const o = 0.45;
    const after = { mat: m.ground.material, group: 'ground' };
    for (const k of cells) {
      const [i, j] = parseKey(k);
      mesh.quad(
        [i * cs + o, j * cs + o, 0.004], [(i + 1) * cs + o, j * cs + o, 0.004],
        [(i + 1) * cs + o, (j + 1) * cs + o, 0.004], [i * cs + o, (j + 1) * cs + o, 0.004],
        'shadow', 'shadow', after,
      );
    }
  }

  buildProps(mesh, m);

  // Each roof item lands on whichever building's roof actually carries it.
  const parts = [];
  const taken = new Set();
  for (const bd of m.buildings) {
    const mine = m.roofItems.filter((it) => {
      if (taken.has(it.id)) return false;
      const cellKey = `${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`;
      if (!bd.cells.includes(cellKey)) return false;
      taken.add(it.id);
      return true;
    });
    const part = buildOne(mesh, m, bd, cs, mine);
    if (part) parts.push(part);
  }

  const main = parts[0] || null;
  return {
    mesh, bounds: b, parts,
    // Kept for callers that only ever look at the first volume.
    edges: parts.flatMap((p) => p.edges),
    geoms: main ? main.geoms : new Map(),
    roof: main ? main.roof : null,
    top: main ? main.top : 0,
  };
}

export { heightField };
