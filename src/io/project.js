/**
 * Saving and loading. The model is plain JSON, so a project file is both the
 * save format and a perfectly readable text file.
 */

import { normalise, defaultModel } from '../core/model.js';

const STORAGE_KEY = 'isometric-house-builder/current';

export function saveLocal(model) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    return true;
  } catch {
    return false; // private browsing, quota, or storage disabled
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalise(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearLocal() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to do */ }
}

const slug = (s) => (s || 'maison').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'maison';

export function exportProject(model) {
  const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(model.name)}.house.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function importProject(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(normalise(JSON.parse(String(reader.result))));
      } catch (e) {
        reject(new Error('Fichier illisible : ' + e.message));
      }
    };
    reader.onerror = () => reject(new Error('Lecture impossible'));
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

export function fromShareUrl() {
  const m = location.hash.match(/#m=([A-Za-z0-9\-_]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return normalise(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export function initialModel() {
  return fromShareUrl() || loadLocal() || defaultModel();
}
