/**
 * Turns a model into a triangle mesh: ground, walls, openings, roof and
 * everything that sits on them. Geometry only — no colours, no projection.
 */

import { Mesh } from './mesh.js';
import { boundaryEdges, decomposeRects, bounds, parseKey, SIDES } from './grid.js';
import { buildRoof, heightField, undersideAt, STEP } from './roof.js';
import { cellSet, wallTop, storeyBase, cellSizeOf, buildingCells, propFootprint } from './model.js';
import { focusRect } from './focus.js';
import { buildProps, roundedRect } from './props.js';

const LIFT = 0.015; // how far detail quads float off the surface they decorate
const GROUND_ROUND = 2.5; // corner radius of the ground pad, in metres

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

/**
 * The recess of an opening, as the wall builder needs it: where the hole is,
 * and how deep. Null when the opening is flush — the overwhelmingly common
 * case, which must not pay for the other one.
 */
function recessOf(op, b, zTopAt, run) {
  const depth = Math.min(1, op.depth || 0);
  if (depth < 0.01) return null;
  const zBase = storeyBase(b, op.storey || 0);
  const w = op.width ?? 1.2;
  const c = op.offset ?? 0.5;
  const z0 = zBase + (op.sill ?? 0.95);
  // The recess may be wider and taller than what stands in it — a doorway set
  // back into a porch, which is what a user described: eighty centimetres of
  // wall either side of his door. The leaf, its frame and its glass keep the
  // opening's own dimensions; only the hole grows.
  const side = Math.max(0, Math.min(2, op.sides || 0));
  const head = Math.max(0, Math.min(1, op.head || 0));
  const z1 = z0 + (op.height ?? 1.25) + head;
  // A niche must sit wholly inside its wall. Where the opening pokes past the
  // roof underside — a user mid-adjustment — it falls back to flush rather
  // than carving a hole open to the sky. Measured at the widened edges, which
  // is where a gable comes down to meet it.
  const s0 = Math.max(run[0], c - w / 2 - side);
  const s1 = Math.min(run[1], c + w / 2 + side);
  if (s1 - s0 < 0.05) return null;
  if (z1 > Math.min(zTopAt(s0), zTopAt(s1)) - 0.02) return null;
  return { s0, s1, z0, z1, depth };
}

