/** Lot « fiabilité » : défauts reproduits à l'audit, chacun avec son test. */

import { check, checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { appStore, frames } from './app.test.js';
import {
  defaultModel, normalise, withTheme, makeBuilding, emptyModel, openingRun, fitOpening, openingSpan,
  overlappingOpenings, newId, idsOf,
} from '../src/core/model.js';
import { placeOpening } from '../src/ui/actions.js';
import { THEMES } from '../src/core/palette.js';
import { rectCells } from '../src/core/grid.js';
import { Store } from '../src/ui/store.js';
import { PlanView } from '../src/ui/plan.js';
import { pointer, stageViewport, stripIds, near } from './helpers.js';
import { Inspector } from '../src/ui/panels.js';
import { renderScene } from '../src/render/svg.js';
import { buildMesh } from '../src/core/scene.js';
import { focusModel } from '../src/core/focus.js';
import { OPENING_DEFAULTS, PROP_DEFAULTS, ROOF_ITEM_DEFAULTS, FIXTURE_DEFAULTS } from '../src/ui/actions.js';
import { toShareUrl, saveLocal, clearLocal, initialModel } from '../src/io/project.js';

/* ---------------- B1: palettes ---------------- */

check('changer de palette applique son style à tous les corps, sans toucher aux retouches', () => {
  const m = normalise({
    ...emptyModel(),
    theme: 'horizons',
    overrides: { wall: '#123456' },
    buildings: [
      makeBuilding({ cells: [...rectCells(0, 0, 3, 3)], plinth: 0 }),
      makeBuilding({ cells: [...rectCells(6, 0, 8, 2)], plinth: 0, overrides: { roof: '#654321' } }),
    ],
  });
  const t = withTheme(m, 'terracotta');
  const want = THEMES.terracotta.style;
  if (t.theme !== 'terracotta') return `palette ${t.theme}`;
  if (t.style.outline !== want.outline || t.style.shadow !== want.shadow) return 'contours ou ombre non appliqués';
  if (t.texture.roof !== want.texture.roof) return `matière ${t.texture.roof}`;
  if (!t.buildings.every((b) => b.plinth === want.plinth)) return 'soubassement non appliqué à chaque corps';
  if (t.overrides.wall !== '#123456' || t.buildings[1].overrides.roof !== '#654321') return 'retouches perdues';
  return true;
});

await checkAsync('la liste des palettes de l’application fonctionne', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  const field = [...doc.querySelectorAll('#inspector .field')]
    .find((f) => f.querySelector('.field-label')?.textContent === 'Palette');
  if (!field) return 'liste des palettes introuvable';
  const sel = field.querySelector('select');
  const errors = [];
  const onError = (e) => errors.push(e.message);
  frame.contentWindow.addEventListener('error', onError);
  sel.value = 'slate';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  frame.contentWindow.removeEventListener('error', onError);
  await frames(frame.contentWindow);
  const ok = store.model.theme === 'slate' && store.model.style.outline === (THEMES.slate.style.outline ?? false);
  store.update(before);
  if (errors.length) return errors.join(' ; ');
  return ok || `palette ${store.model.theme}`;
});

/* ---------------- B2: only the main button acts ---------------- */

check('le clic droit ne peint pas dans le plan, ni ne pose rien', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  const tries = ['paint', 'rect', 'tree', 'hedge', 'frame'];
  for (const tool of tries) {
    s.setTool(tool);
    view.svg.dispatchEvent(pointer(view, 20.5, 20.5, 'pointerdown', { button: 2, buttons: 2 }));
    view.svg.dispatchEvent(pointer(view, 24.5, 22.5, 'pointermove', { button: -1, buttons: 2 }));
    view.svg.dispatchEvent(pointer(view, 24.5, 22.5, 'pointerup', { button: 2 }));
  }
  view.svg.remove();
  const m = s.model;
  if (m.buildings[0].cells.length) return `${m.buildings[0].cells.length} case(s) peinte(s)`;
  if (m.props.length) return `${m.props.length} objet(s) posé(s)`;
  if (m.focus.enabled) return 'cadrage tracé';
  return true;
});

