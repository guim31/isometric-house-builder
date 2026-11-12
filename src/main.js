/**
 * Wiring: store, views, toolbar, keyboard, dialogs.
 */

import { Store } from './ui/store.js';
import { PlanView } from './ui/plan.js';
import { Viewport } from './ui/viewport.js';
import { Inspector } from './ui/panels.js';
import {
  initialModel, importProject, clearLocal, toShareUrl, readShareUrl, clearShareHash, setAside,
  saveProject, pickProject, useFile,
} from './io/project.js';
import { Gallery, presetModel } from './ui/gallery.js';
import { PRESETS } from './data/presets.js';
import { normaliseYaw } from './core/iso.js';
import { nudgeSelection } from './ui/actions.js';
import { Layout } from './ui/layout.js';
import { buildTools, syncTools, revealTool } from './ui/toolbar.js';
import { ExportDialog } from './ui/export-dialog.js';
import { ask, askText, showText } from './ui/dialogs.js';
import { icon } from './ui/icons.js';
import {
  TOOL_GROUPS, LAYOUTS, SHORTCUT_SECTIONS, toolLabel, shortcutParts,
} from './ui/texts.js';
import { blankModel } from './ui/naming.js';
import { pointName } from './ui/words.js';
import { t, language, setLanguage, onLanguageChange, LANGUAGES } from './i18n/index.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);

/*
 * A safety net before anything else. An exception in a click handler leaves
 * the page looking alive while the click did nothing — the palette list threw
 * on every change for months, and nothing said so. A short message is better
 * than silence, and it gives a report something to quote.
 */
let toastTimer = null;
function toast(message, duration = 2600, action = null) {
  const t = $('toast');
  if (!t) return;
  t.querySelector('.toast-text').textContent = message;
  const btn = t.querySelector('.toast-action');
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { t.classList.remove('show'); action.run(); };
  }
  t.classList.toggle('error', duration === 'error');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show', 'error'), duration === 'error' ? 7000 : duration);
}
const reportError = (text) => toast(t('error.generic', { message: text || t('error.unknown') }), 'error');
window.addEventListener('error', (ev) => reportError(ev.message || ev.error?.message));
window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason?.message || String(ev.reason)));

/* ---------- icons, version and words, before anything is drawn ---------- */

for (const n of document.querySelectorAll('[data-icon]')) n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon));
$('app-version').textContent = VERSION;

/*
 * The page's own words — the bar, the headings, the dialogs' frames — are in
 * index.html in French, so that the page reads before any module has run.
 * Each carries the key of its text: `data-i18n` for the text itself,
 * `data-i18n-title` and `data-i18n-aria` for its tooltip and its accessible
 * name. Written again at each change of language, with the page's language,
 * title and description.
 */