/** Draw one opening (window, door, garage door...) onto its wall. */
function buildOpening(mesh, op, g, b, m, rec) {
  const zBase = storeyBase(b, op.storey || 0);
  const w = op.width ?? 1.2;
  const h = op.height ?? 1.25;
  const sill = op.sill ?? 0.95;
  const c = op.offset ?? 0.5;
  const s0 = c - w / 2, s1 = c + w / 2;
  const z0 = zBase + sill, z1 = zBase + sill + h;
  // Anchored to this building's own wall material, which may be recoloured.
  const own = (b.overrides && Object.keys(b.overrides).length) || b.texture;
  const wallMat = own ? `wall#${b.id}` : 'wall';
  // Recessed, the decals rest on the niche's back panel and on nothing else —
  // its own group makes that anchor deterministic. Anchored merely "to the
  // wall", the trim could pick a side reveal as carrier and get thrown in
  // front of the facade.
  const after = { mat: wallMat, group: rec ? 'niche' : 'wall' };
  // Plain openings read as a broad frame around one clear pane. Some palettes
  // want that flatter treatment; the default keeps the mullions, which make a
  // window legible at small sizes.
  const bars = m.style.windowBars !== false;
  const F = bars ? 0.09 : 0.14; // frame thickness

  /*
   * A recessed opening is real geometry, not shading. The wall builder has
   * left a hole here; this closes it with a back panel and four reveals, and
   * the door is then drawn on the back panel instead of the wall plane. Being
   * actual boxes, the reveals shade themselves by their normals and occlude
   * correctly at any camera angle — the plane-ordering pass treats them as
   * shell, like the wall they are carved into.
   *
   * Winding note: (u, n, z-up) is consistently left-handed for boundary
   * edges, so n×ẑ = -u everywhere; the reveal windings below rely on it.
   */
  const depth = rec ? rec.depth : 0;
  if (rec) {
    const q = (sv, z, o) => [
      g.a[0] + g.u[0] * sv + g.n[0] * o,
      g.a[1] + g.u[1] * sv + g.n[1] * o,
      z,
    ];
    const d = depth;
    // The niche follows the hole, which may be wider and taller than the
    // opening standing in it. Taking the opening's own extent here left the
    // recess open along the strip the wall builder had already removed.
    const [n0, n1, nz0, nz1] = [rec.s0, rec.s1, rec.z0, rec.z1];
    const OV = 0.04; // tucked behind the wall strips, against antialias seams
    mesh.quad(q(n0 - OV, nz0 - OV, -d), q(n1 + OV, nz0 - OV, -d),
      q(n1 + OV, nz1 + OV, -d), q(n0 - OV, nz1 + OV, -d), wallMat, 'niche');
    // Reveals: left, right, lintel underside, sill top.
    mesh.quad(q(n0, nz0, 0), q(n0, nz0, -d), q(n0, nz1, -d), q(n0, nz1, 0), wallMat, 'wall');
    mesh.quad(q(n1, nz0, -d), q(n1, nz0, 0), q(n1, nz1, 0), q(n1, nz1, -d), wallMat, 'wall');
    mesh.quad(q(n1, nz1, 0), q(n0, nz1, 0), q(n0, nz1, -d), q(n1, nz1, -d), wallMat, 'wall');
    mesh.quad(q(n0, nz0, 0), q(n1, nz0, 0), q(n1, nz0, -d), q(n0, nz0, -d), wallMat, 'wall');
  }

  if (op.kind === 'shutter') {
    // Shutters flank the opening on the outer wall, so they are drawn before
    // it — and stay on the facade even when the opening is recessed.
    const sw = Math.min(w * 0.45, 0.5);
    wallRect(mesh, g, s0 - sw, s0, z0, z1, 'shutter', LIFT, after);
    wallRect(mesh, g, s1, s1 + sw, z0, z1, 'shutter', LIFT, after);
  }

  wallRect(mesh, g, s0, s1, z0, z1, 'trim', LIFT - depth, after);

  const inner = (mat) => wallRect(mesh, g, s0 + F, s1 - F, z0 + F, z1 - F, mat, LIFT * 2 - depth, after);
  switch (op.kind) {
    case 'door':
      inner('door');
      // Handle.
      wallRect(mesh, g, s1 - F - 0.16, s1 - F - 0.06, z0 + h * 0.45, z0 + h * 0.55, 'garageLine', LIFT * 3 - depth, after);
      break;
    case 'garage':
      inner('garage');
      for (let k = 1; k < 5; k++) {
        const z = z0 + F + ((h - 2 * F) * k) / 5;
        wallRect(mesh, g, s0 + F, s1 - F, z - 0.02, z + 0.02, 'garageLine', LIFT * 3 - depth, after);
      }
      break;
    default: {
      inner('glass');
      if (!bars) break;
      // A single mullion reads as a window at illustration scale.
      const mid = (s0 + s1) / 2;
      wallRect(mesh, g, mid - 0.04, mid + 0.04, z0 + F, z1 - F, 'trim', LIFT * 3 - depth, after);
      if (h > 1.0) {
        const zm = z0 + h * 0.55;
        wallRect(mesh, g, s0 + F, s1 - F, zm - 0.04, zm + 0.04, 'trim', LIFT * 3 - depth, after);
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

    // Everything else lies flat on the slope, emitted as a subdivided patch
    // that follows the roof surface.
    //
    // A single planar quad was tried first and is worse: astride a hip or a
    // ridge it keeps its own plane and tears straight through the roof. Made
    // of small quads it bends over the crease instead, which at least reads
    // as a panel following the roof. On a single slope the pieces are coplanar
    // and merge straight back into one face, so this costs nothing in the
    // ordinary case.
    const lift = 0.04;
    // Fine enough that the pieces straddling a crease stay small. On a plain
    // slope they are coplanar and merge back into one face, so the resolution
    // costs nothing where it is not needed.
    const SUB = 0.18;
    const patch = (x0, y0, x1, y1, extra, material, group) => {
      const nx = Math.max(1, Math.round((x1 - x0) / SUB));
      const ny = Math.max(1, Math.round((y1 - y0) / SUB));
      const at = (px, py) => [px, py, zAt(px, py) + extra];
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const ax = x0 + ((x1 - x0) * ix) / nx, bx = x0 + ((x1 - x0) * (ix + 1)) / nx;
          const ay = y0 + ((y1 - y0) * iy) / ny, by = y0 + ((y1 - y0) * (iy + 1)) / ny;
          mesh.quad(at(ax, ay), at(bx, ay), at(bx, by), at(ax, by), material, group, after);
        }
      }
    };
    if (it.kind === 'solar') {
      patch(x0, y0, x1, y1, lift, mat('solarFrame'), 'solarFrame');
      const b = 0.07;
      patch(x0 + b, y0 + b, x1 - b, y1 - b, lift * 2, mat('solar'), 'solar');
      // Cell divisions are dropped when the panel bridges a crease: those
      // narrow strips cross the fold at a slant and come out as spikes, and a
      // panel that should not be there anyway is better left plain.
      const slope = (x, y) => [
        (zAt(x + 0.05, y) - zAt(x - 0.05, y)) / 0.1,
        (zAt(x, y + 0.05) - zAt(x, y - 0.05)) / 0.1,
      ];
      const g0 = slope(x0 + b, y0 + b);
      const straddles = [[x1 - b, y0 + b], [x0 + b, y1 - b], [x1 - b, y1 - b]]
        .some(([x, y]) => {
          const g = slope(x, y);
          return Math.abs(g[0] - g0[0]) > 0.05 || Math.abs(g[1] - g0[1]) > 0.05;
        });
      const cell = 0.85; // roughly one photovoltaic cell across
      const cols = straddles ? 0 : Math.max(2, Math.round((w - 2 * b) / cell));
      const rows = straddles ? 0 : Math.max(2, Math.round((d - 2 * b) / cell));
      for (let k = 1; k < cols; k++) {
        const x = x0 + b + ((w - 2 * b) * k) / cols;
        patch(x - 0.02, y0 + b, x + 0.02, y1 - b, lift * 3, mat('solarCell'), 'solarCell');
      }
      for (let k = 1; k < rows; k++) {
        const y = y0 + b + ((d - 2 * b) * k) / rows;
        patch(x0 + b, y - 0.02, x1 - b, y + 0.02, lift * 3, mat('solarCell'), 'solarCell');
      }
    } else if (it.kind === 'velux') {
      patch(x0, y0, x1, y1, lift, mat('frame'), 'frame');
      const b = 0.09;
      patch(x0 + b, y0 + b, x1 - b, y1 - b, lift * 2, mat('glass'), 'glass');
    } else if (it.kind === 'dish') {
      const r = Math.max(w, d) / 2;
      const zc = zAt(it.x, it.y) + 0.5;
      mesh.box([it.x - 0.05, it.y - 0.05, zAt(it.x, it.y)], [it.x + 0.05, it.y + 0.05, zc], mat('chimneyCap'), 'dish', ['bottom'], after);
      const pts = [];
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2;
        pts.push([it.x + Math.cos(t) * r, it.y + Math.sin(t) * r * 0.6, zc + Math.sin(t) * r * 0.5]);
      }
      mesh.poly(pts, mat('garage'), 'dish', after);
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
  const zTopFor = (g) => (sv) => {
    const x = g.a[0] + g.u[0] * sv;
    const y = g.a[1] + g.u[1] * sv;
    return Math.max(b.plinth, undersideAt(field, top, fascia, x, y));
  };
  for (const e of edges) geoms.set(e.id, edgeGeometry(e, cs));

  /*
   * How far the wall an edge belongs to actually runs, measured in that edge's
   * own frame. Boundary edges are one cell long; a wide opening, and now a
   * recess wider still, spans several — and must stop where the wall does.
   * Without this a porch widened past the corner of the house carved its niche
   * out into thin air, and the return facade was painted over it.
   */
  const runs = new Map();
  for (const e of edges) {
    const g = geoms.get(e.id);
    let lo = 0, hi = g.len;
    for (const e2 of edges) {
      const g2 = geoms.get(e2.id);
      if (Math.abs(g2.n[0] - g.n[0]) + Math.abs(g2.n[1] - g.n[1]) > 1e-9) continue;
      if (Math.abs((g2.a[0] - g.a[0]) * g.n[0] + (g2.a[1] - g.a[1]) * g.n[1]) > 1e-6) continue;
      const dir = g2.u[0] * g.u[0] + g2.u[1] * g.u[1];
      const sA = (g2.a[0] - g.a[0]) * g.u[0] + (g2.a[1] - g.a[1]) * g.u[1];
      const sB = sA + g2.len * dir;
      lo = Math.min(lo, sA, sB);
      hi = Math.max(hi, sA, sB);
    }
    runs.set(e.id, [lo, hi]);
  }

  /*
   * Recessed openings first: the wall builder must know where NOT to build.
   * A recess is a genuine hole in the wall, with the storey above running on
   * over the lintel — which is what distinguishes it from simply erasing a
   * cell, where the notch would climb the full height of the building.
   *
   * The hole is spread over every edge it actually crosses, not just the one
   * the opening is anchored to. Boundary edges are one cell long, and a
   * French door is wider than a cell: cut only in its anchor edge, the niche
   * kept its wall over one side — found by rendering, not by reasoning.
   */
  const recesses = new Map();
  const addHole = (edgeId, hole) => {
    if (!recesses.has(edgeId)) recesses.set(edgeId, []);
    recesses.get(edgeId).push(hole);
  };
  for (const op of m.openings) {
    const g = geoms.get(op.edge);
    if (!g) continue;
    const rec = recessOf(op, b, zTopFor(g), runs.get(op.edge));
    if (!rec) continue;
    // World endpoints of the hole, on the wall line.
    const P = (sv) => [g.a[0] + g.u[0] * sv, g.a[1] + g.u[1] * sv];
    const [w0, w1] = [P(rec.s0), P(rec.s1)];
    for (const e2 of edges) {
      const g2 = geoms.get(e2.id);
      // Same wall line: same outward normal, and no offset across it.
      if (Math.abs(g2.n[0] - g.n[0]) + Math.abs(g2.n[1] - g.n[1]) > 1e-9) continue;
      const off = (g2.a[0] - g.a[0]) * g.n[0] + (g2.a[1] - g.a[1]) * g.n[1];
      if (Math.abs(off) > 1e-6) continue;
      const sOf = (pt) => (pt[0] - g2.a[0]) * g2.u[0] + (pt[1] - g2.a[1]) * g2.u[1];
      const sA = Math.min(sOf(w0), sOf(w1));
      const sB = Math.max(sOf(w0), sOf(w1));
      if (sB <= 1e-6 || sA >= g2.len - 1e-6) continue;
      addHole(e2.id, { ...rec, s0: Math.max(0, sA), s1: Math.min(g2.len, sB) });
    }
  }

  for (const e of edges) {
    const g = geoms.get(e.id);
    const p = (s, z, out = 0) => [
      g.a[0] + g.u[0] * s + g.n[0] * out,
      g.a[1] + g.u[1] * s + g.n[1] * out,
      z,
    ];
    if (b.plinth > 0) {
      mesh.quad(p(0, 0), p(g.len, 0), p(g.len, b.plinth), p(0, b.plinth), mat('plinth'), 'plinth');
    }
    const zTop = zTopFor(g);
    const holes = recesses.get(e.id) || [];

    // Column boundaries: the sampling step, plus every hole edge, so a hole
    // lands exactly between columns instead of being rounded to the lattice.
    const cuts = new Set([0, g.len]);
    const steps = Math.max(1, Math.round(g.len / STEP));
    for (let k = 1; k < steps; k++) cuts.add((g.len * k) / steps);
    for (const hole of holes) {
      if (hole.s0 > 0) cuts.add(Math.max(0, hole.s0));
      if (hole.s1 < g.len) cuts.add(Math.min(g.len, hole.s1));
    }
    const xs = [...cuts].sort((a2, b2) => a2 - b2);

    for (let i = 0; i + 1 < xs.length; i++) {
      const s0 = xs[i], s1 = xs[i + 1];
      if (s1 - s0 < 1e-6) continue;
      const z0 = zTop(s0), z1 = zTop(s1);
      if (z0 <= b.plinth + 1e-9 && z1 <= b.plinth + 1e-9) continue;
      const mid = (s0 + s1) / 2;
      const cut = holes.filter((hh) => hh.s0 < mid && mid < hh.s1)
        .sort((a2, b2) => a2.z0 - b2.z0);
      // Wall pieces between the holes of this column: sill strip below,
      // lintel strip (and the storeys above) over the top.
      const emit = (zb, ztA, ztB) => {
        if (ztA <= zb + 1e-4 && ztB <= zb + 1e-4) return;
        mesh.quad(p(s0, zb), p(s1, zb), p(s1, ztB), p(s0, ztA), mat('wall'), 'wall');
      };
      let zb = b.plinth;
      for (const hh of cut) {
        emit(zb, Math.min(hh.z0, z0), Math.min(hh.z0, z1));
        zb = Math.max(zb, hh.z1);
      }
      emit(zb, z0, z1);
    }
  }

  for (const op of m.openings) {
    const g = geoms.get(op.edge);
    if (g) buildOpening(mesh, op, g, b, m, recessOf(op, b, zTopFor(g), runs.get(op.edge)));
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

  /*
   * --- Ground ------------------------------------------------------------
   *
   * A pad under what is shown, with rounded corners — not a slab filling the
   * picture. That distinction is what decides whether an exported image sits
   * on a dashboard or covers it: a house on a small green cushion, transparent
   * all round, drops onto any card; a rectangle of lawn edge to edge is a
   * green tile with a house on it. Gladys's own illustrations do the former,
   * and they are what these images stand next to.
   *
   * Under a frame the pad follows the *frame*, not the whole plot. A garden
   * eighty metres long, cropped to the gate, otherwise filled the picture with
   * lawn — the very thing the framing was asked to avoid.
   */
  if (m.ground.enabled) {
    const g = m.ground.margin;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const cover = (ax0, ay0, ax1, ay1) => {
      x0 = Math.min(x0, ax0); y0 = Math.min(y0, ay0);
      x1 = Math.max(x1, ax1); y1 = Math.max(y1, ay1);
    };
    // A building always gets ground under it: it is the one thing that cannot
    // stand on nothing, and its footprint bounds how far that reaches.
    if (!b.empty) cover(b.i0 * cs, b.j0 * cs, (b.i1 + 1) * cs, (b.j1 + 1) * cs);
    if (m.focus?.enabled) {
      cover(...focusRect(m.focus));
    } else {
      // Props count too: one left hanging off the edge of the ground reads as
      // floating above the roof rather than standing behind the house,
      // because nothing anchors it to a surface. Under a frame they do not,
      // deliberately — a wall kept whole because it crosses the frame would
      // otherwise drag the pad the length of the garden, which is the green
      // tile this is meant to avoid. It simply runs off the edge instead,
      // which is what a crop looks like.
      for (const p of m.props) {
        const [px0, py0, px1, py1] = propFootprint(p);
        cover(px0 - 1, py0 - 1, px1 + 1, py1 + 1);
      }
    }
    if (Number.isFinite(x0)) {
      const w = x1 - x0 + 2 * g, d = y1 - y0 + 2 * g;
      const ring = roundedRect(x0 - g, y0 - g, x1 + g, y1 + g,
        Math.min(GROUND_ROUND, Math.min(w, d) * 0.16));
      mesh.poly(ring.map((p) => [p[0], p[1], 0]), m.ground.material, 'ground');
    }
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
