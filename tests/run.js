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
  'export', 'night', 'occlusion', 'focus', 'page', 'app', 'reliability', 'hostile',
];

for (const name of FILES) {
  try {
    await import(`./${name}.test.js`);
  } catch (e) {
    loadFailure(`${name}.test.js`, e);
  }
}
finish();
