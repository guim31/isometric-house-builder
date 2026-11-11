/** Lot « fiabilité » : défauts reproduits à l'audit, chacun avec son test. */

import { check, checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { appStore, frames } from './app.test.js';
import { defaultModel, normalise, withTheme, makeBuilding, emptyModel } from '../src/core/model.js';
import { THEMES } from '../src/core/palette.js';
import { rectCells } from '../src/core/grid.js';
import { Store } from '../src/ui/store.js';
import { PlanView } from '../src/ui/plan.js';
import { pointer, stageViewport } from './helpers.js';
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
