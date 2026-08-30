/**
 * Scene -> SVG.
 *
 * Faces are merged, back-face culled, depth sorted and emitted as flat paths.
 * The output is deliberately plain SVG: no filters, no fonts, so that it
 * rasterises identically in every browser and can be dropped straight into a
 * dashboard. The one gradient is the night sky, and there is no filter at all:
 * filters are the part of SVG that browsers skip when rasterising an <img>,
 * which would drop the effect from exactly the PNG it was asked for.
 */

import { mergeCoplanar } from '../core/mesh.js';
import { Camera, rotateDir, facingOf } from '../core/iso.js';
import { buildMesh } from '../core/scene.js';
import { faceColour, materialColour, darken, nightColour, NIGHT } from '../core/palette.js';
import { cellSet } from '../core/model.js';
import { focusModel } from '../core/focus.js';
import { bounds } from '../core/grid.js';
import { specFor, textureSegments, textureTiles } from './texture.js';

// Clip paths need ids unique to the document, not just to one SVG: a gallery
// page holding several renders would otherwise have them clip each other.
let renderSeq = 0;

/** Materials drawn without an outline, or with a special opacity. */
const NO_OUTLINE = new Set(['shadow', 'grass', 'water', 'solarCell', 'garageLine']);
const OPACITY = { shadow: 0.13 };

/**
 * A few groups are backdrops rather than participants in the depth sort.
 * The ground is a single huge quad at z=0: sorting it by its centroid would
 * put half the garden in front of the house. Everything sits above it, so
 * drawing it first is unconditionally correct.
 */
// Ground-level decals stack in a fixed order rather than by depth: they are
// large and near-coplanar, so their centroids say almost nothing about which
// one is on top. Anything with real height sorts by depth as usual.
const LAYER = { ground: 0, shadow: 1, decal0: 2, decal1: 3, decal2: 4 };
const layerOf = (f) => LAYER[f.group] ?? 5;

/**
 * The building shell: walls, roof, overhang, fascia.
 *
 * These are the faces the centroid order cannot be trusted on. They are large,
 * they belong to the same solid, and they meet at every edge; a centre is a
 * poor stand-in for "which of these two is nearer" when both span metres.
 */
const SHELL = new Set(['wall', 'roof', 'roofEdge', 'niche']);

/**
 * Does `a` lie entirely on the far side of `b`'s plane?
 *
 * The exact question the painter's order is trying to answer, and the reason a
 * plane test settles what centroids only guess at. Distances are taken in world
 * space: the dot product is unchanged by the camera's rotation, so no
 * projection is needed. `b.normal` points towards the camera for a visible
 * face, hence negative distances are behind it.
 */
function behindPlane(a, b, eps = 1e-4) {
  const n = b.normal, c = b.centroid;
  for (const loop of a.loops) {
    for (const p of loop) {
      const d = n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]);
      if (d > -eps) return false;
    }
  }
  return true;
}

/**
 * Bounding box in projected space, cached on the face.
 *
 * Taken before the tilt: a box is not invariant under rotation, so measuring
 * it in a tilted frame would make the draw order depend on an angle that only
 * turns the finished picture.
 */
function screenBox(f, camera) {
  if (f.box) return f.box;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const loop of f.loops) {
    for (const p of loop) {
      const s = camera.projected(p);
      if (s[0] < x0) x0 = s[0];
      if (s[0] > x1) x1 = s[0];
      if (s[1] < y0) y0 = s[1];
      if (s[1] > y1) y1 = s[1];
    }
  }
  f.box = [x0, y0, x1, y1];
  return f.box;
}

/**
 * Reorder the shell by pairwise plane tests, keeping everything else in place.
 *
 * Sorting on centres held for one camera angle and stopped holding once the
 * angle was free. Two failures showed why. A roof slope tilts away, so its
 * centre sits behind its eave and the wall below won: the wall painted over the
 * overhang that covers it. Cutting the overhang off the slope fixed that on a
 * hipped roof and not on a gabled one — there the overhang runs on up the rake
 * to the ridge, and the band's centre lands *behind* the wall it hangs over.
 * No amount of cutting turns a centre into an answer.
 *
 * So the order between two shell faces is decided by asking, not by measuring a
 * proxy: if every vertex of one lies beyond the other's plane, it is behind it,
 * whatever their centres say. The test is exact for planar faces, which these
 * are. Only pairs that overlap on screen are constrained, so faces that cannot
 * hide each other stay where the depth sort put them; the result is settled by
 * a topological sort that falls back to that order for anything the plane test
 * leaves undecided, and for the cycles it cannot rule out.
 *
 * Confined to the shell on purpose. Trees, ground and terraces are ordered by
 * machinery of their own — fixed layers and `after` anchors — and are not
 * planar solids meeting at their edges, so the same test would decide little
 * and risk much.
 */
