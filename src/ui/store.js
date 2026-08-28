/**
 * Application state: the model, the current selection, undo/redo and autosave.
 *
 * The model is treated as immutable — every change produces a new object. That
 * is what makes undo a one-liner and lets the renderer skip work by comparing
 * references.
 */

import { normalise } from '../core/model.js';
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
      const last = this.past[this.past.length - 1];
      if (!(coalesce && last && last.coalesce === coalesce)) {
        this.past.push({ model: this.model, coalesce });
        if (this.past.length > HISTORY_LIMIT) this.past.shift();
      }
      this.future.length = 0;
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

  deleteSelected() {
    const sel = this.selection;
    if (!sel) return;
    const list = { opening: 'openings', roofItem: 'roofItems', prop: 'props' }[sel.type];
    this.update((m) => ({ ...m, [list]: m[list].filter((it) => it.id !== sel.id) }));
    this.select(null);
  }
}
