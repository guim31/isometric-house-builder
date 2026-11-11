/** Revue d'octobre : correctifs. */

import { check } from './harness.js';
import { near } from './helpers.js';
import { decomposeRects, rectCells, edgeRunExtent, runExtents } from '../src/core/grid.js';
import { heightField } from '../src/core/roof.js';
import { defaultModel, emptyModel, normalise, cellSet, makeBuilding } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { hitLayer } from '../src/render/hit.js';
import { Store } from '../src/ui/store.js';
import { placeProp, PROP_DEFAULTS } from '../src/ui/actions.js';
import { Inspector } from '../src/ui/panels.js';
import { toShareUrl, clearLocal, saveLocal, initialModel } from '../src/io/project.js';

/* ---------------- revue d'octobre : correctifs ---------------- */

check('un identifiant ou une couleur piégés ne passent pas dans le SVG', () => {
  // A share link is a model written by someone else, and its ids end up in
  // attributes of markup parsed by the page.
  const evil = 'x" onmouseover="alert(1)';
  const m = normalise({ ...defaultModel(),
    props: [{ id: evil, kind: 'tree', x: 1, y: 1, r: 1 }],
    overrides: { wall: 'red"/><script>alert(1)</script>', roof: '#123456' },
    style: { background: 'red"/><script>alert(1)</script>' } });
  if (m.props[0].id === evil) return 'identifiant conservé tel quel';
  if (m.overrides.wall) return 'couleur piégée conservée';
  if (m.overrides.roof !== '#123456') return 'couleur valide perdue';
  if (m.style.background !== 'transparent') return `fond ${m.style.background}`;
  const out = renderScene(m, { width: 300, height: 200 });
  const hits = hitLayer(m, out.camera, out.built);
  if (/" onmouseover=|<script/.test(out.svg + hits)) return 'balisage injecté';
  // Even a model that never went through normalise cannot break out.
  const raw = { ...m, props: [{ ...m.props[0], id: evil }], style: { ...m.style, background: 'red"/><script>' } };
  const out2 = renderScene(raw, { width: 300, height: 200 });
  return !/" onmouseover=|<script/.test(out2.svg + hitLayer(raw, out2.camera, out2.built)) || 'balisage injecté sans normalise';
});

check('un fichier qui n’est pas un objet ne s’étale pas dans le modèle', () => {
  const m = normalise('abc');
  return !('0' in m) && m.buildings.length === 1 || 'chaîne étalée en clés';
});

check('un lien partagé est lu une fois, puis retiré de l’adresse', () => {
  const m = normalise(defaultModel());
  const url = toShareUrl(m);
  const saved = location.hash;
  location.hash = url.slice(url.indexOf('#'));
  const boot = initialModel();
  const left = location.hash;
  location.hash = saved;
  if (boot.source !== 'link') return `source ${boot.source}`;
  return !left.includes('m=') || 'le lien est resté dans l’adresse : un rechargement écraserait les retouches';
});

check('un projet vide enregistré se rouvre vide', () => {
  // "Nouveau", a name, a palette — and a reload put the demo house back.
  const blank = normalise({ ...emptyModel(), name: 'Page blanche à moi', theme: 'slate' });
  saveLocal(blank);
  const boot = initialModel();
  clearLocal();
  if (boot.source !== 'local') return `source ${boot.source}`;
  return (boot.model.name === 'Page blanche à moi' && !cellSet(boot.model).size)
    || 'le projet vide a été remplacé';
});

check('l’outil Voiture pose une voiture', () => {
  const s = new Store(normalise(emptyModel()));
  placeProp(s, 'car', [5, 5]);
  const car = s.model.props.find((p) => p.kind === 'car');
  if (!car) return 'aucune voiture posée';
  return (car.w === 1.8 && car.d === 4.2 && car.x === 5 && car.y === 5) || JSON.stringify(car);
});

check('chaque objet extérieur dessiné a ses valeurs par défaut', () => {
  const kinds = ['pool', 'terrace', 'path', 'deck', 'muret', 'gate', 'stairs', 'tree', 'bush', 'hedge', 'fence', 'car'];
  const missing = kinds.filter((k) => !PROP_DEFAULTS[k]);
  return !missing.length || `sans défaut : ${missing.join(', ')}`;
});

check('Suppr sur un corps sélectionné ne plante pas et ne supprime rien', () => {
  const s = new Store(defaultModel());
  const id = s.model.buildings[0].id;
  s.select({ type: 'building', id });
  const before = s.model;
  if (s.deleteSelected() !== false) return 'la suppression a été signalée comme faite';
  return s.model === before || 'le modèle a changé';
});

check('le nom d’un corps se tape sans perdre le focus', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  insp.render();
  const nameOf = () => [...div.querySelectorAll('.field')]
    .find((f) => f.querySelector('.field-label')?.textContent === 'Nom')?.querySelector('input');
  const input = nameOf();
  input.focus();
  const focused = document.activeElement === input;
  input.value = 'Ga';
  input.setSelectionRange(2, 2);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  insp.render();
  const again = nameOf();
  const kept = document.activeElement === again;
  const caret = again.selectionStart;
  div.remove();
  if (s.activeBuilding.name !== 'Ga') return `nom ${s.activeBuilding.name}`;
  // If the environment refuses focus, the restore cannot be exercised here.
  if (!focused) return true;
  if (!kept) return 'le champ a perdu le focus';
  return caret === 2 || `curseur en ${caret}`;
});

