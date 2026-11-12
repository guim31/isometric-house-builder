/** Équipements : appliques, caméras, bornes, lampadaires, pompes à chaleur, boîtes aux lettres, carports. */

import { check } from './harness.js';
import { occlusionErrors, stripIds } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import {
  emptyModel, normalise, makeBuilding, MODEL_VERSION, withCellSize, FIXTURE_DEFAULTS, PROP_DEFAULTS,
  quarterTurn, propFootprint, defaultModel,
} from '../src/core/model.js';
import { normalise as normaliseV2 } from './fixtures/model-v2.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { focusModel } from '../src/core/focus.js';
import { NIGHT } from '../src/core/palette.js';
import { Store } from '../src/ui/store.js';
import { stage, clickAt, visible } from './rendu-gestes.test.js';

const NEW_PROPS = ['lamppost', 'heatpump', 'mailbox', 'carport'];
const FIXTURES = ['wallLight', 'camera', 'charger'];

/** A house with every piece of equipment on or around it, as a dashboard would have them. */
export function equippedHouse(extra = {}) {
  return normalise({
    ...emptyModel(),
    buildings: [makeBuilding({
      id: 'maison', cells: [...rectCells(0, 0, 9, 6)], storeys: 2,
      roof: { type: 'gable', pitch: 35, overhang: 0.75, fascia: 0.18, ridge: 'auto' },
    })],
    fixtures: [
      // On the north wall (y = 7), under the eaves of its upper level.
      { id: 'ap', kind: 'wallLight', edge: '2,6,N', storey: 1, offset: 0.5, z: 1.8 },
      { id: 'cam', kind: 'camera', edge: '7,6,N', storey: 1, offset: 0.5, z: 2.4 },
      // On the east wall (x = 10), by where the car stands.
      { id: 'bo', kind: 'charger', edge: '9,2,E', storey: 0, offset: 0.5, z: 1.1 },
      { id: 'ap2', kind: 'wallLight', edge: '9,6,E', storey: 0, offset: 0.5, z: 2 },
    ],
    props: [
      // Against the north wall, under the overhang.
      { id: 'pac', kind: 'heatpump', x: 4, y: 7.05, w: 1, d: 0.4, h: 0.8, dir: 'N' },
      { id: 'bal', kind: 'mailbox', x: 1, y: 9, w: 0.4, d: 0.3, h: 1.15, dir: 'N' },
      { id: 'lamp', kind: 'lamppost', x: 6, y: 8.5, w: 0.4, d: 0.4, h: 2.2 },
      // Against the east wall, a car under it.
      { id: 'cp', kind: 'carport', x: 10.1, y: 0, w: 3, d: 5.5, h: 2.3, cover: 'flat' },
      { id: 'auto', kind: 'car', x: 11.6, y: 2.75, w: 1.8, d: 4.2 },
      { id: 'perg', kind: 'carport', x: 14, y: 6, w: 5.5, d: 3, h: 2.5, cover: 'slats' },
      { id: 'auto2', kind: 'car', x: 16.75, y: 7.5, w: 4.2, d: 1.8, dir: 'W' },
    ],
    ...extra,
  });
}

/* ---------------- le format ---------------- */

check('les équipements passent par normalise, valeurs par défaut comprises', () => {
  const m = normalise({
    buildings: [{ cells: ['0,0'] }],
    props: NEW_PROPS.map((kind, i) => ({ kind, x: i * 4, y: 0 })),
    fixtures: [
      ...FIXTURES.map((kind) => ({ kind, edge: '0,0,S' })),
      { kind: 'antenne', edge: '0,0,S' }, { kind: 'camera', edge: 'x' }, { kind: 'camera', edge: '0,0,N', z: 99 },
    ],
  });
  for (const p of m.props) {
    for (const [k, v] of Object.entries(PROP_DEFAULTS[p.kind])) if (p[k] !== v) return `${p.kind}.${k} = ${p[k]}`;
  }
  if (m.fixtures.length !== 4) return `${m.fixtures.length} équipements muraux gardés`;
  for (const f of m.fixtures.slice(0, 3)) if (f.z !== FIXTURE_DEFAULTS[f.kind].z || f.offset !== 0.5 || f.storey !== 0) return JSON.stringify(f);
  if (m.fixtures[3].z > 4) return 'hauteur non bornée';
  return m.version === MODEL_VERSION && MODEL_VERSION === 3 || `version ${m.version}`;
});

