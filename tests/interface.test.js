/**
 * Lot 4, l'interface : l'archive ZIP relue octet par octet, la saisie
 * numérique, la mémorisation de la mise en page, les dialogues, les
 * raccourcis, l'export, le dépôt d'un fichier, l'enregistrement en place —
 * et les restes des lots précédents réglés ici.
 */

import { check, checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { frames } from './app.test.js';
import { answerDialog } from './helpers.js';
import { fixtureHouse } from './reliability.test.js';
import { crc32, zipStore, uniqueNames, dosDateTime } from '../src/io/zip.js';
import { parseDecimal, formatDecimal, settle, digitsFor } from '../src/ui/numeric.js';
import { readPrefs, clearPrefs, PREFS_KEY, DEFAULT_PREFS } from '../src/ui/prefs.js';
import { Layout } from '../src/ui/layout.js';
import { Inspector } from '../src/ui/panels.js';
import { ask, askText } from '../src/ui/dialogs.js';
import { Store } from '../src/ui/store.js';
import { customSize, MAX_SIDE } from '../src/io/export.js';
import { normalise } from '../src/core/model.js';
import { faceAt, roofAt } from '../src/render/hit.js';
import { VERSION } from '../src/version.js';
import { VIEWPOINTS } from '../src/core/iso.js';

/* ---------------- the archive, read back byte by byte ---------------- */

/**
 * An independent reader, written from the specification rather than from
 * the writer: every field of every record, checked against what it should
 * hold. Returns the files, or throws saying what is wrong.
 */
function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const end = bytes.length - 22;
  if (v.getUint32(end, true) !== 0x06054b50) throw new Error('fin de répertoire absente');
  const count = v.getUint16(end + 10, true);
  if (v.getUint16(end + 8, true) !== count) throw new Error('nombre d’entrées incohérent');
  const cdSize = v.getUint32(end + 12, true), cdAt = v.getUint32(end + 16, true);
  if (cdAt + cdSize !== end) throw new Error('répertoire central mal placé');
  if (v.getUint16(end + 20, true) !== 0) throw new Error('commentaire inattendu');
  const files = [];
  let at = cdAt;
  for (let k = 0; k < count; k++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error(`entrée centrale ${k} illisible`);
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true);
    const crc = v.getUint32(at + 16, true), size = v.getUint32(at + 20, true), raw = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (!(flags & 0x0800)) throw new Error('noms non marqués UTF-8');
    if (method !== 0 || size !== raw) throw new Error('entrée compressée');
    if (extra || comment) throw new Error('champs en trop');
    // The local header must say the same.
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error(`en-tête local de ${name} absent`);
    const lName = v.getUint16(local + 26, true), lExtra = v.getUint16(local + 28, true);
    if (v.getUint32(local + 14, true) !== crc || v.getUint32(local + 18, true) !== size
      || v.getUint32(local + 22, true) !== size) throw new Error(`en-tête local de ${name} discordant`);
    if (dec.decode(bytes.subarray(local + 30, local + 30 + lName)) !== name) throw new Error('nom local discordant');
    if (v.getUint16(local + 10, true) !== v.getUint16(at + 12, true)) throw new Error('heure discordante');
    const data = bytes.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + size);
    if (crc32(data) !== crc) throw new Error(`CRC de ${name} faux`);
    files.push({ name, data, time: v.getUint16(at + 12, true), date: v.getUint16(at + 14, true) });
    at += 46 + nameLen;
  }
  if (at !== end) throw new Error('répertoire central trop long');
  return files;
}

check('CRC-32 : les valeurs de référence', () => {
  const enc = new TextEncoder();
  if (crc32(enc.encode('123456789')) !== 0xcbf43926) return `CRC de « 123456789 » : ${crc32(enc.encode('123456789')).toString(16)}`;
  if (crc32(new Uint8Array(0)) !== 0) return 'CRC du vide non nul';
  return crc32(enc.encode('The quick brown fox jumps over the lazy dog')) === 0x414fa339 || 'CRC de la phrase type faux';
});