check('le clic droit ne fait ni tourner ni sélectionner dans le rendu', () => {
  const { s, div, vp } = stageViewport();
  const r = div.getBoundingClientRect();
  const yaw = s.model.camera.yaw;
  const ev = (type, x, extra) => new PointerEvent(type, {
    clientX: r.left + x, clientY: r.top + 140, bubbles: true, pointerId: 5, ...extra,
  });
  const target = vp.root.querySelector('[data-pick="wall"]') || vp.root;
  target.dispatchEvent(ev('pointerdown', 120, { button: 2, buttons: 2 }));
  target.dispatchEvent(ev('pointermove', 220, { button: -1, buttons: 2 }));
  target.dispatchEvent(ev('pointerup', 220, { button: 2 }));
  div.remove();
  if (s.model.camera.yaw !== yaw) return 'la vue a tourné';
  return !s.selection || `sélection ${JSON.stringify(s.selection)}`;
});

/* ---------------- B3: shortcuts after a slider ---------------- */

await checkAsync('les raccourcis marchent encore après avoir réglé un curseur', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  const store = await appStore();
  const before = store.model;
  store.setTool('select');
  store.update((m) => ({ ...m, props: [...m.props, { id: 'kbdtest', kind: 'tree', x: 2, y: 2, r: 1.5 }] }));
  store.select({ type: 'prop', id: 'kbdtest' });
  await frames(win);
  const range = doc.querySelector('#inspector .panel-selected input[type="range"]');
  if (!range) return 'aucun curseur dans l’inspecteur';
  range.focus();
  const key = (k, extra = {}) => range.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  const yaw = store.model.camera.yaw;
  key(']');
  const turned = store.model.camera.yaw !== yaw;
  key('Delete');
  const deleted = !store.model.props.some((p) => p.id === 'kbdtest');
  // A text field keeps its keys: Suppr there edits the text.
  store.update(before);
  if (!turned) return '] ignoré';
  return deleted || 'Suppr ignoré';
});

await checkAsync('une liste garde ses propres touches, mais pas Échap', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  const store = await appStore();
  store.update((m) => ({ ...m, props: [...m.props, { id: 'kbdlist', kind: 'pool', x: 2, y: 2, w: 6, d: 4 }] }));
  store.select({ type: 'prop', id: 'kbdlist' });
  await frames(win);
  const sel = doc.querySelector('#inspector .panel-selected select');
  if (!sel) return 'aucune liste dans l’inspecteur';
  sel.focus();
  const yaw = store.model.camera.yaw;
  sel.dispatchEvent(new win.KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
  const kept = store.model.camera.yaw === yaw;
  sel.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const cleared = !store.selection;
  store.update((m) => ({ ...m, props: m.props.filter((p) => p.id !== 'kbdlist') }));
  if (!kept) return 'la liste a perdu sa touche ]';
  return cleared || 'Échap ignoré sur une liste';
});

/* ---------------- B5: the camera is not history ---------------- */

check('tourner la vue après « Annuler » laisse « Rétablir » actif', () => {
  const s = new Store(defaultModel());
  s.update((m) => ({ ...m, name: 'retouché' }));
  s.undo();
  if (!s.canRedo) return 'rien à rétablir après annuler';
  s.setCamera({ yaw: 123 });
  s.setCamera((c) => ({ pitch: c.pitch + 5, roll: 4 }));
  s.setCamera({ projection: 'dimetric' });
  if (!s.canRedo) return 'la caméra a vidé la pile de rétablissement';
  s.redo();
  if (s.model.name !== 'retouché') return 'rétablir n’a pas rétabli';
  if (s.model.camera.yaw !== 123 || s.model.camera.projection !== 'dimetric') return 'rétablir a ramené l’ancienne caméra';
  s.undo();
  return s.model.camera.yaw === 123 || 'annuler a ramené l’ancienne caméra';
});

