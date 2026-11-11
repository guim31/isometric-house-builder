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

export const FILES = [
  'grid', 'mesh', 'roof', 'projection', 'dimensions', 'viewpoints', 'render',
  'textures', 'presets', 'ordering', 'buildings', 'levels', 'garden', 'stacking',
  'palette', 'model', 'store', 'plan', 'viewport', 'inspector',
  'review-fixes', 'review-consistency', 'review-rest',
  'export', 'night', 'occlusion', 'focus', 'rendu-gestes', 'moteur', 'equipements', 'page', 'app', 'rendu-app', 'reliability', 'hostile', 'smoke',
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