check('l’archive ZIP se relit octet par octet : en-têtes, CRC, répertoire, noms UTF-8', () => {
  const enc = new TextEncoder();
  const date = new Date(2026, 10, 11, 14, 37, 58);
  const a = enc.encode('premier fichier');
  const b = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  const zip = zipStore([{ name: 'maison-façade.png', data: a }, { name: 'vide.txt', data: new Uint8Array(0) }, { name: 'b.bin', data: b }], date);
  // Exactly the size the specification makes it: no stray byte anywhere.
  const expected = (30 + enc.encode('maison-façade.png').length + a.length) + (30 + 8) + (30 + 5 + b.length)
    + (46 + enc.encode('maison-façade.png').length) + (46 + 8) + (46 + 5) + 22;
  if (zip.length !== expected) return `${zip.length} octets au lieu de ${expected}`;
  // The very first bytes, by hand: signature, version 2.0, UTF-8 flag, stored.
  const head = [...zip.subarray(0, 10)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  if (head !== '50 4b 03 04 14 00 00 08 00 00') return `début d’archive : ${head}`;
  const files = readZip(zip);
  if (files.map((f) => f.name).join('|') !== 'maison-façade.png|vide.txt|b.bin') return `noms : ${files.map((f) => f.name)}`;
  if (new TextDecoder().decode(files[0].data) !== 'premier fichier') return 'contenu du premier fichier altéré';
  if (files[1].data.length !== 0) return 'fichier vide non vide';
  if (!files[2].data.every((x, i) => x === ((i * 31) & 255))) return 'contenu binaire altéré';
  const dt = dosDateTime(date);
  if (files[0].time !== dt.time || files[0].date !== dt.date) return 'date mal écrite';
  // 14:37:58 on 11 November 2026, as MS-DOS counts.
  return (dt.time === ((14 << 11) | (37 << 5) | 29) && dt.date === (((2026 - 1980) << 9) | (11 << 5) | 11))
    || `date DOS : ${dt.time} ${dt.date}`;
});

check('deux vues de même nom ne s’écrasent pas dans l’archive', () => {
  const out = uniqueNames(['a.png', 'a.png', 'a-2.png', 'b.png', 'a.png']);
  return out.join(' ') === 'a.png a-2.png a-2-2.png b.png a-3.png' || out.join(' ');
});

/* ---------------- typing a value ---------------- */

check('saisie numérique : virgule ou point, unité tolérée, rien d’inventé', () => {
  const cases = [['3,40', 3.4], ['3.40', 3.4], [' 3,4 m', 3.4], ['12°', 12], ['-0,5', -0.5], ['−2', -2],
    ['.5', 0.5], ['', NaN], ['abc', NaN], ['3,4,5', NaN], ['3 400', 3400], ['1e3', NaN]];
  for (const [text, want] of cases) {
    const got = parseDecimal(text);
    if (!(Number.isNaN(want) ? Number.isNaN(got) : Math.abs(got - want) < 1e-12)) return `« ${text} » lu ${got}`;
  }
  if (formatDecimal(3.4, 2) !== '3,40' || formatDecimal(-0.001, 2) !== '0,00' || formatDecimal(37, 0) !== '37') return 'affichage';
  if (settle(3.404, { min: 0.25, max: 24, exact: 0.01 }) !== 3.4) return 'centimètre';
  if (settle(99, { min: 0.25, max: 24, exact: 0.01 }) !== 24) return 'borne haute';
  if (settle(0.3, { min: 0, max: 1.25, exact: 0.25 }) !== 0.25) return 'pas imposé';
  if (settle(2.6, { min: 1, max: 4, exact: 1 }) !== 3) return 'entier';
  return digitsFor(1) === 0 && digitsFor(0.1) === 1 && digitsFor(0.05) === 2 && digitsFor(0.01) === 2 || 'décimales';
});

/* ---------------- interface settings ---------------- */

check('les réglages de l’interface rejettent ce qui est étrange', () => {
  const p = readPrefs({ layout: 'n’importe', split: 7, tab: 3, sections: { a: true, b: 'oui' }, customSize: [1, 'x'] });
  if (p.layout !== 'both' || p.tab !== 'plan') return 'valeurs invalides gardées';
  if (p.split !== 0.8) return `partage non borné : ${p.split}`;
  if (p.sections.a !== true || 'b' in p.sections) return 'sections mal filtrées';
  if (p.customSize.join() !== DEFAULT_PREFS.customSize.join()) return 'taille libre invalide gardée';
  return readPrefs('pas un objet').layout === 'both' || 'défaut absent';
});

/** A layout on a page of its own, from what is stored. */
function stageLayout() {
  const root = document.createElement('div');
  root.innerHTML = '<div class="views" style="display:flex;width:600px;height:200px"><div class="view-plan"></div>'
    + '<div class="splitter" tabindex="0" style="flex:0 0 10px"></div><div class="view-render"></div></div>'
    + '<div class="sw"></div><nav class="tb"></nav>';
  document.getElementById('stage').appendChild(root);
  const layout = new Layout({
    root, views: root.querySelector('.views'), splitter: root.querySelector('.splitter'),
    switcher: root.querySelector('.sw'), tabbar: root.querySelector('.tb'),
  });
  return { root, layout };
}

check('la disposition et le partage plan / rendu sont retrouvés à la visite suivante', () => {
  clearPrefs();
  const a = stageLayout();
  a.root.querySelector('.sw [data-layout="render"]').click();
  const sp = a.root.querySelector('.splitter');
  sp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  sp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const stored = JSON.parse(localStorage.getItem(PREFS_KEY));
  a.root.remove();
  // Another visit: nothing in memory, only what was stored.
  clearPrefs();
  localStorage.setItem(PREFS_KEY, JSON.stringify(stored));
  const b = stageLayout();
  const ok = b.root.dataset.layout === 'render'
    && Math.abs(b.layout.split - (DEFAULT_PREFS.split + 0.1)) < 1e-9
    && b.root.querySelector('.view-plan').style.flexGrow === String(b.layout.split)
    && b.root.querySelector('.sw [data-layout="render"]').getAttribute('aria-pressed') === 'true';
  const got = `${b.root.dataset.layout} ${b.layout.split}`;
  b.root.remove();
  clearPrefs();
  return ok || `retrouvé : ${got}`;
});

await checkAsync('l’état ouvert ou fermé des sections de l’inspecteur est retrouvé', async () => {
  clearPrefs();
  const make = () => {
    const root = document.createElement('div');
    document.getElementById('stage').appendChild(root);
    const insp = new Inspector(root, new Store(fixtureHouse()));
    insp.render();
    return root;
  };
  const a = make();
  const ground = a.querySelector('details[data-section="Terrain"]');
  const view = a.querySelector('details[data-section="Vue"]');
  if (ground.open || !view.open) return 'état par défaut inattendu';
  ground.open = true;
  view.open = false;
  await new Promise((r) => setTimeout(r, 30)); // 'toggle' is dispatched as a task
  a.remove();
  // Another visit: the store of settings read afresh.
  const stored = localStorage.getItem(PREFS_KEY);
  clearPrefs();
  localStorage.setItem(PREFS_KEY, stored);
  const b = make();
  const ok = b.querySelector('details[data-section="Terrain"]').open && !b.querySelector('details[data-section="Vue"]').open;
  b.remove();
  clearPrefs();
  return ok || 'sections non retrouvées';
});

/* ---------------- dialogs ---------------- */

await checkAsync('les dialogues : confirmer, annuler, saisir, au clavier comme à la souris', async () => {
  const yes = ask({ title: 'Q', body: 'corps', confirm: 'Oui', danger: true });
  let dlg = document.querySelector('dialog.dialog-ask[open]');
  if (!dlg) return 'pas de dialogue ouvert';
  // A destructive question starts on the safe answer.
  if (document.activeElement?.value !== 'cancel') return 'le focus n’est pas sur « Annuler »';
  dlg.querySelector('button[type="submit"]').click();
  if (await yes !== true) return 'confirmer ne confirme pas';
  if (document.querySelector('dialog.dialog-ask')) return 'dialogue resté dans la page';

  const no = ask({ title: 'Q', confirm: 'Oui' });
  document.querySelector('dialog.dialog-ask button[value="cancel"]').click();
  if (await no !== false) return 'annuler confirme';

  // Échap: the browser's cancel closes the dialog with no value.
  const esc = ask({ title: 'Q', confirm: 'Oui' });
  document.querySelector('dialog.dialog-ask').close();
  if (await esc !== false) return 'Échap confirme';

  // Entrée in the field submits the form.
  const named = askText({ title: 'Nom', label: 'Nom', value: 'Portail', confirm: 'OK' });
  dlg = document.querySelector('dialog.dialog-ask[open]');
  const input = dlg.querySelector('input');
  if (document.activeElement !== input) return 'le champ n’a pas le focus';
  input.value = '  Jardin  ';
  dlg.querySelector('form').requestSubmit();
  if (await named !== 'Jardin') return 'nom saisi perdu';
  const empty = askText({ title: 'Nom', label: 'Nom', confirm: 'OK' });
  document.querySelector('dialog.dialog-ask input').value = '   ';
  document.querySelector('dialog.dialog-ask form').requestSubmit();
  return (await empty) === null || 'un nom vide est accepté';
});

check('une taille libre est bornée à ce qu’un canvas accepte', () => {
  const big = customSize(50000, 12.4);
  const ok = big.width === MAX_SIDE && big.height === 64 && big.ratio === 1;
  return ok || `${big.width} × ${big.height}`;
});

/* ---------------- in the application ---------------- */

const key = (win, target, k, extra = {}) => target.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

await checkAsync('dans l’application, les raccourcis : outils, Échap, aide, export, disposition — jamais pendant une saisie', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store, layout } = win.__app;
  doc.querySelectorAll('dialog[open]').forEach((d) => d.close());
  store.setTool('select');
  key(win, doc.body, 'f');
  if (store.tool !== 'window') return `F donne ${store.tool}`;
  key(win, doc.body, 'Escape');
  if (store.tool !== 'select') return 'Échap ne revient pas à Sélectionner';
  // In the name field, letters are letters.
  const name = doc.getElementById('project-name');
  name.focus();
  key(win, name, 'b');
  key(win, name, '3');
  if (store.tool !== 'select') return 'une lettre tapée dans le nom a changé d’outil';
  if (layout.layout !== 'both') return 'un chiffre tapé dans le nom a changé la disposition';
  name.blur();
  key(win, doc.body, 'b');
  if (store.tool !== 'paint') return 'B ne donne pas le pinceau';
  store.setTool('select');
  key(win, doc.body, '3');
  const rendered = layout.layout === 'render' && doc.getElementById('layout').dataset.layout === 'render';
  key(win, doc.body, '2');
  if (!rendered || layout.layout !== 'both') return '1 · 2 · 3 ne changent pas la disposition';
  key(win, doc.body, '?');
  const help = doc.getElementById('keys-dialog');
  if (!help.open) return '? n’ouvre pas l’aide';
  const listed = help.textContent;
  help.close();
  if (!/Ctrl\+?S|Enregistrer le projet/.test(listed) || !/Fenêtre/.test(listed)) return 'aide incomplète';
  key(win, doc.body, 'e', { ctrlKey: true });
  const exp = doc.getElementById('export-dialog');
  if (!exp.open) return 'Ctrl+E n’ouvre pas l’export';
  // Inside a dialog, the letters belong to the dialog.
  key(win, exp.querySelector('select'), 'g');
  exp.close();
  return store.tool === 'select' || 'une touche dans un dialogue a changé d’outil';
});