function applyPageWords() {
  const root = document.documentElement;
  root.lang = language();
  document.title = t('page.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('page.description'));
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
  for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  for (const n of document.querySelectorAll('a[data-guide]')) n.href = t('page.guide');
  $('app-version').title = t('page.version', { version: VERSION });
  for (const pick of document.querySelectorAll('.lang-select')) if (pick.value !== language()) pick.value = language();
}

/*
 * The language selector: each language named in itself, as one looks for it.
 * Two of them, the same: one in the bar, one in the phone's menu.
 */
for (const pick of document.querySelectorAll('.lang-select')) {
  for (const l of LANGUAGES) pick.appendChild(new Option(l.name, l.id));
  pick.value = language();
  pick.addEventListener('change', () => setLanguage(pick.value));
}
applyPageWords();

/* ---------- the store and the views ---------- */

const boot = initialModel();
// The house a first visit opens on — or the one opened when what was saved
// would not — is named in the visitor's language, like everything the tool
// creates. A project that was saved keeps its names.
if (boot.source === 'default' || boot.source === 'rejected') boot.model = presetModel(PRESETS[0]);
// A link opened over a project already here does not erase it: that project
// becomes the history entry before the link, and « Annuler » brings it back.
const store = new Store(boot.source === 'link' && boot.previous ? boot.previous : boot.model);
if (boot.source === 'link' && boot.previous) store.update(boot.model);
store.onLimit = (message) => toast(message, 4000);
store.onNotice = (message) => toast(message, 3200);
store.onSaveError = () => toast(t('project.autosaveFailed'));
const plan = new PlanView($('plan'), store);
const viewport = new Viewport($('iso'), store);
const exportDialog = new ExportDialog($('export-dialog'), store);
const inspector = new Inspector($('inspector'), store, {
  onExport: () => exportDialog.open(),
  askText,
  notify: (message, action) => toast(message, action ? 6000 : 2600, action),
});
const layout = new Layout({
  root: $('layout'), views: $('views'), splitter: $('splitter'),
  switcher: $('layout-switch'), tabbar: $('tabbar'),
});

/**
 * A project replaces the one open: from the gallery, a file, a link, a new
 * page. Each is one step of the history — Ctrl+Z brings the previous back —
 * and each refits both views, which a mere edit never does.
 */
function openModel(model, { file = null } = {}) {
  store.update(model);
  store.select(null);
  useFile(file);
  viewport.resetView();
  plan.refit();
}


/*
 * A link pasted into the address bar of a page already open changes only the
 * fragment: no reload, so nothing happened at all, and the fragment stayed —
 * the next reload then opened the link over everything done since.
 */
window.addEventListener('hashchange', () => {
  const link = readShareUrl();
  if (!link) return;
  clearShareHash();
  if (link.failed) {
    toast(t('link.unreadable'), 6000);
    return;
  }
  openModel(link.model);
  toast(t('link.openedOver'), 6000);
});

/* ---------- tools ---------- */

const toolsRoot = $('tools');
const hint = $('plan-hint');
store.subscribe((_s, reason) => {
  if (reason === 'tool') requestAnimationFrame(() => revealTool(toolsRoot, store.tool));
});

/**
 * Step to the next quarter turn in the pressed direction.
 *
 * Floor/ceil rather than round: after orbiting by hand to 37°, pressing "turn
 * right" must go to 90°, not snap backwards to 0° because that happens to be
 * the nearest quarter turn. The buttons always move the way they point.
 */
function rotate(delta) {
  store.setCamera((c) => {
    const q = c.yaw / 90;
    const next = delta > 0 ? Math.floor(q) + 1 : Math.ceil(q) - 1;
    return { yaw: normaliseYaw(next * 90) };
  });
}

/* ---------- navigation pad ---------- */

/*
 * Inline SVG rather than a font or an image: nothing to load, and it inherits
 * the text colour, so it follows the light and dark themes for free.
 */
const NAV_ICON = {
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

/** What each arrow of the pad says it does, in the mode of the moment: `nav.<mode>.<dir>`. */
const nudgeTitle = (mode, dir) => t(`nav.${mode === 'pan' ? 'pan' : 'orbit'}.${dir}`);

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
  // Enter and Space press a button without any pointer: a click with no
  // detail, which the pointer path above has already handled otherwise.
  button.addEventListener('click', (ev) => { if (ev.detail === 0) run(); });
}

function buildNav() {
  const root = $('view-nav');
  const modes = document.createElement('div');
  modes.className = 'nav-modes';
  const modeButtons = [['orbit', 'nav.orbit', 'nav.orbitTitle'], ['pan', 'nav.pan', 'nav.panTitle']];
  for (const [mode, label, title] of modeButtons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t(label);
    b.title = t(title);
    b.dataset.mode = mode;
    b.addEventListener('click', () => viewport.setDragMode(mode));
    modes.appendChild(b);
  }

  const glyph = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true">${NAV_ICON[name]}</svg>`;
  const btn = (cls, name, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `nav-btn ${cls}`;
    b.innerHTML = glyph(name);
    b.title = t(label);
    b.setAttribute('aria-label', b.title);
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };

  const pad = document.createElement('div');
  pad.className = 'nav-pad';
  for (const dir of ['up', 'left', 'right', 'down']) {
    const b = btn(`nav-${dir}`, 'arrow', `nav.orbit.${dir}`, null);
    b.dataset.dir = dir;
    repeatable(b, NUDGE[dir]);
    pad.appendChild(b);
  }
  pad.appendChild(btn('nav-fit', 'fit', 'nav.fit', () => viewport.resetView()));

  const zoom = document.createElement('div');
  zoom.className = 'nav-zoom';
  zoom.append(
    btn('nav-out', 'minus', 'nav.zoomOut', () => viewport.zoomBy(1 / 1.25)),
    btn('nav-in', 'plus', 'nav.zoomIn', () => viewport.zoomBy(1.25)),
    // The pad's centre button, again, for the compact pad that has no arrows.
    btn('nav-fit nav-fit-compact', 'fit', 'nav.fit', () => viewport.resetView()),
  );

  root.replaceChildren(modes, pad, zoom);
  syncNav();
}

function syncNav() {
  for (const b of document.querySelectorAll('.nav-modes button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === viewport.dragMode));
  }
  for (const b of document.querySelectorAll('.nav-pad [data-dir]')) {
    b.title = nudgeTitle(viewport.dragMode, b.dataset.dir);
    b.setAttribute('aria-label', b.title);
  }
}
viewport.onModeChange = syncNav;

/* ---------- application bar ---------- */

$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
$('btn-rot-left').addEventListener('click', () => rotate(-1));
$('btn-rot-right').addEventListener('click', () => rotate(1));
$('btn-fit').addEventListener('click', () => viewport.resetView());

/*
 * On a phone the project's actions fold into a menu behind « ⋯ ». The same
 * buttons: the menu is the group, shown as a sheet.
 */
const menu = $('project-actions');
const menuButton = $('btn-menu');
function setMenu(open) {
  menu.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button')?.focus();
}
menuButton.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
menu.addEventListener('click', (ev) => { if (ev.target.closest('button')) setMenu(false); });
document.addEventListener('pointerdown', (ev) => {
  if (menu.classList.contains('open') && !menu.contains(ev.target) && !menuButton.contains(ev.target)) setMenu(false);
});
menu.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && menu.classList.contains('open')) {
    ev.stopPropagation();
    setMenu(false);
    menuButton.focus();
  }
});

