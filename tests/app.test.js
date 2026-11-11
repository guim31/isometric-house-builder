/** L'application réelle, dans son cadre : ce qu'aucun test de module ne voit. */

import { checkAsync } from './harness.js';
import { app } from './app-frame.js';

/** The frame's own store, as main.js leaves it for the bench. */
const appStore = async () => (await app()).contentWindow.__app.store;

/** Let the app's own animation frame run. */
export const frames = (win, n = 2) => new Promise((resolve) => {
  const step = () => (n-- > 0 ? win.requestAnimationFrame(step) : resolve());
  // A fallback, should the frame be throttled: the result is then read late
  // rather than never.
  setTimeout(resolve, 400);
  step();
});

await checkAsync('une erreur non rattrapée s’affiche au lieu de rester muette', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  win.dispatchEvent(new win.ErrorEvent('error', { message: 'essai du filet' }));
  const toast = frame.contentDocument.getElementById('toast');
  const shown = toast.classList.contains('show') && /Une erreur est survenue.*essai du filet/.test(toast.textContent);
  toast.classList.remove('show', 'error');
  return shown || `message affiché : « ${toast.textContent} »`;
});

await checkAsync('une promesse rejetée sans suite s’affiche aussi', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  const ev = new win.Event('unhandledrejection');
  ev.reason = new Error('rejet d’essai');
  win.dispatchEvent(ev);
  const toast = frame.contentDocument.getElementById('toast');
  const shown = /rejet d’essai/.test(toast.textContent);
  toast.classList.remove('show', 'error');
  return shown || `message affiché : « ${toast.textContent} »`;
});

export { appStore };