await checkAsync('dans l’application, « Nouveau » le dit, s’annule, et Ctrl+Z ramène le projet', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  doc.querySelectorAll('dialog[open]').forEach((d) => d.close());
  store.reset(fixtureHouse());
  const before = store.model;
  doc.getElementById('btn-new').click();
  if (!/Ctrl\+Z/.test(doc.querySelector('dialog.dialog-ask[open]')?.textContent || '')) return 'le dialogue ne dit pas comment revenir';
  await answerDialog(doc, null, false);
  if (store.model !== before) return 'annuler a quand même remplacé le projet';
  doc.getElementById('btn-new').click();
  await answerDialog(doc);
  if (store.model.buildings.some((b) => b.cells.length)) return 'le projet n’a pas été remplacé';
  store.undo();
  return store.model.buildings === before.buildings || 'Ctrl+Z ne ramène pas le projet';
});

await checkAsync('dans l’application, un champ exact prend 3,40 et le borne comme son curseur', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  store.reset({ ...fixtureHouse(), props: [{ id: 'tx', kind: 'terrace', x: -6, y: 1, w: 3, d: 2 }] });
  store.select({ type: 'prop', id: 'tx' });
  win.__app.render();
  const field = (label) => [...doc.querySelectorAll('#inspector .panel-selected .field')]
    .find((f) => f.querySelector('.field-label')?.textContent === label)?.querySelector('input.num');
  const typeIn = (label, text) => {
    const f = field(label);
    f.value = text;
    f.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.__app.render();
  };
  typeIn('Largeur', '3,40');
  const w = store.selected.w;
  if (w !== 3.4) return `largeur ${w} pour « 3,40 »`;
  if (field('Largeur').value !== '3,40') return `le champ affiche ${field('Largeur').value}`;
  typeIn('Largeur', 'trois');
  if (store.selected.w !== 3.4 || field('Largeur').value !== '3,40') return 'une saisie illisible a été prise';
  typeIn('Largeur', '999');
  if (store.selected.w !== 24) return `borne non tenue : ${store.selected.w}`;
  typeIn('X', '-2.5');
  return store.selected.x === -2.5 || `X = ${store.selected.x}`;
});

