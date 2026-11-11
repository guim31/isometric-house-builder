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