function repairShell(all, camera) {
  const faces = all.filter((f) => SHELL.has(f.group) && f.facing > 1e-6);
  if (faces.length < 2) return;

  // before[j] = faces that must be drawn before faces[j].
  const before = faces.map(() => []);
  const indeg = faces.map(() => 0);
  const overlap = (p, q) => p[0] <= q[2] && q[0] <= p[2] && p[1] <= q[3] && q[1] <= p[3];
  for (let a = 0; a < faces.length; a++) {
    for (let b = a + 1; b < faces.length; b++) {
      if (!overlap(screenBox(faces[a], camera), screenBox(faces[b], camera))) continue;
      // Coplanar faces are never separated by each other's plane; leave them.
      let first = -1;
      if (behindPlane(faces[a], faces[b])) first = a;
      else if (behindPlane(faces[b], faces[a])) first = b;
      if (first < 0) continue;
      const second = first === a ? b : a;
      before[second].push(first);
      indeg[second]++;
    }
  }

  // Kahn's algorithm, ties broken by the depth already computed. A cycle —
  // which the plane test cannot rule out for three faces winding round each
  // other — is broken by releasing whichever remaining face came first.
  const order = faces.map((_, i) => i);
  order.sort((i, j) => faces[i].sortDepth - faces[j].sortDepth || faces[i].seq - faces[j].seq);
  const out = [];
  const done = faces.map(() => false);
  const after = faces.map(() => []);
  for (let j = 0; j < faces.length; j++) for (const i of before[j]) after[i].push(j);
  while (out.length < faces.length) {
    let pick = -1;
    for (const j of order) { if (!done[j] && indeg[j] === 0) { pick = j; break; } }
    if (pick < 0) for (const j of order) if (!done[j]) { pick = j; break; }
    done[pick] = true;
    out.push(pick);
    for (const j of after[pick]) if (!done[j] && indeg[j] > 0) indeg[j]--;
  }

  // Write the order back as depths rather than as positions. Everything else
  // is placed by depth too — the ground layers, and the `after` anchors that
  // put a solar panel on its slope — so handing the result back in the same
  // currency keeps a panel with the roof that carries it instead of leaving it
  // stranded in the slot its slope has just vacated. The existing depths are
  // reused, only redistributed, so the shell keeps its place among the trees.
  const pool = faces.map((f) => f.sortDepth).sort((a, b) => a - b);
  out.forEach((i, k) => { faces[i].sortDepth = pool[k]; });
}