const gallery = new Gallery($('gallery-dialog'), (model) => {
  // Offered on a first visit, the gallery replaces nothing anyone made.
  const replacing = gallery.replacing;
  openModel(model);
  if (replacing) toast(t('gallery.done', { name: model.name }), 4200, { label: t('undo'), run: () => store.undo() });
});
$('btn-gallery').addEventListener('click', () => gallery.open({ replacing: true }));

async function newProject() {
  const ok = await ask({ title: t('new.title'), body: t('new.body'), confirm: t('new.confirm'), danger: true });
  if (!ok) return;
  clearLocal();
  openModel(blankModel());
  toast(t('new.done'), 4200, { label: t('undo'), run: () => store.undo() });
}
$('btn-new').addEventListener('click', newProject);

async function save(as = false) {
  try {
    const done = await saveProject(store.model, { as });
    if (done) toast(done.name ? t('project.savedTo', { name: done.name }) : t('project.saved'));
  } catch (e) {
    toast(t('project.saveFailed', { message: e.message }), 5000);
  }
}
$('btn-save').addEventListener('click', () => save(false));
$('btn-save-as').addEventListener('click', () => save(true));

$('btn-share').addEventListener('click', async () => {
  // The whole model rides in the URL fragment: nothing touches a server.
  const url = toShareUrl(store.model);
  try {
    await navigator.clipboard.writeText(url);
    toast(t('link.copied'));
  } catch {
    // No clipboard on insecure origins: the link is shown, selected, to copy.
    showText({ title: t('link.title'), body: t('link.body'), text: url });
  }
});

