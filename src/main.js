/**
 * Wiring: store, views, toolbar, keyboard.
 */

import { Store } from './ui/store.js';
import { PlanView } from './ui/plan.js';
import { Viewport } from './ui/viewport.js';
import { Inspector } from './ui/panels.js';
import { initialModel, exportProject, importProject, clearLocal } from './io/project.js';
import { defaultModel, emptyModel } from './core/model.js';
import { SIZES, exportPng, exportSvg, exportFourViews, copyPngToClipboard } from './io/export.js';

const TOOL_GROUPS = [
  {
    title: 'Structure', tools: [
      ['select', 'Sélectionner'],
      ['paint', 'Pinceau'],
      ['rect', 'Rectangle'],
      ['erase', 'Gomme'],
    ],
  },
  {
    title: 'Ouvertures', tools: [
      ['window', 'Fenêtre'],
      ['shutter', 'Fenêtre à volets'],
      ['door', 'Porte'],
      ['garage', 'Porte de garage'],
    ],
  },
  {
    title: 'Toiture', tools: [
      ['solar', 'Panneaux solaires'],
      ['chimney', 'Cheminée'],
      ['velux', 'Fenêtre de toit'],
      ['dish', 'Parabole'],
    ],
  },
  {
    title: 'Extérieur', tools: [
      ['pool', 'Piscine'],
      ['terrace', 'Terrasse'],
      ['path', 'Allée'],
      ['tree', 'Arbre'],
      ['hedge', 'Haie'],
      ['fence', 'Clôture'],
      ['car', 'Voiture'],
    ],
  },
];

const HINTS = {
  select: 'Cliquez un élément pour le régler, glissez pour le déplacer.',
  paint: 'Dessinez l’emprise de la maison. Alt efface.',
  rect: 'Glissez pour ajouter un volume rectangulaire. Alt retire.',
  erase: 'Glissez pour retirer des cases.',
  window: 'Cliquez près d’un mur, ici ou sur le rendu, pour poser une fenêtre.',
  shutter: 'Cliquez près d’un mur pour poser une fenêtre à volets.',
  door: 'Cliquez près d’un mur pour poser une porte.',
  garage: 'Cliquez près d’un mur pour poser une porte de garage.',
  solar: 'Cliquez sur le toit pour poser des panneaux.',
  chimney: 'Cliquez sur le toit pour poser une cheminée.',
  velux: 'Cliquez sur le toit pour poser une fenêtre de toit.',
  dish: 'Cliquez sur le toit pour poser une parabole.',
};

const ROTATION_LABELS = ['Sud-Est', 'Sud-Ouest', 'Nord-Ouest', 'Nord-Est'];

const $ = (id) => document.getElementById(id);

const store = new Store(initialModel());
const plan = new PlanView($('plan'), store);
const viewport = new Viewport($('iso'), store);
const inspector = new Inspector($('inspector'), store);

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- tool palette ---------- */

function buildTools() {
  const root = $('tools');
  root.replaceChildren();
  for (const group of TOOL_GROUPS) {
    const box = document.createElement('div');
    box.className = 'tool-group';
    const title = document.createElement('h3');
    title.textContent = group.title;
    const list = document.createElement('div');
    list.className = 'tool-list';
    for (const [id, label] of group.tools) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.textContent = label;
      b.dataset.tool = id;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => store.setTool(id));
      list.appendChild(b);
    }
    box.append(title, list);
    root.appendChild(box);
  }
}

function syncTools() {
  for (const b of document.querySelectorAll('.tool')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool));
  }
  $('plan-hint').textContent = HINTS[store.tool] || '';
}

/* ---------- toolbar ---------- */

function rotate(delta) {
  store.update((m) => ({
    ...m,
    camera: { ...m.camera, rotation: (((m.camera.rotation + delta) % 4) + 4) % 4 },
  }));
}

