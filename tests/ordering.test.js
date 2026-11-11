/** Recouvrements et ordre de tracé. */

import { check } from './harness.js';
import { near, topFaceAt, roofHouse } from './helpers.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';

/* ---------------- overlapping and depth ordering ---------------- */



check('une cheminée près du faîtage n’est pas tranchée par le toit', () => {
  // It used to anchor to one slope while the other, drawn later, painted over
  // it — so any chimney near a ridge came out sliced in half.
  for (const [label, x, y] of [['faîtage', 22.5, 17.5], ['milieu de pan', 22.5, 19.5], ['près de l’égout', 22.5, 20.6]]) {
    const m = roofHouse({ roofItems: [{ id: 'c', kind: 'chimney', x, y, w: 0.8, d: 0.8, h: 1.3 }] });
    const out = renderScene(m, { width: 600, height: 460 });
    const shaft = out.faces.filter((f) => f.group === 'chimney');
    if (!shaft.length) return `${label} : cheminée absente`;
    // Its own top, well above the roof, must be the face on top there.
    const apex = shaft.reduce((a, f) => (f.centroid[2] > a.centroid[2] ? f : a), shaft[0]);
    const top = topFaceAt(out, out.camera.toScreen(apex.centroid));
    if (!top) return `${label} : rien à cet endroit`;
    if (top.group !== 'chimney') return `${label} : recouverte par « ${top.mat} »`;
  }
  return true;
});

check('un objet de toiture épouse la pente', () => {
  const m = roofHouse({ roofItems: [{ id: 's', kind: 'solar', x: 21, y: 19, w: 3.2, d: 2.4 }] });
  const built = buildMesh(m);
  const part = built.parts[0];
  const zRoof = (x, y) => part.top + Math.max(0, part.field.h(x, y));
  let worst = 0;
  for (const t of built.mesh.tris) {
    if (t.mat !== 'solar') continue;
    for (const p of [t.a, t.b, t.c]) worst = Math.max(worst, Math.abs(p[2] - zRoof(p[0], p[1])));
  }
  // Astride a hip a single flat quad kept its own plane and tore through the
  // roof; the panel is now subdivided and never leaves the surface.
  return worst < 0.12 || `le panneau s'écarte de ${worst.toFixed(2)} m de la toiture`;
});

check('une haie longue est découpée en tronçons de profondeurs distinctes', () => {
  // One centroid for a twenty-metre run means one depth, so the whole hedge
  // sorts either in front of the house or behind it, never partly each.
  const m = roofHouse({
    props: [{ id: 'h', kind: 'hedge', x: 10, y: 23, w: 20, d: 0.6, h: 1.6 }],
  });
  const out = renderScene(m, { width: 700, height: 500 });
  const parts = out.faces.filter((f) => f.group.startsWith('hedge:'));
  if (parts.length < 6) return `${parts.length} faces seulement`;
  const depths = new Set(parts.map((f) => Math.round(f.depth * 4)));
  return depths.size >= 4 || `${depths.size} profondeurs distinctes`;
});

check('les tronçons se recouvrent, sans jour entre eux', () => {
  const m = roofHouse({ props: [{ id: 'h', kind: 'hedge', x: 10, y: 23, w: 12, d: 0.6, h: 1.6 }] });
  const xs = buildMesh(m).mesh.tris
    .filter((t) => t.group && t.group.startsWith('hedge:'))
    .map((t) => [Math.min(t.a[0], t.b[0], t.c[0]), Math.max(t.a[0], t.b[0], t.c[0])]);
  const starts = [...new Set(xs.map(([lo]) => Math.round(lo * 1000) / 1000))].sort((a, b) => a - b);
  const ends = [...new Set(xs.map(([, hi]) => Math.round(hi * 1000) / 1000))].sort((a, b) => a - b);
  // Every segment boundary must be covered: the next start comes before the
  // previous end, or an anti-aliased seam shows through.
  for (let i = 1; i < starts.length; i++) {
    const prevEnd = ends.filter((e) => e > starts[i - 1] && e <= starts[i] + 0.06).pop();
    if (prevEnd === undefined) continue;
    if (prevEnd < starts[i]) return `jour de ${(starts[i] - prevEnd).toFixed(3)} m entre deux tronçons`;
  }
  return true;
});
