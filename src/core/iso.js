/**
 * Isometric camera: projection, rotation and painter's-algorithm depth.
 *
 * Both supported projections satisfy `kz === 2 * ky`, which makes the view
 * direction exactly (1, 1, 1) in world space. The consequence is worth stating
 * plainly because the whole renderer leans on it: the depth of a point along
 * the view axis is simply `x + y + z`, so faces can be depth-sorted exactly,
 * at any rotation, without a z-buffer.
 */

export const PROJECTIONS = {
  // True isometric: the three axes are equally foreshortened (30 degrees).
  iso30: { kx: Math.cos(Math.PI / 6), ky: 0.5, kz: 1, label: 'Isométrique 30°' },
  // 2:1 dimetric, the classic pixel-art / game look.
  dimetric: { kx: 1, ky: 0.5, kz: 1, label: 'Dimétrique 2:1' },
};

export const DEFAULT_PROJECTION = 'iso30';

/**
 * Compass corner the camera looks FROM at each quarter-turn.
 *
 * Derivation, since an off-by-one here once shipped: a face is visible when
 * its rotated normal has a positive dot with the view axis (1,1,1). At
 * rotation 0 that selects the +y (north) and +x (east) walls, so the camera
 * stands to the north-east. Each turn then walks the viewpoint clockwise
 * around the house. The test suite checks this list against the geometry.
 */
export const VIEWPOINTS = ['Nord-Est', 'Sud-Est', 'Sud-Ouest', 'Nord-Ouest'];

/** Rotate a world point by `r` quarter-turns around the vertical axis at (cx, cy). */
export function rotatePoint(p, r, cx, cy) {
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  switch (((r % 4) + 4) % 4) {
    case 0: return [cx + dx, cy + dy, p[2]];
    case 1: return [cx - dy, cy + dx, p[2]];
    case 2: return [cx - dx, cy - dy, p[2]];
    default: return [cx + dy, cy - dx, p[2]];
  }
}

/** Rotate a direction (normal) by `r` quarter-turns. Translation-free. */
export function rotateDir(n, r) {
  switch (((r % 4) + 4) % 4) {
    case 0: return [n[0], n[1], n[2]];
    case 1: return [-n[1], n[0], n[2]];
    case 2: return [-n[0], -n[1], n[2]];
    default: return [n[1], -n[0], n[2]];
  }
}

/**
 * Project a world point to screen space (y grows downward, as in SVG).
 *
 * The horizontal term is (y - x), not the video-game classic (x - y). With
 * screen y pointing down and the near side at +x+y, the classic form is a
 * LEFT-handed basis: the painter's order says the camera is to the north-east
 * while the horizontal axis says south-west, and every view comes out as the
 * mirror image of what a physical camera would see — a pool west of the house
 * on the plan showed up on the wrong side of the render. From a real camera
 * at the north-east, east extends to the screen left and north to the right,
 * which is what (y - x) yields.
 */
export function project(p, proj) {
  return [
    (p[1] - p[0]) * proj.kx,
    (p[0] + p[1]) * proj.ky - p[2] * proj.kz,
  ];
}

/** Depth along the view axis. Larger means nearer to the camera. */
export function depthOf(p) {
  return p[0] + p[1] + p[2];
}

/**
 * A camera bundles the rotation, the projection and the scale/offset needed to
 * map world coordinates into the SVG viewBox.
 */
export class Camera {
  constructor({ rotation = 0, projection = DEFAULT_PROJECTION, centre = [0, 0] } = {}) {
    this.rotation = rotation;
    this.projection = PROJECTIONS[projection] ? projection : DEFAULT_PROJECTION;
    this.centre = centre;
    this.scale = 32;
    this.offset = [0, 0];
  }

  get proj() { return PROJECTIONS[this.projection]; }

  /** World point -> rotated world point. */
  toView(p) {
    return rotatePoint(p, this.rotation, this.centre[0], this.centre[1]);
  }

  /** World point -> SVG coordinates. */
  toScreen(p) {
    const v = this.toView(p);
    const s = project(v, this.proj);
    return [s[0] * this.scale + this.offset[0], s[1] * this.scale + this.offset[1]];
  }

  /** World point -> painter's depth (already rotated). */
  depth(p) {
    return depthOf(this.toView(p));
  }

  /**
   * Fit the camera so that every point of `points` lands inside a
   * `width` x `height` box, with `pad` pixels of margin.
   */
  fit(points, width, height, pad = 24) {
    if (!points.length) return this;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      const s = project(this.toView(p), this.proj);
      if (s[0] < minX) minX = s[0];
      if (s[0] > maxX) maxX = s[0];
      if (s[1] < minY) minY = s[1];
      if (s[1] > maxY) maxY = s[1];
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    this.scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
    this.offset = [
      width / 2 - ((minX + maxX) / 2) * this.scale,
      height / 2 - ((minY + maxY) / 2) * this.scale,
    ];
    return this;
  }
}
