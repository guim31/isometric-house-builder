/**
 * The export window: what will be downloaded, shown before it is.
 *
 * The panel on screen and the exported frame do not share proportions — a
 * 16:10 image made from a square panel crops or pads in ways nobody could
 * guess. So the window draws the file itself, at the proportions of the size
 * chosen, through the very function the download uses: what is seen here is
 * what is written, background and framing included.
 */

import {
  SIZES, svgFor, exportPng, exportSvg, exportFourViews, exportSavedViews, copyPngToClipboard,
  customSize, pixelsOf, MAX_SIDE, MIN_SIDE,
} from '../io/export.js';
import { prefs, setPrefs } from './prefs.js';
import { t } from '../i18n/index.js';

/** The backgrounds offered as chips, with the key of each one's name. */
const BACKGROUNDS = [
  ['transparent', 'export.bg.transparent'],
  ['#ffffff', 'export.bg.white'],
  ['#f4f6f8', 'export.bg.light'],
  ['#0f172a', 'export.bg.dark'],
];

/** The name of a background, for whoever shows it elsewhere: the inspector. */
export function backgroundName(value) {
  const known = BACKGROUNDS.find(([v]) => v === value);
  return known ? t(known[1]) : value;
}

const COLOUR_RE = /^#[0-9a-f]{6}$/i;

