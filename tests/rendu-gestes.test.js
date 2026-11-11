/** Agir dans le rendu : toit cliquable, pose sur le toit, déplacement au glisser. */

import { check } from './harness.js';
import { topFaceAt } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { emptyModel, normalise, makeBuilding, defaultModel } from '../src/core/model.js';
import { renderScene } from '../src/render/svg.js';
import { screenToPlane, roofAt, rayOnRoof, snapOntoBuilding } from '../src/render/hit.js';
import { Store } from '../src/ui/store.js';
import { Viewport } from '../src/ui/viewport.js';

/** A viewport on the test stage, around a given model. */
export function stage(model, w = 440, h = 400) {
  const s = new Store(model);
  const div = document.createElement('div');
  div.style.cssText = `width:${w}px;height:${h}px`;
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  return { s, div, vp };
}

/** Press and release at a drawing pixel, on whatever the browser would hit there. */
export function clickAt(vp, sx, sy, { id = 41, move = null, target = null } = {}) {
  const r = vp.svg.getBoundingClientRect();
  const on = target || vp.root;
  const ev = (type, x, y) => on.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerId: id, isPrimary: true, button: 0,
  }));
  ev('pointerdown', sx, sy);
  if (move) for (const [x, y] of move) ev('pointermove', x, y);
  const last = move ? move[move.length - 1] : [sx, sy];
  ev('pointerup', last[0], last[1]);
}

/** A pixel where a face of a group is what is drawn on top, with its world point. */
export function visible(vp, group, pick = (f) => f) {
  const out = vp.lastRender;
  const cands = out.faces.filter((f) => f.group === group).map(pick).filter(Boolean);
  for (const f of cands) {
    // A few points inside the face, from its centre outwards.
    const ring = f.loops[0];
    const c = f.centroid;
    for (const t of [0, 0.3, 0.6]) {
      for (const v of [null, ...ring]) {
        const p = v ? [c[0] + (v[0] - c[0]) * t, c[1] + (v[1] - c[1]) * t, c[2] + (v[2] - c[2]) * t] : c;
        const s = out.camera.toScreen(p);
        if (topFaceAt(out, s) === f) return { face: f, world: p, screen: s };
      }
    }
  }
  return null;
}

const gabled = (extra = {}) => normalise({
  ...emptyModel(),
  buildings: [makeBuilding({
    id: 'maison', cells: [...rectCells(0, 0, 9, 6)],
    roof: { type: 'gable', pitch: 35, overhang: 0.5, fascia: 0.18, shedDir: 'S' },
  })],
  ...extra,
});

check('un point vu à l’écran revient exactement sur le plan de sa face', () => {
  const m = gabled({ camera: { yaw: 37, pitch: 41, roll: 12, projection: 'iso30' } });
  const out = renderScene(m, { width: 500, height: 400 });
  for (const f of out.faces.filter((x) => x.group === 'roof')) {
    const s = out.camera.toScreen(f.centroid);
    const p = screenToPlane(out.camera, s[0], s[1], f.normal, f.centroid);
    if (Math.hypot(p[0] - f.centroid[0], p[1] - f.centroid[1], p[2] - f.centroid[2]) > 1e-6) {
      return `écart de ${Math.hypot(p[0] - f.centroid[0], p[1] - f.centroid[1], p[2] - f.centroid[2])} m`;
    }
  }
  return true;
});

check('cliquer un versant du toit dans le rendu choisit son corps', () => {
  // Only a two-centimetre band at the top of the walls picked a volume; a
  // click on the slope itself selected nothing, or what stood behind.
  const m = gabled({
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(0, 0, 9, 6)], roof: { type: 'gable', pitch: 35, overhang: 0.5, fascia: 0.18, shedDir: 'S' } }),
      makeBuilding({ id: 'abri', cells: [...rectCells(14, 0, 17, 3)], roof: { type: 'hip', pitch: 30, overhang: 0.25, fascia: 0.18, shedDir: 'S' } }),
    ],
    // Behind the house from the default camera, where its pick target used
    // to answer for clicks on the roof in front of it.
    props: [{ id: 'arbre', kind: 'tree', x: -2, y: -2, r: 3 }],
  });
  for (const yaw of [0, 60, 145, 230, 300]) {
    const { s, vp } = stage({ ...m, camera: { ...m.camera, yaw } });
    const hits = vp.lastRender.faces.filter((f) => f.group === 'roof');
    let tried = 0;
    for (const f of hits) {
      const v = visible(vp, 'roof', (x) => (x === f ? x : null));
      if (!v) continue;
      tried++;
      s.select(null);
      clickAt(vp, v.screen[0], v.screen[1]);
      const want = v.world[0] < 12 ? 'maison' : 'abri';
      if (s.selection?.type !== 'building' || s.selection.id !== want) {
        return `${yaw}° : ${JSON.stringify(s.selection)} au lieu de ${want}`;
      }
      if (s.activeBuildingId !== want) return `${yaw}° : le corps actif n’a pas suivi`;
    }
    if (!tried) return `${yaw}° : aucun versant visible`;
  }
  return true;
});

