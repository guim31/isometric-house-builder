/**
 * La garde de démarrage d'index.html, devant une mise en ligne rejouée par le
 * lanceur (dev/run-tests.mjs, sous /__boot/) : un roof.js d'avant la version,
 * gardé en cache, qui n'a pas l'export dont main.js a besoin.
 *
 * Servie par un simple serveur statique, la suite n'a pas cette reprise : ces
 * tests se disent alors sautés, sans échouer.
 */

import { checkAsync } from './harness.js';
import { normalise, emptyModel } from '../src/core/model.js';

const STORAGE_KEY = 'isometric-house-builder/current';
const RETRY_KEY = 'ihb-boot-retry';
const PREFS_KEY = 'isometric-house-builder/ui';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const available = await fetch('/__boot-log/probe', { cache: 'no-store' })
  .then((r) => r.ok && /json/.test(r.headers.get('content-type') || ''), () => false);

let n = 0;

/**
 * Load the page of one scenario in a frame at the top of the bench, and wait
 * for it to settle: the interface up, or the guard's message. Reloads happen
 * inside the frame, which stays the same element.
 */
async function play(scenario, { deadline = 15000 } = {}) {
  const run = `${scenario}-${Date.now().toString(36)}${n++}`;
  const holder = document.createElement('div');
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:900px;height:600px;border:0';
  holder.appendChild(frame);
  document.body.insertBefore(holder, document.body.firstChild);
  frame.src = `/__boot/${run}/index.html`;
  const started = Date.now();
  let state = 'timeout';
  while (Date.now() - started < deadline) {
    await sleep(100);
    const win = frame.contentWindow, doc = frame.contentDocument;
    if (!doc || doc.readyState === 'loading') continue;
    // Ready as the guard knows it, not as it looks: a page that draws
    // but never says so is one the guard must still act on.
    if (doc.documentElement.dataset.boot === 'ready' && win.__app && doc.querySelector('#iso svg')) { state = 'ready'; break; }
    if (doc.querySelector('.boot-failure')) { state = 'message'; break; }
  }
  // A moment for a reload that would follow — there must be none.
  await sleep(600);
  const log = await fetch(`/__boot-log/${run}`, { cache: 'no-store' }).then((r) => r.json());
  const doc = frame.contentDocument;
  const out = {
    state,
    log,
    loads: log['index.html']?.count || 0,
    name: frame.contentWindow?.__app?.store.model.name,
    message: doc?.querySelector('.boot-failure'),
    retry: sessionStorage.getItem(RETRY_KEY),
    done: () => holder.remove(),
  };
  return out;
}

/** A saved project to watch: the guard must leave it byte for byte. */
function withProject(fn) {
  return async () => {
    if (!available) return true;
    const before = localStorage.getItem(STORAGE_KEY);
    // Already in its normalised form: the app writes back what it opened
    // at its first change, the guard nothing at all.
    const mine = JSON.stringify(normalise({ ...emptyModel(), name: 'Projet témoin', cells: ['0,0', '1,0', '0,1', '1,1'] }));
    localStorage.setItem(STORAGE_KEY, mine);
    sessionStorage.removeItem(RETRY_KEY);
    try {
      return await fn(mine);
    } finally {
      sessionStorage.removeItem(RETRY_KEY);
      if (before === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, before);
    }
  };
}

await checkAsync(`démarrage sain : la garde ne recharge rien et ne refait aucune requête${available ? '' : ' (sauté : lancez dev/run-tests.mjs)'}`, withProject(async (mine) => {
  const r = await play('ok');
  r.done();
  if (r.state !== 'ready') return `état : ${r.state}`;
  if (r.loads !== 1) return `${r.loads} chargements de la page`;
  const twice = Object.entries(r.log).filter(([, e]) => e.count !== 1 || e.bypass);
  if (twice.length) return `redemandés : ${twice.map(([k]) => k).join(', ')}`;
  if (r.retry !== null) return 'une marque de reprise est restée';
  return localStorage.getItem(STORAGE_KEY) === mine || 'le projet enregistré a changé';
}));

