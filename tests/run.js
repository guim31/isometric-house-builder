/**
 * Entry point of the suite: loads each test file in turn, then writes the
 * summary.
 *
 * Imported one after the other rather than statically: several files await
 * their own checks, and sequential loading keeps the order fixed — the page
 * tests at the end must run once every module test has stopped writing to the
 * shared local storage.
 */

import { finish, loadFailure } from './harness.js';
import { clearPrefs } from '../src/ui/prefs.js';
import { setLanguage } from '../src/i18n/index.js';

// Settings left by an earlier run in this browser would open other sections
// than the tests expect.
clearPrefs();
// The suite reads the interface in French, whatever the browser's language:
// the English pass is asked for where it is tested.
setLanguage('fr', { remember: false });

export const FILES = [
  'grid', 'mesh', 'roof', 'projection', 'dimensions', 'viewpoints', 'render',
  'textures', 'presets', 'ordering', 'buildings', 'levels', 'garden', 'stacking',
  'palette', 'model', 'store', 'plan', 'plan-view', 'plan-draw', 'plan-edit', 'viewport', 'inspector',
  'review-fixes', 'review-consistency', 'review-rest',
  'export', 'night', 'occlusion', 'focus', 'rendu-gestes', 'moteur', 'equipements', 'croisements',
  'page', 'app', 'rendu-app', 'reliability', 'hostile', 'smoke', 'plan-app', 'interface', 'langues', 'demarrage',
];

// `?only=roof,rendu-gestes` runs those files alone — a quick loop while
// working on one area. The whole suite still runs before every push.
const only = new URLSearchParams(location.search).get('only');
const chosen = only ? FILES.filter((f) => only.split(',').includes(f)) : FILES;

for (const name of chosen) {
  try {
    await import(`./${name}.test.js`);
  } catch (e) {
    loadFailure(`${name}.test.js`, e);
  }
}
finish();
