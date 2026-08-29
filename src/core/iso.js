/**
 * Isometric camera: projection, rotation and painter's-algorithm depth.
 *
 * The camera orbits freely — any yaw, any pitch — and the depth sort stays
 * exact. That is worth spelling out, because it is not obvious and the whole
 * renderer leans on it.
 *
 * A point's depth is its coordinate along the view axis. Solving "which world
 * direction moves nothing on screen" for the projection below gives that axis
 * as (1, 1, lambda) in *view* space, with `lambda = 2 * ky / kz`. So depth is
 * `x + y + lambda*z` after rotation — a plain linear form, whatever the angle.
 *
 * Sorting faces by that depth is *correct*, not merely plausible, because the
 * geometry is axis-aligned boxes: two disjoint boxes always have a separating
 * plane perpendicular to a world axis, and the view axis has a non-zero
 * component on that axis, so one box's depths lie entirely beyond the other's.
 * The exceptions are the four yaws where the camera looks straight down a world
 * axis; there one component vanishes, but a shift along that axis is then a
 * pure screen translation, so the boxes it separates cannot occlude each other
 * anyway. Ties there are harmless, which is why no angle has to be forbidden.
 *
 * Pitch is the one real constraint: at 0 the vertical component vanishes and a
 * chimney would no longer sort above the roof it stands on. Hence PITCH_RANGE.
 */

/**
 * Horizontal stretch of each named projection.
 *
 * A true axonometric fixes the three foreshortenings from the pitch alone;
 * `stretch` is the deliberate departure from it. The 2:1 dimetric look is the
 * isometric one widened by 2/sqrt(3), which is exactly what makes its ground
 * tiles twice as wide as they are tall.
 */
export const PROJECTIONS = {
  iso30: { label: 'Isométrique 30°', stretch: 1 },
  dimetric: { label: 'Dimétrique 2:1', stretch: 2 / Math.sqrt(3) },
};

export const DEFAULT_PROJECTION = 'iso30';

/** Elevation of the classic isometric view: atan(1/sqrt(2)), in degrees. */
export const DEFAULT_PITCH = (Math.atan(1 / Math.SQRT2) * 180) / Math.PI;

/**
 * How far the camera may be raised or lowered.
 *
 * Below the floor the ground plane collapses and heights stop sorting; above
 * the ceiling the walls do. Neither limit is reachable by accident — the
 * useful range is roughly 20° to 60°.
 */
export const PITCH_RANGE = [8, 80];

export const clampPitch = (deg) =>
  Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], Number.isFinite(deg) ? deg : DEFAULT_PITCH));

/** Yaw folded into [0, 360). */
export const normaliseYaw = (deg) =>
  (((Number.isFinite(deg) ? deg : 0) % 360) + 360) % 360;

/**
 * The (kx, ky, kz) of a projection at a given pitch.
 *
 * Ratios come from the orthonormal camera basis: with `lambda = sqrt(2)*tan
 * (pitch)`, they are sqrt(2 + lambda^2) : lambda : 2. Normalised so kz = 1,
 * the default pitch reproduces sqrt(3)/2 : 1/2 : 1 — the values this file
 * carried as constants before the pitch became adjustable.
 */
export function projectionFor(name, pitch = DEFAULT_PITCH) {
  const p = PROJECTIONS[name] || PROJECTIONS[DEFAULT_PROJECTION];
  const lambda = Math.SQRT2 * Math.tan((clampPitch(pitch) * Math.PI) / 180);
  return {
    kx: (Math.sqrt(2 + lambda * lambda) / 2) * p.stretch,
    ky: lambda / 2,
    kz: 1,
    lambda,
    label: p.label,
  };
}

/** The sixteen-point rose, so a free yaw still names its viewpoint. */
const ROSE = [
  'Nord', 'Nord-Nord-Est', 'Nord-Est', 'Est-Nord-Est',
  'Est', 'Est-Sud-Est', 'Sud-Est', 'Sud-Sud-Est',
  'Sud', 'Sud-Sud-Ouest', 'Sud-Ouest', 'Ouest-Sud-Ouest',
  'Ouest', 'Ouest-Nord-Ouest', 'Nord-Ouest', 'Nord-Nord-Ouest',
];

/**
 * Compass corner the camera looks FROM at a given yaw.
 *
 * Derivation, since an off-by-one here once shipped: a face is visible when its
 * rotated normal has a positive dot with the view axis. At yaw 0 that selects
 * the +y (north) and +x (east) walls, so the camera stands to the north-east —
 * bearing 45°. Each degree of yaw then walks the viewpoint clockwise around the
 * house. The test suite checks this against the geometry.
 */
export function viewpointLabel(yaw) {
  return ROSE[Math.round(normaliseYaw(45 + yaw) / 22.5) % 16];
}

/** The four quarter-turn viewpoints, in order. */
export const VIEWPOINTS = [0, 90, 180, 270].map(viewpointLabel);

