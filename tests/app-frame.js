/**
 * The real page, loaded in an iframe and shared by every test that needs it.
 */

import { clearLocal } from '../src/io/project.js';

/**
 * Load the real page in an iframe.
 *
 * The suite above exercises modules; this one exercises the assembled page,
 * which is where a purely-CSS regression hides. One did: the layout grew past
 * the viewport and pushed both drawings below the fold, and every module test
 * still passed.
 */
let bootError = null;

/** Longer than the store's autosave debounce, so no save can outlive the wipe. */
const AUTOSAVE_DEBOUNCE = 500;

async function loadAppOnce(width, height, deadline) {
  /*
   * The suite's own stores autosave, so the app would see a returning visitor
   * and skip the gallery. Clearing once was not enough: a store touched by an
   * earlier test has a save queued on a timer, and it lands *after* the wipe
   * and before the frame boots. The gallery test then failed for a reason
   * having nothing to do with the gallery — and it moved with the number of
   * tests before it, which is how a latent race passes for a flake.
   */
  clearLocal();
  await new Promise((r) => setTimeout(r, AUTOSAVE_DEBOUNCE));
  clearLocal();
  bootError = null;
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = `width:${width}px;height:${height}px`;
    frame.src = '../index.html';
    frame.onerror = () => reject(new Error('page non chargée'));
    // A throw during boot leaves a half-built interface that can still look
    // ready: catch it outright rather than waiting for the symptom.
    frame.addEventListener('load', () => {
      frame.contentWindow.addEventListener('error', (e) => {
        bootError = `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`;
      });
      const started = Date.now();
      const ready = () => {
        if (bootError) { reject(new Error(`erreur au démarrage : ${bootError}`)); return; }
        const doc = frame.contentDocument;
        const done = doc.querySelector('#inspector .panel') && doc.querySelector('#iso svg');
        if (done) resolve(frame);
        else if (Date.now() - started > deadline) reject(new Error('interface non prête'));
        else setTimeout(ready, 60);
      };
      ready();
    }, { once: true });
    // The frame lives at the top of the page and there is only ever one:
    // anywhere below the fold, Chrome throttles its animation frames to
    // nothing and the app inside never draws.
    document.getElementById('appframe').replaceChildren(frame);
  });
}

/**
 * Load the app, retrying once.
 *
 * Served from a cold CDN the first fetch of thirty-odd modules can be slow
 * enough to blow any reasonable deadline, and that first request is exactly
 * the one a verification run makes. A genuine fault fails both attempts, so
 * the retry buys tolerance without hiding anything.
 */
async function loadApp(width, height) {
  try {
    return await loadAppOnce(width, height, 12000);
  } catch (first) {
    if (bootError) throw first; // a real error, not slowness
    return loadAppOnce(width, height, 20000);
  }
}

// Loaded once and shared: a second frame lands lower down the page, where
// Chrome throttles animation frames and the app never draws.
let appFramePromise = null;
export const app = () => (appFramePromise ||= loadApp(1280, 800));