check('aucun geste de caméra ne crée d’entrée d’historique', () => {
  const { s, div, vp } = stageViewport();
  vp.nudge(15, 6);
  vp.nudge(-30, 0);
  const r = div.getBoundingClientRect();
  const at = (dx, type, extra = {}) => div.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + 200 + dx, clientY: r.top + 200, bubbles: true, pointerId: 12, button: 0, ...extra,
  }));
  at(0, 'pointerdown', { altKey: true }); at(50, 'pointermove', { altKey: true }); at(50, 'pointerup');
  at(0, 'pointerdown'); at(80, 'pointermove'); at(80, 'pointerup');
  div.remove();
  return !s.canUndo || `${s.past.length} entrée(s)`;
});

await checkAsync('les réglages de la section Vue et les boutons de rotation restent hors de l’historique', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  const store = await appStore();
  const depth = store.past.length;
  doc.getElementById('btn-rot-right').click();
  doc.getElementById('btn-rot-left').click();
  await frames(win);
  const view = doc.querySelector('#inspector details[data-section="Vue"]');
  if (!view) return 'section Vue introuvable';
  view.open = true;
  for (const input of view.querySelectorAll('input[type="range"]')) {
    input.value = input.max;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    await frames(win);
  }
  const proj = view.querySelector('select');
  proj.value = proj.options[proj.options.length - 1].value;
  proj.dispatchEvent(new win.Event('change', { bubbles: true }));
  await frames(win);
  [...doc.querySelectorAll('#inspector details[data-section="Vue"] button')]
    .find((b) => /isométrique/.test(b.textContent))?.click();
  await frames(win);
  return store.past.length === depth || `${store.past.length - depth} entrée(s) ajoutée(s)`;
});

check('après annuler, la modification suivante ne fusionne pas avec une entrée antérieure', () => {
  const s = new Store(defaultModel());
  s.update((m) => ({ ...m, name: 'a' }), { coalesce: 'name' });
  s.update((m) => ({ ...m, theme: 'slate' }));
  s.undo(); // back to name 'a', the 'name' entry on top
  s.update((m) => ({ ...m, name: 'ab' }), { coalesce: 'name' });
  s.undo();
  return s.model.name === 'a' || `annuler ramène « ${s.model.name} »`;
});

/* ---------------- B4: share links ---------------- */

const hashOf = (model) => toShareUrl(model).slice(toShareUrl(model).indexOf('#'));

check('un lien ouvert au démarrage garde le projet local pour l’annulation', () => {
  const local = normalise({ ...defaultModel(), name: 'Projet local' });
  saveLocal(local);
  const shared = normalise({ ...defaultModel(), name: 'Projet partagé' });
  const before = location.href;
  history.replaceState(null, '', hashOf(shared));
  let boot;
  try {
    boot = initialModel();
  } finally {
    clearLocal();
    history.replaceState(null, '', before.replace(/#.*$/, ''));
  }
  if (boot.source !== 'link' || boot.model.name !== 'Projet partagé') return `source ${boot.source}`;
  return boot.previous?.name === 'Projet local' || 'projet local perdu';
});

await checkAsync('un lien collé dans l’appli ouverte se charge, quitte l’adresse et s’annule', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  const store = await appStore();
  const mine = store.model.name;
  const shared = normalise({ ...defaultModel(), name: 'Maison du lien' });
  const changed = new Promise((r) => win.addEventListener('hashchange', () => setTimeout(r, 0), { once: true }));
  win.location.hash = hashOf(shared).slice(1);
  await changed;
  if (store.model.name !== 'Maison du lien') return `projet ouvert : ${store.model.name}`;
  if (win.location.hash) return `le lien reste dans l’adresse : ${win.location.hash.slice(0, 20)}…`;
  if (!/Annuler/.test(frame.contentDocument.getElementById('toast').textContent)) return 'aucun message';
  frame.contentDocument.getElementById('btn-undo').click();
  return store.model.name === mine || `annuler ramène « ${store.model.name} »`;
});

/* ---------------- B6: every control does something ---------------- */

/** A plain house to hang items on, in a palette whose materials all differ. */
export function fixtureHouse() {
  return normalise({
    ...emptyModel(),
    theme: 'terracotta',
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)], storeys: 2, storeyHeight: 2.7 })],
    texture: { roof: 'none', wall: 'none' },
  });
}

