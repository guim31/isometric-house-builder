/**
 * Wiring: store, views, toolbar, keyboard.
 */

import { Store } from './ui/store.js';
import { PlanView } from './ui/plan.js';
import { Viewport } from './ui/viewport.js';
import { Inspector } from './ui/panels.js';
import { initialModel, exportProject, importProject, clearLocal, loadLocal, fromShareUrl, toShareUrl } from './io/project.js';
import { Gallery } from './ui/gallery.js';
import { defaultModel, emptyModel, cellSet } from './core/model.js';
import { SIZES, exportPng, exportSvg, exportFourViews, exportSavedViews, copyPngToClipboard } from './io/export.js';
import { viewpointLabel, normaliseYaw } from './core/iso.js';

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
    title: 'Sur le toit', folded: true, tools: [
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
      ['stairs', 'Escalier'],
      ['tree', 'Arbre'],
      ['bush', 'Buisson'],
      ['hedge', 'Haie'],
      ['fence', 'Clôture'],
      ['muret', 'Muret'],
      ['gate', 'Portillon / portail'],
      ['car', 'Voiture'],
    ],
  },
  {
    title: 'Cadrage', folded: true, tools: [
      ['frame', 'Zone de cadrage'],
    ],
  },
];

const HINTS = {
  select: 'Cliquez un élément pour le régler, glissez pour le déplacer — une ouverture coulisse le long des murs. Dans le rendu, glisser fait tourner la maison où qu’on la prenne ; le pavé en bas à droite fait de même, et bascule entre pivoter et déplacer.',
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
  pool: 'Cliquez dans le plan — ou directement sur le rendu — pour poser la piscine.',
  terrace: 'Cliquez dans le plan ou sur le rendu pour poser la terrasse.',
  path: 'Cliquez dans le plan ou sur le rendu pour poser l’allée.',
  stairs: 'Cliquez au pied d’une terrasse surélevée : l’escalier prend sa hauteur et se tourne vers elle.',
  tree: 'Cliquez dans le plan ou sur le rendu pour planter un arbre.',
  bush: 'Cliquez dans le plan ou sur le rendu pour planter un buisson.',
  hedge: 'Glissez dans le plan pour tracer la haie.',
  fence: 'Glissez dans le plan pour tracer la clôture.',
  car: 'Cliquez dans le plan ou sur le rendu pour garer la voiture.',
  muret: 'Glissez dans le plan pour tracer le muret — sa longueur s’affiche pendant le tracé.',
  frame: 'Glissez dans le plan pour délimiter la zone à montrer : le rendu se recadre dessus et le reste disparaît.',
  gate: 'Cliquez près d’un muret : le portail s’y aligne et l’ouvre automatiquement.',
};

const $ = (id) => document.getElementById(id);

const store = new Store(initialModel());
const plan = new PlanView($('plan'), store);
const viewport = new Viewport($('iso'), store);
const inspector = new Inspector($('inspector'), store, {
  onExport: () => { status(''); dialog.showModal(); },
});

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- tool palette ---------- */

/**
 * The tool palette, in collapsible groups.
 *
 * Twenty-three tools in one column ran off the bottom of the panel. They all
 * start open — a first-time reader should see what the tool can do, not a row
 * of shut drawers — and folding away the families one does not use is what
 * makes room. Two families start folded — roof furniture and framing are set
 * once and left alone — which is what makes the column fit without hiding a
 * family from view: the headings are all still there.
 * Built once, so <details> keeps its own state from there on.
 */
