/**
 * Outdoor items: pool, terrace, path, greenery, fence, car.
 *
 * Rectangular props are positioned by their minimum corner (x, y) plus a size
 * (w, d); trees and cars are positioned by their centre. All of them anchor to
 * the ground plane so they sort after it whatever the rotation.
 */

import { cellSet } from './model.js';

// Props are ordered by their own depth. They do not anchor to the ground:
// the renderer already draws the ground plane as a backdrop, and anchoring to
// a scene-sized quad would drag every prop to the front.
const groundAnchor = () => null;

/** Above this, a slab stops being a decal and becomes geometry with sides. */
const RAISED = 0.05;

/** Rounded rectangle as a closed ring of points, for pools and terraces. */
export function roundedRect(x0, y0, x1, y1, r, steps = 5) {
  const w = x1 - x0, d = y1 - y0;
  const rr = Math.max(0, Math.min(r, w / 2, d / 2));
  if (rr < 1e-6) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (k / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  return pts;
}

/**
 * A flat decal on the ground.
 *
 * `group` names a paint tier rather than the material. Terrace, coping and
 * water are large, near-coplanar faces: their painter's depth is dominated by
 * their position on the ground, not by the millimetres of height between them,
 * so a pool sitting at the far end of a terrace would be painted over by it.
 * Ordering them explicitly is the same remedy already used for the ground
 * plane, and for the same reason.
 */
function ringSlab(mesh, ring, z, mat, group, anchor) {
  mesh.poly(ring.map(([x, y]) => [x, y, z]), mat, group, anchor);
}

/**
 * A raised slab: top face plus the vertical sides that make the height read.
 *
 * Once it has real height it is ordinary geometry, sorted by depth against the
 * house like anything else — the flat-decal tiers no longer apply, and must
 * not, or a raised terrace in front of the house would slide behind it.
 */
function raisedSlab(mesh, ring, z, matTop, matSide, group, after = null) {
  mesh.poly(ring.map(([x, y]) => [x, y, z]), matTop, group, after);
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    mesh.quad([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], z], [a[0], a[1], z], matSide, group, after);
  }
}

/** A tapered stack of rings, flat-shaded — reads as stylised foliage. */
function blob(mesh, cx, cy, z0, r, h, mat, anchor, sides = 12) {
  const levels = [
    { t: 0.0, s: 0.55 }, { t: 0.32, s: 1.0 }, { t: 0.68, s: 0.86 }, { t: 1.0, s: 0.0 },
  ];
  const ring = (s, t) => {
    const pts = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
      pts.push([cx + Math.cos(a) * r * s, cy + Math.sin(a) * r * s, z0 + h * t]);
    }
    return pts;
  };
  let prev = ring(levels[0].s, levels[0].t);
  mesh.poly([...prev].reverse(), mat, mat, anchor);
  for (let i = 1; i < levels.length; i++) {
    const cur = ring(levels[i].s, levels[i].t);
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      if (levels[i].s < 1e-6) mesh.tri(prev[k], prev[k2], cur[k], mat, mat, anchor);
      else mesh.quad(prev[k], prev[k2], cur[k2], cur[k], mat, mat, anchor);
    }
    prev = cur;
  }
}

/**
 * A garden wall, in the material of the house so a boundary wall reads as
 * belonging to it, capped with a slightly proud coping.
 */
function muretRun(mesh, a0, a1, c0, c1, h, horiz, id) {
  if (a1 - a0 < 0.05) return;
  const [x0, y0, x1, y1] = horiz ? [a0, c0, a1, c1] : [c0, a0, c1, a1];
  const tag = `muret:${id}:${a0.toFixed(2)}`;
  segmentedBox(mesh, [x0, y0, 0], [x1, y1, h - 0.06], 'wall', tag, null);
  const o = 0.035;
  segmentedBox(mesh, [x0 - o, y0 - o, h - 0.06], [x1 + o, y1 + o, h], 'trim', `${tag}:cap`, null);
}

/**
 * A white gate: two posts, a frame, and vertical bars.
 *
 * `slide` adds the ground guide and the counterweight tail of a sliding gate,
 * which is what tells it apart from a swing gate at a glance.
 */
