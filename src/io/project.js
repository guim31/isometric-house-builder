/**
 * Saving and loading. The model is plain JSON, so a project file is both the
 * save format and a perfectly readable text file.
 */

import { normalise, defaultModel, MODEL_VERSION } from '../core/model.js';
import { download, slug } from './files.js';
import { t } from '../i18n/index.js';

const STORAGE_KEY = 'isometric-house-builder/current';

export function saveLocal(model) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    return true;
  } catch {
    return false; // private browsing, quota, or storage disabled
  }
}

/** Where a project that could not be opened is kept, rather than lost. */
export const REJECTED_KEY = 'isometric-house-builder/rejected';

/**
 * Keep a project that failed to open under a key of its own. Left in place,
 * it would be overwritten by the default model's first autosave — and with
 * it whatever could still have been recovered by hand.
 */
export function setAside(raw) {
  try {
    localStorage.setItem(REJECTED_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
    return true;
  } catch {
    return false;
  }
}

/** The saved project, null when there is none, or `{ failed }` when it would not open. */
export function loadLocal() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage disabled: nothing saved, nothing to lose
  }
  if (!raw) return null;
  try {
    return normalise(JSON.parse(raw));
  } catch {
    setAside(raw);
    return { failed: true };
  }
}

export function clearLocal() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to do */ }
}

export function exportProject(model) {
  const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
  download(blob, `${slug(model.name)}.house.json`);
}

/**
 * Read a project file. Resolves to `{ model, newer }`: `newer` flags a file
 * written by a later version of the tool, whose settings this one may not know
 * and will drop — worth saying, rather than losing them without a word.
 */
export function importProject(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(t('project.notProject'));
        resolve({ model: normalise(raw), newer: Number(raw.version) > MODEL_VERSION });
      } catch (e) {
        reject(new Error(t('project.unreadable', { message: e.message })));
      }
    };
    reader.onerror = () => reject(new Error(t('project.readFailed')));
    reader.readAsText(file);
  });
}

/** Pack the model into the URL fragment so a design can be shared as a link. */
export function toShareUrl(model) {
  const json = JSON.stringify(model);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#m=${b64}`;
}

/** The model a share link carries, null without one, `{ failed }` when it is unreadable. */
export function readShareUrl() {
  const m = location.hash.match(/#m=([A-Za-z0-9\-_]+)/);
  if (!m) return null;
  let text = m[1];
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    text = new TextDecoder().decode(bytes);
    return { model: normalise(JSON.parse(text)) };
  } catch {
    setAside(text);
    return { failed: true };
  }
}

export function fromShareUrl() {
  return readShareUrl()?.model || null;
}

/** Take a share link off the address, so a reload keeps the edits made since. */
export function clearShareHash() {
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sandboxed */ }
}

/**
 * The model to open with, and where it came from.
 *
 * A share link is read once and then taken off the address: left there, every
 * reload would bring the shared model back over the edits made since, and the
 * autosave would then write it over them.
 */
export function initialModel() {
  const link = readShareUrl();
  const saved = loadLocal();
  const local = saved && !saved.failed ? saved : null;
  // A project or a link that will not open never leaves the page blank: it is
  // set aside, the default model opens instead, and `rejected` says which.
  const rejected = link?.failed ? 'link' : saved?.failed ? 'local' : null;
  if (link) clearShareHash();
  if (link?.model) {
    // The project that was open is handed back too: opening a link must be
    // undoable, and the caller makes it the history entry before the link.
    return { model: link.model, source: 'link', previous: local, rejected };
  }
  if (local) return { model: local, source: 'local', rejected };
  return { model: defaultModel(), source: rejected ? 'rejected' : 'default', rejected };
}

/*
 * Saving into the same file, where the browser allows it.
 *
 * A download is a new file each time — « maison (3).house.json » — and the
 * one opened yesterday is never the one saved today. With the File System
 * Access API the project remembers the file it came from, or the one it was
 * first saved to, and « Enregistrer » writes there again. Elsewhere it stays
 * a download.
 */
let fileHandle = null;

const pickerTypes = () => [{ description: t('project.fileType'), accept: { 'application/json': ['.json'] } }];

/** Can this browser write a file in place? */
export const canWriteFiles = () => typeof window.showSaveFilePicker === 'function';

/** The file the project is tied to, if any — its name only. */
export const currentFileName = () => fileHandle?.name || null;

/** Tie the project to a file (opened, or dropped) or to none (a new project). */
export function useFile(handle) {
  fileHandle = handle && typeof handle.createWritable === 'function' ? handle : null;
}

/**
 * Save the project. Resolves with `{ name }` — the file written in place, or
 * null for a download — or with null when the user closed the file picker.
 */
export async function saveProject(model, { as = false } = {}) {
  if (!canWriteFiles()) {
    exportProject(model);
    return { name: null };
  }
  try {
    if (!fileHandle || as) {
      fileHandle = await window.showSaveFilePicker({ suggestedName: `${slug(model.name)}.house.json`, types: pickerTypes() });
    }
    const out = await fileHandle.createWritable();
    await out.write(JSON.stringify(model, null, 2));
    await out.close();
    return { name: fileHandle.name };
  } catch (e) {
    if (e?.name === 'AbortError') return null;
    throw e;
  }
}

/**
 * Pick a project file to open, through the browser's picker when it hands
 * back a file that can be written to later. Resolves like importProject, plus
 * the handle; null when the picker was closed, or when there is no such
 * picker — the caller then falls back on a plain file input.
 */
export async function pickProject() {
  if (typeof window.showOpenFilePicker !== 'function') return null;
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ types: pickerTypes(), multiple: false });
  } catch (e) {
    if (e?.name === 'AbortError') return { cancelled: true };
    return null;
  }
  const opened = await importProject(await handle.getFile());
  return { ...opened, handle };
}
