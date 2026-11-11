/**
 * Helpers shared by several test files: model shorthands, synthetic pointers,
 * a staged viewport, and the occlusion detector.
 */

import { rectCells, key } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise, makeBuilding } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { Store } from '../src/ui/store.js';
import { Viewport } from '../src/ui/viewport.js';

/** First (or nth) volume of a model — most tests only ever have one. */
export const B = (m, i = 0) => m.buildings[i];

export const cellsOf = (m, i = 0) => m.buildings[i].cells;

export const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/** Clip-path and gradient ids are unique per render; two renders compare without them. */
export const stripIds = (svg) => svg.replace(/\bt[0-9a-z]+(?=-)/g, 't');

// A face standing in for one slope of a 30-degree roof.
export const slopeFace = () => {
  const k = Math.tan((30 * Math.PI) / 180);
  const n = [0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
  return {
    normal: n,
    loops: [[[0, 0, 3], [8, 0, 3], [8, 4, 3 + 4 * k], [0, 4, 3 + 4 * k]].map(
      (p) => [p[0], p[1], p[2]],
    )],
  };
};

/** The face drawn last at a screen point — what the eye actually sees. */
export function topFaceAt(out, pt) {
  const { camera, faces } = out;
  const inside = (loop) => {
    const s2 = loop.map((p) => camera.toScreen(p));
    let c = false;
    for (let i = 0, j = s2.length - 1; i < s2.length; j = i++) {
      if ((s2[i][1] > pt[1]) !== (s2[j][1] > pt[1])
        && pt[0] < ((s2[j][0] - s2[i][0]) * (pt[1] - s2[i][1])) / (s2[j][1] - s2[i][1]) + s2[i][0]) c = !c;
    }
    return c;
  };
  let top = null;
  for (const f of faces) {
    let hit = false;
    f.loops.forEach((l, li) => { if (inside(l)) hit = li === 0 ? true : !hit; });
    if (hit) top = f;
  }
  return top;
}

export const roofHouse = (extra) => normalise({
  ...emptyModel(),
  buildings: [makeBuilding({ cells: [...rectCells(18, 14, 27, 21)], storeyHeight: 2.6 })],
  texture: { roof: 'none', wall: 'none' },
  ...extra,
});

/** Span covered by the wall's own masonry along the x axis. */
export function muretSpans(model) {
  // Segmented for depth sorting, so the group carries the run and the piece.
  return buildMesh(normalise(model)).mesh.tris
    .filter((t) => t.group && t.group.startsWith('muret:') && !t.group.includes(':cap'))
    .map((t) => [Math.min(t.a[0], t.b[0], t.c[0]), Math.max(t.a[0], t.b[0], t.c[0])]);
}

/** Draw order of the first face of each material in a render. */
export function orderOf(model, width = 700, height = 500) {
  const out = renderScene(normalise(model), { width, height });
  const at = {};
  out.faces.forEach((f, i) => { if (!(f.mat in at)) at[f.mat] = i; });
  return at;
}

export function pointer(view, wx, wy, type, extra = {}) {
  const r = view.svg.getBoundingClientRect();
  const [px, py] = view.toPx(wx, wy);
  return new PointerEvent(type, {
    clientX: r.left + px, clientY: r.top + py,
    bubbles: true, pointerId: 1, isPrimary: true, button: 0, ...extra,
  });
}

/** A viewport in the test stage, with its hit layer drawn. */
export function stageViewport() {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  return { s, div, vp };
}

/** Press, move, release — on `target`, so the pick layer is exercised. */
export function dragOn(target, div, id, dx, dy = 0) {
  const r = div.getBoundingClientRect();
  const at = (ox, type) => target.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + 120 + ox, clientY: r.top + 140 + (ox ? dy : 0),
    bubbles: true, pointerId: id, isPrimary: true, button: 0,
  }));
  at(0, 'pointerdown'); at(dx, 'pointermove'); at(dx, 'pointerup');
}

/**
 * Load a blob back as an <img>. Deliberately not createImageBitmap: an image
 * load is a resource load, which headless Chrome's virtual clock waits for,
 * whereas createImageBitmap is not and lets the run finish underneath us.
 */
export function loadBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('PNG illisible')); };
    img.src = url;
  });
}

/**
 * Faces drawn over something nearer than themselves.
 *
 * For each sampled pixel, work out where the view ray meets the *plane* of
 * every face covering it. The one that should be visible is the one whose
 * intersection is nearest; if the renderer drew another last, that is an
 * occlusion error and not a matter of taste. Reporting it in metres of
 * overshoot is what separates a real inversion from a tie along a shared edge.
 */
export const STACKED = new Set(['solar', 'solarFrame', 'solarCell']);

export function occlusionErrors(model, W, H, step = 3) {
  const out = renderScene(model, { width: W, height: H });
  const cam = out.camera, proj = cam.proj, L = cam.lambda;
  const faces = out.faces.map((f, i) => {
    const v = cam.toView(f.centroid);
    const n = f.nCam;
    return {
      i, f, n,
      loops: f.loops.map((l) => l.map((p) => cam.toScreen(p))),
      d: n[0] * v[0] + n[1] * v[1] + n[2] * v[2],
    };
  });
  const covers = (F, x, y) => {
    let c = false;
    for (const l of F.loops) {
      for (let a = 0, b = l.length - 1; a < l.length; b = a++) {
        if ((l[a][1] > y) !== (l[b][1] > y)
          && x < ((l[b][0] - l[a][0]) * (y - l[a][1])) / (l[b][1] - l[a][1]) + l[a][0]) c = !c;
      }
    }
    return c;
  };
  const depthAt = (F, x, y) => {
    const sx = (x - cam.offset[0]) / cam.scale;
    const sy = (y - cam.offset[1]) / cam.scale;
    const u = sx / proj.kx;
    const k = (F.n[0] + F.n[1] + L * F.n[2]) / L;
    if (Math.abs(k) < 1e-9) return null;
    const qz = (F.d - (u * (F.n[1] - F.n[0])) / 2 - (sy * (F.n[0] + F.n[1])) / (2 * proj.ky)) / k;
    return (sy + qz * proj.kz) / proj.ky + L * qz;
  };
  const bad = new Map();
  for (let y = 2; y < H; y += step) {
    for (let x = 2; x < W; x += step) {
      let top = null, best = null;
      for (const F of faces) {
        if (!covers(F, x, y)) continue;
        if (!top || F.i > top.i) top = F;
        const dp = depthAt(F, x, y);
        if (dp !== null && (!best || dp > best.dp)) best = { F, dp };
      }
      if (!top || !best || best.F === top) continue;
      const dTop = depthAt(top, x, y);
      if (dTop === null || best.dp - dTop < 0.03) continue;
      // A solar array is three deliberately stacked decals a centimetre apart:
      // backing, cells, then the grid lines. Their order is set by insertion,
      // not by depth, and a plane test on faces that nearly coincide answers a
      // question nobody asked. Everything else is fair game.
      if (STACKED.has(best.F.f.group) && STACKED.has(top.f.group)) continue;
      const key = `${best.F.f.group} masqué par ${top.f.group}`;
      // How deep the inversion runs matters as much as how wide: a pixel at a
      // shared silhouette edge overshoots by centimetres, a panel seen through
      // a roof by metres. Reporting only the count cannot tell them apart.
      const e = bad.get(key) || { n: 0, gap: 0 };
      e.n++;
      e.gap = Math.max(e.gap, best.dp - dTop);
      bad.set(key, e);
    }
  }
  return bad;
}