await checkAsync('dans l’application, X / Y d’un objet de toit ne le font pas sortir de son toit', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  store.reset({ ...fixtureHouse(), roofItems: [{ id: 'rx', kind: 'chimney', x: 4, y: 3, w: 0.8, d: 0.8, h: 1.1 }] });
  store.select({ type: 'roofItem', id: 'rx' });
  win.__app.render();
  const x = [...doc.querySelectorAll('#inspector .panel-selected .field')]
    .find((f) => f.querySelector('.field-label')?.textContent === 'X').querySelector('input.num');
  x.value = '40';
  x.dispatchEvent(new win.Event('change', { bubbles: true }));
  const it = store.selected;
  const cs = store.model.grid?.cellSize || 1;
  const onRoof = store.model.buildings[0].cells.includes(`${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`);
  return onRoof || `objet sorti du toit, en x = ${it.x}`;
});

await checkAsync('dans l’application, l’aperçu d’export suit la taille, le fond et la vue de nuit', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store, exportDialog } = win.__app;
  store.reset(fixtureHouse());
  exportDialog.open();
  const sel = doc.getElementById('export-size');
  const frameEl = doc.getElementById('export-frame');
  const ratio = () => frameEl.getBoundingClientRect().width / frameEl.getBoundingClientRect().height;
  const pick = (v) => { sel.value = v; sel.dispatchEvent(new win.Event('change')); };
  try {
    pick('square');
    if (Math.abs(ratio() - 1) > 0.02) return `aperçu carré au rapport ${ratio().toFixed(2)}`;
    pick('sd');
    if (Math.abs(ratio() - 1.5) > 0.02) return `aperçu 3:2 au rapport ${ratio().toFixed(2)}`;
    if (!frameEl.querySelector('svg')) return 'aperçu vide';
    if (!frameEl.classList.contains('checker')) return 'pas de damier sous un fond transparent';
    pick('custom');
    const w = doc.getElementById('export-w'), h = doc.getElementById('export-h');
    if (doc.getElementById('export-custom').hidden) return 'champs de taille libre absents';
    w.value = '800'; w.dispatchEvent(new win.Event('change'));
    h.value = '800'; h.dispatchEvent(new win.Event('change'));
    if (Math.abs(ratio() - 1) > 0.02 || !/800 × 800/.test(doc.getElementById('export-dims').textContent)) return 'taille libre non suivie';
    const white = doc.querySelector('#export-bg-chips input[value="#ffffff"]');
    white.checked = true;
    white.dispatchEvent(new win.Event('change'));
    if (store.model.style.background !== '#ffffff') return 'le fond choisi n’arrive pas au modèle';
    if (frameEl.classList.contains('checker')) return 'damier sous un fond blanc';
    store.update((m) => ({ ...m, style: { ...m.style, night: true } }));
    const disabled = white.disabled && /nuit/i.test(doc.getElementById('export-bg-note').textContent);
    if (!disabled) return 'la vue de nuit ne dit pas qu’elle impose son ciel';
    return true;
  } finally {
    doc.getElementById('export-dialog').close();
    pick('gladys');
  }
});

