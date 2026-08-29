/**
 * Application state: the model, the current selection, undo/redo and autosave.
 *
 * The model is treated as immutable — every change produces a new object. That
 * is what makes undo a one-liner and lets the renderer skip work by comparing
 * references.
 */

import { normalise, newId, makeBuilding } from '../core/model.js';
import { saveLocal } from '../io/project.js';

const HISTORY_LIMIT = 80;

export class Store {
  constructor(model) {
    this.model = normalise(model);
    this.past = [];
    this.future = [];
    this.selection = null; // { type: 'opening'|'roofItem'|'prop', id }
    this.tool = 'paint';
    this.listeners = new Set();
    this.saveTimer = null;
    this.lastEditAt = 0;
    this.activeId = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason) {
    for (const fn of this.listeners) fn(this, reason);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveLocal(this.model), 400);
  }

  /**
   * Apply a change.
   *
   * `coalesce` merges consecutive edits of the same kind into one history
   * entry, so dragging a slider or painting a stroke undoes as a single step
   * rather than fifty.
   */
  update(fn, { coalesce = null, silent = false } = {}) {
    const next = typeof fn === 'function' ? fn(this.model) : fn;
    if (!next || next === this.model) return;
    if (!silent) {
      const now = Date.now();
      const last = this.past[this.past.length - 1];
      // Coalescing is bounded in time: one continuous gesture merges into a
      // single undo step, but returning to the same control after a pause
      // starts a fresh one — undo then rewinds the latest gesture, not every
      // adjustment ever made with that slider.
      const merge = coalesce && last && last.coalesce === coalesce && now - this.lastEditAt < 900;
      if (!merge) {
        this.past.push({ model: this.model, coalesce });
        if (this.past.length > HISTORY_LIMIT) this.past.shift();
      }
      this.future.length = 0;
      this.lastEditAt = now;
    }
    this.model = next;
    this.emit('model');
  }

  /** End a coalescing run, so the next edit starts a fresh history entry. */
  commit() {
    const last = this.past[this.past.length - 1];
    if (last) last.coalesce = null;
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ model: this.model });
    this.model = entry.model;
    this.emit('model');
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ model: this.model, coalesce: null });
    this.model = entry.model;
    this.emit('model');
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  select(selection) {
    const same = JSON.stringify(selection) === JSON.stringify(this.selection);
    if (same) return;
    this.selection = selection;
    this.emit('selection');
  }

  setTool(tool) {
    if (this.tool === tool) return;
    this.tool = tool;
    if (tool !== 'select') this.selection = null;
    this.emit('tool');
  }

  /**
   * The building being edited. Painting goes into it, and the inspector shows
   * its roof. Falls back to the first volume so there is always a target.
   */
  get activeBuildingId() {
    const ids = this.model.buildings.map((b) => b.id);
    return ids.includes(this.activeId) ? this.activeId : ids[0];
  }

  get activeBuilding() {
    return this.model.buildings.find((b) => b.id === this.activeBuildingId) || null;
  }

  setActiveBuilding(id) {
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit('selection');
  }

  /** Patch the active building. */
  patchBuilding(patch, coalesce) {
    const id = this.activeBuildingId;
    this.update((m) => ({
      ...m,
      buildings: m.buildings.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }), { coalesce });
  }

  /** Patch the active building's roof. */
  patchRoof(patch, coalesce) {
    const id = this.activeBuildingId;
    this.update((m) => ({
      ...m,
      buildings: m.buildings.map((b) => (b.id === id ? { ...b, roof: { ...b.roof, ...patch } } : b)),
    }), { coalesce });
  }

  /** Add an empty volume and make it the one being painted into. */
  addBuilding() {
    const b = makeBuilding({ name: `Bâtiment ${this.model.buildings.length + 1}` });
    this.update((m) => ({ ...m, buildings: [...m.buildings, b] }));
    this.activeId = b.id;
    this.emit('selection');
    return b.id;
  }

  /** Remove a volume, along with the openings that lived on its walls. */
  removeBuilding(id) {
    if (this.model.buildings.length <= 1) return;
    const gone = this.model.buildings.find((b) => b.id === id);
    const cells = new Set(gone ? gone.cells : []);
    this.update((m) => ({
      ...m,
      buildings: m.buildings.filter((b) => b.id !== id),
      openings: m.openings.filter((o) => !cells.has(o.edge.split(',').slice(0, 2).join(','))),
    }));
    this.activeId = null;
    this.emit('selection');
  }

  /** The currently selected item, or null. */
  get selected() {
    if (!this.selection) return null;
    const list = { opening: 'openings', roofItem: 'roofItems', prop: 'props' }[this.selection.type];
    if (!list) return null;
    return (this.model[list] || []).find((it) => it.id === this.selection.id) || null;
  }

  /** Patch the selected item. */
  patchSelected(patch, coalesce) {
    const sel = this.selection;
    if (!sel) return;
    const list = { opening: 'openings', roofItem: 'roofItems', prop: 'props' }[sel.type];
    this.update((m) => ({
      ...m,
      [list]: m[list].map((it) => (it.id === sel.id ? { ...it, ...patch } : it)),
    }), { coalesce });
  }

  /** Clone the selected item, nudged aside so the copy is visibly distinct. */
  duplicateSelected() {
    const sel = this.selection;
    if (!sel) return;
    const list = { opening: 'openings', roofItem: 'roofItems', prop: 'props' }[sel.type];
    const src = (this.model[list] || []).find((it) => it.id === sel.id);
    if (!src) return;
    const copy = { ...src, id: newId(sel.type[0]) };
    if (sel.type === 'opening') copy.offset = (src.offset ?? 0.5) + 1;
    else copy.x = (src.x ?? 0) + 1.5;
    this.update((m) => ({ ...m, [list]: [...m[list], copy] }));
    this.select({ type: sel.type, id: copy.id });
  }

  deleteSelected() {
    const sel = this.selection;
    if (!sel) return;
    const list = { opening: 'openings', roofItem: 'roofItems', prop: 'props' }[sel.type];
    this.update((m) => ({ ...m, [list]: m[list].filter((it) => it.id !== sel.id) }));
    this.select(null);
  }
}