check('un outil d’extérieur ne pose rien sous la maison quand on clique son toit', () => {
  const { s, vp } = stage(gabled());
  s.setTool('tree');
  const v = visible(vp, 'roof');
  clickAt(vp, v.screen[0], v.screen[1]);
  return s.model.props.length === 0 || 'un arbre a été planté sous le toit';
});

check('les outils de toit posent à l’endroit du versant cliqué', () => {
  for (const yaw of [0, 110, 250]) {
    const m = gabled({ camera: { ...emptyModel().camera, yaw } });
    const { s, vp } = stage(m);
    s.setTool('chimney');
    const v = visible(vp, 'roof');
    if (!v) return `${yaw}° : aucun versant visible`;
    clickAt(vp, v.screen[0], v.screen[1]);
    const it = s.model.roofItems[0];
    if (!it) return `${yaw}° : rien posé`;
    // Snapped to the quarter metre, and kept on the footprint.
    const want = snapOntoBuilding(m.buildings[0], 1, v.world[0], v.world[1]);
    if (it.x !== want[0] || it.y !== want[1]) {
      return `${yaw}° : posée en ${it.x}, ${it.y} au lieu de ${want}`;
    }
    if (s.selection?.id !== it.id) return 'l’objet posé n’est pas sélectionné';
  }
  return true;
});

check('un clic hors de tout toit ne pose aucun objet de toit', () => {
  const { s, vp } = stage(gabled());
  s.setTool('solar');
  // A corner of the picture: lawn or nothing.
  clickAt(vp, 6, 6);
  return s.model.roofItems.length === 0 || 'un panneau posé hors du toit';
});

check('un clic sur un objet de toit le sélectionne, au travers de son toit', () => {
  const m = gabled({ roofItems: [{ id: 'chem', kind: 'chimney', x: 5, y: 3.5, w: 0.8, d: 0.8, h: 1.4 }] });
  const { s, vp } = stage(m);
  const v = visible(vp, 'chimney');
  if (!v) return 'cheminée invisible';
  clickAt(vp, v.screen[0], v.screen[1]);
  return (s.selection?.type === 'roofItem' && s.selection.id === 'chem') || JSON.stringify(s.selection);
});

check('le rayon de vue rencontre le toit à sa surface exacte', () => {
  const m = gabled({ camera: { yaw: 23, pitch: 30, roll: 0, projection: 'iso30' } });
  const { vp } = stage(m);
  const part = vp.lastRender.built.parts[0];
  for (const [x, y] of [[2, 1.5], [5, 3], [8.5, 5.5], [3, 6.2]]) {
    const z = part.top + Math.max(0, part.field.h(x, y));
    const sc = vp.lastRender.camera.toScreen([x, y, z]);
    const p = rayOnRoof(vp.lastRender.camera, sc[0], sc[1], part);
    if (!p) return `${x}, ${y} : manqué`;
    // The near slope may hide the point: then the ray meets it first, higher.
    if (p[2] < z - 1e-4) return `${x}, ${y} : sous la surface`;
    if (Math.abs(part.top + Math.max(0, part.field.h(p[0], p[1])) - p[2]) > 1e-4) return 'hors de la surface';
  }
  return true;
});

check('roofAt ne répond pas pour ce qui n’est pas un toit', () => {
  const { vp } = stage(defaultModel());
  const v = visible(vp, 'wall');
  return roofAt(vp.lastRender, v.screen[0], v.screen[1]) === null || 'un mur pris pour un toit';
});