/** A wall the default camera sees, with room on either side. */
export const FIXTURE_EDGE = '4,6,N';

export const FIXTURE_ITEMS = {
  opening: ['window', 'shutter', 'door', 'garage'].map((kind) => ({
    kind, edge: FIXTURE_EDGE, storey: 0, offset: 0.5, ...OPENING_DEFAULTS[kind],
  })),
  roofItem: ['solar', 'chimney', 'velux', 'dish'].map((kind) => ({
    kind, x: 5, y: 2, ...ROOF_ITEM_DEFAULTS[kind],
  })),
  prop: Object.keys(PROP_DEFAULTS).map((kind) => ({
    kind, x: kind === 'stairs' ? 3 : 2, y: -8, ...PROP_DEFAULTS[kind],
  })),
  fixture: Object.keys(FIXTURE_DEFAULTS).map((kind) => ({
    kind, edge: FIXTURE_EDGE, storey: 0, offset: 0.5, z: FIXTURE_DEFAULTS[kind].z,
  })),
};

const LIST = { opening: 'openings', roofItem: 'roofItems', prop: 'props', fixture: 'fixtures' };

/** The model with one item added and selected, in a store, with its inspector. */
export function staged(type, item) {
  const id = `fx${type[0]}${item.kind}`;
  const m = fixtureHouse();
  const s = new Store({ ...m, [LIST[type]]: [{ ...item, id }] });
  s.setTool('select');
  s.select({ type, id });
  const root = document.createElement('div');
  document.getElementById('stage').appendChild(root);
  const ins = new Inspector(root, s);
  ins.render();
  return { s, root, ins };
}

/** Each control of the selection block, as [label, element]. */
const selectionControls = (root) => [...root.querySelectorAll('.panel-selected .field')]
  .map((f) => [f.querySelector('.field-label')?.textContent, f.querySelector('input, select')])
  .filter(([, el]) => el);

const picture = (m) => stripIds(renderScene(m, { width: 500, height: 360 }).svg);

for (const type of Object.keys(FIXTURE_ITEMS)) {
  for (const item of FIXTURE_ITEMS[type]) {
    check(`chaque réglage de l’inspecteur change le rendu : ${type} ${item.kind}`, () => {
      const probe = staged(type, item);
      const labels = selectionControls(probe.root).map(([l]) => l);
      probe.root.remove();
      const dead = [];
      labels.forEach((label, i) => {
        const { s, root } = staged(type, item);
        const before = picture(s.model);
        const [, el] = selectionControls(root)[i];
        const tries = [];
        if (el.tagName === 'SELECT') {
          for (const o of el.options) if (o.value !== el.value) tries.push(o.value);
        } else if (el.type === 'range') {
          tries.push(Number(el.value) === Number(el.max) ? el.min : el.max);
        } else if (el.type === 'number') {
          tries.push(String(Math.min(Number(el.max), Number(el.value) + 1)));
        } else if (el.type === 'checkbox') {
          tries.push(!el.checked);
        }
        const start = s.model;
        for (const v of tries) {
          s.update(start);
          const ctl = selectionControls(root)[i][1];
          if (ctl.type === 'checkbox') ctl.checked = v; else ctl.value = v;
          ctl.dispatchEvent(new Event(ctl.type === 'range' ? 'input' : 'change', { bubbles: true }));
          if (picture(s.model) === before) dead.push(`${label} = ${v}`);
        }
        root.remove();
      });
      return !dead.length || `sans effet : ${dead.join(', ')}`;
    });
  }
}

/* ---------------- B7 / D2: a cell belongs to one body ---------------- */

function twoBodies() {
  const s = new Store(normalise({
    ...emptyModel(),
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(10, 10, 14, 14)] }),
      makeBuilding({ id: 'abri', name: 'Abri', cells: [...rectCells(20, 10, 21, 11)] }),
    ],
  }));
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  return { s, view };
}

const owners = (m) => {
  const seen = new Map();
  for (const b of m.buildings) for (const c of b.cells) seen.set(c, (seen.get(c) || 0) + 1);
  return [...seen.values()].filter((n) => n > 1).length;
};