function buildTools() {
  const root = $('tools');
  root.replaceChildren();
  root.appendChild(Object.assign(document.createElement('p'),
    { className: 'panel-group', textContent: 'Créer' }));
  for (const group of TOOL_GROUPS) {
    const box = document.createElement('details');
    box.className = 'tool-group';
    box.open = !group.folded;
    const title = document.createElement('summary');
    title.className = 'panel-title';
    title.appendChild(Object.assign(document.createElement('span'),
      { className: 'panel-name', textContent: group.title }));
    box.appendChild(title);
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
    box.appendChild(list);
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

/**
 * Step to the next quarter turn in the pressed direction.
 *
 * Floor/ceil rather than round: after orbiting by hand to 37°, pressing "turn
 * right" must go to 90°, not snap backwards to 0° because that happens to be
 * the nearest quarter turn. The buttons always move the way they point.
 */
function rotate(delta) {
  store.update((m) => {
    const q = m.camera.yaw / 90;
    const next = delta > 0 ? Math.floor(q) + 1 : Math.ceil(q) - 1;
    return { ...m, camera: { ...m.camera, yaw: normaliseYaw(next * 90) } };
  });
}

/* ---------- navigation pad ---------- */

/*
 * Inline SVG rather than a font or an image: nothing to load, and it inherits
 * the text colour, so it follows the light and dark themes for free.
 */
const ICON = {
  arrow: '<path fill="currentColor" d="M8 3.4 12.8 11.2H3.2z"/>',
  plus: '<path fill="currentColor" d="M7.1 3.2h1.8v3.9h3.9v1.8H8.9v3.9H7.1V8.9H3.2V7.1h3.9z"/>',
  minus: '<path fill="currentColor" d="M3.2 7.1h9.6v1.8H3.2z"/>',
  fit: '<path fill="currentColor" d="M2.4 6.4V2.4h4v1.5H3.9v2.5zm7.2-4h4v4h-1.5V3.9h-2.5zm4 7.2v4h-4v-1.5h2.5v-2.5zm-7.2 4h-4v-4h1.5v2.5h2.5z"/>',
};

const YAW_STEP = 15;
const PITCH_STEP = 6;
const PAN_STEP = 40;

/*
 * The arrows do whatever the mode says, which is the point of having a mode:
 * turn the house around in « pivoter », slide the picture in « déplacer ».
 */
const NUDGE = {
  up: () => (viewport.dragMode === 'pan' ? viewport.panBy(0, -PAN_STEP) : viewport.nudge(0, PITCH_STEP)),
  down: () => (viewport.dragMode === 'pan' ? viewport.panBy(0, PAN_STEP) : viewport.nudge(0, -PITCH_STEP)),
  left: () => (viewport.dragMode === 'pan' ? viewport.panBy(-PAN_STEP, 0) : viewport.nudge(-YAW_STEP, 0)),
  right: () => (viewport.dragMode === 'pan' ? viewport.panBy(PAN_STEP, 0) : viewport.nudge(YAW_STEP, 0)),
};

const NUDGE_TITLES = {
  orbit: {
    up: 'Monter la caméra', down: 'Descendre la caméra',
    left: 'Tourner vers la gauche', right: 'Tourner vers la droite',
  },
  pan: {
    up: 'Remonter l’image', down: 'Descendre l’image',
    left: 'Décaler vers la gauche', right: 'Décaler vers la droite',
  },
};

/**
 * Press and hold to keep going.
 *
 * Fifteen degrees a click is a coarse way to travel a full turn. Holding runs
 * the same step on a timer, which makes the pad usable for more than nudging —
 * dragging is still quicker, and that is fine: the pad is what tells you the
 * drag exists.
 */
function repeatable(button, run) {
  let timer = null, delay = null;
  const stop = () => { clearTimeout(delay); clearInterval(timer); timer = delay = null; };
  button.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    run();
    delay = setTimeout(() => { timer = setInterval(run, 90); }, 320);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
    button.addEventListener(type, stop);
  }
}

function buildNav() {
  const root = $('view-nav');
  const modes = document.createElement('div');
  modes.className = 'nav-modes';
  const modeButtons = [['orbit', 'Pivoter', 'Glisser fait pivoter la maison (Maj : déplacer)'],
    ['pan', 'Déplacer', 'Glisser déplace la vue (Maj : pivoter)']];
  for (const [mode, label, title] of modeButtons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.dataset.mode = mode;
    b.addEventListener('click', () => viewport.setDragMode(mode));
    modes.appendChild(b);
  }

  const icon = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[name]}</svg>`;
  const btn = (cls, glyph, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `nav-btn ${cls}`;
    b.innerHTML = icon(glyph);
    b.title = label;
    b.setAttribute('aria-label', label);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };

  const pad = document.createElement('div');
  pad.className = 'nav-pad';
  for (const dir of ['up', 'left', 'right', 'down']) {
    const b = btn(`nav-${dir}`, 'arrow', NUDGE_TITLES.orbit[dir], null);
    b.dataset.dir = dir;
    repeatable(b, NUDGE[dir]);
    pad.appendChild(b);
  }
  pad.appendChild(btn('nav-fit', 'fit', 'Recadrer', () => viewport.resetView()));

  const zoom = document.createElement('div');
  zoom.className = 'nav-zoom';
  zoom.append(
    btn('nav-out', 'minus', 'Dézoomer', () => viewport.zoomBy(1 / 1.25)),
    btn('nav-in', 'plus', 'Zoomer', () => viewport.zoomBy(1.25)),
  );

  root.replaceChildren(modes, pad, zoom);
  syncNav();
}

function syncNav() {
  for (const b of document.querySelectorAll('.nav-modes button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === viewport.dragMode));
  }
  const titles = NUDGE_TITLES[viewport.dragMode] || NUDGE_TITLES.orbit;
  for (const b of document.querySelectorAll('.nav-pad [data-dir]')) {
    b.title = titles[b.dataset.dir];
    b.setAttribute('aria-label', titles[b.dataset.dir]);
  }
}
viewport.onModeChange = syncNav;

$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
$('btn-rot-left').addEventListener('click', () => rotate(-1));
$('btn-rot-right').addEventListener('click', () => rotate(1));
$('btn-fit').addEventListener('click', () => viewport.resetView());

const gallery = new Gallery($('gallery-dialog'), (model) => {
  store.update(model);
  store.select(null);
  viewport.resetView();
});
$('btn-gallery').addEventListener('click', () => gallery.open());

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

$('btn-share').addEventListener('click', async () => {
  // The whole model rides in the URL fragment: nothing touches a server.
  const url = toShareUrl(store.model);
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié — il contient tout le projet');
  } catch {
    // No clipboard on insecure origins; the prompt is copyable everywhere.
    window.prompt('Copiez le lien :', url);
  }
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

$('btn-views').addEventListener('click', async () => {
  const n = store.model.views.length;
  if (!n) { status('Aucune vue enregistrée — cadrez une zone puis « Enregistrer cette vue ».'); return; }
  status('Rendu des vues enregistrées…');
  try {
    await exportSavedViews(store.model, currentSize(), (i) => status(`Vue ${i} sur ${n}…`));
    status(`${n} vue${n > 1 ? 's' : ''} téléchargée${n > 1 ? 's' : ''}.`);
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
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
    ev.preventDefault();
    store.duplicateSelected();
    return;
  }
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
    $('rot-label').textContent = viewpointLabel(store.model.camera.yaw);
    if (nameInput.value !== store.model.name) nameInput.value = store.model.name;
  });
}

store.subscribe(scheduleRender);
window.addEventListener('resize', scheduleRender);
// The inspector skips its own rebuild while one of its controls is mid-drag;
// the release fires 'change', which runs the refresh it deferred.
$('inspector').addEventListener('change', scheduleRender);

// The panels also resize without the window doing so — when the inspector
// wraps under the stage, for instance — and a view sized from a stale
// measurement letterboxes itself.
if (window.ResizeObserver) {
  const ro = new ResizeObserver(scheduleRender);
  ro.observe($('plan'));
  ro.observe($('iso'));
}

buildTools();
buildNav();
nameInput.value = store.model.name;
store.setTool('select');
scheduleRender();

// A first-run project that shows what the tool can do beats an empty grid.
if (!cellSet(store.model).size) {
  store.update(defaultModel(), { silent: true });
}

// On a genuinely first visit, offer the gallery rather than leaving someone to
// guess what the tool is for. Returning visitors get their project straight
// back, with the gallery a click away.
if (!fromShareUrl() && !loadLocal()) {
  requestAnimationFrame(() => gallery.open());
}