function opened({ model, newer }, file = null) {
  openModel(model, { file });
  toast(newer ? t('project.openedNewer') : t('project.opened'));
}

async function openFile() {
  const picked = await pickProject().catch((e) => { toast(e.message); return { cancelled: true }; });
  if (picked?.cancelled) return;
  if (picked) { opened(picked, picked.handle); return; }
  $('file-input').click();
}
$('btn-open').addEventListener('click', openFile);
$('file-input').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    opened(await importProject(file));
  } catch (e) {
    toast(e.message);
  }
  ev.target.value = '';
});

/*
 * A project file dropped anywhere on the window opens. Only files: a text or
 * a link dragged from elsewhere is left to whatever is under it.
 */
const dropZone = $('drop-zone');
let dragDepth = 0;
const carriesFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (ev) => {
  if (!carriesFiles(ev)) return;
  ev.preventDefault();
  dragDepth++;
  dropZone.hidden = false;
});
window.addEventListener('dragover', (ev) => {
  if (!carriesFiles(ev)) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (ev) => {
  if (!carriesFiles(ev)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropZone.hidden = true;
});
window.addEventListener('drop', async (ev) => {
  if (!carriesFiles(ev)) return;
  ev.preventDefault();
  dragDepth = 0;
  dropZone.hidden = true;
  const item = [...(ev.dataTransfer.items || [])].find((i) => i.kind === 'file');
  const file = ev.dataTransfer.files?.[0];
  if (!file) return;
  if (!/\.json$/i.test(file.name)) { toast(t('project.dropRefused'), 4000); return; }
  // Where the browser hands over the file itself, « Enregistrer » can write
  // back into it. Asked for before anything is awaited: the drop's data is
  // only there during the event.
  const handle = item?.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null;
  try {
    opened(await importProject(file), await handle);
  } catch (e) {
    toast(e.message);
  }
});

/* ---------- export, shortcuts ---------- */

$('btn-export').addEventListener('click', () => exportDialog.open());

const keysDialog = $('keys-dialog');
function buildKeys() {
  const body = $('keys-body');
  const lead = document.createElement('p');
  lead.className = 'dialog-lead';
  lead.textContent = t('keys.lead');
  const sections = [
    ...SHORTCUT_SECTIONS.map((s) => ({
      title: t(`keys.${s.id}`), keys: s.keys.map(([keys, what]) => [shortcutParts(keys), t(`keys.${what}`)]),
    })),
    {
      title: t('keys.tools'),
      keys: TOOL_GROUPS.flatMap((g) => g.tools).filter((x) => x.key).map((x) => [shortcutParts(x.key), toolLabel(x.id)]),
    },
  ];
  const grid = document.createElement('div');
  grid.className = 'keys-grid';
  for (const s of sections) {
    const box = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = s.title;
    const dl = document.createElement('dl');
    for (const [keys, what] of s.keys) {
      const dt = document.createElement('dt');
      for (const part of keys) {
        if (part.text) { dt.append(part.text); continue; }
        for (const [n, key] of part.keys.entries()) {
          if (n) dt.append('+');
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          dt.appendChild(kbd);
        }
      }
      const dd = document.createElement('dd');
      dd.textContent = what;
      dl.append(dt, dd);
    }
    box.append(h, dl);
    grid.appendChild(box);
  }
  const foot = document.createElement('p');
  foot.className = 'keys-version';
  foot.textContent = t('keys.version', { version: VERSION });
  body.replaceChildren(lead, grid, foot);
}
function showKeys() {
  if (!keysDialog.open) keysDialog.showModal();
}
$('btn-keys').addEventListener('click', showKeys);
$('btn-keys-menu').addEventListener('click', showKeys);

/* ---------- project name ---------- */

const nameInput = $('project-name');
nameInput.addEventListener('input', () => {
  store.update((m) => ({ ...m, name: nameInput.value }), { coalesce: 'name' });
});

/* ---------- keyboard ---------- */

/** Arrow keys as plan directions: north is up on the plan. */
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** One key, one tool: the palette says which. */
const TOOL_KEYS = Object.fromEntries(TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => t.key)
  .map((t) => [t.key.toLowerCase(), t.id]));
const LAYOUT_KEYS = Object.fromEntries(LAYOUTS.map((l) => [l.key, l.id]));

/** Where a typed key belongs to a field rather than to the application. */
function isTyping(t, ev) {
  if (!t || !t.tagName) return false;
  const textEntry = t.tagName === 'TEXTAREA' || t.isContentEditable
    || (t.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password|)$/.test(t.type || ''));
  // A list keeps the keys it uses itself: arrows, letters for type-ahead, Enter.
  const listKey = t.tagName === 'SELECT' && !ev.ctrlKey && !ev.metaKey
    && (ev.key.length === 1 || /^(Arrow|Page|Home|End|Enter)/.test(ev.key));
  return { textEntry, typing: textEntry || listKey };
}

