/**
 * How the centre of the page is shared: the plan, the render, or both side by
 * side with a splitter between them — and, on a phone, which of the three
 * screens is up. All of it is remembered from one visit to the next, in the
 * interface's own settings rather than in the project (see prefs.js).
 *
 * The drawings are not told: they watch their own size, and redraw at the
 * size they are given.
 */

import { prefs, setPrefs, SPLIT_RANGE, DEFAULT_PREFS, LAYOUT_IDS, TAB_IDS } from './prefs.js';
import { LAYOUTS, TABS } from './texts.js';
import { icon } from './icons.js';

/** The width below which the page is laid out as a phone application. */
export const PHONE_QUERY = '(max-width: 820px)';

const LAYOUT_ICONS = { plan: 'viewPlan', both: 'viewBoth', render: 'viewRender' };
const TAB_ICONS = { plan: 'viewPlan', render: 'viewRender', settings: 'settings' };

/** A keyboard step of the splitter, as a share of the centre. */
const SPLIT_STEP = 0.05;

export class Layout {
  constructor({ root, views, splitter, switcher, tabbar }) {
    this.root = root;
    this.views = views;
    this.splitter = splitter;
    this.plan = views.querySelector('.view-plan');
    this.render = views.querySelector('.view-render');
    this.onChange = null;
    this.phoneQuery = window.matchMedia ? window.matchMedia(PHONE_QUERY) : { matches: false };
    this.buildSwitcher(switcher);
    this.buildTabs(tabbar);
    this.bindSplitter();
    this.phoneQuery.addEventListener?.('change', () => this.apply());
    this.apply();
  }

  get phone() { return !!this.phoneQuery.matches; }
  get layout() { return prefs().layout; }
  get split() { return prefs().split; }
  get tab() { return prefs().tab; }

  /** Which drawings are on screen now, whatever the width. */
  get shown() {
    if (this.phone) return { plan: this.tab === 'plan', render: this.tab === 'render', settings: this.tab === 'settings' };
    return { plan: this.layout !== 'render', render: this.layout !== 'plan', settings: true };
  }

  buildSwitcher(root) {
    this.switchButtons = LAYOUTS.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.layout = l.id;
      b.title = `${l.title} (${l.key})`;
      b.innerHTML = `${icon(LAYOUT_ICONS[l.id])}<span class="btn-label">${l.label}</span>`;
      b.setAttribute('aria-label', l.title);
      b.addEventListener('click', () => this.setLayout(l.id));
      root.appendChild(b);
      return b;
    });
  }

  buildTabs(root) {
    this.tabButtons = TABS.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tab = t.id;
      b.innerHTML = `${icon(TAB_ICONS[t.id])}<span class="tab-label">${t.label}</span><span class="tab-dot" hidden></span>`;
      b.addEventListener('click', () => this.setTab(t.id));
      root.appendChild(b);
      return b;
    });
  }

  setLayout(id) {
    if (!LAYOUT_IDS.includes(id)) return;
    setPrefs({ layout: id });
    this.apply();
  }

  setTab(id) {
    if (!TAB_IDS.includes(id)) return;
    setPrefs({ tab: id });
    this.apply();
  }

  /** The plan's share of the centre, kept within its bounds. */
  setSplit(v, store = true) {
    const split = Math.max(SPLIT_RANGE[0], Math.min(SPLIT_RANGE[1], v));
    if (store) setPrefs({ split });
    this.applySplit(split);
  }

  applySplit(split) {
    this.plan.style.flexGrow = String(split);
    this.render.style.flexGrow = String(1 - split);
    this.splitter.setAttribute('aria-valuenow', String(Math.round(split * 100)));
    this.splitter.setAttribute('aria-valuetext', `Plan ${Math.round(split * 100)} %, rendu ${Math.round((1 - split) * 100)} %`);
  }

  /** Put the page in the state the prefs say. */
  apply() {
    const p = prefs();
    this.root.dataset.layout = p.layout;
    this.root.dataset.tab = p.tab;
    this.root.dataset.phone = String(this.phone);
    for (const b of this.switchButtons) b.setAttribute('aria-pressed', String(b.dataset.layout === p.layout));
    for (const b of this.tabButtons) {
      const on = b.dataset.tab === p.tab;
      b.setAttribute('aria-pressed', String(on));
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    this.splitter.setAttribute('aria-valuemin', String(SPLIT_RANGE[0] * 100));
    this.splitter.setAttribute('aria-valuemax', String(SPLIT_RANGE[1] * 100));
    this.applySplit(p.split);
    this.onChange?.(this.shown);
  }

  /** A dot on the settings tab: there is something selected to set. */
  markSettings(on) {
    const dot = this.tabButtons.find((b) => b.dataset.tab === 'settings')?.querySelector('.tab-dot');
    if (dot) dot.hidden = !on;
  }

  /**
   * The splitter, by pointer and by keyboard. While dragged the share is
   * applied as it goes and stored once, on release: storage is not written
   * sixty times a second.
   */
  bindSplitter() {
    const s = this.splitter;
    let drag = null;
    const shareAt = (clientX) => {
      const r = this.views.getBoundingClientRect();
      const room = r.width - s.offsetWidth;
      return room > 0 ? (clientX - r.left - s.offsetWidth / 2) / room : this.split;
    };
    s.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      drag = { id: ev.pointerId };
      try { s.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
      s.classList.add('dragging');
      this.root.classList.add('resizing');
      ev.preventDefault();
    });
    s.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      drag.split = shareAt(ev.clientX);
      this.setSplit(drag.split, false);
    });
    const end = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      if (drag.split != null) this.setSplit(drag.split);
      drag = null;
      s.classList.remove('dragging');
      this.root.classList.remove('resizing');
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('dblclick', () => this.setSplit(DEFAULT_PREFS.split));
    s.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? SPLIT_STEP * 2 : SPLIT_STEP;
      const to = {
        ArrowLeft: this.split - step, ArrowRight: this.split + step,
        ArrowDown: this.split - step, ArrowUp: this.split + step,
        Home: SPLIT_RANGE[0], End: SPLIT_RANGE[1], Enter: DEFAULT_PREFS.split,
      }[ev.key];
      if (to == null) return;
      ev.preventDefault();
      // The arrows here belong to the splitter, not to the selection.
      ev.stopPropagation();
      this.setSplit(to);
    });
  }
}
