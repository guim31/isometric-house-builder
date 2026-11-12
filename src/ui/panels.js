/**
 * The inspector: global settings, plus whatever is currently selected.
 */

import { THEMES, materialColour } from '../core/palette.js';
import {
  PROJECTIONS, PITCH_RANGE, ROLL_RANGE, DEFAULT_PITCH, normaliseYaw,
} from '../core/iso.js';
import { ROOF_TYPES, STEP } from '../core/roof.js';
import {
  withCellSize, withTheme, cellSizeOf, cellSet, buildingOfEdge,
  storeyHeightOf, DEFAULT_FOCUS, PROP_DEFAULTS, OPENING_DEFAULTS, fitOpening, overlappingOpenings, newId, CELL_SIZES, STOREY_HEIGHT_RANGE, stairsSteps,
  TURNABLE_KINDS, quarterTurn, FIXTURE_DEFAULTS, fixtureZRange, FIXED_SHAPE_KINDS,
} from '../core/model.js';
import { bounds, edgeRunExtent } from '../core/grid.js';
import { ROOF_TEXTURES, WALL_TEXTURES } from '../render/texture.js';
import { parseDecimal, formatDecimal, settle, digitsFor } from './numeric.js';
import { prefs, setPrefs } from './prefs.js';
import { roofAt, OFF_ROOF } from './actions.js';
import { icon } from './icons.js';
import { t, metres } from '../i18n/index.js';
import { pointName } from './words.js';
import { backgroundName } from './export-dialog.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Separator naming a family of sections. */
const groupTitle = (text) => h('p', 'panel-group', text);

function field(label, control, hint) {
  const row = h('label', 'field');
  row.appendChild(h('span', 'field-label', label));
  row.appendChild(control);
  if (hint) row.appendChild(h('span', 'field-hint', hint));
  return row;
}

/**
 * A slider doubled by a field for the exact value.
 *
 * The slider keeps its step — it is for feeling one's way — while the field
 * takes what is typed, to the centimetre where the model keeps centimetres
 * (`exact`), within the slider's own bounds: « 3,40 » is 3.40, not the
 * nearest notch. `unit` follows the field; `note` adds a word about the value
 * — a bearing, « aucun » — that a number alone does not say.
 */
function slider(value, { min, max, step, onInput, unit = 'm', note = null, exact = null, digits = null }) {
  const wrap = h('span', 'slider');
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min, max, step, value });
  const fine = exact ?? (unit === 'm' ? 0.01 : step);
  const places = digits ?? digitsFor(Math.min(step, fine));
  const num = numberField(value, {
    min, max, exact: fine, digits: places,
    onChange: (v) => { input.value = v; if (noteEl) noteEl.textContent = note(v); onInput(v); },
  });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    num.value = formatDecimal(v, places);
    if (noteEl) noteEl.textContent = note(v);
    onInput(v);
  });
  wrap.append(input, num);
  if (unit) wrap.appendChild(h('span', 'num-unit', unit));
  const noteEl = note ? h('span', 'slider-note', note(value)) : null;
  if (!noteEl) return wrap;
  const box = h('span', 'slider-box');
  box.append(wrap, noteEl);
  return box;
}

/**
 * A field for a number typed by hand: a comma or a point, a unit or none.
 * What cannot be read is refused and the value put back; what is out of
 * bounds is brought in. Committed on Entrée or on leaving the field, so a
 * value half typed draws nothing. `onChange` may return false to refuse a
 * value it cannot take, which is then put back too.
 */
function numberField(value, { min, max, exact = 0.01, digits = 2, onChange, label = null }) {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.className = 'num';
  input.value = formatDecimal(value, digits);
  input.dataset.min = String(min);
  input.dataset.max = String(max);
  if (label) input.setAttribute('aria-label', label);
  let shown = value;
  const commit = () => {
    const typed = parseDecimal(input.value);
    const v = settle(typed, { min, max, exact });
    if (!Number.isFinite(v)) {
      input.value = formatDecimal(shown, digits);
      input.classList.remove('invalid');
      return;
    }
    input.value = formatDecimal(v, digits);
    if (Math.abs(v - shown) < 1e-9) return;
    if (onChange(v) === false) { input.value = formatDecimal(shown, digits); return; }
    shown = v;
  };
  input.addEventListener('change', commit);
  input.addEventListener('input', () => input.classList.toggle('invalid', !Number.isFinite(parseDecimal(input.value))));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { input.value = formatDecimal(shown, digits); input.classList.remove('invalid'); input.blur(); ev.stopPropagation(); }
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      // The arrows step the value, as in a number field, by the slider's
      // finest step; the selection is not moved from here.
      ev.preventDefault();
      const cur = parseDecimal(input.value);
      const base = Number.isFinite(cur) ? cur : shown;
      input.value = formatDecimal(settle(base + (ev.key === 'ArrowUp' ? 1 : -1) * (exact || 1) * (ev.shiftKey ? 10 : 1), { min, max, exact }), digits);
      commit();
    }
  });
  return input;
}