await checkAsync(`un module périmé juste après une mise en ligne : la garde recharge le graphe sans cache, relance une fois, et l’application démarre${available ? '' : ' (sauté)'}`, withProject(async (mine) => {
  const r = await play('deploy');
  r.done();
  if (r.state !== 'ready') return `état : ${r.state}${r.message ? ' (message affiché)' : ''}`;
  if (r.loads !== 2) return `${r.loads} chargements de la page au lieu de deux`;
  const roof = r.log['src/core/roof.js'];
  // Once stale from the cache's point of view, once past it by the guard;
  // the relaunch then finds the fresh copy in the cache.
  if (roof?.count !== 2 || roof.bypass !== 1) return `roof.js : ${JSON.stringify(roof)}`;
  const modules = Object.keys(r.log).filter((k) => k.startsWith('src/'));
  const skipped = modules.filter((k) => !r.log[k].bypass);
  if (skipped.length) return `non rechargés par la garde : ${skipped.join(', ')}`;
  if (!r.log['styles.css']?.bypass) return 'la feuille de style n’a pas été rechargée';
  if (r.name !== 'Projet témoin') return `projet ouvert : ${r.name}`;
  if (r.retry !== null) return 'la marque de reprise est restée après le succès';
  return localStorage.getItem(STORAGE_KEY) === mine || 'le projet enregistré a changé';
}));

/*
 * The guard speaks the language the app would have spoken — the one chosen,
 * read from the interface's settings, else the browser's — with no module to
 * ask: the dictionaries are among what failed to load.
 */
const GUARD_WORDS = {
  fr: { title: /n’a pas pu démarrer/, body: /projet enregistré/, button: 'Recharger la page' },
  en: { title: /could not start/, body: /project saved/, button: 'Reload the page' },
};

for (const lang of ['fr', 'en']) {
  await checkAsync(`un module qui reste périmé : une seule relance, puis un message clair qui propose de recharger (${lang})${available ? '' : ' (sauté)'}`, withProject(async (mine) => {
    const prefs = localStorage.getItem(PREFS_KEY);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ lang }));
    const r = await play('stuck');
    if (prefs === null) localStorage.removeItem(PREFS_KEY); else localStorage.setItem(PREFS_KEY, prefs);
    const out = [];
    if (r.state !== 'message') out.push(`état : ${r.state}`);
    if (r.loads !== 2) out.push(`${r.loads} chargements de la page au lieu de deux`);
    const box = r.message;
    const want = GUARD_WORDS[lang];
    if (box) {
      if (box.getAttribute('role') !== 'alert') out.push('message sans rôle d’alerte');
      if (box.getAttribute('lang') !== lang) out.push(`message en « ${box.getAttribute('lang')} »`);
      if (!want.title.test(box.textContent) || !want.body.test(box.textContent)) out.push(`texte : ${box.textContent}`);
      const btn = box.querySelector('button');
      if (!btn || btn.textContent !== want.button) out.push('pas de bouton pour recharger');
      if (btn && box.ownerDocument.activeElement !== btn) out.push('le bouton n’a pas le focus');
    }
    r.done();
    if (localStorage.getItem(STORAGE_KEY) !== mine) out.push('le projet enregistré a changé');
    return !out.length || out.join(' ; ');
  }));
}

await checkAsync(`une application qui ne se dit jamais prête : la garde agit après son délai${available ? '' : ' (sauté)'}`, withProject(async () => {
  const r = await play('slow');
  r.done();
  if (r.state !== 'ready') return `état : ${r.state}`;
  if (r.loads !== 2) return `${r.loads} chargements de la page au lieu de deux`;
  return r.retry === null || 'la marque de reprise est restée';
}));