function gate(mesh, a0, a1, c0, c1, h, horiz, slide, id) {
  const g = `gate:${id}`;
  const span = a1 - a0;
  const post = 0.11;
  const at = (p0, p1, q0, q1, z0, z1, mat) => {
    const [x0, y0, x1, y1] = horiz ? [p0, q0, p1, q1] : [q0, p0, q1, p1];
    mesh.box([x0, y0, z0], [x1, y1, z1], mat, g, ['bottom']);
  };
  at(a0, a0 + post, c0 - 0.03, c1 + 0.03, 0, h + 0.12, 'trim');
  at(a1 - post, a1, c0 - 0.03, c1 + 0.03, 0, h + 0.12, 'trim');

  const i0 = a0 + post, i1 = a1 - post;
  at(i0, i1, c0, c1, 0.06, 0.18, 'trim');       // bottom rail
  at(i0, i1, c0, c1, h - 0.14, h, 'trim');      // top rail
  const step = 0.16;
  const count = Math.max(1, Math.round((i1 - i0) / step));
  for (let k = 1; k < count; k++) {
    const x = i0 + ((i1 - i0) * k) / count;
    at(x - 0.025, x + 0.025, c0 + 0.01, c1 - 0.01, 0.18, h - 0.14, 'trim');
  }
  if (slide) {
    // Ground guide rail, and the tail the leaf slides back onto.
    at(a0 - span * 0.55, a1, c0 + 0.02, c1 - 0.02, 0, 0.05, 'garageLine');
  }
}

/**
 * A long box, emitted in segments.
 *
 * A hedge or a garden wall can run twenty metres. Merged into one face it
 * carries a single centroid, hence a single depth, so the whole run sorts
 * either in front of the house or behind it — never partly each, which is
 * exactly what a long run needs. Segments each get their own depth; the faces
 * they share are skipped so no wall appears inside the run.
 */
function segmentedBox(mesh, min, max, mat, group, anchor, target = 2.5) {
  const horiz = (max[0] - min[0]) >= (max[1] - min[1]);
  const len = horiz ? max[0] - min[0] : max[1] - min[1];
  const n = Math.max(1, Math.round(len / target));
  // Segments overlap by a hair. Two polygons sharing an edge always leave a
  // seam: each is anti-aliased against the background there, and the two half
  // coverages do not add up to one. Overlapping puts the nearer segment's
  // solid fill over the joint instead.
  const ov = 0.05;
  for (let k = 0; k < n; k++) {
    const a = (len * k) / n;
    const b = (len * (k + 1)) / n + (k < n - 1 ? ov : 0);
    const lo = horiz ? [min[0] + a, min[1], min[2]] : [min[0], min[1] + a, min[2]];
    const hi = horiz ? [min[0] + b, max[1], max[2]] : [max[0], min[1] + b, max[2]];
    const skip = ['bottom'];
    if (horiz) {
      if (k > 0) skip.push('x-');
      if (k < n - 1) skip.push('x+');
    } else {
      if (k > 0) skip.push('y-');
      if (k < n - 1) skip.push('y+');
    }
    mesh.box(lo, hi, mat, `${group}:${k}`, skip, anchor);
  }
}

/** Extent of a prop along and across a given axis. */
function extent(p, horiz) {
  const w = p.w ?? 2, d = p.d ?? 0.2;
  return horiz
    ? { a0: p.x, a1: p.x + w, c0: p.y, c1: p.y + d }
    : { a0: p.y, a1: p.y + d, c0: p.x, c1: p.x + w };
}