function select(value, options, onChange) {
  const s = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function toggle(value, onChange) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

/**
 * A number field that keeps to its own bounds. The browser only advises them:
 * typed, -50 went through as is, and a field emptied by mistake came through
 * as 0 — a framing zone zero metres wide, an item sent back to the origin.
 */
function number(value, { min, max, step, onChange, exact = 0.01 }) {
  const row = h('span', 'num-row');
  row.append(numberField(value, { min, max, exact: Math.min(step, exact), digits: 2, onChange }), h('span', 'num-unit', 'm'));
  return row;
}

/** Materials the user can recolour, grouped as they are presented. */
const COLOUR_GROUPS = [
  ['building', ['wall', 'roof', 'roofEdge', 'plinth']],
  ['joinery', ['trim', 'door', 'shutter', 'garage', 'glass']],
  ['outside', ['grass', 'paving', 'water', 'foliage']],
];

/*
 * The kinds each list of choices offers, in the order shown. Their names are
 * read from the dictionary when the panel is drawn — `ridge.ew`, `slope.S` —
 * so that a change of language finds them in the new one.
 */
const RIDGES = ['auto', 'ew', 'ns'];
const SLOPES = ['S', 'N', 'W', 'E'];
const GROUNDS = ['grass', 'paving', 'gravel'];
const OPENING_KINDS = ['window', 'shutter', 'door', 'garage'];
const ROOF_ITEM_KINDS = ['solar', 'chimney', 'velux', 'dish'];
const FIXTURE_KINDS = ['wallLight', 'camera', 'charger'];
const FACES = ['S', 'N', 'E', 'W'];
const options = (ids, prefix) => ids.map((id) => [id, t(`${prefix}.${id}`)]);

/** What an item is called: its tool's name, or the deck's own. */
const kindName = (kind) => (kind === 'deck' ? t('kind.deck') : t(`tool.${kind}`));

/** A level's name: the ground floor, then the floors above. */
const levelName = (i) => (i === 0 ? t('insp.ground') : t('insp.level', { n: i }));

/** The levels a wall item can sit on — one taken away since included, and said so. */
const storeyOptions = (storeys, level) => Array.from({ length: Math.max(storeys, level + 1) }, (_, i) => [String(i),
  i >= storeys ? t('insp.levelGone', { level: levelName(i) }) : levelName(i)]);

/**
 * Where an opening sits along its wall, counted the way a person would.
 *
 * Stored, an offset is the *centre* of the opening measured from the start of
 * a boundary edge — and a boundary edge is one cell long, so the origin is
 * some cell corner partway along the facade. A user reported the obvious
 * consequence: "0 should intuitively be the corner where the wall begins, but
 * it isn't", and his own file has a window at -0.75 to prove how he got there.
 *
 * Only the reading changes. The file keeps its offsets exactly as they were,
 * so a project saved or shared before this still opens where it was left, and
 * placing or dragging an opening goes on speaking the edge's language.
 */
function positionField(m, item, patch) {
  const cs = cellSizeOf(m);
  const host = buildingOfEdge(m, item.edge);
  const run = host ? edgeRunExtent(new Set(host.cells), item.edge, cs) : null;
  const w = item.width ?? FIXTURE_DEFAULTS[item.kind]?.width ?? 1.2;
  if (!run) {
    // The wall has been erased under it; fall back rather than show nothing.
    return field(t('insp.position'), slider(item.offset ?? 0.5, {
      min: -1, max: 2, step: 0.05, unit: 'm',
      onInput: (v) => patch({ offset: v }, 'offset'),
    }), t('insp.alongWall'));
  }
  const from = (item.offset ?? 0.5) - w / 2 - run.lo;
  // An opening already past a corner — older files have them — widens the
  // course instead of being shown at the corner, which made the first nudge
  // jump it there.
  const max = Math.max(0, run.hi - run.lo - w, from);
  const min = Math.min(0, from);
  const outside = from < -1e-6 || from > run.hi - run.lo - w + 1e-6;
  const fixture = !!FIXTURE_DEFAULTS[item.kind];
  return field(t('insp.position'), slider(Math.round(from * 100) / 100, {
    min, max, step: 0.05, unit: 'm',
    onInput: (v) => patch({ offset: v + run.lo + w / 2 }, 'offset'),
  }), outside
    ? t(fixture ? 'insp.pastFixture' : 'insp.pastOpening')
    : t(fixture ? 'insp.fromCornerFixture' : 'insp.fromCornerOpening'));
}

export class Inspector {
  constructor(root, store, { onExport = null, askText = null, notify = null } = {}) {
    this.root = root;
    this.store = store;
    this.onExport = onExport;
    // The page's dialogs and messages, when there is a page: a name to ask
    // for, a deletion to offer to take back.
    this.askText = askText;
    this.notify = notify || ((message) => store.notify(message));
    // The range or colour input in the middle of a gesture, if any. Replacing
    // one mid-drag detaches it, which kills the drag and can close a native
    // colour picker, so the panel waits. The gesture ends with 'change', and
    // the shell listens for it to run the refresh deferred until then.
    //
    // Keyed on the gesture, not on focus: a slider keeps the focus once let go,
    // and a panel waiting for it to lose it went on showing — and writing back —
    // values from before the change.
    this.busy = null;
    root.addEventListener('input', (ev) => {
      if (ev.target.type === 'range' || ev.target.type === 'color') this.busy = ev.target;
    }, true);
    root.addEventListener('change', (ev) => {
      if (ev.target === this.busy) this.busy = null;
    }, true);
    // A colour picker dismissed without a choice may never fire 'change'.
    root.addEventListener('focusout', (ev) => {
      if (ev.target !== this.busy) return;
      this.busy = null;
      requestAnimationFrame(() => this.render());
    });
  }

  /**
   * Which control has the focus, in terms that survive a rebuild: its section,
   * its label, and its rank among controls sharing both.
   */
  focusKey(el) {
    if (!el || !this.root.contains(el) || !el.matches('input, select, button')) return null;
    const sig = (n) => [
      n.closest('details')?.dataset.section ?? '',
      n.closest('.field')?.querySelector('.field-label')?.textContent ?? n.textContent,
      n.type,
    ].join('|');
    const key = sig(el);
    const same = [...this.root.querySelectorAll('input, select, button')].filter((n) => sig(n) === key);
    return { key, rank: same.indexOf(el), sig };
  }

  restoreFocus(f, caret) {
    if (!f) return;
    const same = [...this.root.querySelectorAll('input, select, button')].filter((n) => f.sig(n) === f.key);
    const el = same[f.rank];
    if (!el) return;
    el.focus({ preventScroll: true });
    if (caret && el.type === 'text') el.setSelectionRange(caret[0], caret[1]);
  }

  render() {
    if (this.busy && this.root.contains(this.busy)) return;
    this.busy = null;
    // The panel is rebuilt from scratch on every change, which would drop the
    // focus — and with it the next keystroke typed into a name.
    const active = document.activeElement;
    const focus = this.focusKey(active);
    const caret = active?.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
    // Where the panel was scrolled to, kept: emptied for an instant, the
    // column would otherwise spring back to the top while one sets a value
    // halfway down.
    const scroll = this.root.scrollTop;
    this.root.replaceChildren();
    const sel = this.store.selected;
    // Three families, in the order the work goes: what is selected, then the
    // volume being edited, then the project as a whole, then how it is looked
    // at and exported. Everything below the first is folded away by default —
    // there is now far more here than fits on a screen, and a wall of open
    // panels reads as clutter rather than as capability.
    this.root.append(
      groupTitle(t('insp.selection')),
      sel ? this.selectionSection(sel) : this.emptySelection(),
      groupTitle(t('insp.building')),
      this.activeSection(),
      this.buildingSection(),
      groupTitle(t('insp.project')),
      this.appearanceSection(),
      this.coloursSection(),
      this.groundSection(),
      groupTitle(t('insp.viewExport')),
      this.viewSection(),
      this.focusSection(),
    );
    this.restoreFocus(focus, caret);
    this.root.scrollTop = scroll;
  }

  /**
   * Bring what shows the camera up to date, without rebuilding anything.
   *
   * An orbit changes the camera sixty times a second, and nothing in the panel
   * but the « Vue » section reads it: rebuilding the whole inspector for each
   * frame was most of what a turn cost. A control in the middle of its own
   * gesture is left alone — it is the one setting the value.
   */
  syncCamera() {
    const c = this.cameraControls;
    if (!c || !this.root.contains(c.projection)) { this.render(); return; }
    const cam = this.store.model.camera;
    if (c.badge) c.badge.textContent = `${t('insp.bearing', { yaw: Math.round(cam.yaw), point: pointName(cam.yaw) })}${c.views}`;
    for (const k of ['yaw', 'pitch', 'roll']) {
      const { input, num, note, format } = c[k];
      if (input === this.busy || num === document.activeElement) continue;
      const v = Math.round(cam[k]);
      input.value = v;
      num.value = String(v);
      if (note) note.textContent = format(v);
    }
    if (c.projection.value !== cam.projection) c.projection.value = cam.projection;
  }

  /** Stands in for the selection panel, so the group is never a bare title. */
  emptySelection() {
    return h('p', 'panel-empty', t('insp.empty'));
  }

  /**
   * A collapsible section. Returns its body, with the <details> itself hanging
   * off `.panel` so the caller can hand it back.
   *
   * `badge` is what the section says about itself while folded: a palette
   * name, a camera bearing, how many volumes there are. Without it a closed
   * panel is a title and nothing else, and everything has to be opened to be
   * read.
   */
  section(title, { id, open = false, badge = '', accent = false } = {}) {
    const d = h('details', `panel${accent ? ' panel-selected' : ''}`);
    d.dataset.section = id;
    // Which sections are unfolded is kept in the interface's settings rather
    // than in the DOM: the panel is rebuilt on every change to the model, and
    // a <details> rebuilt from scratch would spring shut under the hand — and
    // a section opened today is wanted open tomorrow.
    const remembered = prefs().sections[id];
    d.open = remembered ?? open;
    const sum = document.createElement('summary');
    sum.className = 'panel-title';
    sum.appendChild(h('span', 'panel-name', title));
    if (badge) sum.appendChild(h('span', 'panel-badge', badge));
    d.appendChild(sum);
    // Attached after the initial state is set, so restoring it fires nothing.
    d.addEventListener('toggle', () => {
      if (prefs().sections[id] !== d.open) setPrefs({ sections: { ...prefs().sections, [id]: d.open } });
    });
    const body = h('div', 'panel-body');
    d.appendChild(body);
    body.panel = d;
    return body;
  }

  /** A plain block: the selection is transient, folding it away helps nobody. */
  block(title) {
    const s = h('section', 'panel panel-selected panel-block');
    s.appendChild(h('h2', 'panel-title', title));
    return s;
  }

  set(patch, coalesce) {
    this.store.update((m) => ({ ...m, ...patch }), { coalesce });
  }

  setIn(keyName, patch, coalesce) {
    this.store.update((m) => ({ ...m, [keyName]: { ...m[keyName], ...patch } }), { coalesce });
  }

  buildingSection() {
    const m = this.store.model;
    const cs = cellSizeOf(m);
    const b = bounds(cellSet(m));
    const dims = b.empty ? '—'
      : t('insp.dims', { w: metres(b.w * cs), d: metres(b.d * cs) });
    const n = m.buildings.length;
    const s = this.section(t('insp.bodies'), {
      id: 'Tous les corps',
      badge: t('insp.bodiesBadge', { n, dims }),
    });
    s.append(
      field(t('insp.footprint'), h('span', 'field-static', dims), t('insp.footprintHint')),
      field(t('insp.grid'), select(String(cs), CELL_SIZES.map((v) => [String(v), t('insp.gridOption', { v: metres(v) })]),
        (v) => this.store.update((mm) => withCellSize(mm, Number(v)))),
        t('insp.gridHint')),
    );

    // The list of volumes. Each one owns its roof and its height, so a garden
    // shed can be flat-roofed and timber-clad while the house keeps its tiles.
    const list = h('div', 'building-list');
    for (const bd of m.buildings) {
      const active = bd.id === this.store.activeBuildingId;
      const row = h('button', `building-row${active ? ' active' : ''}`);
      const area = bd.cells.length * cs * cs;
      row.type = 'button';
      row.innerHTML = `<span class="building-name"></span><span class="building-meta"></span>`;
      row.querySelector('.building-name').textContent = bd.name;
      row.querySelector('.building-meta').textContent =
        bd.cells.length ? t('insp.bodyMeta', { area: metres(Math.round(area * 10) / 10), roof: t(`roof.${bd.roof.type}`) }) : t('insp.toDraw');
      row.addEventListener('click', () => {
        this.store.setActiveBuilding(bd.id);
        this.store.select({ type: 'building', id: bd.id });
      });
      list.appendChild(row);
    }
    s.appendChild(list);

    const add = h('button', 'subtle', t('insp.addBody'));
    add.addEventListener('click', () => this.store.addBuilding());
    s.appendChild(add);
    return s.panel;
  }

  /** Settings of the volume currently being edited. */
  /**
   * The volume being edited, in three sections rather than one.
   *
   *
   * As one, it ran to a dozen controls and pushed everything else in the panel
   * below the fold — which is how a tool ends up looking as though it has one
   * screen of settings and a mystery. Shape, roof and materials are three
   * different questions, and they are asked at different moments.
   */
  activeSection() {
    const b = this.store.activeBuilding;
    if (!b) return document.createDocumentFragment();
    const m = this.store.model;
    const frag = document.createDocumentFragment();
    const s = this.section(t('insp.body'), {
      id: 'active', open: true, accent: true,
      badge: t('insp.bodyBadge', { name: b.name, n: b.storeys }),
    });
    frag.appendChild(s.panel);

    const name = document.createElement('input');
    name.type = 'text';
    name.value = b.name;
    name.addEventListener('input', () => this.store.patchBuilding({ name: name.value }, 'bname'));
    s.appendChild(field(t('insp.name'), name));

    s.append(
      field(t('insp.storeys'), slider(b.storeys, {
        min: 1, max: 4, step: 1, unit: '', exact: 1,
        onInput: (v) => this.store.patchBuilding({ storeys: v }, 'storeys'),
      })),
    );
    /*
     * One height per level once there is more than one level. The recurring
     * real house this serves has full storeys below and a short one under the
     * roof — the level where the slopes already start. A single shared height
     * cannot say that, and rounding it to 2 or 3 whole storeys misses the
     * house by half a metre either way.
     */
    const [hMin, hMax] = STOREY_HEIGHT_RANGE;
    if (b.storeys <= 1) {
      // What is drawn is the first level's own height when the building has
      // one — left over from when it had more levels, and kept for when it
      // has them again.
      s.append(field(t('insp.storeyHeight'), slider(storeyHeightOf(b, 0), {
        min: hMin, max: hMax, step: 0.1, unit: 'm',
        onInput: (v) => this.store.patchBuilding((cur) => ({
          storeyHeight: v,
          storeyHeights: cur.storeyHeights ? [v, ...cur.storeyHeights.slice(1)] : null,
        }), 'storeyHeight'),
      })));
    } else {
      for (let i = 0; i < b.storeys; i++) {
        const level = i;
        s.append(field(t('insp.levelHeight', { level: levelName(i) }), slider(storeyHeightOf(b, i), {
          min: hMin, max: hMax, step: 0.1, unit: 'm',
          onInput: (v) => this.store.patchBuilding((cur) => {
            const heights = Array.from({ length: Math.max(cur.storeys, cur.storeyHeights?.length ?? 0) },
              (_, k) => storeyHeightOf(cur, k));
            heights[level] = v;
            return { storeyHeights: heights };
          }, `sh${level}`),
        }), i === b.storeys - 1 ? t('insp.atticHint') : undefined));
      }
    }
    s.append(
      field(t('insp.plinth'), slider(b.plinth, {
        min: 0, max: 0.8, step: 0.05, unit: 'm',
        onInput: (v) => this.store.patchBuilding({ plinth: v }, 'plinth'),
      })),
    );

    // Whole-body actions, discreet: they are used now and then, not at every
    // visit. Openings, roof items and a shed's slope follow the body.
    const acts = h('div', 'body-actions');
    for (const [label, title, run] of [
      ['insp.duplicate', 'insp.duplicateTitle', () => this.store.duplicateBuilding(b.id)],
      ['insp.rotate', 'insp.rotateTitle', () => this.store.rotateBuilding(b.id)],
      ['insp.mirror', 'insp.mirrorTitle', () => this.store.mirrorBuilding(b.id)],
    ]) {
      const btn = h('button', 'body-action', t(label));
      btn.type = 'button';
      btn.title = t(title);
      btn.disabled = !b.cells.length;
      btn.addEventListener('click', run);
      acts.appendChild(btn);
    }
    s.appendChild(acts);
    if (m.buildings.length > 1) {
      const del = h('button', 'danger', t('insp.deleteBody'));
      del.addEventListener('click', () => this.store.removeBuilding(b.id));
      s.appendChild(del);
    }

    const roof = this.section(t('insp.roof'), {
      id: 'active-roof', open: true, badge: t(`roof.${b.roof.type}`),
    });
    roof.appendChild(this.roofFields(b));
    frag.appendChild(roof.panel);

    // Materials of this volume, defaulting to the model's.
    const tex = b.texture || m.texture;
    const own = Object.keys(b.overrides || {}).length || b.texture;
    const mat = this.section(t('insp.materials'), {
      id: 'active-mat',
      badge: own ? t('insp.ownSettings') : t('insp.likeProject'),
    });
    frag.appendChild(mat.panel);
    mat.append(
      field(t('insp.roofMaterial'), select(tex.roof, options(Object.keys(ROOF_TEXTURES), 'roofTexture'),
        (v) => this.store.patchBuilding({ texture: { ...tex, roof: v } })),
        b.texture ? t('insp.ownBody') : t('insp.fromProject')),
      field(t('insp.wallMaterial'), select(tex.wall, options(Object.keys(WALL_TEXTURES), 'wallTexture'),
        (v) => this.store.patchBuilding({ texture: { ...tex, wall: v } }))),
    );

    // Per-volume colours, over the palette. This is what lets one building be
    // timber-clad white while the rest of the model stays as it is.
    const grid = h('div', 'colour-grid');
    for (const key of ['wall', 'roof', 'roofEdge']) {
      const cell = h('label', 'colour-cell');
      const input = document.createElement('input');
      input.type = 'color';
      input.value = materialColour(key, m.theme, { ...m.overrides, ...b.overrides });
      input.addEventListener('input', () => {
        this.store.patchBuilding(
          (cur) => ({ overrides: { ...cur.overrides, [key]: input.value } }), `bcol:${key}`,
        );
      });
      cell.append(input, h('span', null, t(`colour.${key}`)));
      grid.appendChild(cell);
    }
    const group = h('div', 'colour-group');
    group.appendChild(h('span', 'colour-group-title', t('insp.bodyColours')));
    group.appendChild(grid);
    mat.appendChild(group);

    if (own) {
      const reset = h('button', 'subtle', t('insp.resetBody'));
      reset.addEventListener('click', () => this.store.patchBuilding({ overrides: {}, texture: null }));
      mat.appendChild(reset);
    }
    return frag;
  }

  /** Roof controls for one volume. */
  roofFields(b) {
    const s = h('div', 'roof-fields');
    s.appendChild(field(t('insp.roofShape'), select(b.roof.type, options(ROOF_TYPES, 'roof'),
      (v) => this.store.patchRoof({ type: v }))));
    if (b.roof.type === 'gable') {
      s.appendChild(field(t('insp.ridge'), select(b.roof.ridge || 'auto', options(RIDGES, 'ridge'),
        (v) => this.store.patchRoof({ ridge: v })), t('insp.ridgeHint')));
    }
    if (b.roof.type === 'shed') {
      s.appendChild(field(t('insp.slope'), select(b.roof.shedDir, options(SLOPES, 'slope'),
        (v) => this.store.patchRoof({ shedDir: v }))));
    }
    if (b.roof.type !== 'flat') {
      s.appendChild(field(t('insp.pitch'), slider(b.roof.pitch, {
        min: 5, max: 55, step: 1, unit: '°',
        onInput: (v) => this.store.patchRoof({ pitch: v }, 'pitch'),
      })));
    }
    s.append(
      field(t('insp.overhang'), slider(b.roof.overhang, {
        min: 0, max: 1.25, step: STEP, unit: 'm', exact: STEP,
        onInput: (v) => this.store.patchRoof({ overhang: v }, 'overhang'),
      }), t('insp.overhangHint', { step: STEP })),
      field(t('insp.fascia'), slider(b.roof.fascia, {
        min: 0, max: 0.4, step: 0.02, unit: 'm',
        onInput: (v) => this.store.patchRoof({ fascia: v }, 'fascia'),
      })),
    );
    return s;
  }

  appearanceSection() {
    const m = this.store.model;
    const theme = THEMES[m.theme] ? t(`theme.${m.theme}`) : m.theme;
    const s = this.section(t('insp.appearance'), {
      id: 'Apparence',
      badge: m.style.night ? t('insp.nightBadge', { theme }) : theme,
    });
    s.append(
      field(t('insp.palette'), select(m.theme, options(Object.keys(THEMES), 'theme'),
        (v) => this.store.update((mm) => withTheme(mm, v))), t('insp.paletteHint')),
      field(t('insp.outline'), toggle(m.style.outline, (v) => this.setIn('style', { outline: v }))),
      field(t('insp.shadow'), toggle(m.style.shadow, (v) => this.setIn('style', { shadow: v }))),
      field(t('insp.windowBars'), toggle(m.style.windowBars !== false,
        (v) => this.setIn('style', { windowBars: v }))),
      field(t('insp.night'), toggle(m.style.night, (v) => this.setIn('style', { night: v })),
        t('insp.nightHint')),
      // The background is chosen where its effect is seen: in the export
      // window, over the preview. Said here, with the way there.
      field(t('insp.background'), this.backgroundLink(m),
        m.style.night ? t('insp.backgroundNight') : t('insp.backgroundHint')),
    );
    return s.panel;
  }

  backgroundLink(m) {
    const current = m.style.night ? t('insp.nightSky') : backgroundName(m.style.background);
    const b = h('button', 'link-button', t('insp.choose', { current }));
    b.type = 'button';
    b.addEventListener('click', () => this.onExport?.());
    return b;
  }

  /** Textures and per-material colour overrides. */
  coloursSection() {
    const m = this.store.model;
    const tweaks = Object.keys(m.overrides).length;
    const s = this.section(t('insp.colours'), {
      id: 'Couleurs et matières',
      badge: [
        ROOF_TEXTURES[m.texture.roof] ? t(`roofTexture.${m.texture.roof}`) : '',
        tweaks ? t('insp.tweaks', { n: tweaks }) : '',
      ].filter(Boolean).join(' · '),
    });
    s.append(
      field(t('insp.roofMaterial'), select(m.texture.roof, options(Object.keys(ROOF_TEXTURES), 'roofTexture'),
        (v) => this.setIn('texture', { roof: v }))),
      field(t('insp.wallMaterial'), select(m.texture.wall, options(Object.keys(WALL_TEXTURES), 'wallTexture'),
        (v) => this.setIn('texture', { wall: v }))),
    );

    for (const [title, mats] of COLOUR_GROUPS) {
      const group = h('div', 'colour-group');
      group.appendChild(h('span', 'colour-group-title', t(`colour.${title}`)));
      const grid = h('div', 'colour-grid');
      for (const mat of mats) {
        const cell = h('label', 'colour-cell');
        const input = document.createElement('input');
        input.type = 'color';
        input.value = materialColour(mat, m.theme, m.overrides);
        input.addEventListener('input', () => {
          this.store.update(
            (mm) => ({ ...mm, overrides: { ...mm.overrides, [mat]: input.value } }),
            { coalesce: `colour:${mat}` },
          );
        });
        cell.append(input, h('span', null, t(`colour.${mat}`)));
        grid.appendChild(cell);
      }
      group.appendChild(grid);
      s.appendChild(group);
    }

    const count = Object.keys(m.overrides).length;
    const reset = h('button', 'subtle', count ? t('insp.resetPaletteCount', { n: count }) : t('insp.resetPalette'));
    reset.disabled = !count;
    reset.addEventListener('click', () => this.store.update((mm) => ({ ...mm, overrides: {} })));
    s.appendChild(reset);
    return s.panel;
  }

  groundSection() {
    const m = this.store.model;
    const s = this.section(t('insp.terrain'), {
      id: 'Terrain',
      badge: m.ground.enabled ? t(`ground.${m.ground.material}`) : t('insp.hidden'),
    });
    s.appendChild(field(t('insp.show'), toggle(m.ground.enabled, (v) => this.setIn('ground', { enabled: v }))));
    if (m.ground.enabled) {
      s.append(
        field(t('insp.surface'), select(m.ground.material, options(GROUNDS, 'ground'),
          (v) => this.setIn('ground', { material: v }))),
        field(t('insp.margin'), slider(m.ground.margin, {
          min: 0, max: 10, step: 0.5, unit: 'm',
          onInput: (v) => this.setIn('ground', { margin: v }, 'margin'),
        })),
      );
    }
    return s.panel;
  }

  viewSection() {
    const m = this.store.model;
    const nv = m.views.length;
    const views = nv ? ` · ${t('insp.viewsCount', { n: nv })}` : '';
    const s = this.section(t('insp.view'), {
      id: 'Vue',
      open: true,
      badge: t('insp.bearing', { yaw: Math.round(m.camera.yaw), point: pointName(m.camera.yaw) }) + views,
    });
    const yawFormat = (v) => pointName(v);
    const yaw = slider(Math.round(m.camera.yaw), {
      min: 0, max: 359, step: 1, unit: '°', note: yawFormat,
      onInput: (v) => this.store.setCamera({ yaw: normaliseYaw(v) }),
    });
    const pitch = slider(Math.round(m.camera.pitch), {
      min: PITCH_RANGE[0], max: PITCH_RANGE[1], step: 1, unit: '°',
      onInput: (v) => this.store.setCamera({ pitch: v }),
    });
    const roll = slider(Math.round(m.camera.roll), {
      min: ROLL_RANGE[0], max: ROLL_RANGE[1], step: 1, unit: '°',
      onInput: (v) => this.store.setCamera({ roll: v }),
    });
    const projection = select(m.camera.projection, options(Object.keys(PROJECTIONS), 'projection'),
      (v) => this.store.setCamera({ projection: v }));
    s.append(
      // Free orbit, in numbers as well as by dragging: a saved view is worth
      // little if it cannot be reproduced, and "37°" can be typed back in.
      field(t('insp.orientation'), yaw, t('insp.orientationHint')),
      field(t('insp.eyeHeight'), pitch, t('insp.eyeHeightHint')),
      field(t('insp.roll'), roll, t('insp.rollHint')),
      field(t('insp.projection'), projection),
    );
    // What syncCamera updates in place when only the camera has moved.
    const ctl = (wrap, format) => ({
      input: wrap.querySelector('input[type="range"]'), num: wrap.querySelector('.num'),
      note: wrap.querySelector('.slider-note'), format,
    });
    this.cameraControls = {
      badge: s.panel.querySelector('.panel-badge'),
      views,
      yaw: ctl(yaw, yawFormat), pitch: ctl(pitch, null), roll: ctl(roll, null), projection,
    };

    const reset = h('button', 'subtle', t('insp.resetView'));
    reset.addEventListener('click', () => this.store.setCamera({
      // Read at the click: the section is no longer rebuilt as the camera
      // turns, so the camera it was drawn with may be minutes old.
      yaw: Math.round(this.store.model.camera.yaw / 90) % 4 * 90, pitch: DEFAULT_PITCH, roll: 0,
    }));
    s.appendChild(reset);

    // Saved views: one framing per widget, all re-exportable in one pass.
    if (m.views.length) {
      const list = h('div', 'building-list');
      for (const v of m.views) {
        const row = h('div', 'view-row');
        const apply = h('button', 'building-row');
        apply.type = 'button';
        apply.innerHTML = '<span class="building-name"></span><span class="building-meta"></span>';
        apply.querySelector('.building-name').textContent = v.name;
        apply.querySelector('.building-meta').textContent = v.focus.enabled
          ? t('insp.viewFramed', { point: pointName(v.camera.yaw), w: metres(v.focus.w), d: metres(v.focus.d) })
          : t('insp.viewWhole', { point: pointName(v.camera.yaw) });
        apply.addEventListener('click', () => this.set({
          camera: { ...v.camera }, focus: { ...DEFAULT_FOCUS, ...v.focus },
        }));
        const acts = h('span', 'view-acts');
        const act = (name, title, run, cls = '') => {
          const b = h('button', `icon-button${cls}`);
          b.type = 'button';
          b.title = title;
          b.setAttribute('aria-label', t('insp.viewAction', { action: title, name: v.name }));
          b.innerHTML = icon(name);
          b.addEventListener('click', run);
          acts.appendChild(b);
        };
        act('rename', t('insp.viewRename'), () => this.renameView(v.id));
        act('refresh', t('insp.viewUpdate'), () => this.updateView(v.id));
        act('trash', t('insp.viewDelete'), () => this.deleteView(v.id), ' delete');
        row.append(apply, acts);
        list.appendChild(row);
      }
      s.appendChild(list);
    }

    const save = h('button', 'subtle', t('insp.saveView'));
    save.addEventListener('click', () => this.saveView());
    s.appendChild(save);
    return s.panel;
  }

  /** The name of a view, asked in the page's own dialog. */
  async nameView(title, value, confirm) {
    if (!this.askText) return null;
    return this.askText({ title, label: t('view.name'), value, confirm });
  }

  async saveView() {
    const m = this.store.model;
    const name = await this.nameView(t('view.new'),
      m.focus.enabled ? t('default.viewFramed') : t('default.viewWhole'), t('view.save'));
    if (!name) return;
    // Read after the dialog: the camera may have moved while it was open.
    const now = this.store.model;
    this.set({
      views: [...now.views, {
        id: newId('v', now), name,
        camera: { ...now.camera }, focus: { ...now.focus },
      }],
    });
  }

  async renameView(id) {
    const v = this.store.model.views.find((x) => x.id === id);
    if (!v) return;
    const name = await this.nameView(t('view.rename'), v.name, t('view.renameOk'));
    if (!name || name === v.name) return;
    this.set({ views: this.store.model.views.map((x) => (x.id === id ? { ...x, name } : x)) });
  }

  /** The view takes the camera and the framing of the moment. */
  updateView(id) {
    const m = this.store.model;
    const v = m.views.find((x) => x.id === id);
    if (!v) return;
    this.set({ views: m.views.map((x) => (x.id === id ? { ...x, camera: { ...m.camera }, focus: { ...m.focus } } : x)) });
    this.notify(t('view.updated', { name: v.name }));
  }

  /**
   * Gone at once, with a way back offered at once: the view is put back where
   * it was, whatever has been done since — undo would also rewind that.
   */
  deleteView(id) {
    const views = this.store.model.views;
    const at = views.findIndex((x) => x.id === id);
    if (at < 0) return;
    const gone = views[at];
    this.set({ views: views.filter((x) => x.id !== id) });
    this.notify(t('view.deleted', { name: gone.name }), {
      label: t('undo'),
      run: () => {
        const now = this.store.model.views;
        if (now.some((x) => x.id === gone.id)) return;
        const next = [...now];
        next.splice(Math.min(at, next.length), 0, gone);
        this.set({ views: next });
      },
    });
  }

  /**
   * The framing rectangle.
   *
   * Its reason for existing is the dashboard widget that drives one device: a
   * picture of the whole property makes the gate a dozen pixels wide. Here the
   * zone is nudged numerically; the "Zone de cadrage" tool draws it directly
   * on the plan, which is faster for a first pass.
   */
  focusSection() {
    const m = this.store.model;
    const f = m.focus;
    const s = this.section(t('insp.framing'), {
      id: 'Cadrage de l’export',
      badge: f.enabled ? t('insp.dims', { w: metres(f.w), d: metres(f.d) }) : t('insp.off'),
    });
    s.append(field(t('insp.frameOn'), toggle(f.enabled, (v) => {
      if (!v) { this.setIn('focus', { enabled: false }); return; }
      // Switching it on frames the house. The zone stored by default sits at
      // the origin, which on most plans is an empty patch of lawn — turning
      // the setting on would then appear to blank the drawing.
      const b = bounds(cellSet(m));
      const cs = cellSizeOf(m);
      const box = b.empty ? {} : {
        x: b.i0 * cs, y: b.j0 * cs, w: (b.i1 - b.i0 + 1) * cs, d: (b.j1 - b.j0 + 1) * cs,
      };
      this.setIn('focus', { enabled: true, ...box });
    }), t('insp.frameOnHint')));
    if (!f.enabled) {
      s.appendChild(h('p', 'field-hint', t('insp.frameOff')));
      s.appendChild(this.exportButton());
      return s.panel;
    }

    const num = (label, k, opts) => field(label, number(f[k], {
      ...opts, onChange: (v) => this.setIn('focus', { [k]: v }),
    }));
    s.append(
      num(t('insp.westCorner'), 'x', { min: -200, max: 200, step: 0.25 }),
      num(t('insp.southCorner'), 'y', { min: -200, max: 200, step: 0.25 }),
      num(t('insp.width'), 'w', { min: 2, max: 200, step: 0.25 }),
      num(t('insp.depth'), 'd', { min: 2, max: 200, step: 0.25 }),
      field(t('insp.margin'), slider(f.margin, {
        min: 0, max: 10, step: 0.25, unit: 'm',
        onInput: (v) => this.setIn('focus', { margin: v }, 'focus'),
      }), t('insp.frameMarginHint')),
    );
    s.appendChild(h('p', 'field-hint', t('insp.frameNote')));
    s.appendChild(this.exportButton());
    return s.panel;
  }

  /**
   * The way out of the panel where the framing is set up.
   *
   * The button in the app bar remains, and does the same thing. Having one here
   * as well is not duplication so much as the answer to "and now what?": the
   * settings above exist for the export, and leaving them without a way to
   * reach it makes the reader hunt back up the screen for it.
   */
  exportButton() {
    const b = h('button', 'subtle export-link', t('insp.exportImage'));
    b.type = 'button';
    b.addEventListener('click', () => this.onExport?.());
    return b;
  }

  /**
   * The bounds of a roof item's coordinate: its roof's extent along that
   * axis, so a value typed far out lands on the far edge of the same roof.
   */
  roofSpan(item, axis) {
    const m = this.store.model;
    const host = roofAt(m, [item.x, item.y]);
    if (!host?.cells.length) return { min: 0, max: 60 };
    const cs = cellSizeOf(m);
    const vals = host.cells.map((k) => Number(k.split(',')[axis]));
    return { min: Math.min(...vals) * cs, max: (Math.max(...vals) + 1) * cs - 0.25 };
  }

  /** Move a roof item to a typed position, refused off every roof. */
  moveRoofItem(item, x, y) {
    if (!roofAt(this.store.model, [x, y])) {
      this.notify(t(OFF_ROOF));
      return false;
    }
    this.store.patchSelected({ x, y });
    return true;
  }

  selectionSection(item) {
    const type = this.store.selection.type;
    const s = this.block(kindName(item.kind));
    const patch = (p, c) => this.store.patchSelected(p, c);

    if (type === 'opening') {
      const m = this.store.model;
      const host = buildingOfEdge(m, item.edge) || this.store.activeBuilding;
      const storeys = host ? host.storeys : 1;
      const level = item.storey || 0;
      // A window turned into a door goes down to the floor: the sill and the
      // height follow the new kind wherever they were still the old kind's
      // defaults. A value set by hand is a choice, and is kept.
      s.appendChild(field(t('insp.type'), select(item.kind, options(OPENING_KINDS, 'tool'), (v) => patch((it, mm) => {
        const was = OPENING_DEFAULTS[it.kind] || {}, now = OPENING_DEFAULTS[v] || {};
        const next = { ...it, kind: v };
        for (const k of ['sill', 'height']) if (it[k] === was[k]) next[k] = now[k];
        return fitOpening(mm, next);
      }))));
      // Also shown when the opening sits on a level since taken away: it is
      // not drawn any more, and this is the one place it can be brought down.
      if (storeys > 1 || level >= storeys) {
        s.appendChild(field(t('insp.storey'), select(String(level), storeyOptions(storeys, level),
          (v) => patch({ storey: Number(v) })),
        level >= storeys ? t('insp.storeyGoneOpening') : undefined));
      }
      // Height and sill share the level between them: together they never
      // reach past the floor above.
      const levelH = host ? storeyHeightOf(host, level) : 2.7;
      const room = (v) => Math.floor((levelH - v) * 20 + 1e-6) / 20;
      const overlaps = overlappingOpenings(m, item).length;
      s.append(
        positionField(m, item, patch),
        field(t('insp.width'), slider(item.width, {
          min: 0.4, max: 5, step: 0.1, unit: 'm',
          onInput: (v) => patch((it, mm) => fitOpening(mm, { ...it, width: v }), 'w'),
        }), overlaps ? t('insp.overlaps', { n: overlaps }) : undefined),
        field(t('insp.height'), slider(item.height, {
          min: 0.4, max: Math.max(0.4, Math.min(3, room(item.sill ?? 0))), step: 0.05,
          unit: 'm',
          onInput: (v) => patch((it) => ({ height: Math.min(v, Math.max(0.4, levelH - (it.sill ?? 0))) }), 'h'),
        })),
        field(t('insp.sill'), slider(item.sill ?? 0.95, {
          min: 0, max: Math.max(0, Math.min(2, room(item.height))), step: 0.05,
          unit: 'm',
          onInput: (v) => patch((it) => ({ sill: Math.max(0, Math.min(v, levelH - it.height)) }), 'sill'),
        }), t('insp.sillHint')),
        field(t('insp.recess'), slider(item.depth ?? 0, {
          min: 0, max: 0.8, step: 0.05,
          unit: 'm', note: (v) => (v > 0 ? '' : t('insp.none')),
          onInput: (v) => patch({ depth: v }, 'depth'),
        }), t('insp.recessHint')),
      );
      // Only once there is a recess to widen: two sliders that do nothing are
      // worse than none, and this panel is already long.
      if ((item.depth ?? 0) >= 0.01) {
        s.append(
          field(t('insp.sides'), slider(item.sides ?? 0, {
            min: 0, max: 2, step: 0.05,
            unit: 'm', note: (v) => (v > 0 ? '' : t('insp.none')),
            onInput: (v) => patch({ sides: v }, 'sides'),
          }), t('insp.sidesHint')),
          field(t('insp.head'), slider(item.head ?? 0, {
            min: 0, max: 1, step: 0.05,
            unit: 'm', note: (v) => (v > 0 ? '' : t('insp.none')),
            onInput: (v) => patch({ head: v }, 'head'),
          }), t('insp.headHint')),
        );
      }
    } else if (type === 'fixture') {
      const m = this.store.model;
      const host = buildingOfEdge(m, item.edge) || this.store.activeBuilding;
      const storeys = host ? host.storeys : 1;
      const level = item.storey || 0;
      s.appendChild(field(t('insp.type'), select(item.kind, options(FIXTURE_KINDS, 'tool'),
        (v) => patch((it, mm) => fitOpening(mm, { ...it, kind: v })))));
      if (storeys > 1 || level >= storeys) {
        s.appendChild(field(t('insp.storey'), select(String(level), storeyOptions(storeys, level),
          (v) => patch({ storey: Number(v) })),
        level >= storeys ? t('insp.storeyGoneFixture') : undefined));
      }
      const [lo, hi] = fixtureZRange(host ? storeyHeightOf(host, level) : 2.7);
      s.append(
        positionField(m, item, patch),
        field(t('insp.height'), slider(Math.max(lo, Math.min(hi, item.z ?? FIXTURE_DEFAULTS[item.kind].z)), {
          min: lo, max: hi, step: 0.05, unit: 'm',
          onInput: (v) => patch({ z: v }, 'z'),
        }), t('insp.fixtureHeightHint')),
      );
    } else if (type === 'roofItem') {
      s.append(
        field(t('insp.type'), select(item.kind, options(ROOF_ITEM_KINDS, 'tool'), (v) => patch({ kind: v }))),
        // Kept on a roof, as the plan, the render and the arrows keep it: a
        // value typed past the eaves would leave the item on no roof at all,
        // never drawn again.
        field('X', number(item.x, { ...this.roofSpan(item, 0), step: 0.25, onChange: (v) => this.moveRoofItem(item, v, item.y) })),
        field('Y', number(item.y, { ...this.roofSpan(item, 1), step: 0.25, onChange: (v) => this.moveRoofItem(item, item.x, v) })),
      );
      if (item.kind === 'dish') {
        // A dish is round, drawn from the larger of its two sides: a width and
        // a depth meant one of the two sliders did nothing.
        s.appendChild(field(t('insp.diameter'), slider(Math.max(item.w ?? 0.8, item.d ?? 0.8), {
          min: 0.4, max: 2, step: 0.1, unit: 'm',
          onInput: (v) => patch({ w: v, d: v }, 'w'),
        })));
      } else {
        s.append(
          field(t('insp.width'), slider(item.w ?? 2, {
            min: 0.4, max: 10, step: 0.2, unit: 'm',
            onInput: (v) => patch({ w: v }, 'w'),
          })),
          field(t('insp.depth'), slider(item.d ?? 1.5, {
            min: 0.4, max: 8, step: 0.2, unit: 'm',
            onInput: (v) => patch({ d: v }, 'd'),
          })),
        );
      }
      if (item.kind === 'chimney') {
        s.appendChild(field(t('insp.height'), slider(item.h ?? 1.1, {
          min: 0.3, max: 3, step: 0.1, unit: 'm',
          onInput: (v) => patch({ h: v }, 'h'),
        })));
      }
    } else if (type === 'prop') {
      s.append(
        field('X', number(item.x, { min: -20, max: 80, step: 0.25, onChange: (v) => patch({ x: v }) })),
        field('Y', number(item.y, { min: -20, max: 80, step: 0.25, onChange: (v) => patch({ y: v }) })),
      );
      // A tree and a bush are drawn from their radius alone: offering them a
      // width and a depth gave the bush two sliders that did nothing.
      if (FIXED_SHAPE_KINDS.has(item.kind)) {
        // Drawn to one shape: a width and a depth would be sliders that
        // stretch a lamp into a wall.
      } else if (item.kind === 'tree' || item.kind === 'bush') {
        s.appendChild(field(t('insp.size'), slider(item.r ?? PROP_DEFAULTS[item.kind].r, {
          min: 0.5, max: 4, step: 0.1, unit: 'm',
          onInput: (v) => patch({ r: v }, 'r'),
        })));
      } else {
        s.append(
          // A slider's values are min + k x step, so the minimum sets the grid
          // as much as the step does. At 0.40 and 0.20 a terrace could be 3.15
          // by 3.95 but never 3 by 4, and no amount of care aligned it on the
          // building it adjoins — reported by a user trying to do exactly that.
          field(t('insp.width'), slider(item.w ?? 2, {
            min: 0.25, max: 24, step: 0.25, unit: 'm',
            onInput: (v) => patch({ w: v }, 'w'),
          })),
          field(t('insp.depth'), slider(item.d ?? 2, {
            min: 0.25, max: 24, step: 0.25, unit: 'm',
            onInput: (v) => patch({ d: v }, 'd'),
          })),
        );
      }
      if (item.kind === 'pool') {
        s.appendChild(field(t('insp.poolShape'), select(item.shape || 'rounded',
          [['rounded', t('insp.rounded')], ['rect', t('insp.rectangular')]], (v) => patch({ shape: v }))));
      }
      if (['terrace', 'path', 'deck', 'stairs'].includes(item.kind)) {
        s.appendChild(field(t('insp.surface'), select(item.material || (item.kind === 'deck' ? 'deck' : 'paving'),
          options(['paving', 'gravel', 'deck'], 'surface'), (v) => patch({ material: v }))));
      }
      if (item.kind === 'stairs') {
        // What the flight comes to, so a run too short for its height shows
        // before it is noticed on the drawing.
        const steps = stairsSteps(Math.max(0.15, item.h ?? 0.5));
        const up = item.dir === 'E' || item.dir === 'W' ? item.w : item.d;
        const tread = Math.round(((up ?? 1.25) / steps) * 100);
        s.append(
          field(t('insp.height'), slider(item.h ?? 0.5, {
            // As high as a terrace can be raised: the two go together.
            min: 0.15, max: 3, step: 0.05, unit: 'm',
            onInput: (v) => patch({ h: v }, 'h'),
          }), tread < 24 ? t('insp.tooSteep', { steps: t('insp.steps', { n: steps, tread }) })
            : t('insp.steps', { n: steps, tread })),
          field(t('insp.upTowards'), select(item.dir || 'N', options(['N', 'S', 'E', 'W'], 'face'),
            (v) => patch({ dir: v }))),
        );
      }
      if (['terrace', 'path', 'deck', 'pool'].includes(item.kind)) {
        s.appendChild(field(t('insp.elevation'), slider(item.z ?? 0, {
          // Up to a full storey: on sloping ground a terrace can sit level
          // with the first floor, the garage opening underneath it.
          min: 0, max: 3, step: 0.05, unit: 'm', note: (v) => (v > 0 ? '' : t('insp.onGround')),
          onInput: (v) => patch({ z: v }, 'z'),
        }), t('insp.elevationHint')));
      }
      if (item.kind === 'heatpump' || item.kind === 'mailbox') {
        // The side it faces; width and depth trade places when it turns
        // across, as the quarter-turn button does.
        const across = (d) => d === 'E' || d === 'W';
        s.appendChild(field(t(item.kind === 'heatpump' ? 'insp.fanTowards' : 'insp.slotTowards'),
          select(item.dir || 'S', options(FACES, 'face'), (v) => patch((it) => (across(it.dir || 'S') === across(v)
            ? { dir: v } : { dir: v, w: it.d, d: it.w })))));
      }
      if (item.kind === 'lamppost') {
        s.appendChild(field(t('insp.height'), slider(item.h ?? 2.2, {
          min: 0.8, max: 4, step: 0.1, unit: 'm',
          onInput: (v) => patch({ h: v }, 'h'),
        }), t('insp.lampHint')));
      }
      if (item.kind === 'carport') {
        s.append(
          field(t('insp.height'), slider(item.h ?? 2.3, {
            min: 1.8, max: 3.5, step: 0.05, unit: 'm',
            onInput: (v) => patch({ h: v }, 'h'),
          }), t('insp.underCover')),
          field(t('insp.cover'), select(item.cover || 'flat',
            [['flat', t('insp.coverFlat')], ['slats', t('insp.coverSlats')]], (v) => patch({ cover: v }))),
        );
      }
      if (item.kind === 'car') {
        // Width and depth are the footprint on the ground, so a car turned
        // across trades them: what stays is the car, not the numbers.
        const across = (d) => d === 'E' || d === 'W';
        s.appendChild(field(t('insp.carFacing'), select(item.dir || 'N', options(['N', 'E', 'S', 'W'], 'heading'),
          (v) => patch((it) => (across(it.dir || 'N') === across(v) ? { dir: v }
            : { dir: v, w: it.d, d: it.w }))), t('insp.carFacingHint')));
      }
      if (item.kind === 'tree') {
        s.appendChild(field(t('insp.silhouette'), select(item.style || 'leafy',
          [['leafy', t('insp.leafy')], ['conifer', t('insp.conifer')]], (v) => patch({ style: v }))));
      }
      if (item.kind === 'gate') {
        s.appendChild(field(t('insp.type'), select(item.style || 'swing',
          [['swing', t('insp.gateSwing')], ['sliding', t('insp.gateSliding')]],
          (v) => patch({ style: v }))));
      }
      if (['hedge', 'fence', 'muret', 'gate'].includes(item.kind)) {
        s.appendChild(field(t('insp.height'), slider(item.h ?? 1, {
          min: 0.3, max: 3, step: 0.05, unit: 'm',
          onInput: (v) => patch({ h: v }, 'h'),
        })));
      }
    }

    if (type === 'prop' && TURNABLE_KINDS.has(item.kind)) {
      const turn = h('button', 'subtle', t('insp.turn'));
      turn.type = 'button';
      turn.title = t('insp.turnTitle');
      turn.addEventListener('click', () => this.store.patchSelected((it) => quarterTurn(it)));
      s.appendChild(turn);
    }
    const dup = h('button', 'subtle', t('insp.duplicateItem'));
    dup.addEventListener('click', () => this.store.duplicateSelected());
    s.appendChild(dup);
    const del = h('button', 'danger', t('insp.delete'));
    del.addEventListener('click', () => this.store.deleteSelected());
    s.appendChild(del);
    return s;
  }
}