document.addEventListener('keydown', (ev) => {
  // A dialog has the keyboard to itself: Échap closes it, nothing else runs.
  if (ev.target.closest?.('dialog')) return;
  // Only a field one types into keeps the keyboard. A slider, a checkbox or a
  // button that merely has the focus after a click did too, and the shortcuts
  // went dead — Suppr, [ ], Échap — until one clicked somewhere else.
  const t = ev.target;
  const { textEntry = false, typing = false } = isTyping(t, ev) || {};
  const mod = ev.ctrlKey || ev.metaKey;
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  // The project's own commands answer even from a field: Ctrl+S in the name
  // field means save, and the browser's « save the page » would be a trap.
  if (mod && !ev.altKey && (key === 's' || key === 'o' || key === 'e')) {
    ev.preventDefault();
    if (key === 's') save(ev.shiftKey);
    else if (key === 'o') openFile();
    else exportDialog.open();
    return;
  }
  // In a text field, undo is the field's own: taking it over rewound the last
  // model change instead of the typing.
  if (textEntry && mod && /^[zy]$/i.test(ev.key)) return;
  if (mod && key === 'z') {
    ev.preventDefault();
    ev.shiftKey ? store.redo() : store.undo();
    return;
  }
  if (mod && key === 'y') {
    ev.preventDefault();
    store.redo();
    return;
  }
  if (typing) return;
  if (mod && key === 'd') {
    ev.preventDefault();
    store.duplicateSelected();
    return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (store.deleteSelected()) ev.preventDefault();
    return;
  }
  if (ARROWS[ev.key] && !t.closest?.('input, select, textarea, [role="slider"], [role="separator"]')) {
    // The selection, nudged — a field with the focus keeps its own arrows.
    const [dx, dy] = ARROWS[ev.key];
    if (nudgeSelection(store, dx, dy, ev.shiftKey)) ev.preventDefault();
    return;
  }
  if (ev.key === 'Escape') {
    // A gesture under way was already taken back by the view that owns it.
    // Then the tool goes back to Sélectionner, then the selection goes.
    if (store.tool !== 'select') store.setTool('select');
    else store.select(null);
    return;
  }
  if (mod || ev.altKey) return;
  if (ev.key === '[') rotate(-1);
  else if (ev.key === ']') rotate(1);
  else if (ev.key === '?') { ev.preventDefault(); showKeys(); }
  else if (TOOL_KEYS[key] && !ev.shiftKey) { ev.preventDefault(); store.setTool(TOOL_KEYS[key]); }
  else if (LAYOUT_KEYS[ev.key]) {
    ev.preventDefault();
    if (layout.phone) layout.setTab(LAYOUT_KEYS[ev.key] === 'both' ? layout.tab : LAYOUT_KEYS[ev.key]);
    else layout.setLayout(LAYOUT_KEYS[ev.key]);
  }
});