check('le pinceau et le rectangle ne prennent pas les cases d’un autre corps', () => {
  const { s, view } = twoBodies();
  s.setActiveBuilding('abri');
  s.setTool('paint');
  view.svg.dispatchEvent(pointer(view, 12.5, 12.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 13.5, 12.5, 'pointermove'));
  view.svg.dispatchEvent(pointer(view, 13.5, 12.5, 'pointerup'));
  s.setTool('rect');
  view.svg.dispatchEvent(pointer(view, 8.5, 8.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 22.5, 12.5, 'pointermove'));
  view.svg.dispatchEvent(pointer(view, 22.5, 12.5, 'pointerup'));
  view.svg.remove();
  const shared = owners(s.model);
  if (shared) return `${shared} case(s) à deux corps`;
  const house = s.model.buildings[0].cells.length;
  return house === 25 || `la maison a ${house} cases`;
});

check('la gomme retire la case du corps qui la possède', () => {
  const { s, view } = twoBodies();
  s.setActiveBuilding('abri');
  s.setTool('erase');
  view.svg.dispatchEvent(pointer(view, 12.5, 12.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 12.5, 12.5, 'pointerup'));
  view.svg.remove();
  return !s.model.buildings[0].cells.includes('12,12') || 'la case de la maison est restée';
});

check('un fichier où deux corps se disputent une case la laisse au premier', () => {
  const m = normalise({
    buildings: [
      { id: 'a', cells: ['0,0', '1,0'] },
      { id: 'b', cells: ['1,0', '2,0'] },
    ],
  });
  return (m.buildings[0].cells.join() === '0,0,1,0' && m.buildings[1].cells.join() === '2,0')
    || JSON.stringify(m.buildings.map((b) => b.cells));
});

/* ---------------- D10: the fence stands where it is drawn ---------------- */

check('la clôture est dessinée au milieu de son emprise, comme dans le plan', () => {
  const fence = (p) => buildMesh(normalise({ ...emptyModel(), props: [{ id: 'f', kind: 'fence', ...p }] }))
    .mesh.tris.filter((t) => t.mat === 'fence');
  const mid = (tris, k) => {
    let lo = Infinity, hi = -Infinity;
    for (const t of tris) for (const v of [t.a, t.b, t.c]) { lo = Math.min(lo, v[k]); hi = Math.max(hi, v[k]); }
    return (lo + hi) / 2;
  };
  const h = mid(fence({ x: 0, y: 4, w: 6, d: 0.6 }), 1);
  const v = mid(fence({ x: 2, y: 0, w: 0.6, d: 6 }), 0);
  if (Math.abs(h - 4.3) > 1e-6) return `clôture est-ouest centrée sur y = ${h}`;
  return Math.abs(v - 2.3) < 1e-6 || `clôture nord-sud centrée sur x = ${v}`;
});

/* ---------------- B8 / D4 / D5: openings stay on their wall ---------------- */

/** A 10 m north wall from x = 0 to 10, its edges `i,6,N`; the run is the whole wall. */
function wallStore(openings = []) {
  const m = fixtureHouse();
  const s = new Store({ ...m, openings });
  s.setTool('select');
  return s;
}

/** Ends of an opening along its run, measured from the run's start. */
function onRun(m, op) {
  const run = openingRun(m, op);
  const c = op.offset - run.lo;
  return { a: c - op.width / 2, b: c + op.width / 2, len: run.hi - run.lo };
}
const whole = (m, op) => {
  const r = onRun(m, op);
  return r.a >= -1e-6 && r.b <= r.len + 1e-6;
};

check('une ouverture posée près d’un angle reste entière sur son mur', () => {
  const s = wallStore();
  placeOpening(s, 'garage', '0,6,N', 0, 0.9); // last cell of the wall, seen from its own edge
  const op = s.model.openings[0];
  return whole(s.model, op) || `déborde : ${JSON.stringify(onRun(s.model, op))}`;
});