await checkAsync('dans l’application, « Les 4 faces » télécharge une seule archive de quatre PNG', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store, exportDialog } = win.__app;
  store.reset({ ...fixtureHouse(), name: 'Façade test' });
  exportDialog.open();
  const sel = doc.getElementById('export-size');
  sel.value = 'widget';
  sel.dispatchEvent(new win.Event('change'));
  const got = [];
  const click = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function () { got.push({ href: this.href, name: this.download }); };
  try {
    doc.getElementById('btn-four').click();
    const until = Date.now() + 20000;
    while (exportDialog.busy && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  } finally {
    win.HTMLAnchorElement.prototype.click = click;
    doc.getElementById('export-dialog').close();
    sel.value = 'gladys';
    sel.dispatchEvent(new win.Event('change'));
  }
  if (got.length !== 1) return `${got.length} téléchargements`;
  if (got[0].name !== 'facade-test-4-faces.zip') return `archive nommée ${got[0].name}`;
  const bytes = new Uint8Array(await (await fetch(got[0].href)).arrayBuffer());
  const files = readZip(bytes);
  const names = files.map((f) => f.name).join(' ');
  const want = VIEWPOINTS.map((v) => `facade-test-${v.toLowerCase()}.png`).join(' ');
  if (names !== want) return `fichiers : ${names}`;
  for (const f of files) {
    if (![137, 80, 78, 71].every((b, i) => f.data[i] === b)) return `${f.name} n’est pas un PNG`;
  }
  return /archive/i.test(doc.getElementById('export-status').textContent) || 'fin non annoncée';
});

