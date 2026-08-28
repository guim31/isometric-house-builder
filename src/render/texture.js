/**
 * Flat vector textures: tile courses, brick, siding.
 *
 * The lines are generated in the plane of each face, in world coordinates, and
 * only then projected. Emitting them as an SVG <pattern> would be far less
 * code, but a pattern lives in screen space: courses would run the same way on
 * every slope and the texture would read as stuck onto the picture rather than
 * lying on the roof.
 */

import { cross, norm, dot } from '../core/mesh.js';

export const ROOF_TEXTURES = {
  none: { label: 'Lisse' },
  tiles: { label: 'Tuiles', course: 0.38, joint: 0.42, stagger: true },
  slate: { label: 'Ardoises', course: 0.3, joint: 0.34, stagger: true },
  seam: { label: 'Bac acier', seam: 0.55 },
};

export const WALL_TEXTURES = {
  none: { label: 'Lisse' },
  brick: { label: 'Briques', course: 0.24, joint: 0.52, stagger: true },
  siding: { label: 'Bardage', course: 0.26 },
  stone: { label: 'Pierre', course: 0.44, joint: 0.86, stagger: true },
};

/** In-plane frame: `u` runs horizontally across the face, `v` up its slope. */
function frame(n) {
  if (Math.abs(n[2]) > 0.999) return { u: [1, 0, 0], v: [0, 1, 0] };
  const u = norm(cross(n, [0, 0, 1]));
  return { u, v: cross(u, n) };
}

/**
 * Texture segments for one face, as world-space [from, to] pairs.
 *
 * `minSpacing` is the smallest on-screen gap worth drawing, in the same units
 * as the returned coordinates once scaled; the caller passes the camera scale
 * so that a texture simply disappears when it would turn into a grey smear.
 */
export function textureSegments(face, spec, scale, minSpacingPx = 3.5) {
  if (!spec || (!spec.course && !spec.seam)) return [];
  const n = face.normal;
  const { u, v } = frame(n);
  const ring = face.loops[0];

  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of ring) {
    const a = dot(p, u), b = dot(p, v);
    if (a < a0) a0 = a;
    if (a > a1) a1 = a;
    if (b < b0) b0 = b;
    if (b > b1) b1 = b;
  }
  // Any point of the face fixes the plane; the offset along the normal is
  // constant across it by definition.
  const w = dot(ring[0], n);
  const at = (a, b) => [
    u[0] * a + v[0] * b + n[0] * w,
    u[1] * a + v[1] * b + n[1] * w,
    u[2] * a + v[2] * b + n[2] * w,
  ];

  const segs = [];
  const step = spec.course || spec.seam;
  if (step * scale < minSpacingPx) return [];

  if (spec.seam) {
    // Standing seams run up the slope.
    for (let a = Math.ceil(a0 / step) * step; a <= a1; a += step) {
      segs.push([at(a, b0), at(a, b1)]);
    }
    return segs;
  }

  // Courses run across the face; joints, when present, cross them.
  const courses = [];
  for (let b = Math.ceil(b0 / step) * step; b <= b1; b += step) {
    segs.push([at(a0, b), at(a1, b)]);
    courses.push(b);
  }
  if (spec.joint && spec.joint * scale >= minSpacingPx * 1.4) {
    courses.forEach((b, i) => {
      const offset = spec.stagger && i % 2 ? spec.joint / 2 : 0;
      for (let a = Math.ceil((a0 - offset) / spec.joint) * spec.joint + offset; a <= a1; a += spec.joint) {
        segs.push([at(a, b), at(a, b + step)]);
      }
    });
  }
  return segs;
}

/** Which texture setting, if any, applies to a material. */
export function specFor(mat, texture) {
  if (mat === 'roof') return ROOF_TEXTURES[texture?.roof] || null;
  if (mat === 'wall') return WALL_TEXTURES[texture?.wall] || null;
  return null;
}
