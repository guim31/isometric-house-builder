/** Page réelle. */

import { checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { defaultModel } from '../src/core/model.js';
import { Store } from '../src/ui/store.js';
import { svgToPng } from '../src/io/export.js';

await checkAsync('la page tient dans la fenêtre, sans déborder', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  const view = doc.documentElement.clientHeight;
  const scroll = doc.body.scrollHeight;
  if (scroll > view + 2) return `contenu ${scroll}px pour une fenêtre de ${view}px`;
  // Both drawing panels must fit inside the viewport, not merely exist.
  for (const id of ['plan', 'iso']) {
    const r = doc.getElementById(id).getBoundingClientRect();
    if (r.height > view) return `le panneau « ${id} » fait ${Math.round(r.height)}px`;
    if (r.height < 120) return `le panneau « ${id} » est écrasé (${Math.round(r.height)}px)`;
  }
  return true;
});

await checkAsync('la galerie d’accueil s’ouvre à la première visite', async () => {
  // The boot sequence opens it, so this also catches a throw on the way there.
  const frame = await app();
  const dialog = frame.contentDocument.getElementById('gallery-dialog');
  if (!dialog) return 'dialogue absent de la page';
  return dialog.open || 'la galerie ne s’est pas ouverte';
});

/*
 * The guide, in each of its languages: the English one is a page of its own,
 * and each links to the other.
 */
for (const [page, other] of [['guide.html', 'guide.en.html'], ['guide.en.html', 'guide.html']]) {
await checkAsync(`le guide se charge, et l’application y renvoie (${page})`, async () => {
  // Meant to be handed to people who have never seen the tool, so a dead link
  // or a missing illustration is not a detail.
  const frame = await app();
  // The application links to the guide of its language: switched for the
  // English page, and back.
  const pick = frame.contentDocument.getElementById('lang-select');
  pick.value = page === 'guide.html' ? 'fr' : 'en';
  pick.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
  const link = frame.contentDocument.querySelector(`a.app-link[href="${page}"]`);
  pick.value = 'fr';
  pick.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
  if (!link) return 'aucun lien vers le guide dans l’application';

  const doc = await new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'width:900px;height:600px;position:absolute;left:-9999px';
    f.onload = () => resolve(f.contentDocument);
    f.onerror = () => reject(new Error('guide illisible'));
    f.src = `../${page}`;
    document.getElementById('stage').appendChild(f);
  });
  if (!doc.querySelector(`header a[href="${other}"]`)) return `pas de lien vers ${other}`;
  const sections = doc.querySelectorAll('main h2[id]').length;
  if (sections < 8) return `${sections} sections dans le guide`;
  // Every entry in the table of contents must land somewhere.
  for (const a of doc.querySelectorAll('.toc a')) {
    const id = a.getAttribute('href').slice(1);
    if (!doc.getElementById(id)) return `le sommaire renvoie à « ${id} », qui n’existe pas`;
  }
  // And every illustration must exist: they are all repository assets.
  const shots = [...doc.querySelectorAll('main img')];
  if (shots.length < 3) return `${shots.length} illustration(s)`;
  for (const img of shots) {
    const ok = await new Promise((res) => {
      const probe = new Image();
      probe.onload = () => res(true);
      probe.onerror = () => res(false);
      probe.src = img.getAttribute('src').replace(/^assets\//, '../assets/');
    });
    if (!ok) return `illustration manquante : ${img.getAttribute('src')}`;
  }
  return true;
});
}

await checkAsync('la page s’amorce avec ses outils et un rendu visible', async () => {
  const frame = await app();
  const doc = frame.contentDocument;
  if (doc.querySelectorAll('.tool').length < 10) return 'palette d’outils incomplète';
  // Twenty-three tools in one column ran off the bottom of the panel; the
  // families fold, and enough of them start folded for the column to fit.
  // Every gesture the mouse can make has a button on the drawing.
  const nav = doc.getElementById('view-nav');
  const navBtns = nav ? nav.querySelectorAll('button').length : 0;
  if (navBtns < 8) return `pavé de navigation incomplet (${navBtns} boutons)`;
  const padBox = nav.getBoundingClientRect();
  const bodyBox = nav.parentElement.getBoundingClientRect();
  if (padBox.bottom > bodyBox.bottom + 1 || padBox.right > bodyBox.right + 1) {
    return 'le pavé de navigation déborde du rendu';
  }
  // The arrows do what the mode says they do.
  const arrow = nav.querySelector('.nav-pad [data-dir="up"]');
  const orbitTitle = arrow.title;
  nav.querySelector('.nav-modes button[data-mode="pan"]').click();
  if (arrow.title === orbitTitle) return 'les flèches ne suivent pas le mode';
  nav.querySelector('.nav-modes button[data-mode="orbit"]').click();
  const groups = [...doc.querySelectorAll('.tool-group')];
  if (groups.length < 4) return `${groups.length} familles d’outils repliables`;
  if (!groups.some((g) => g.classList.contains('folded'))) return 'aucune famille repliée au démarrage';
  const tools = doc.getElementById('tools');
  if (tools.scrollHeight > tools.clientHeight + 2) {
    return `la palette déborde de ${tools.scrollHeight - tools.clientHeight} px`;
  }
  const svg = doc.querySelector('#iso svg');
  if (svg.querySelectorAll('path').length < 20) return 'rendu isométrique vide';
  // The drawing must land inside the panel, not somewhere off-screen below it.
  const panel = doc.getElementById('iso').getBoundingClientRect();
  const box = svg.getBBox();
  return (box.y + box.height <= panel.height + 2 && box.height > 40)
    || `dessin en dehors du panneau : y=${Math.round(box.y)} h=${Math.round(box.height)} pour ${Math.round(panel.height)}px`;
});

await checkAsync('une sauvegarde locale impossible est signalée, une fois', async () => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('quota'); };
  let told = 0;
  try {
    const s = new Store(defaultModel());
    s.onSaveError = () => { told++; };
    s.update((m) => ({ ...m, name: 'a' }));
    await new Promise((r) => setTimeout(r, 450));
    s.update((m) => ({ ...m, name: 'b' }));
    await new Promise((r) => setTimeout(r, 450));
  } finally {
    Storage.prototype.setItem = orig;
  }
  return told === 1 || `signalée ${told} fois`;
});

await checkAsync('un export PNG impossible échoue au lieu de rester en suspens', async () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = () => null;
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
    const outcome = await Promise.race([
      svgToPng(svg, 10, 10).then(() => 'résolu', (e) => `rejeté : ${e.message}`),
      new Promise((r) => setTimeout(() => r('en suspens'), 3000)),
    ]);
    return outcome.startsWith('rejeté') || outcome;
  } finally {
    HTMLCanvasElement.prototype.getContext = orig;
  }
});