export function buildProps(mesh, m) {
  const anchor = groundAnchor(m);
  const occupied = cellSet(m);
  const gates = m.props.filter((p) => p.kind === 'gate');

  for (const p of m.props) {
    switch (p.kind) {
      case 'terrace':
      case 'deck':
      case 'path': {
        const mat = p.material || (p.kind === 'path' ? 'gravel' : p.kind === 'deck' ? 'deck' : 'paving');
        const ring = roundedRect(p.x, p.y, p.x + p.w, p.y + p.d, p.radius ?? (p.kind === 'deck' ? 0.1 : 0.2));
        const z = p.z ?? 0;
        if (z > RAISED) raisedSlab(mesh, ring, z, mat, mat, 'slab');
        else ringSlab(mesh, ring, 0.012, mat, 'decal0', anchor);
        break;
      }
      case 'pool': {
        const r = p.shape === 'rounded' ? Math.min(p.w, p.d) * 0.32 : 0.05;
        const i = 0.28;
        const coping = roundedRect(p.x, p.y, p.x + p.w, p.y + p.d, r + 0.25);
        const water = roundedRect(p.x + i, p.y + i, p.x + p.w - i, p.y + p.d - i, r);
        const z = p.z ?? 0;
        if (z > RAISED) {
          // Raised, both are ordinary geometry — and two raised slabs sorted by
          // their centres bring the original defect back one storey up, a large
          // terrace swallowing the small pool standing on it. So the coping is
          // anchored to whatever slab carries it, and the water to its coping.
          raisedSlab(mesh, coping, z, 'poolRim', 'poolRim', 'poolslab', { group: 'slab' });
          ringSlab(mesh, water, z + 0.015, 'water', 'poolwater', { group: 'poolslab' });
        } else {
          ringSlab(mesh, coping, 0.02, 'poolRim', 'decal1', anchor);
          ringSlab(mesh, water, 0.035, 'water', 'decal2', anchor);
        }
        break;
      }
      case 'bush': {
        // A single flat disc, which projects to a clean ellipse and takes one
        // uniform colour. A dome would be more literal but breaks into shaded
        // facets, and reads as a faceted rock rather than a soft shrub.
        const r = p.r ?? 1.1;
        const pts = [];
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2;
          pts.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 0.045]);
        }
        mesh.poly(pts, 'foliage', `bush:${p.id}`, anchor);
        break;
      }
      case 'tree': {
        const r = p.r ?? 1.4;
        const trunkH = r * 0.75;
        mesh.box([p.x - 0.11, p.y - 0.11, 0], [p.x + 0.11, p.y + 0.11, trunkH], 'trunk', 'trunk', ['bottom'], anchor);
        blob(mesh, p.x, p.y, trunkH, r, r * 1.9, 'foliage', anchor);
        break;
      }
      case 'hedge': {
        const h = p.h ?? 0.8;
        segmentedBox(mesh, [p.x, p.y, 0], [p.x + p.w, p.y + p.d, h],
          'foliageDark', `hedge:${p.id}`, anchor);
        break;
      }
      case 'fence': {
        const h = p.h ?? 1.1;
        const horizontal = p.w >= p.d;
        const t = 0.09;
        const len = horizontal ? p.w : p.d;
        const posts = Math.max(2, Math.round(len / 1.6));
        for (let k = 0; k <= posts; k++) {
          const f = (len * k) / posts;
          const cx = horizontal ? p.x + f : p.x;
          const cy = horizontal ? p.y : p.y + f;
          mesh.box([cx - t, cy - t, 0], [cx + t, cy + t, h], 'fence', 'fence', ['bottom'], anchor);
        }
        for (const zr of [0.45, 0.8]) {
          const z = h * zr;
          const tag = `fence:${p.id}:${zr}`;
          if (horizontal) {
            segmentedBox(mesh, [p.x, p.y - t / 2, z - 0.06], [p.x + p.w, p.y + t / 2, z + 0.06], 'fence', tag, anchor);
          } else {
            segmentedBox(mesh, [p.x - t / 2, p.y, z - 0.06], [p.x + t / 2, p.y + p.d, z + 0.06], 'fence', tag, anchor);
          }
        }
        break;
      }
      case 'muret': {
        // Gates are not linked to a wall by hand: any gate straddling this run
        // opens it. Dropping a gate onto a wall, or sliding it along, then
        // does the obvious thing without a relationship to maintain.
        const horiz = (p.w ?? 4) >= (p.d ?? 0.2);
        const e = extent(p, horiz);
        const h = p.h ?? 1.5;
        const cuts = [];
        for (const g of gates) {
          const ge = extent(g, horiz);
          const thin = horiz ? (g.d ?? 0.2) : (g.w ?? 0.2);
          if (Math.abs((ge.c0 + ge.c1) / 2 - (e.c0 + e.c1) / 2) > 0.5 + thin) continue;
          if (ge.a1 <= e.a0 || ge.a0 >= e.a1) continue;
          cuts.push([Math.max(e.a0, ge.a0), Math.min(e.a1, ge.a1)]);
        }
        cuts.sort((u, v) => u[0] - v[0]);
        let cur = e.a0;
        for (const [s0, s1] of cuts) {
          muretRun(mesh, cur, Math.max(cur, s0), e.c0, e.c1, h, horiz, p.id);
          cur = Math.max(cur, s1);
        }
        muretRun(mesh, cur, e.a1, e.c0, e.c1, h, horiz, p.id);
        break;
      }
      case 'gate': {
        const horiz = (p.w ?? 1.1) >= (p.d ?? 0.2);
        const e = extent(p, horiz);
        gate(mesh, e.a0, e.a1, e.c0, e.c1, p.h ?? 1.5, horiz, p.style === 'sliding', p.id);
        break;
      }
      case 'car': {
        const w = p.w ?? 1.8, d = p.d ?? 4.2;
        const x0 = p.x - w / 2, x1 = p.x + w / 2, y0 = p.y - d / 2, y1 = p.y + d / 2;
        mesh.box([x0, y0, 0.22], [x1, y1, 0.78], 'carBody', 'car', ['bottom'], anchor);
        mesh.box([x0 + 0.16, y0 + d * 0.22, 0.78], [x1 - 0.16, y1 - d * 0.28, 1.22], 'carGlass', 'car', ['bottom'], anchor);
        for (const [wx, wy] of [[x0, y0 + d * 0.2], [x1 - 0.22, y0 + d * 0.2], [x0, y1 - d * 0.3], [x1 - 0.22, y1 - d * 0.3]]) {
          mesh.box([wx, wy, 0], [wx + 0.22, wy + 0.7, 0.34], 'carTyre', 'car', ['bottom'], anchor);
        }
        break;
      }
      default:
        break;
    }
  }
  return occupied;
}
