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
function roundedRect(x0, y0, x1, y1, r, steps = 5) {
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

export function buildProps(mesh, m) {
  const anchor = groundAnchor(m);
  const occupied = cellSet(m);

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
        mesh.box([p.x, p.y, 0], [p.x + p.w, p.y + p.d, h], 'foliageDark', 'hedge', ['bottom'], anchor);
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
          if (horizontal) mesh.box([p.x, p.y - t / 2, z - 0.06], [p.x + p.w, p.y + t / 2, z + 0.06], 'fence', 'fence', [], anchor);
          else mesh.box([p.x - t / 2, p.y, z - 0.06], [p.x + t / 2, p.y + p.d, z + 0.06], 'fence', 'fence', [], anchor);
        }
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
