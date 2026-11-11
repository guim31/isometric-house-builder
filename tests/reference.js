/**
 * The renders whose output must not change by accident: the ten starter
 * models and the example file, each from its own camera, from a turned and
 * raised one, and with outlines on.
 *
 * Shared by the test that compares them and by dev/reference-svg.mjs, which
 * writes the fingerprints the test compares against.
 */

import { normalise } from '../src/core/model.js';
import { renderScene } from '../src/render/svg.js';
import { PRESETS } from '../src/data/presets.js';

/** Clip-path and gradient ids are unique per render; compare without them. */
const stripIds = (svg) => svg.replace(/\bt[0-9a-z]+(?=-)/g, 't');

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function referenceRenders(base = '..') {
  const example = await (await fetch(`${base}/examples/maison-de-stephane.house.json`)).json();
  const sources = [
    ...PRESETS.map((p) => [p.id, { ...p.model, name: p.name }]),
    ['exemple', example],
  ];
  const out = {};
  for (const [id, raw] of sources) {
    const m = normalise(raw);
    const variants = {
      vue: m,
      tournee: { ...m, camera: { ...m.camera, yaw: 137, pitch: 48 } },
      contours: { ...m, style: { ...m.style, outline: true } },
    };
    for (const [name, model] of Object.entries(variants)) {
      out[`${id}/${name}`] = await sha(stripIds(renderScene(model, { width: 800, height: 560 }).svg));
    }
  }
  return out;
}