$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
$('btn-rot-left').addEventListener('click', () => rotate(-1));
$('btn-rot-right').addEventListener('click', () => rotate(1));
$('btn-fit').addEventListener('click', () => viewport.resetView());

$('btn-new').addEventListener('click', () => {
  const blank = confirm(
    'Repartir de zéro ?\n\nOK : maison vierge (à dessiner)\nAnnuler : conserver le projet actuel',
  );
  if (!blank) return;
  clearLocal();
  store.update(emptyModel());
  store.select(null);
  toast('Nouveau projet');
});

$('btn-save').addEventListener('click', () => {
  exportProject(store.model);
  toast('Projet enregistré');
});

$('btn-open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    store.update(await importProject(file));
    store.select(null);
    viewport.resetView();
    toast('Projet chargé');
  } catch (e) {
    toast(e.message);
  }
  ev.target.value = '';
});

/* ---------- export ---------- */

const dialog = $('export-dialog');
const sizeSelect = $('export-size');
for (const s of SIZES) {
  const o = document.createElement('option');
  o.value = s.id;
  o.textContent = s.label;
  sizeSelect.appendChild(o);
}
const currentSize = () => SIZES.find((s) => s.id === sizeSelect.value) || SIZES[0];
const status = (msg) => { $('export-status').textContent = msg; };

$('btn-export').addEventListener('click', () => { status(''); dialog.showModal(); });

$('btn-png').addEventListener('click', async () => {
  status('Rendu en cours…');
  try {
    await exportPng(store.model, currentSize());
    status('Image PNG téléchargée.');
  } catch (e) { status('Échec : ' + e.message); }
});

$('btn-svg').addEventListener('click', () => {
  exportSvg(store.model, currentSize());
  status('Fichier SVG téléchargé.');
});

$('btn-four').addEventListener('click', async () => {
  status('Rendu des 4 faces…');
  try {
    await exportFourViews(store.model, currentSize(), (n, total) => status(`Face ${n} sur ${total}…`));
    status('Les 4 faces ont été téléchargées.');
  } catch (e) { status('Échec : ' + e.message); }
});

$('btn-copy').addEventListener('click', async () => {
  try {
    await copyPngToClipboard(store.model, currentSize());
    status('Image copiée dans le presse-papier.');
  } catch (e) { status('Échec : ' + e.message); }
});

/* ---------- project name ---------- */

const nameInput = $('project-name');
nameInput.addEventListener('input', () => {
  store.update((m) => ({ ...m, name: nameInput.value }), { coalesce: 'name' });
});

/* ---------- keyboard ---------- */

document.addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName);
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    ev.shiftKey ? store.redo() : store.undo();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
    ev.preventDefault();
    store.redo();
    return;
  }
  if (typing) return;
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (store.selection) { ev.preventDefault(); store.deleteSelected(); }
  } else if (ev.key === '[') rotate(-1);
  else if (ev.key === ']') rotate(1);
  else if (ev.key === 'Escape') store.select(null);
});

/* ---------- render loop ---------- */

let frame = null;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    plan.render();
    viewport.render();
    inspector.render();
    syncTools();
    $('btn-undo').disabled = !store.canUndo;
    $('btn-redo').disabled = !store.canRedo;
    $('rot-label').textContent = ROTATION_LABELS[store.model.camera.rotation] || '';
    if (nameInput.value !== store.model.name) nameInput.value = store.model.name;
  });
}

store.subscribe(scheduleRender);
window.addEventListener('resize', scheduleRender);

// The panels also resize without the window doing so — when the inspector
// wraps under the stage, for instance — and a view sized from a stale
// measurement letterboxes itself.
if (window.ResizeObserver) {
  const ro = new ResizeObserver(scheduleRender);
  ro.observe($('plan'));
  ro.observe($('iso'));
}

buildTools();
nameInput.value = store.model.name;
store.setTool('select');
scheduleRender();

// A first-run project that shows what the tool can do beats an empty grid.
if (!store.model.cells.length) {
  store.update(defaultModel(), { silent: true });
}