check('un fichier de ce lot s’ouvre dans la version précédente, qui ignore ce qu’elle ne connaît pas', () => {
  const v3 = JSON.parse(JSON.stringify(equippedHouse({
    props: [...equippedHouse().props, { id: 'sap', kind: 'tree', x: -3, y: -3, r: 1.5, style: 'conifer' }],
  })));
  let old;
  try { old = normaliseV2(v3); } catch (e) { return `exception : ${e.message}`; }
  // What it would have made of the same file without anything new in it.
  const plain = JSON.parse(JSON.stringify(v3));
  delete plain.fixtures;
  plain.props = plain.props.filter((p) => !NEW_PROPS.includes(p.kind));
  for (const p of plain.props) if (p.kind === 'tree') delete p.style;
  for (const b of plain.buildings) delete b.roof.ridge;
  const a = JSON.stringify(old), b = JSON.stringify(normaliseV2(plain));
  if (a !== b) return 'l’ancienne version lit autre chose que le fichier sans les nouveautés';
  // And it draws.
  const out = renderScene(old, { width: 300, height: 200 });
  return out.svg.includes('<path') || 'rien dessiné';
});

check('un fichier de la version précédente s’ouvre à l’identique, migré', () => {
  const v2 = normaliseV2({ ...defaultModel(), version: 2 });
  const m = normalise(JSON.parse(JSON.stringify(v2)));
  if (m.version !== 3 || m.fixtures.length || m.buildings.some((b) => b.roof.ridge !== 'auto')) return 'migration';
  const svg = (x) => stripIds(renderScene(x, { width: 400, height: 300 }).svg);
  return svg(m) === svg(v2) || 'le rendu a changé';
});

/* ---------------- la géométrie ---------------- */

const mats = (m) => new Set(buildMesh(m).mesh.tris.map((t) => t.mat));

check('chaque équipement se dessine, dans sa propre emprise', () => {
  for (const kind of NEW_PROPS) {
    const p = { id: 'x', kind, x: 2, y: 3, ...PROP_DEFAULTS[kind] };
    const tris = buildMesh(normalise({ props: [p] })).mesh.tris.filter((t) => t.group.startsWith('equip:'));
    if (!tris.length) return `${kind} : rien dessiné`;
    const [x0, y0, x1, y1] = propFootprint(p);
    for (const t of tris) {
      for (const q of [t.a, t.b, t.c]) {
        // A grille and a slot stand a couple of centimetres proud.
        if (q[0] < x0 - 0.03 || q[0] > x1 + 0.03 || q[1] < y0 - 0.03 || q[1] > y1 + 0.03) return `${kind} hors emprise`;
        if (q[2] > (p.h ?? 1) + 1e-9) return `${kind} plus haut que sa hauteur`;
      }
    }
  }
  for (const kind of FIXTURES) {
    const m = normalise({ buildings: [{ cells: ['0,0', '1,0'] }], fixtures: [{ id: 'f', kind, edge: '1,0,E', offset: 0.5 }] });
    const tris = buildMesh(m).mesh.tris.filter((t) => t.group === 'equip:f');
    if (!tris.length) return `${kind} : rien dessiné`;
    // On the east wall, x = 2: in front of it, never inside.
    if (tris.some((t) => [t.a, t.b, t.c].some((q) => q[0] < 2 - 1e-9 || q[0] > 2.6))) return `${kind} dans le mur`;
  }
  return true;
});

check('une couverture à lames laisse passer le jour, un toit plat non', () => {
  const area = (cover) => buildMesh(normalise({ props: [{ id: 'c', kind: 'carport', x: 0, y: 0, cover }] })).mesh.tris
    .filter((t) => t.n[2] > 0.99 && Math.min(t.a[2], t.b[2], t.c[2]) > 2)
    .reduce((acc, t) => acc + Math.abs((t.b[0] - t.a[0]) * (t.c[1] - t.a[1]) - (t.c[0] - t.a[0]) * (t.b[1] - t.a[1])) / 2, 0);
  const flat = area('flat'), slats = area('slats');
  return (flat > 16 && slats < flat * 0.5) || `${flat.toFixed(1)} m² contre ${slats.toFixed(1)} m²`;
});

