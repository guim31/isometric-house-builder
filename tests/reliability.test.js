/** Lot « fiabilité » : défauts reproduits à l'audit, chacun avec son test. */

import { check, checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { appStore, frames } from './app.test.js';
import { defaultModel, normalise, withTheme, makeBuilding, emptyModel } from '../src/core/model.js';
import { THEMES } from '../src/core/palette.js';
import { rectCells } from '../src/core/grid.js';

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