await checkAsync('dans l’application, un fichier .house.json déposé sur la fenêtre s’ouvre', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  const json = JSON.stringify({ ...fixtureHouse(), name: 'Déposée' });
  const dt = new win.DataTransfer();
  dt.items.add(new win.File([json], 'deposee.house.json', { type: 'application/json' }));
  win.dispatchEvent(new win.DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  const shown = !doc.getElementById('drop-zone').hidden;
  win.dispatchEvent(new win.DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  const until = Date.now() + 3000;
  while (store.model.name !== 'Déposée' && Date.now() < until) await new Promise((r) => setTimeout(r, 30));
  if (!shown) return 'aucune zone de dépôt affichée';
  if (!doc.getElementById('drop-zone').hidden) return 'la zone de dépôt reste affichée';
  return store.model.name === 'Déposée' || 'le fichier déposé ne s’est pas ouvert';
});

await checkAsync('dans l’application, « Enregistrer » réécrit le même fichier quand le navigateur le permet', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  const writes = [];
  let picks = 0;
  const handle = {
    name: 'ma-maison.house.json',
    createWritable: async () => ({ write: async (t) => writes.push(t), close: async () => {} }),
  };
  const had = win.showSaveFilePicker;
  win.showSaveFilePicker = async () => { picks++; return handle; };
  try {
    store.reset({ ...fixtureHouse(), name: 'Première' });
    key(win, doc.body, 's', { ctrlKey: true });
    await new Promise((r) => setTimeout(r, 50));
    store.update((m) => ({ ...m, name: 'Seconde' }));
    doc.getElementById('btn-save').click();
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    if (had) win.showSaveFilePicker = had; else delete win.showSaveFilePicker;
  }
  if (picks !== 1) return `${picks} choix de fichier pour deux enregistrements`;
  if (writes.length !== 2) return `${writes.length} écritures`;
  if (JSON.parse(writes[1]).name !== 'Seconde') return 'la seconde écriture n’est pas le projet du moment';
  return /ma-maison/.test(doc.querySelector('#toast .toast-text').textContent) || 'le fichier écrit n’est pas nommé';
});