check('la pompe à chaleur et la boîte aux lettres regardent dans leur sens', () => {
  for (const kind of ['heatpump', 'mailbox']) {
    for (const dir of ['N', 'E', 'S', 'W']) {
      const across = dir === 'E' || dir === 'W';
      const def = PROP_DEFAULTS[kind];
      const p = { id: 'x', kind, x: 0, y: 0, ...def, dir, w: across ? def.d : def.w, d: across ? def.w : def.d };
      const front = buildMesh(normalise({ props: [p] })).mesh.tris.filter((t) => t.mat === (kind === 'heatpump' ? 'hpGrille' : 'mailSlot') && t.a[2] > 0.1);
      const out = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] }[dir];
      if (!front.some((t) => t.n[0] === out[0] && t.n[1] === out[1])) return `${kind} ${dir}`;
    }
  }
  return true;
});

check('un quart de tour fait pivoter un équipement avec son sens', () => {
  const p = { id: 'x', kind: 'heatpump', x: 0, y: 0, w: 1, d: 0.4, h: 0.8, dir: 'S' };
  const q = quarterTurn(p);
  return (q.dir === 'W' && q.w === 0.4 && q.d === 1) || JSON.stringify(q);
});

/* ---------------- la nuit ---------------- */

check('appliques et lampadaires s’allument en vue de nuit, comme les fenêtres', () => {
  const night = equippedHouse();
  night.style = { ...night.style, night: true };
  const lit = (m) => renderScene(m, { width: 500, height: 380 }).faces.filter((f) => f.mat === 'lampGlass');
  const day = lit(equippedHouse()), dark = lit(night);
  if (!dark.length) return 'aucune lanterne visible';
  if (!dark.every((f) => f.fill === NIGHT.lit.lampGlass)) return `éteinte : ${dark.map((f) => f.fill)}`;
  return day.every((f) => f.fill !== NIGHT.lit.lampGlass) || 'allumée de jour';
});

/* ---------------- les murs bougent ---------------- */

check('un équipement mural suit son mur quand la trame est affinée', () => {
  const m = equippedHouse();
  const world = (mm) => buildMesh(mm).mesh.tris.filter((t) => t.group === 'equip:cam')
    .map((t) => t.a.map((v) => v.toFixed(4)).join(',')).sort().join(';');
  const fine = withCellSize(m, 0.5);
  if (fine.fixtures.length !== 4) return 'perdus au changement de trame';
  return world(m) === world(fine) || 'la caméra a bougé';
});

check('supprimer un corps emporte ses équipements muraux, et le cadrage aussi', () => {
  const m = equippedHouse({
    buildings: [...equippedHouse().buildings, makeBuilding({ id: 'abri', cells: [...rectCells(30, 0, 33, 3)] })],
  });
  const s = new Store(m);
  s.removeBuilding('maison');
  if (s.model.fixtures.length) return 'équipements orphelins';
  const framed = focusModel({ ...m, focus: { enabled: true, x: 28, y: -2, w: 8, d: 8, margin: 1 } });
  if (framed.fixtures.length) return 'gardés hors cadre';
  const kept = focusModel({ ...m, focus: { enabled: true, x: 0, y: 0, w: 12, d: 12, margin: 1 } });
  if (kept.fixtures.length !== 4) return 'perdus dans le cadre';
  // Compact on the ground: kept whole, or not at all.
  return kept.props.filter((p) => p.kind === 'carport').every((p) => p.w === 3 || p.w === 5.5) || 'carport coupé';
});

/* ---------------- dans le rendu ---------------- */