/**
 * Cosine and sine of a yaw, exact on the quarter turns.
 *
 * `Math.cos(Math.PI / 2)` is 6e-17 rather than 0, and that residue leaks into
 * every coordinate. The four default views are the ones that have to stay
 * pixel-identical from one release to the next, so they take the exact path.
 */
function turn(yaw) {
  const q = yaw / 90;
  if (Number.isInteger(q)) return [[1, 0], [0, 1], [-1, 0], [0, -1]][((q % 4) + 4) % 4];
  const a = (yaw * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** Rotate a world point by `yaw` degrees around the vertical axis at (cx, cy). */
export function rotatePoint(p, yaw, cx, cy) {
  const [c, s] = turn(yaw);
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c, p[2]];
}

/** Rotate a direction (normal) by `yaw` degrees. Translation-free. */
export function rotateDir(n, yaw) {
  const [c, s] = turn(yaw);
  return [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
}

/** Undo `rotatePoint` on a ground coordinate. */
export function unrotatePoint(x, y, yaw, cx, cy) {
  const [c, s] = turn(yaw);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c + dy * s, cy - dx * s + dy * c];
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
export function depthOf(p, lambda = 1) {
  return p[0] + p[1] + lambda * p[2];
}

/** Dot of a camera-space normal with the unit view axis: > 0 means visible. */
export function facingOf(n, lambda = 1) {
  return (n[0] + n[1] + lambda * n[2]) / Math.sqrt(2 + lambda * lambda);
}

/**
 * How far the drawing may be tilted within its frame.
 *
 * The third rotation, and worth being plain about what it is: yaw and pitch
 * move the camera around the house, this one turns the finished picture. In an
 * axonometric projection those are the only three there are, and this one
 * changes nothing about which faces are visible or how they sort — it happens
 * after the projection. The sky stays level, so the effect reads as tilting
 * the model in the frame rather than as leaning the camera over.
 */
export const ROLL_RANGE = [-45, 45];

export const clampRoll = (deg) =>
  Math.min(ROLL_RANGE[1], Math.max(ROLL_RANGE[0], Number.isFinite(deg) ? deg : 0));

/**
 * A camera bundles the orbit, the projection and the scale/offset needed to
 * map world coordinates into the SVG viewBox.
 */
export class Camera {
  constructor({
    yaw = 0, pitch = DEFAULT_PITCH, roll = 0,
    projection = DEFAULT_PROJECTION, centre = [0, 0],
  } = {}) {
    this.yaw = normaliseYaw(yaw);
    this.pitch = clampPitch(pitch);
    this.roll = clampRoll(roll);
    this.projection = PROJECTIONS[projection] ? projection : DEFAULT_PROJECTION;
    this.proj = projectionFor(this.projection, this.pitch);
    this.lambda = this.proj.lambda;
    this.centre = centre;
    this.scale = 32;
    this.offset = [0, 0];
    // Exactly the identity at zero, so an untilted view stays byte-identical
    // to what it was before this existed.
    const a = (this.roll * Math.PI) / 180;
    this.rollCos = this.roll === 0 ? 1 : Math.cos(a);
    this.rollSin = this.roll === 0 ? 0 : Math.sin(a);
  }

  /** Projected point -> tilted projected point. */
  tilt(s) {
    if (this.roll === 0) return s;
    return [
      s[0] * this.rollCos - s[1] * this.rollSin,
      s[0] * this.rollSin + s[1] * this.rollCos,
    ];
  }

  /** The inverse, for turning a screen position back into a world one. */
  untilt(s) {
    if (this.roll === 0) return s;
    return [
      s[0] * this.rollCos + s[1] * this.rollSin,
      -s[0] * this.rollSin + s[1] * this.rollCos,
    ];
  }

  /** World point -> rotated world point. */
  toView(p) {
    return rotatePoint(p, this.yaw, this.centre[0], this.centre[1]);
  }

  /**
   * World point -> projected point, before the tilt and before scaling.
   *
   * What the sort compares. The tilt is a rigid rotation of the finished
   * picture, so whether two faces overlap does not depend on it — but an
   * axis-aligned bounding box does, and comparing boxes in a tilted frame
   * would let the drawn order change with the tilt.
   */
  projected(p) {
    return project(this.toView(p), this.proj);
  }

  /** World point -> SVG coordinates. */
  toScreen(p) {
    const s = this.tilt(project(this.toView(p), this.proj));
    return [s[0] * this.scale + this.offset[0], s[1] * this.scale + this.offset[1]];
  }

  /** World point -> painter's depth (already rotated). */
  depth(p) {
    return depthOf(this.toView(p), this.lambda);
  }

  /**
   * Fit the camera so that every point of `points` lands inside a
   * `width` x `height` box, with `pad` pixels of margin.
   */
  fit(points, width, height, pad = 24) {
    if (!points.length) return this;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      const s = this.tilt(project(this.toView(p), this.proj));
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