check('glisser une ouverture dans le plan la garde entière sur son mur', () => {
  const s = wallStore([{ id: 'o1', kind: 'window', edge: '5,6,N', storey: 0, offset: 0.5, ...OPENING_DEFAULTS.window }]);
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  const target = view.svg.querySelector('[data-id="o1"]');
  const r = view.svg.getBoundingClientRect();
  const [px, py] = view.toPx(5, 7);
  const [qx] = view.toPx(-0.2, 7);
  target.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + px, clientY: r.top + py, bubbles: true, pointerId: 1, button: 0 }));
  view.svg.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + qx, clientY: r.top + py, bubbles: true, pointerId: 1, button: 0 }));
  view.svg.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + qx, clientY: r.top + py, bubbles: true, pointerId: 1, button: 0 }));
  view.svg.remove();
  const op = s.model.openings[0];
  return whole(s.model, op) || `déborde : ${JSON.stringify(onRun(s.model, op))}`;
});

check('élargir une ouverture la garde sur son mur, centrée s’il est trop court', () => {
  const s = wallStore([{ id: 'o1', kind: 'window', edge: '9,6,N', storey: 0, offset: 0.5, ...OPENING_DEFAULTS.window }]);
  s.select({ type: 'opening', id: 'o1' });
  const root = document.createElement('div');
  document.getElementById('stage').appendChild(root);
  new Inspector(root, s).render();
  const width = [...root.querySelectorAll('.panel-selected .field')]
    .find((f) => f.querySelector('.field-label').textContent === 'Largeur').querySelector('input');
  width.value = '4';
  width.dispatchEvent(new Event('input', { bubbles: true }));
  root.remove();
  const op = s.model.openings[0];
  if (!whole(s.model, op)) return `déborde : ${JSON.stringify(onRun(s.model, op))}`;
  // A wall shorter than the opening: centred on it.
  const short = normalise({ ...emptyModel(), buildings: [makeBuilding({ cells: ['0,0', '1,0'] })] });
  const c = fitOpening(short, { kind: 'garage', edge: '0,0,N', offset: 0, width: 3, height: 2, sill: 0 });
  return near(onRun(short, c).a + onRun(short, c).b, 2) || `non centrée : ${JSON.stringify(onRun(short, c))}`;
});

check('la copie d’une ouverture reste entière sur son mur', () => {
  const s = wallStore([{ id: 'o1', kind: 'garage', edge: '1,6,N', storey: 0, offset: 0.5, ...OPENING_DEFAULTS.garage }]);
  s.select({ type: 'opening', id: 'o1' });
  s.duplicateSelected();
  return s.model.openings.every((op) => whole(s.model, op)) || 'la copie déborde';
});

check('hauteur et allège ne dépassent pas la hauteur du niveau', () => {
  const s = wallStore([{ id: 'o1', kind: 'window', edge: '5,6,N', storey: 0, offset: 0.5, ...OPENING_DEFAULTS.window }]);
  s.select({ type: 'opening', id: 'o1' });
  const root = document.createElement('div');
  document.getElementById('stage').appendChild(root);
  const ins = new Inspector(root, s);
  const set = (label) => {
    ins.render();
    const el = [...root.querySelectorAll('.panel-selected .field')]
      .find((f) => f.querySelector('.field-label').textContent === label).querySelector('input');
    el.value = el.max;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('Hauteur');
  set('Allège');
  set('Hauteur');
  root.remove();
  const op = s.model.openings[0];
  return op.height + op.sill <= 2.7 + 1e-6 || `hauteur ${op.height} + allège ${op.sill} > 2,70`;
});

check('une menuiserie trop haute n’est jamais dessinée au-dessus de son niveau', () => {
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)], storeyHeight: 2.6 })],
    openings: [{ id: 'o1', kind: 'window', edge: '2,4,N', offset: 0.5, width: 1.2, height: 3, sill: 0.95 }],
  });
  const tris = buildMesh(m).mesh.tris.filter((t) => ['trim', 'glass'].includes(t.mat));
  const top = Math.max(...tris.flatMap((t) => [t.a[2], t.b[2], t.c[2]]));
  if (top > 2.6 + 1e-6) return `menuiserie jusqu’à ${top.toFixed(2)} m`;
  // And the pick target and the selection outline agree with it.
  const span = openingSpan(m.openings[0], m.buildings[0]);
  return span.z1 <= 2.6 + 1e-6 || `contour jusqu’à ${span.z1}`;
});