check('un équipement mural se pose sur le rendu à la hauteur cliquée, et se règle au glisser', () => {
  const m = equippedHouse({ fixtures: [] });
  const { s, vp } = stage(m);
  s.setTool('camera');
  // A point of the north wall the default camera sees, 1,80 m up its ground level.
  const cam = vp.lastRender.camera;
  const at = cam.toScreen([5.3, 7, 1.8]);
  const wall = [...vp.root.querySelectorAll('.hit-layer [data-pick="wall"]')]
    .find((el) => el.dataset.edge === '5,6,N' && el.dataset.storey === '0');
  if (!wall) return 'mur introuvable';
  clickAt(vp, at[0], at[1], { target: wall });
  const f = s.model.fixtures[0];
  if (!f || f.kind !== 'camera') return 'rien posé';
  // A north edge runs west, from x = 6 to x = 5.
  if (Math.abs(f.offset - 0.7) > 0.051 || Math.abs(f.z - 1.8) > 0.051) return `posée à ${f.offset} m, ${f.z} m de haut`;
  // Held and dragged: along the wall and up it.
  vp.render();
  const hit = vp.root.querySelector('.hit-layer [data-pick="fixture"]');
  const from = cam.toScreen([5.3, 7.25, 1.8]), to = cam.toScreen([4.3, 7.25, 2.3]);
  const r = vp.svg.getBoundingClientRect();
  const ev = (el, type, [x, y]) => el.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerId: 71, isPrimary: true, button: 0,
  }));
  ev(hit, 'pointerdown', from);
  ev(vp.root, 'pointermove', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  ev(vp.root, 'pointermove', to);
  ev(vp.root, 'pointerup', to);
  const g = s.model.fixtures[0];
  return (Math.abs(g.offset - 1.7) < 0.051 && Math.abs(g.z - 2.3) < 0.051) || `déplacée à ${g.offset} m, ${g.z} m`;
});

check('cliquer un équipement dans le rendu le sélectionne', () => {
  // From whichever side shows it: a carport hides the charger behind it
  // from one corner, an eave hides the camera from above.
  const m = equippedHouse();
  // A charger under its carport shows only from low down, between the posts.
  const views = [30, 12].flatMap((pitch) => [0, 90, 180, 270]
    .map((yaw) => stage({ ...m, camera: { ...m.camera, yaw, pitch } })));
  // The camera is left out: it hangs under the eaves, where it is meant to be hidden.
  for (const id of ['ap', 'ap2', 'bo', 'pac', 'bal', 'lamp', 'cp', 'perg']) {
    let done = false;
    for (const { s, vp } of views) {
      const v = visible(vp, `equip:${id}`);
      if (!v) continue;
      s.select(null);
      // Through the browser's own hit test on the pick layer.
      const el = vp.root.querySelector(`.hit-layer [data-id="${id}"]`);
      if (!el) return `${id} sans cible`;
      clickAt(vp, v.screen[0], v.screen[1], { target: el });
      if (s.selection?.id !== id) return `${id} : ${JSON.stringify(s.selection)}`;
      done = true;
      break;
    }
    if (!done) return `${id} invisible sous huit angles`;
  }
  return true;
});

/* ---------------- l'ordre de dessin ---------------- */

check('chaque équipement reste du bon côté des murs, du débord et de la voiture, à tout angle', () => {
  // Against a wall, under an overhang, a carport over a car: the cases a
  // painter's sort gets wrong, swept over every orientation and height.
  const m = equippedHouse();
  const ours = /^(equip|parked)/;
  for (let yaw = 0; yaw < 360; yaw += 30) {
    for (const pitch of [10, 20, 35, 60, 80]) {
      for (const [k, e] of occlusionErrors({ ...m, camera: { ...m.camera, yaw, pitch } }, 300, 220, 3)) {
        const [hidden, , , over] = k.split(' ');
        if (!ours.test(hidden) && !ours.test(over)) continue;
        // A car against itself predates this lot (see moteur.test.js).
        if (/^parked/.test(hidden) && hidden === over) continue;
        if (e.gap > 0.05 && e.n > 1) return `${yaw}°/${pitch}° : ${e.n} px, ${e.gap.toFixed(2)} m — ${k}`;
      }
    }
  }
  return true;
});

check('les équipements ne changent rien à une maison qui n’en a pas', () => {
  const m = defaultModel();
  const svg = (x) => stripIds(renderScene(x, { width: 400, height: 300 }).svg);
  return svg(m) === svg({ ...m, fixtures: [] }) || 'rendu changé';
});

check('chaque équipement a son matériau et ses couleurs', () => {
  const all = mats(equippedHouse());
  for (const k of ['lampPost', 'lampGlass', 'camBody', 'camLens', 'chargerBody', 'chargerLight', 'hpBody', 'hpGrille', 'mailBox', 'mailPost', 'mailSlot', 'carportFrame', 'carportRoof']) {
    if (!all.has(k)) return `${k} absent`;
  }
  return true;
});