/** A whole number of pixels from what was typed, or null. */
export function parsePixels(text) {
  const v = Number(String(text).replace(/\s|px/gi, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

export class ExportDialog {
  constructor(dialog, store) {
    this.dialog = dialog;
    this.store = store;
    this.$ = (id) => dialog.querySelector(`#${id}`);
    this.busy = false;
    this.shown = null; // what the preview was drawn from: model and size
    this.unsubscribe = null;
    this.buildSizes();
    this.buildBackgrounds();
    this.bindActions();
    this.relabel();
    dialog.addEventListener('close', () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
      // The preview can be a large drawing; nothing needs it once closed.
      this.$('export-frame').replaceChildren();
      this.shown = null;
    });
  }

  /** The size chosen, as export.js takes it. */
  get size() {
    const id = prefs().exportSize;
    if (id === 'custom') return customSize(...prefs().customSize);
    return SIZES.find((s) => s.id === id) || SIZES[0];
  }

  buildSizes() {
    const sel = this.$('export-size');
    for (const s of SIZES) sel.appendChild(new Option('', s.id));
    sel.appendChild(new Option('', 'custom'));
    sel.addEventListener('change', () => {
      setPrefs({ exportSize: sel.value });
      this.sync();
    });
    const w = this.$('export-w'), hgt = this.$('export-h');
    const commit = () => {
      const [cw, ch] = prefs().customSize;
      const size = customSize(parsePixels(w.value) ?? cw, parsePixels(hgt.value) ?? ch);
      setPrefs({ customSize: [size.width, size.height] });
      this.sync();
    };
    for (const input of [w, hgt]) {
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } });
    }
  }

  /** Every word the window writes itself, in the language of the moment. */
  relabel() {
    this.$('export-lead').textContent = t('export.lead');
    for (const o of this.$('export-size').options) {
      o.textContent = o.value === 'custom' ? t('export.custom') : t(`export.size.${o.value}`);
    }
    for (const input of [this.$('export-w'), this.$('export-h')]) {
      input.title = t('export.tooBig', { max: MAX_SIDE });
      input.setAttribute('aria-description', t('export.range', { min: MIN_SIDE, max: MAX_SIDE }));
    }
    for (const chip of this.dialog.querySelectorAll('#export-bg-chips .chip')) {
      chip.querySelector('.chip-label').textContent = t(chip.dataset.label);
    }
    this.colourInput.setAttribute('aria-label', t('export.customColour'));
    if (this.dialog.open) this.sync();
  }

  buildBackgrounds() {
    const box = this.$('export-bg-chips');
    this.bgInputs = [];
    const word = (key) => {
      const span = document.createElement('span');
      span.className = 'chip-label';
      span.textContent = t(key);
      return span;
    };
    for (const [value, label] of BACKGROUNDS) {
      const chip = document.createElement('label');
      chip.className = 'chip';
      chip.dataset.label = label;
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'export-bg';
      r.value = value;
      const swatch = document.createElement('span');
      swatch.className = `swatch${value === 'transparent' ? ' swatch-clear' : ''}`;
      if (value !== 'transparent') swatch.style.background = value;
      chip.append(r, swatch, word(label));
      r.addEventListener('change', () => this.setBackground(value));
      box.appendChild(chip);
      this.bgInputs.push(r);
    }
    // A colour of one's own: the dashboard's own background, say.
    const chip = document.createElement('label');
    chip.className = 'chip chip-colour';
    chip.dataset.label = 'export.customColour';
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = 'export-bg';
    r.value = 'custom';
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.value = '#dfe7ee';
    chip.append(r, colour, word('export.customColour'));
    r.addEventListener('change', () => this.setBackground(colour.value));
    colour.addEventListener('input', () => { r.checked = true; this.setBackground(colour.value, true); });
    box.appendChild(chip);
    this.bgInputs.push(r);
    this.colourInput = colour;
  }

  /** The background is the model's own field, set from here; undo takes it back. */
  setBackground(value, live = false) {
    if (value !== 'transparent' && !COLOUR_RE.test(value)) return;
    this.store.update((m) => (m.style.background === value ? m : { ...m, style: { ...m.style, background: value } }),
      { coalesce: live ? 'export-bg' : null });
  }

  bindActions() {
    const run = (id, fn) => this.$(id).addEventListener('click', () => fn());
    run('btn-png', () => this.job(t('export.rendering'), async () => {
      await exportPng(this.store.model, this.size);
      return t('export.pngDone');
    }));
    // Synchronous, so that a failure is said before the click returns.
    run('btn-svg', () => this.job(null, () => {
      exportSvg(this.store.model, this.size);
      return t('export.svgDone');
    }));
    // Not through job(): the clipboard write must start within the click, and
    // Safari refuses it once the click is over.
    run('btn-copy', async () => {
      this.status('');
      try {
        await copyPngToClipboard(this.store.model, this.size);
        this.status(t('export.copyDone'));
      } catch (e) { this.status(t('export.failed', { message: e.message }), true); }
    });
    run('btn-four', () => this.job(t('export.face', { n: 0, total: 4 }), async (progress) => {
      const n = await exportFourViews(this.store.model, this.size,
        (i, total) => progress(i, total, t('export.face', { n: Math.min(i + 1, total), total })));
      return t('export.zipDone', { n });
    }));
    run('btn-views', () => {
      const total = this.store.model.views.length;
      if (!total) { this.status(t('export.noViews')); return; }
      this.job(t('export.view', { n: 1, total }), async (progress) => {
        const n = await exportSavedViews(this.store.model, this.size,
          (i, all) => progress(i, all, t('export.view', { n: Math.min(i + 1, all), total: all })));
        return t('export.zipDone', { n });
      });
    });
  }

  status(text, error = false) {
    const p = this.$('export-status');
    p.textContent = text;
    p.classList.toggle('error', error);
  }

  /**
   * Run an export with its progress shown and its buttons held: a second
   * click while four faces render would start a second archive.
   */
  async job(start, fn) {
    if (this.busy) return;
    this.busy = true;
    const bar = this.$('export-progress');
    const buttons = [...this.dialog.querySelectorAll('.export-actions button')];
    buttons.forEach((b) => { b.disabled = true; });
    this.dialog.setAttribute('aria-busy', 'true');
    if (start) this.status(start);
    bar.value = 0;
    bar.hidden = !start;
    const progress = (i, total, text) => {
      bar.hidden = false;
      bar.max = total;
      bar.value = i;
      if (text && i < total) this.status(text);
    };
    try {
      const done = fn(progress);
      this.status(done instanceof Promise ? await done : done);
    } catch (e) {
      this.status(t('export.failed', { message: e.message }), true);
    } finally {
      this.busy = false;
      bar.hidden = true;
      buttons.forEach((b) => { b.disabled = false; });
      this.dialog.removeAttribute('aria-busy');
    }
  }

  open() {
    this.status('');
    if (!this.dialog.open) this.dialog.showModal();
    this.unsubscribe?.();
    // The preview follows the project while the window is open: an undo, a
    // background picked here.
    this.unsubscribe = this.store.subscribe((_s, reason) => {
      if (reason !== 'selection' && reason !== 'tool') this.sync();
    });
    this.sync();
  }

  /**
   * The preview at the proportions of the file, as large as its stage
   * allows: a 1:1 widget and a 16:10 wallpaper must look different here,
   * since they will look different on the dashboard.
   */
  fitFrame(size = this.size) {
    const stage = this.$('export-stage');
    const frame = this.$('export-frame');
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const k = Math.min(W / size.width, H / size.height);
    frame.style.width = `${Math.floor(size.width * k)}px`;
    frame.style.height = `${Math.floor(size.height * k)}px`;
  }

  /** Bring every control and the preview in line with the model and the prefs. */
  sync() {
    if (!this.dialog.open) return;
    const p = prefs();
    const m = this.store.model;
    const size = this.size;
    const sel = this.$('export-size');
    if (sel.value !== p.exportSize) sel.value = SIZES.some((s) => s.id === p.exportSize) || p.exportSize === 'custom' ? p.exportSize : SIZES[0].id;
    const custom = this.$('export-custom');
    custom.hidden = p.exportSize !== 'custom';
    const [cw, ch] = p.customSize;
    const w = this.$('export-w'), hgt = this.$('export-h');
    const shownW = customSize(cw, ch);
    if (document.activeElement !== w) w.value = String(shownW.width);
    if (document.activeElement !== hgt) hgt.value = String(shownW.height);

    const night = !!m.style.night;
    const bg = m.style.background;
    const preset = BACKGROUNDS.some(([v]) => v === bg);
    for (const r of this.bgInputs) {
      r.disabled = night;
      r.checked = r.value === 'custom' ? !preset : r.value === bg;
    }
    this.colourInput.disabled = night;
    if (!preset && COLOUR_RE.test(bg) && this.colourInput.value !== bg) this.colourInput.value = bg;
    this.$('export-bg-note').textContent = night ? t('export.nightNote') : '';
    this.$('export-bg').classList.toggle('disabled', night);

    const [pw, ph] = pixelsOf(size);
    this.$('export-dims').textContent = t('export.file', { w: pw, h: ph });
    this.fitFrame(size);
    if (this.shown?.model === m && this.shown.size === `${size.id}:${size.width}x${size.height}`) return;
    this.shown = { model: m, size: `${size.id}:${size.width}x${size.height}` };
    const frame = this.$('export-frame');
    // At one pixel per pixel: a vector drawing scales down without losing
    // anything, and the layout — what the ratio changes — is the same.
    frame.innerHTML = svgFor(m, { ...size, ratio: 1 });
    frame.classList.toggle('checker', !night && bg === 'transparent');
  }
}