await checkAsync('dans l’application, une vue enregistrée se renomme, se met à jour, se supprime et revient', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  doc.querySelectorAll('dialog[open]').forEach((d) => d.close());
  store.reset({ ...fixtureHouse(), views: [{ id: 'v1', name: 'Portail', camera: { ...fixtureHouse().camera, yaw: 0 }, focus: { enabled: false } }] });
  win.__app.render();
  doc.querySelector('#inspector details[data-section="Vue"]').open = true;
  const act = (label) => [...doc.querySelectorAll('#inspector .view-acts button')].find((b) => b.title === label);
  act('Renommer').click();
  await answerDialog(doc, 'Entrée');
  if (store.model.views[0].name !== 'Entrée') return 'renommer sans effet';
  store.setCamera({ yaw: 123 });
  win.__app.render();
  act('Mettre à jour avec la vue en cours').click();
  if (store.model.views[0].camera.yaw !== 123) return 'mise à jour sans effet';
  win.__app.render();
  act('Supprimer').click();
  if (store.model.views.length) return 'suppression sans effet';
  const undo = doc.querySelector('#toast .toast-action');
  if (undo.hidden) return 'pas d’annulation proposée';
  undo.click();
  return store.model.views[0]?.name === 'Entrée' || 'la vue n’est pas revenue';
});

await checkAsync('dans le rendu, une caméra posée haut sous le débord se saisit (le toit ne prend plus le clic)', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store, viewport } = win.__app;
  doc.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const house = fixtureHouse();
  store.reset(normalise({
    ...house,
    buildings: house.buildings.map((b) => ({ ...b, storeys: 1, roof: { ...b.roof, overhang: 0.75 } })),
    fixtures: [{ id: 'cam', kind: 'camera', edge: '4,6,N', storey: 0, offset: 0.5, z: 2.35 }],
  }));
  store.setTool('select');
  store.select(null);
  const iso = doc.getElementById('iso');
  const click = (box, [x, y]) => {
    const at = { clientX: box.left + x, clientY: box.top + y, bubbles: true, pointerId: 41, button: 0, buttons: 1, isPrimary: true };
    const target = doc.elementsFromPoint(at.clientX, at.clientY).find((n) => iso.contains(n)) || iso;
    store.select(null);
    target.dispatchEvent(new win.PointerEvent('pointerdown', at));
    target.dispatchEvent(new win.PointerEvent('pointerup', { ...at, buttons: 0 }));
    return store.selection;
  };
  // Seen from the north-west, low: the camera shows just under the eaves.
  store.setCamera({ yaw: 0, pitch: 15 });
  win.__app.render();
  const r = viewport.lastRender;
  const box = iso.getBoundingClientRect();
  const shown = [];
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) if (faceAt(r, x, y)?.group === 'equip:cam') shown.push([x, y]);
  }
  if (!shown.length) return 'caméra invisible';
  // Where the camera is drawn, whatever the pick layer has on top there.
  for (const p of shown) {
    const sel = click(box, p);
    if (sel?.type !== 'fixture') return `clic sur la caméra dessinée : ${JSON.stringify(sel)}`;
  }
  // Just above it, on the edge of the roof that touches it: a camera is a
  // fifth of a metre wide, and a press a pixel off went to the roof.
  const top = shown.reduce((a, p) => (p[1] < a[1] ? p : a));
  const above = [top[0], top[1] - 2];
  if (!roofAt(r, above[0], above[1])) return 'aucun toit au-dessus de la caméra : la scène ne montre pas le cas';
  const sel = click(box, above);
  return (sel?.type === 'fixture' && sel.id === 'cam') || `clic au ras du débord : ${JSON.stringify(sel)}`;
});

