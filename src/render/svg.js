/**
 * Scene -> SVG.
 *
 * Faces are merged, back-face culled, depth sorted and emitted as flat paths.
 * The output is deliberately plain SVG: no filters, no fonts, so that it
 * rasterises identically in every browser and can be dropped straight into a
 * dashboard. The one gradient is the framing vignette, and it is a mask over
 * the finished drawing rather than a filter — filters are the part of SVG that
 * browsers skip when rasterising an <img>, which would have silently dropped
 * the effect from exactly the PNG it was asked for.
 */

import { mergeCoplanar } from '../core/mesh.js';
import { Camera, rotateDir, facingOf } from '../core/iso.js';
import { buildMesh } from '../core/scene.js';
import { faceColour, materialColour, darken } from '../core/palette.js';
import { cellSet } from '../core/model.js';
import { focusModel, focusPoints } from '../core/focus.js';
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

/** Resolve `after` anchors and return faces in draw order. */
function orderFaces(faces, camera) {
  faces.forEach((f, i) => {
    f.seq = i;
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
  const byMat = new Map();
  for (const f of faces) {
    const k = `${f.mat}|${f.group}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(f);
    if (!byGroupOnly.has(f.group)) byGroupOnly.set(f.group, []);
    byGroupOnly.get(f.group).push(f);
    if (!byMat.has(f.mat)) byMat.set(f.mat, []);
    byMat.get(f.mat).push(f);
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
    // Naming a material without a group spans every group carrying it, which
    // is how a roof item rests on the roof whether it sits over the footprint
    // or out on the overhang — two groups, one surface.
    const cands = f.after.group === undefined
      ? byMat.get(f.after.mat)
      : (f.after.mat
        ? byGroup.get(`${f.after.mat}|${f.after.group}`)
        : byGroupOnly.get(f.after.group));
    if (!cands || !cands.length) continue;

    // The carrier is the surface that actually covers this face on screen,
    // taking the nearest one when several do. Picking merely the closest
    // plane sliced every chimney standing near a ridge: it anchored to one
    // slope while the other, drawn later, painted over it.
    const pt = camera.toScreen(f.centroid);
    let best = null;
    for (const c of cands) {
      if (c === f) continue;
      if (!contains(c, pt)) continue;
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
  }

  // Propagate along the chain rather than resolving each link once: water
  // rests on its coping, which rests on the terrace. Reading the carrier's raw
  // depth only ever moved a face past its immediate support, so the water
  // stayed behind the terrace its own coping had already cleared. Passes are
  // capped so a malformed cycle cannot spin here.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const f of faces) {
      if (!f.carrier) continue;
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
  const camera = new Camera({
    yaw: model.camera.yaw,
    pitch: model.camera.pitch,
    projection: model.camera.projection,
    // The rotation centre stays the house even when the frame is elsewhere:
    // it only sets which point the yaw turns about, and the fit re-centres
    // afterwards. Moving it would make the orbit swing rather than turn.
    centre: [((b.i0 + b.i1 + 1) / 2) * cs, ((b.j0 + b.j1 + 1) / 2) * cs],
  });

  let pts = [];
  for (const f of faces) for (const loop of f.loops) for (const p of loop) pts.push(p);
  if (framed) pts = focusPoints(model.focus, faces);
  if (opts.camera) {
    camera.scale = opts.camera.scale;
    camera.offset = opts.camera.offset;
  } else {
    camera.fit(pts, width, height, opts.pad ?? Math.min(width, height) * 0.06);
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

  /*
   * Under a frame, the ground is backed by a plain fill of its own colour.
   *
   * The ground quad is sized in the scene, before the camera is known; a tight
   * frame can therefore run past its edge, and the picture then shows a wedge
   * of lawn ending in a hard straight line with nothing beyond it. Growing the
   * quad by guesswork does not settle it — at a low camera the visible ground
   * stretches away without bound. Painting the frame in the ground's own
   * colour first does, and costs one rectangle. Only under a frame: in the
   * ordinary view the edge of the plot is a real edge, worth seeing.
   */
  if (framed && model.ground?.enabled) {
    floor.push(`<rect width="${width}" height="${height}" `
      + `fill="${faceColour(model.ground.material, theme, ov, [0, 0, 1])}"/>`);
  }
  const hair = Math.max(0.5, camera.scale * 0.02);
  ordered.forEach((f, i) => {
    const sink = f.group === 'ground' ? floor : out;
    const fill = f.mat === 'shadow'
      ? materialColour(f.mat, theme, ov)
      : faceColour(f.mat, theme, ov, f.nCam);
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
  const bgRect = bg && bg !== 'transparent'
    ? `<rect width="${width}" height="${height}" fill="${bg}"/>` : '';

  /*
   * The fade applies to the composite, not to each face: fading faces one by
   * one would make the house transparent to itself — you would read the far
   * wall through the near one. Masking after compositing has no such problem.
   *
   * The ground and the background are left out of it, and that is the whole
   * difference between an effect and a blemish. A lawn covers the frame edge
   * to edge; fading it to transparent draws a pale ellipse across it, which is
   * what a radial gradient over a flat colour can only ever look like. Fading
   * only what *stands* on the ground gives what was actually wanted: distant
   * things dissolving into the lawn instead of being sliced by the picture
   * edge — and it reads the same whatever the image is dropped onto, since it
   * no longer fades into the backdrop but into the ground.
   */
  let maskAttr = '';
  const vig = framed ? Math.max(0, Math.min(0.9, model.focus.vignette ?? 0)) : 0;
  if (vig > 0.001) {
    const id = `${prefix}-vignette`;
    defs.push(
      // r = 0.6, not 0.5: at 0.5 the gradient circle only touches the middle of
      // each edge, so a mild setting fades the corners and nothing else, which
      // reads as a mistake rather than an effect.
      `<radialGradient id="${id}-g" cx="0.5" cy="0.5" r="0.6">` +
      `<stop offset="${(1 - vig).toFixed(3)}" stop-color="#fff" stop-opacity="1"/>` +
      `<stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
      `</radialGradient>` +
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="url(#${id}-g)"/></mask>`,
    );
    maskAttr = ` mask="url(#${id})"`;
  }

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
    `<g stroke-linejoin="round" stroke-linecap="round"${maskAttr}>${out.join('')}</g>` +
    `</svg>`;

  return { svg, camera, faces: ordered, merged: faces, built, model, width, height };
}

/** Bounding box of the footprint, used by the plan view. */
export function footprintBounds(model) {
  return bounds(cellSet(model));
}