check('l’inspecteur signale deux ouvertures qui se chevauchent', () => {
  const s = wallStore([
    { id: 'o1', kind: 'window', edge: '5,6,N', storey: 0, offset: 0.5, ...OPENING_DEFAULTS.window },
    { id: 'o2', kind: 'door', edge: '4,6,N', storey: 0, offset: 0.2, ...OPENING_DEFAULTS.door },
    { id: 'o3', kind: 'window', edge: '5,6,N', storey: 1, offset: 0.5, ...OPENING_DEFAULTS.window },
  ]);
  if (overlappingOpenings(s.model, s.model.openings[2]).length) return 'un autre étage compte comme chevauchement';
  s.select({ type: 'opening', id: 'o1' });
  const root = document.createElement('div');
  document.getElementById('stage').appendChild(root);
  new Inspector(root, s).render();
  const text = root.querySelector('.panel-selected').textContent;
  root.remove();
  return /chevauche/.test(text) || 'aucun avertissement';
});

check('une ouverture qui dépassait déjà s’ouvre où elle était', () => {
  const raw = {
    ...fixtureHouse(),
    openings: [{ id: 'o1', kind: 'window', edge: '0,6,N', offset: 1.4, width: 1.3, height: 1.3, sill: 0.95 }],
  };
  return normalise(raw).openings[0].offset === 1.4 || 'le fichier a été réécrit';
});

check('changer le type d’une ouverture reprend l’allège et la hauteur du nouveau type, sauf réglage manuel', () => {
  const s = wallStore([
    { id: 'o1', kind: 'window', edge: '5,6,N', storey: 0, offset: 0.5, ...OPENING_DEFAULTS.window },
    { id: 'o2', kind: 'window', edge: '2,6,N', storey: 0, offset: 0.5, ...OPENING_DEFAULTS.window, sill: 0.6 },
  ]);
  const retype = (id) => {
    s.select({ type: 'opening', id });
    const root = document.createElement('div');
    document.getElementById('stage').appendChild(root);
    new Inspector(root, s).render();
    const sel = root.querySelector('.panel-selected select');
    sel.value = 'door';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    root.remove();
    return s.model.openings.find((o) => o.id === id);
  };
  const a = retype('o1');
  if (a.sill !== 0 || a.height !== OPENING_DEFAULTS.door.height) return `porte à ${a.sill} m, haute de ${a.height} m`;
  const b = retype('o2');
  return b.sill === 0.6 || `allège réglée à la main perdue : ${b.sill}`;
});

/* ---------------- B9: framing keeps the mesh cache ---------------- */

check('sous cadrage, deux modèles ne différant que par la caméra donnent les mêmes listes', () => {
  const m = normalise({ ...defaultModel(), focus: { enabled: true, x: 0, y: 0, w: 6, d: 6, margin: 1 } });
  const turned = { ...m, camera: { ...m.camera, yaw: 77 } };
  const a = focusModel(m), b = focusModel(turned);
  const same = ['buildings', 'props', 'openings', 'roofItems'].every((k) => a[k] === b[k]);
  if (!same) return 'listes reconstruites pour un simple changement de caméra';
  return b.camera.yaw === 77 || 'la caméra du second modèle est perdue';
});

check('sous cadrage, pivoter ne reconstruit pas le maillage du rendu', () => {
  const { s, div, vp } = stageViewport();
  s.update((m) => ({ ...m, focus: { enabled: true, x: 0, y: 0, w: 6, d: 6, margin: 1 } }));
  vp.render();
  const built = vp.cache.built;
  for (const yaw of [20, 40, 60]) {
    s.setCamera({ yaw });
    vp.render();
  }
  div.remove();
  return vp.cache.built === built || 'maillage reconstruit à chaque image';
});

/* ---------------- D: consistency ---------------- */