/** Resolve `after` anchors and return faces in draw order. */
function orderFaces(faces, camera) {
  faces.forEach((f, i) => {
    f.seq = i;
    f.rides = false;
    f.box = null; // screen boxes are per camera, and faces outlive a frame
    f.nCam = rotateDir(f.normal, camera.yaw);
    f.facing = facingOf(f.nCam, camera.lambda);
    f.depth = camera.depth(f.centroid);
  });

  // Index candidate anchor surfaces, by material + group and by group alone.
  // Anchoring by group only matters when the carrying surface's material is
  // the user's choice — a terrace may be paving, gravel or wood, and a pool
  // resting on it should not have to know which.
  const byGroup = new Map();
  const byGroupOnly = new Map();
  for (const f of faces) {
    const k = `${f.mat}|${f.group}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(f);
    if (!byGroupOnly.has(f.group)) byGroupOnly.set(f.group, []);
    byGroupOnly.get(f.group).push(f);
  }

  // Screen-space containment test, used to choose which surface carries a
  // face. Cheap enough: only anchored faces run it, against a handful of
  // candidates each.
  const contains = (face, pt) => {
    const s2 = face.loops[0].map((p) => camera.toScreen(p));
    let inside = false;
    for (let i = 0, j = s2.length - 1; i < s2.length; j = i++) {
      if ((s2[i][1] > pt[1]) !== (s2[j][1] > pt[1])
        && pt[0] < ((s2[j][0] - s2[i][0]) * (pt[1] - s2[i][1])) / (s2[j][1] - s2[i][1]) + s2[i][0]) {
        inside = !inside;
      }
    }
    return inside;
  };

  for (const f of faces) {
    f.sortDepth = f.depth;
    f.carrier = null;
    if (!f.after) continue;
    const cands = f.after.mat
      ? byGroup.get(`${f.after.mat}|${f.after.group}`)
      : byGroupOnly.get(f.after.group);
    if (!cands || !cands.length) continue;

    /*
     * The carrier is the surface that actually covers this face on screen,
     * taking the nearest one when several do. Picking merely the closest plane
     * sliced every chimney standing near a ridge: it anchored to one slope
     * while the other, drawn later, painted over it.
     *
     * But a surface the face lies entirely *behind* is hiding it, not carrying
     * it — and anchoring to it drew the face in front of the very thing that
     * should conceal it. That is how solar panels on the far slope of a roof
     * came to show through the near one. The plane test tells the two apart:
     * a chimney by a ridge rises above the far slope's plane and so keeps it
     * as a candidate, while a panel lying flat beyond the ridge does not.
     */
    const pt = camera.toScreen(f.centroid);
    let best = null;
    for (const c of cands) {
      if (c === f) continue;
      // A face the camera cannot see covers nothing; letting one win here
      // anchored a niche's door to the culled side reveal and threw it in
      // front of the facade.
      if (c.facing <= 1e-6) continue;
      if (!contains(c, pt)) continue;
      if (behindPlane(f, c)) continue;
      if (!best || c.depth > best.depth) best = c;
    }
    if (!best) {
      // Nothing covers it — fall back to the nearest plane, which is what an
      // item lying flat on a surface needs.
      let bestDist = Infinity;
      for (const c of cands) {
        if (c === f) continue;
        const d = Math.abs(
          c.normal[0] * (f.centroid[0] - c.centroid[0]) +
          c.normal[1] * (f.centroid[1] - c.centroid[1]) +
          c.normal[2] * (f.centroid[2] - c.centroid[2]),
        );
        if (d < bestDist) { bestDist = d; best = c; }
      }
    }
    f.carrier = best;
    /*
     * A decal lying on its carrier's plane rides it: same depth exactly, the
     * stable sort's emission order putting it just on top. Anything looser —
     * own depth, or carrier plus an epsilon — breaks the moment the shell is
     * reordered, because the exact pass redistributes shell depths and the
     * decal's raw depth then interleaves wrongly with walls it never touches.
     * Found as a door drawn over the facade one metre in front of its niche.
     *
     * Only true decals ride. A chimney anchored to its roof stands metres off
     * the plane and keeps the old rule: its faces need their own depths.
     */
    if (best && SHELL.has(best.group)) {
      let dmax = 0;
      for (const loop of f.loops) {
        for (const pt2 of loop) {
          const dd = Math.abs(
            best.normal[0] * (pt2[0] - best.centroid[0])
            + best.normal[1] * (pt2[1] - best.centroid[1])
            + best.normal[2] * (pt2[2] - best.centroid[2]),
          );
          if (dd > dmax) dmax = dd;
        }
      }
      f.rides = dmax <= 0.25;
    }
  }

  repairShell(faces, camera);

  /*
   * Propagate along the chain rather than resolving each link once: water
   * rests on its coping, which rests on the terrace. Reading the carrier's raw
   * depth only ever moved a face past its immediate support, so the water
   * stayed behind the terrace its own coping had already cleared. Passes are
   * capped so a malformed cycle cannot spin here.
   *
   * The bump is zero when the carrier is shell. The shell's exact ordering
   * redistributes existing depths, and two neighbours can end up closer than
   * any epsilon — a door pushed past its niche's back panel by 1e-4 leapt
   * over the facade strip next in line and was drawn in front of the wall.
   * At equal depth the stable sort falls back to emission order, and a decal
   * is always emitted after the surface it decorates.
   */
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const f of faces) {
      if (!f.carrier) continue;
      if (f.rides) {
        if (f.sortDepth !== f.carrier.sortDepth) { f.sortDepth = f.carrier.sortDepth; moved = true; }
        continue;
      }
      const want = f.carrier.sortDepth + 1e-4;
      if (want > f.sortDepth) { f.sortDepth = want; moved = true; }
    }
    if (!moved) break;
  }

  const visible = faces.filter((f) => f.facing > 1e-6);
  // Stable sort: ties keep mesh insertion order, which is how frame / glass /
  // mullion end up stacked correctly on a window.
  visible.sort((a, b) =>
    (layerOf(a) - layerOf(b)) || (a.sortDepth - b.sortDepth) || (a.seq - b.seq));
  return visible;
}

function pathData(face, camera) {
  let d = '';
  for (const loop of face.loops) {
    for (let i = 0; i < loop.length; i++) {
      const [x, y] = camera.toScreen(loop[i]);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    d += 'Z';
  }
  return d;
}

/**
 * The night sky: gradient, stars, moon.
 *
 * Drawn in screen space and behind everything, because that is what a sky is —
 * it does not pan with the house, and it is not part of the depth sort.
 *
 * A night view cannot keep a transparent background: the sky *is* the effect.
 * That is the one place where this mode overrides the export setting, and it
 * seemed better than producing a transparent picture of a dark house and
 * calling it night.
 *
 * The stars come from a hash of their own index rather than from a random
 * draw, for the same reason the roof tiles do: the export has to match the
 * preview, and re-exporting tomorrow has to give the same image.
 */
function nightSky(width, height, defs, prefix) {
  // Three stops, not two. The sky lightens a little towards the horizon and
  // goes dark again below it: with a single fall from zenith to floor, the
  // bottom of the picture stayed as starry as the top and the plot read as
  // floating in space rather than standing on the ground at night.
  const id = `${prefix}-sky`;
  defs.push(
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${NIGHT.sky[0]}"/>` +
    `<stop offset="0.46" stop-color="${NIGHT.sky[1]}"/>` +
    `<stop offset="1" stop-color="${NIGHT.sky[2]}"/></linearGradient>`,
  );
  const out = [`<rect width="${width}" height="${height}" fill="url(#${id})"/>`];

  // Stars belong overhead. They thin out through the lower half and are gone
  // by the bottom of the frame — the plot is finite, so there is sky around it
  // whichever way you look, and a starfield underneath the garden is the one
  // reading nobody wants.
  const n = Math.min(220, Math.round((width * height) / 2600));
  const hash = (i, k) => {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const stars = [];
  for (let i = 0; i < n; i++) {
    const y = hash(i, 2) * height;
    const fade = Math.max(0, Math.min(1, (0.88 * height - y) / (0.43 * height)));
    if (fade < 0.02) continue;
    const r = (0.4 + hash(i, 3) * 1.0).toFixed(2);
    stars.push(`<circle cx="${(hash(i, 1) * width).toFixed(1)}" `
      + `cy="${y.toFixed(1)}" r="${r}" `
      + `opacity="${((0.25 + hash(i, 4) * 0.6) * fade).toFixed(2)}"/>`);
  }
  out.push(`<g fill="${NIGHT.star}">${stars.join('')}</g>`);

  // A moon, high and to the left, clear of the compass and of the house — which
  // the fit centres. Its halo is a radial gradient rather than a blur: a blur
  // is a filter, and filters are what browsers drop when rasterising an image,
  // so the halo would have gone missing from the PNG and stayed in the preview.
  // Concentric discs were the first attempt and read as rings, not as light.
  const mr = Math.max(9, Math.min(width, height) * 0.032);
  const mx = width * 0.13, my = height * 0.16;
  const halo = `${prefix}-halo`;
  defs.push(
    `<radialGradient id="${halo}">` +
    `<stop offset="0.35" stop-color="${NIGHT.moon}" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="${NIGHT.moon}" stop-opacity="0"/></radialGradient>`,
  );
  out.push(
    `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${(mr * 3).toFixed(1)}" fill="url(#${halo})"/>`
    + `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${mr.toFixed(1)}" fill="${NIGHT.moon}"/>`,
  );
  return out.join('');
}

/**
 * Render a model.
 *
 * Returns the SVG markup plus the camera actually used, so that interactive
 * callers can hit-test against exactly the same projection.
 */
export function renderScene(input, opts = {}) {
  const width = opts.width ?? 1200;
  const height = opts.height ?? 800;
  // A frame removes whole items before anything is built, so the mesh, the
  // pick targets and the export all agree on what exists.
  const model = focusModel(input);
  const built = opts.built ?? buildMesh(model);
  // Both stages can be supplied by the caller: the model is immutable, so a
  // viewport can cache them and pay only the projection when panning.
  const faces = opts.faces ?? mergeCoplanar(built.mesh.tris);

  const b = built.bounds.empty ? { i0: 0, j0: 0, i1: 1, j1: 1 } : built.bounds;
  const cs = model.grid?.cellSize || 1;
  const framed = model.focus?.enabled;
  // Night is a grade over whichever palette is in use, applied once, at the
  // point the fills are computed: the textures take their shades from `fill`
  // and the outlines are derived from it, so both follow without knowing.
  const night = !!model.style.night;
  const graded = (mat, hex) => (night ? nightColour(mat, hex) : hex);
  const camera = new Camera({
    yaw: model.camera.yaw,
    pitch: model.camera.pitch,
    roll: model.camera.roll,
    projection: model.camera.projection,
    // The rotation centre stays the house even when the frame is elsewhere:
    // it only sets which point the yaw turns about, and the fit re-centres
    // afterwards. Moving it would make the orbit swing rather than turn.
    centre: [((b.i0 + b.i1 + 1) / 2) * cs, ((b.j0 + b.j1 + 1) / 2) * cs],
  });

  const pts = [];
  for (const f of faces) for (const loop of f.loops) for (const p of loop) pts.push(p);
  if (opts.camera) {
    camera.scale = opts.camera.scale;
    camera.offset = opts.camera.offset;
  } else {
    const base = opts.pad ?? Math.min(width, height) * 0.06;
    camera.fit(pts, width, height, base);
    /*
     * The frame's margin, as air rather than as geometry.
     *
     * The camera used to be fitted on the zone's own eight corners — its
     * ground rectangle and the same rectangle raised to the height of the
     * tallest thing standing in it. Most of that box was imaginary: a corner
     * six metres over an empty patch of lawn projects well above anything
     * actually there, and the camera made room for it. The drawing came out
     * fifty pixels below centre with white space above it.
     *
     * Fitting on what is drawn centres it by construction. The margin is then
     * simply padding, which needs the scale to be expressed in pixels — hence
     * fitting twice. Cheap, and it keeps the margin meaning metres.
     */
    if (framed && model.focus.margin > 0) {
      camera.fit(pts, width, height, base + model.focus.margin * camera.scale);
    }
    camera.scale *= opts.zoom ?? 1;
    camera.offset = [
      camera.offset[0] + (opts.panX ?? 0),
      camera.offset[1] + (opts.panY ?? 0),
    ];
    if (opts.zoom && opts.zoom !== 1) {
      // Zoom about the centre of the canvas rather than the origin.
      camera.offset = [
        width / 2 + (camera.offset[0] - width / 2) * opts.zoom,
        height / 2 + (camera.offset[1] - height / 2) * opts.zoom,
      ];
    }
  }

  const ordered = orderFaces(faces, camera);
  const theme = model.theme;
  // Per-building overrides are folded in under their suffixed names, so the
  // face colour lookup stays a single flat map.
  let ov = model.overrides;
  const textures = new Map();
  for (const b of model.buildings) {
    if (b.texture) textures.set(b.id, { ...model.texture, ...b.texture });
    if (!b.overrides || !Object.keys(b.overrides).length) continue;
    if (ov === model.overrides) ov = { ...model.overrides };
    for (const [k, v] of Object.entries(b.overrides)) ov[`${k}#${b.id}`] = v;
  }
  // A suffixed material names its building, so its own materials win.
  const textureFor = (mat) => {
    const cut = mat.indexOf('#');
    return cut < 0 ? model.texture : (textures.get(mat.slice(cut + 1)) || model.texture);
  };
  const prefix = `t${renderSeq++}`;
  const out = [];
  // The ground is emitted apart because the fade must not touch it. It is
  // always first in draw order anyway, being a backdrop rather than a
  // participant in the depth sort.
  const floor = [];
  const defs = [];

  const hair = Math.max(0.5, camera.scale * 0.02);
  // Night is a grade over whichever palette is in use, applied once here: the
  // textures take their own shades from `fill`, and the outlines are derived
  // from it, so both follow without knowing anything about it.
  ordered.forEach((f, i) => {
    const sink = f.group === 'ground' ? floor : out;
    const fill = graded(f.mat, f.mat === 'shadow'
      ? materialColour(f.mat, theme, ov)
      : faceColour(f.mat, theme, ov, f.nCam));
    // Kept on the face: the colour is the outcome of palette, orientation and
    // any per-building override, and callers should not have to redo that.
    f.fill = fill;
    const d = pathData(f, camera);
    const parts = [`d="${d}"`, `fill="${fill}"`];
    if (OPACITY[f.mat] != null) parts.push(`opacity="${OPACITY[f.mat]}"`);
    if (model.style.outline && !NO_OUTLINE.has(f.mat)) {
      parts.push(`stroke="${darken(fill, 0.26)}"`, `stroke-width="${model.style.outlineWidth}"`);
    }
    sink.push(`<path ${parts.join(' ')}/>`);

    const spec = specFor(f.mat, textureFor(f.mat));
    if (!spec) return;
    // Clipping to the face itself is what lets the generators ignore the face
    // outline entirely and simply rule across its bounding box.
    const id = `${prefix}-${i}`;
    const layers = [];

    const tiles = spec.tile ? textureTiles(f, spec, camera.scale, fill) : [];
    if (tiles.length) {
      // Grouped by shade, not emitted tile by tile: a full roof runs to
      // thousands of tiles but only a score of colours, so this is the
      // difference between twenty paths and several thousand.
      const byShade = new Map();
      for (const tile of tiles) {
        const sub = tile.pts.map((p, k) => {
          const s = camera.toScreen(p);
          return `${k === 0 ? 'M' : 'L'}${s[0].toFixed(2)} ${s[1].toFixed(2)}`;
        }).join('') + 'Z';
        const acc = byShade.get(tile.colour);
        if (acc) acc.push(sub); else byShade.set(tile.colour, [sub]);
      }
      for (const [colour, subs] of byShade) {
        layers.push(`<path d="${subs.join('')}" clip-path="url(#${id})" fill="${colour}"/>`);
      }
    }

    const segs = textureSegments(f, spec, camera.scale);
    if (segs.length) {
      const lines = segs.map(([p, q]) => {
        const a = camera.toScreen(p), b = camera.toScreen(q);
        return `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
      }).join('');
      layers.push(
        `<path d="${lines}" clip-path="url(#${id})" fill="none" ` +
        `stroke="${darken(fill, spec.contrast ?? 0.2)}" ` +
        `stroke-width="${(hair * (spec.weight ?? 1)).toFixed(2)}"/>`,
      );
    }

    if (!layers.length) return;
    defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
    sink.push(...layers);
  });

  const bg = model.style.background;
  let bgRect = bg && bg !== 'transparent'
    ? `<rect width="${width}" height="${height}" fill="${bg}"/>` : '';
  if (night) bgRect = nightSky(width, height, defs, prefix);

  // The viewBox stays at the layout size while width/height carry the pixel
  // ratio, so a 4x export re-rasterises the vectors instead of upscaling a
  // bitmap — outlines stay one pixel crisp at any resolution.
  const ratio = opts.pixelRatio ?? 1;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * ratio)}" ` +
    `height="${Math.round(height * ratio)}" ` +
    `viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    bgRect +
    (floor.length ? `<g stroke-linejoin="round" stroke-linecap="round">${floor.join('')}</g>` : '') +
    `<g stroke-linejoin="round" stroke-linecap="round">${out.join('')}</g>` +
    `</svg>`;

  return { svg, camera, faces: ordered, merged: faces, built, model, width, height };
}

/** Bounding box of the footprint, used by the plan view. */
export function footprintBounds(model) {
  return bounds(cellSet(model));
}
