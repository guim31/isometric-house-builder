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

/** Axis-aligned slab lying on the ground. */
function slab(mesh, x0, y0, x1, y1, z, mat, anchor) {
  mesh.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], mat, mat, anchor);
}

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

function ringSlab(mesh, ring, z, mat, anchor) {
  mesh.poly(ring.map(([x, y]) => [x, y, z]), mat, mat, anchor);
}

/** A tapered stack of rings, flat-shaded — reads as stylised foliage. */
function blob(mesh, cx, cy, z0, r, h, mat, anchor, sides = 8) {
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
      case 'path': {
        const mat = p.material || (p.kind === 'path' ? 'gravel' : 'paving');
        ringSlab(mesh, roundedRect(p.x, p.y, p.x + p.w, p.y + p.d, p.radius ?? 0.2), 0.012, mat, anchor);
        break;
      }
      case 'deck':
        ringSlab(mesh, roundedRect(p.x, p.y, p.x + p.w, p.y + p.d, p.radius ?? 0.1), 0.05, 'deck', anchor);
        break;
      case 'pool': {
        const r = p.shape === 'rounded' ? Math.min(p.w, p.d) * 0.32 : 0.05;
        // Coping first, then the water inset within it and slightly lower.
        ringSlab(mesh, roundedRect(p.x, p.y, p.x + p.w, p.y + p.d, r + 0.25), 0.02, 'poolRim', anchor);
        const i = 0.28;
        // Above the coping, not below: these are stacked decals, so painting
        // order follows height and the water must come last.
        ringSlab(mesh, roundedRect(p.x + i, p.y + i, p.x + p.w - i, p.y + p.d - i, r), 0.035, 'water', anchor);
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