/* ---------- render loop ---------- */

function renderAll() {
  plan.render();
  viewport.render();
  inspector.render();
  syncTools(toolsRoot, hint, store);
  $('btn-undo').disabled = !store.canUndo;
  $('btn-redo').disabled = !store.canRedo;
  $('rot-label').textContent = pointName(store.model.camera.yaw);
  if (nameInput.value !== store.model.name) nameInput.value = store.model.name;
  layout.markSettings(!!store.selection && layout.tab !== 'settings');
}

/**
 * What a camera move changes: the drawing, and what reads the camera back —
 * the bearing in the toolbar and the « Vue » section. Nothing else looks at it,
 * so an orbit no longer redraws the plan nor rebuilds the inspector at every
 * frame.
 */
function renderCamera() {
  viewport.render();
  inspector.syncCamera();
  $('rot-label').textContent = pointName(store.model.camera.yaw);
}

let frame = null;
let full = false;
function scheduleRender(_store, reason) {
  if (reason !== 'camera') full = true;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    const all = full;
    full = false;
    if (all) renderAll(); else renderCamera();
  });
}

store.subscribe(scheduleRender);
layout.onChange = () => scheduleRender(store, 'layout');
// The autosave waits for a pause; a page being closed will not get one.
window.addEventListener('pagehide', () => store.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flush();
});
window.addEventListener('resize', scheduleRender);
// The inspector skips its own rebuild while one of its controls is mid-drag;
// the release fires 'change', which runs the refresh it deferred.
$('inspector').addEventListener('change', scheduleRender);

// The panels also resize without the window doing so — the splitter, a
// layout switch — and a view sized from a stale measurement letterboxes
// itself.
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => scheduleRender(store, 'layout'));
  ro.observe($('plan'));
  ro.observe($('iso'));
}

/*
 * A change of language rewrites every word on the page where it stands: the
 * page's own, the palette, the pad, the help, the open dialogs, the
 * inspector and the drawings' dimensions. Nothing is reloaded, the project
 * and its history are not touched, and the names the project holds stay as
 * they were given.
 */
onLanguageChange(() => {
  applyPageWords();
  buildTools(toolsRoot, store);
  buildNav();
  buildKeys();
  layout.relabel();
  plan.relabel();
  exportDialog.relabel();
  gallery.relabel();
  renderAll();
});

buildTools(toolsRoot, store);
buildNav();
buildKeys();
nameInput.value = store.model.name;
store.setTool('select');
// The first drawing is made now, not in an animation frame: a frame that the
// browser judges hidden — a background tab, an iframe under load — gets none,
// and the page stayed blank until it did. Later changes go through the frame.
try {
  renderAll();
} catch (e) {
  // A project that normalises but will not draw: set it aside like one that
  // will not parse, and open the default model rather than a blank page.
  setAside(store.model);
  boot.rejected = 'local';
  store.reset(presetModel(PRESETS[0]));
  plan.refit();
  renderAll();
}
if (boot.rejected) {
  toast(boot.rejected === 'link' ? t('link.unreadableDefault') : t('project.restoreFailed'), 8000);
}

// For the test bench and the console: the running store, nothing else.
window.__app = {
  store, viewport, plan, inspector, layout, exportDialog, gallery, render: renderAll, renderCamera,
  i18n: { t, language, setLanguage },
};
// Tell the boot guard of index.html that the interface stands: from here on,
// the page's own error net answers for what goes wrong.
window.__bootReady?.();

// On a genuinely first visit, offer the gallery rather than leaving someone to
// guess what the tool is for — over the first preset, which beats an empty
// grid behind it. Returning visitors get their project straight back, even an
// empty one: a page left blank on purpose is still their page.
if (boot.source === 'link') toast(boot.previous ? t('link.openedOver') : t('link.opened'), 6000);

if (boot.source === 'default') {
  requestAnimationFrame(() => gallery.open({ replacing: false }));
}