check('supprimer un corps supprime aussi ses objets de toit', () => {
  const s = new Store(normalise({
    ...emptyModel(),
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(0, 0, 7, 5)] }),
      makeBuilding({ id: 'abri', cells: [...rectCells(12, 0, 15, 3)] }),
    ],
    roofItems: [
      { id: 'r1', kind: 'chimney', x: 3, y: 3, ...ROOF_ITEM_DEFAULTS.chimney },
      { id: 'r2', kind: 'solar', x: 14, y: 2, ...ROOF_ITEM_DEFAULTS.solar },
    ],
  }));
  s.removeBuilding('abri');
  const ids = s.model.roofItems.map((r) => r.id).join();
  return ids === 'r1' || `objets restants : ${ids}`;
});

check('un clic sans glisser avec Haie, Clôture ou Muret ne pose rien', () => {
  const s = new Store(emptyModel());
  const view = new PlanView(document.getElementById('plan'), s);
  view.render();
  for (const tool of ['hedge', 'fence', 'muret']) {
    s.setTool(tool);
    view.svg.dispatchEvent(pointer(view, 20.4, 20.4, 'pointerdown'));
    view.svg.dispatchEvent(pointer(view, 20.4, 20.4, 'pointerup'));
  }
  view.svg.remove();
  return !s.model.props.length || `${s.model.props.length} tronçon(s) posé(s)`;
});

check('la copie d’un objet de toit reste sur le toit quand c’est possible', () => {
  const s = new Store(normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ id: 'maison', cells: [...rectCells(0, 0, 7, 5)] })],
    roofItems: [{ id: 'r1', kind: 'velux', x: 7, y: 3, ...ROOF_ITEM_DEFAULTS.velux }],
  }));
  s.select({ type: 'roofItem', id: 'r1' });
  s.duplicateSelected();
  const copy = s.model.roofItems[1];
  const cell = `${Math.floor(copy.x)},${Math.floor(copy.y)}`;
  return s.model.buildings[0].cells.includes(cell) || `copie posée en ${copy.x}, ${copy.y}, hors du toit`;
});

await checkAsync('la sauvegarde automatique s’écrit sans délai quand la page se masque', async () => {
  clearLocal();
  const s = new Store(normalise({ ...defaultModel(), name: 'à garder' }));
  s.update((m) => ({ ...m, name: 'dernière retouche' }));
  s.flush();
  const saved = JSON.parse(localStorage.getItem('isometric-house-builder/current') || 'null');
  clearLocal();
  return saved?.name === 'dernière retouche' || `enregistré : ${saved?.name}`;
});

await checkAsync('l’application écrit sa sauvegarde en attente quand elle se masque', async () => {
  const frame = await app();
  const store = await appStore();
  const win = frame.contentWindow;
  store.update((m) => ({ ...m, name: 'fermeture imminente' }));
  win.dispatchEvent(new win.Event('pagehide'));
  const saved = JSON.parse(win.localStorage.getItem('isometric-house-builder/current') || 'null');
  store.undo();
  return saved?.name === 'fermeture imminente' || `enregistré : ${saved?.name}`;
});

check('un identifiant neuf n’est jamais celui d’un élément du projet', () => {
  const m = defaultModel();
  const ids = new Set();
  for (let i = 0; i < 2000; i++) ids.add(newId('p', m));
  if (ids.size !== 2000) return 'identifiants répétés';
  for (const id of ids) if (idsOf(m).has(id)) return `${id} existe déjà`;
  // And a reload does not restart a sequence: two "sessions" draw apart.
  return newId('p') !== newId('p') || 'deux tirages identiques';
});

await checkAsync('un export SVG impossible le dit dans la fenêtre d’export', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const orig = win.URL.createObjectURL;
  win.URL.createObjectURL = () => { throw new Error('refus d’essai'); };
  const errors = [];
  const onError = (e) => { errors.push(e.message); e.preventDefault(); };
  win.addEventListener('error', onError);
  try {
    doc.getElementById('btn-svg').click();
  } finally {
    win.URL.createObjectURL = orig;
    win.removeEventListener('error', onError);
  }
  const text = doc.getElementById('export-status').textContent;
  if (errors.length) return `exception : ${errors.join(' ; ')}`;
  return /Échec.*refus d’essai/.test(text) || `statut : « ${text} »`;
});
