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
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } from '../core/palette.js';

export const ROOF_TEXTURES = {
  none: { label: 'Lisse' },
  tiles: { label: 'Tuiles', course: 0.38, joint: 0.42, stagger: true },
  canal: {
    // Southern canal tiles: each one fired to its own shade, so the roof reads
    // as a camaïeu rather than a flat plane. Drawn as filled tiles, unlike the
    // line-only materials — the colour variation IS the material here.
    label: 'Tuiles canal panachées',
    // Seams, not courses: what reads on a canal roof is the lines running up
    // the slope between one channel and the next.
    seam: 0.3,
    contrast: 0.22,
    // A canal tile is a channel carrying water from ridge to eaves, so its
    // long axis follows the slope, never the eaves line. `slope` is that
    // length, `width` the span across the slope.
    tile: { slope: 0.58, width: 0.3, inset: 0.016 },
  },
  slate: { label: 'Ardoises', course: 0.3, joint: 0.34, stagger: true },
  seam: { label: 'Bac acier', seam: 0.55 },
};

/**
 * The panaché mix, as [weight, hue shift °, saturation ×, lightness ×] around
 * the roof's own colour: mostly terracotta, with straw, rosé and a few deeper
 * weathered tiles. Weights are repeat counts, so a uniform pick reproduces
 * the proportions.
 */
const CANAL_MIX = [
  [11, 0, 1.00, 1.00],  // terre cuite, the ground note — kept true to the
  [4, -2, 1.02, 0.965], // rouge profond    chosen roof colour, so only the
  [3, 7, 0.80, 1.045],  // paille           variants are muted and the roof
  [2, -4, 0.80, 1.03],  // rosé             still reads as the colour picked
  [2, 3, 0.92, 1.02],   // ocre
  [1, 9, 0.74, 1.065],  // paille claire
  [1, -2, 1.05, 0.945], // tuile vieillie
];

/**
 * Build the shade set for one face.
 *
 * A fixed, small palette rather than free jitter: it bounds the number of
 * distinct colours, which is what lets the renderer emit one path per shade
 * instead of one per tile.
 */
export function tilePalette(fill, spread = 1) {
  const [h0, s0, l0] = rgbToHsl(...hexToRgb(fill));
  const out = [];
  for (const [weight, dh, ms, ml] of CANAL_MIX) {
    for (let i = 0; i < weight; i++) {
      const t = weight > 1 ? (i / (weight - 1) - 0.5) * 2 : 0;
      const h = h0 + (dh + t * 1.8) * spread;
      const sat = Math.max(0, Math.min(1, s0 * (ms + t * 0.03 * spread)));
      const lum = Math.max(0, Math.min(1, l0 * (ml + t * 0.014 * spread)));
      out.push(rgbToHex(...hslToRgb(h, sat, lum)));
    }
  }
  return out;
}

/**
 * Deterministic per-tile pick.
 *
 * Seeded by the tile's own lattice position in world space, so the same roof
 * always fires the same tiles: an export matches the preview, and re-exporting
 * tomorrow gives a byte-identical image. Math.random would reshuffle the roof
 * on every frame.
 */
function hash2(a, b) {
  let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const WALL_TEXTURES = {
  none: { label: 'Lisse' },
  brick: { label: 'Briques', course: 0.24, joint: 0.52, stagger: true },
  siding: { label: 'Bardage', course: 0.26 },
  stone: { label: 'Pierre', course: 0.44, joint: 0.86, stagger: true },
  // Half-timbering is beams, not joints: a coarse grid drawn dark and thick,
  // where the other materials want fine lines barely off the wall colour.
  timber: { label: 'Colombages', course: 0.95, joint: 1.15, contrast: 0.45, weight: 2.2 },
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

/**
 * Individually coloured tiles covering one face, as world-space quads.
 *
 * Same in-plane frame as the line materials, so courses follow the slope and
 * align across coplanar faces. Returns [] when a tile would be too small to
 * read — a roof of sub-pixel quads is a slow way to draw a flat colour. The
 * threshold is far lower than for the line materials: at two pixels a tile
 * still reads as mottling — which is what a tiled roof looks like from a
 * distance — where a two-pixel rule is just noise. Measured against the sizes
 * that matter: the app's own preview sits at roughly 2 px per tile, an export
 * at 6, and a gallery thumbnail below the threshold, which keeps the ten
 * thumbnails cheap.
 */
export function textureTiles(face, spec, scale, fill, minPx = 1.7) {
  const t = spec.tile;
  if (!t) return [];
  if (t.slope * scale < minPx || t.width * scale < minPx) return [];

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
  // `u` runs across the slope and `v` up it, so the tile's width sits on u and
  // its length on v — laid the other way the roof would be shingled sideways.
  const cols = Math.ceil((a1 - a0) / t.width) + 1;
  const rows = Math.ceil((b1 - b0) / t.slope) + 1;
  if (cols * rows > 20000) return []; // pathological face; keep it flat

  const w = dot(ring[0], n);
  const at = (a, b) => [
    u[0] * a + v[0] * b + n[0] * w,
    u[1] * a + v[1] * b + n[1] * w,
    u[2] * a + v[2] * b + n[2] * w,
  ];
  const palette = tilePalette(fill, spec.spread ?? 1);
  const inset = t.inset ?? 0.01;
  const out = [];
  for (let ib = Math.floor(b0 / t.slope); ib * t.slope <= b1; ib++) {
    for (let ia = Math.floor(a0 / t.width); ia * t.width <= a1; ia++) {
      const a = ia * t.width, b = ib * t.slope;
      out.push({
        colour: palette[Math.floor(hash2(ia, ib) * palette.length) % palette.length],
        pts: [
          at(a + inset, b + inset),
          at(a + t.width - inset, b + inset),
          at(a + t.width - inset, b + t.slope - inset),
          at(a + inset, b + t.slope - inset),
        ],
      });
    }
  }
  return out;
}

/** Which texture setting, if any, applies to a material. */
export function specFor(mat, texture) {
  const base = mat.includes('#') ? mat.slice(0, mat.indexOf('#')) : mat;
  if (base === 'roof') return ROOF_TEXTURES[texture?.roof] || null;
  if (base === 'wall') return WALL_TEXTURES[texture?.wall] || null;
  return null;
}