await checkAsync('dans le plan, la cote de la sélection reste dans le panneau et passe devant celles des murs', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store, plan } = win.__app;
  doc.querySelectorAll('dialog[open]').forEach((d) => d.close());
  store.reset({ ...fixtureHouse(), props: [{ id: 'edge', kind: 'terrace', x: 2, y: 6, w: 4, d: 2 }] });
  store.setTool('select');
  store.select({ type: 'prop', id: 'edge' });
  win.__app.render();
  // The terrace's north side at the very top of the panel: its width label,
  // eight pixels above, would be cut.
  const svg = doc.querySelector('#plan .plan-svg');
  const h = Number(svg.getAttribute('height')), w = Number(svg.getAttribute('width'));
  plan.view = { cx: 4, cy: 8 - (h / 2 - 4) / 20, scale: 20 };
  plan.render();
  const labels = [...svg.querySelectorAll('.plan-overlay text.plan-dim')];
  if (!labels.length) return 'aucune cote de sélection';
  for (const t of labels) {
    const b = t.getBBox();
    if (b.y < 0 || b.x < 0 || b.y + b.height > h || b.x + b.width > w) return `cote « ${t.textContent} » coupée (y = ${Math.round(b.y)})`;
  }
  // The terrace sits on the house's north wall, whose own dimension is
  // written along it: it must not show through the selection's.
  plan.view = { cx: 4, cy: 6, scale: 24 };
  plan.render();
  const sel = [...svg.querySelectorAll('.plan-overlay text.plan-dim')].map((t) => t.getBBox());
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const t of svg.querySelectorAll('.plan-dims text')) {
    if (t.classList.contains('plan-dim-covered')) continue;
    if (sel.some((b) => overlap(b, t.getBBox()))) return `la cote du mur « ${t.textContent} » est écrite sous celle de la sélection`;
  }
  return true;
});

/* ---------------- the boot guard follows the whole graph ---------------- */

await checkAsync('la garde de démarrage retrouve chaque module et chaque feuille de style que l’application charge', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  // What the browser actually fetched to start the application.
  const loaded = new Set(win.performance.getEntriesByType('resource')
    .map((e) => e.name.split('#')[0].split('?')[0])
    .filter((u) => /\/src\/.+\.js$/.test(u)));
  // What the guard would refetch: its own pattern, taken from the page.
  const guard = doc.getElementById('boot-guard').textContent;
  const src = /var re = (\/.+\/g);/.exec(guard)?.[1];
  if (!src) return 'motif de la garde introuvable';
  const re = new Function(`return ${src}`)();
  const found = new Set();
  const entry = new URL(doc.querySelector('script[type="module"][src]').getAttribute('src'), win.location.href).href;
  const visit = async (url) => {
    if (found.has(url)) return;
    found.add(url);
    const text = await (await fetch(url)).text();
    const next = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) next.push(new URL(m[1] || m[2], url).href);
    await Promise.all(next.map(visit));
  };
  await visit(entry);
  const missed = [...loaded].filter((u) => !found.has(u));
  if (missed.length) return `modules hors de portée de la garde : ${missed.map((u) => u.split('/src/')[1]).join(', ')}`;
  if (found.size < 30) return `${found.size} modules seulement`;
  // Style sheets: only <link> elements, which the guard refetches; an
  // @import inside one would escape it.
  for (const sheet of doc.styleSheets) {
    const owner = sheet.ownerNode;
    if (owner.tagName === 'LINK' && owner.rel !== 'stylesheet') return 'feuille liée autrement';
    for (const rule of sheet.cssRules) if (rule instanceof win.CSSImportRule) return `@import dans ${sheet.href}`;
  }
  return true;
});

check('la version affichée est celle du journal des changements', () => VERSION === '2.0.0' || VERSION);

await checkAsync('le journal des changements commence par la version affichée', async () => {
  const text = await (await fetch('../CHANGELOG.md')).text();
  const first = /^##\s*\[?(\d+\.\d+\.\d+)/m.exec(text)?.[1];
  return first === VERSION || `CHANGELOG : ${first}, interface : ${VERSION}`;
});

await checkAsync('dans l’application, la version est visible', async () => {
  const frame = await app();
  return frame.contentDocument.getElementById('app-version').textContent === VERSION || 'version absente';
});

// What the tests above stored must not reach the next file's page.
clearPrefs();
