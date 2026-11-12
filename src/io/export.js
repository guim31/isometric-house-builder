/**
 * Export: SVG, PNG at several resolutions or at a free size, and sets of
 * images — the four faces, the saved views — as one archive. Everything happens in the browser; nothing is uploaded anywhere.
 */

import { renderScene } from '../render/svg.js';
import { viewpointIndex } from '../core/iso.js';
import { DEFAULT_FOCUS } from '../core/model.js';
import { download, slug } from './files.js';
import { zipStore, uniqueNames } from './zip.js';
import { t } from '../i18n/index.js';

/** The sizes offered; each one's name is `export.size.<id>` in the dictionaries. */
export const SIZES = [
  // Gladys downscales anything past 2560 px on the long edge, and keeps the
  // file untouched below 2 MB — so this is the largest size worth uploading.
  { id: 'gladys', width: 1280, height: 800, ratio: 2 },
  { id: 'sd', width: 1200, height: 800, ratio: 1 },
  { id: 'hd', width: 1200, height: 800, ratio: 2 },
  { id: 'uhd', width: 1200, height: 800, ratio: 4 },
  { id: 'square', width: 1024, height: 1024, ratio: 1 },
  // Laid out at 640 × 400 and rendered at twice that, for a sharp widget on a
  // high-density screen; the label gives the file's size, like the others.
  { id: 'widget', width: 640, height: 400, ratio: 2 },
];

export function svgFor(model, size) {
  return renderScene(model, {
    width: size.width, height: size.height, pixelRatio: size.ratio,
  }).svg;
}

/** Rasterise an SVG string to a PNG blob, preserving transparency. */
export function svgToPng(svg, width, height) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // A throw in here would leave the promise pending for good, and the
      // interface on "Rendu en cours…" with it. A canvas past the browser's
      // size limit is the usual cause: getContext then returns null.
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(t('export.tooLarge', { w: width, h: height }));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('export.pngFailed')))), 'image/png');
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('export.svgUnreadable'))); };
    img.src = url;
  });
}

export async function exportPng(model, size) {
  const [w, h] = pixelsOf(size);
  const blob = await svgToPng(svgFor(model, size), w, h);
  download(blob, `${slug(model.name)}-${sizeTag(size)}.png`);
}

export function exportSvg(model, size) {
  // A vector file has no pixel density: at « 4× » it declared a 4800-pixel
  // width for the very same drawing. It keeps the layout size.
  const svg = svgFor(model, { ...size, ratio: 1 });
  download(new Blob([svg], { type: 'image/svg+xml' }), `${slug(model.name)}.svg`);
}

/** The longest side a canvas is trusted with, in pixels, in every browser. */
export const MAX_SIDE = 8192;
/** And the smallest image worth making. */
export const MIN_SIDE = 64;

/**
 * A free size, in output pixels, as the export window takes it: laid out at
 * that size, at one pixel per pixel, bounded to what a canvas accepts.
 */
export function customSize(width, height) {
  const side = (v) => Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.round(Number(v) || 0)));
  return { id: 'custom', label: `${side(width)} × ${side(height)}`, width: side(width), height: side(height), ratio: 1 };
}

/** What a size gives, in pixels: [width, height] of the PNG file. */
export const pixelsOf = (size) => [size.width * size.ratio, size.height * size.ratio];

/** File-name tail of a size: the preset's id, or the free size's dimensions. */
const sizeTag = (size) => (size.id === 'custom' ? `${size.width}x${size.height}` : size.id);

async function pngBytes(model, size) {
  const [w, h] = pixelsOf(size);
  const blob = await svgToPng(svgFor(model, size), w, h);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The four isometric views of the same house, as PNG files named as they
 * were when each one was its own download — after the point of the compass
 * each is seen from, in the interface's language.
 */
export async function fourViewFiles(model, size, onProgress) {
  const names = [0, 90, 180, 270].map((yaw) => slug(t(`rose.${viewpointIndex(yaw)}`)));
  const files = [];
  for (let r = 0; r < 4; r++) {
    // The quarter turns keep their own pitch: the four faces are meant to read
    // as one set, and a hand-tilted camera is a different picture each time.
    const view = { ...model, camera: { ...model.camera, yaw: r * 90 } };
    files.push({ name: `${slug(model.name)}-${names[r]}.png`, data: await pngBytes(view, size) });
    onProgress?.(r + 1, 4);
  }
  return files;
}

/**
 * Every saved view, as its own PNG.
 *
 * This is the point of saving them: one file per widget — the gate, the pool,
 * the whole house — regenerated as a set whenever the model changes, instead
 * of being reframed by hand one at a time.
 */
export async function savedViewFiles(model, size, onProgress) {
  const views = model.views || [];
  const names = uniqueNames(views.map((v) => `${slug(model.name)}-${slug(v.name)}.png`));
  const files = [];
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    const shot = { ...model, camera: v.camera, focus: { ...DEFAULT_FOCUS, ...v.focus } };
    files.push({ name: names[i], data: await pngBytes(shot, size) });
    onProgress?.(i + 1, views.length);
  }
  return files;
}

/** Hand a set of files over as one archive: one download, which nothing blocks. */
export function downloadZip(files, filename) {
  download(new Blob([zipStore(files)], { type: 'application/zip' }), filename);
}

export async function exportFourViews(model, size, onProgress) {
  const files = await fourViewFiles(model, size, onProgress);
  downloadZip(files, `${slug(model.name)}-${t('export.fourFile')}.zip`);
  return files.length;
}

export async function exportSavedViews(model, size, onProgress) {
  const files = await savedViewFiles(model, size, onProgress);
  downloadZip(files, `${slug(model.name)}-${t('export.viewsFile')}.zip`);
  return files.length;
}

/** Copy the current view to the clipboard, ready to paste into a dashboard. */
export async function copyPngToClipboard(model, size) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error(t('export.noClipboard'));
  }
  // The item is handed a promise of the image and written straight away:
  // Safari only lets a page write to the clipboard within the click itself,
  // and the click is long over by the time the image has been rendered.
  const png = Promise.resolve().then(() =>
    svgToPng(svgFor(model, size), size.width * size.ratio, size.height * size.ratio));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