check('l’inspecteur se met à jour dès qu’un curseur est relâché', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  insp.render();
  const fieldInput = (label) => [...div.querySelectorAll('.field')]
    .find((f) => f.querySelector('.field-label')?.textContent === label)?.querySelector('input');
  const storeys = fieldInput('Étages');
  storeys.focus();
  storeys.value = '3';
  storeys.dispatchEvent(new Event('input', { bubbles: true }));
  insp.render();
  if (fieldInput('Hauteur — Étage 2')) return 'reconstruit en plein geste';
  storeys.dispatchEvent(new Event('change', { bubbles: true }));
  // Still focused, as a slider stays once let go — the panel must not wait.
  insp.render();
  const ok = !!fieldInput('Hauteur — Étage 2');
  div.remove();
  return ok || 'les hauteurs par niveau ne sont pas apparues';
});

check('deux réglages successifs d’un corps ne s’annulent pas', () => {
  const m = normalise(defaultModel());
  m.buildings[0] = { ...m.buildings[0], storeys: 2, storeyHeights: null, storeyHeight: 2.5 };
  const s = new Store(m);
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const fieldInput = (label) => [...div.querySelectorAll('.field')]
    .find((f) => f.querySelector('.field-label')?.textContent === label)?.querySelector('input');
  const ground = fieldInput('Hauteur — Rez-de-chaussée');
  const first = fieldInput('Hauteur — Étage 1');
  ground.value = '3';
  ground.dispatchEvent(new Event('input', { bubbles: true }));
  // The second control was drawn before the first moved; it must not write
  // the old ground-floor height back.
  first.value = '2.2';
  first.dispatchEvent(new Event('input', { bubbles: true }));
  const colours = [...div.querySelectorAll('input[type=color]')];
  div.remove();
  const hs = s.activeBuilding.storeyHeights;
  if (!(hs && near(hs[0], 3) && near(hs[1], 2.2))) return `hauteurs ${JSON.stringify(hs)}`;
  return colours.length > 0 || 'aucune couleur';
});

check('le renfoncement s’arrête où s’arrête le mur, comme le curseur', () => {
  // A U open to the south: two wings, x 0..2 and 4..6, joined at the back.
  const cells = [...rectCells(0, 0, 1, 0), ...rectCells(4, 0, 5, 0), ...rectCells(0, 1, 5, 2)];
  const m = normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells, roof: { type: 'flat', pitch: 0, overhang: 0, fascia: 0.1, shedDir: 'S' } })],
    openings: [{ id: 'o1', edge: '1,0,S', kind: 'door', storey: 0, offset: 0.5,
      width: 0.9, height: 2.1, sill: 0, depth: 0.3, sides: 2 }] });
  const run = edgeRunExtent(new Set(cells), '1,0,S', 1);
  const all = runExtents(new Set(cells), 1).get('1,0,S');
  if (run.lo !== all.lo || run.hi !== all.hi) return 'deux définitions du pan';
  if (run.hi - run.lo !== 2) return `pan de ${run.hi - run.lo} m`;
  const tris = buildMesh(m).mesh.tris;
  const inCourt = tris.some((t) => t.mat.startsWith('wall') && [t.a, t.b, t.c].some((p) =>
    p[0] > 2.1 && p[0] < 3.9 && p[1] > 0.01 && p[1] < 0.99));
  return !inCourt || 'la niche est creusée dans la cour';
});

check('un appentis sur une emprise en L reste un seul plan', () => {
  const cells = new Set([...rectCells(0, 0, 2, 9), ...rectCells(3, 6, 7, 9)]);
  const f = heightField(decomposeRects(cells), { type: 'shed', pitch: 30, overhang: 0, shedDir: 'S' });
  const a = f.h(2.9, 9.5), b = f.h(3.1, 9.5);
  if (!near(a, b, 1e-6)) return `ressaut de ${(a - b).toFixed(2)} m entre les deux ailes`;
  // And it still slopes the way it says: high to the north, at the eaves to the south.
  return (near(f.h(1, 0), 0) && f.h(1, 9) > f.h(1, 1)) || 'pente inversée';
});
