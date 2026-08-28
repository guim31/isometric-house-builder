/**
 * Export: SVG, PNG at several resolutions, and the four isometric views in one
 * go. Everything happens in the browser; nothing is uploaded anywhere.
 */

import { renderScene } from '../render/svg.js';

export const SIZES = [
  { id: 'sd', label: '1× — 1200 × 800', width: 1200, height: 800, ratio: 1 },
  { id: 'hd', label: '2× — 2400 × 1600', width: 1200, height: 800, ratio: 2 },
  { id: 'uhd', label: '4× — 4800 × 3200', width: 1200, height: 800, ratio: 4 },
  { id: 'square', label: 'Carré 1024 × 1024', width: 1024, height: 1024, ratio: 1 },
  { id: 'widget', label: 'Widget 640 × 400', width: 640, height: 400, ratio: 2 },
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
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encodage PNG impossible'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG illisible')); };
    img.src = url;
  });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const slug = (s) => (s || 'maison').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'maison';

export async function exportPng(model, size) {
  const svg = svgFor(model, size);
  const blob = await svgToPng(svg, size.width * size.ratio, size.height * size.ratio);
  download(blob, `${slug(model.name)}-${size.id}.png`);
}

export function exportSvg(model, size) {
  const svg = svgFor(model, size);
  download(new Blob([svg], { type: 'image/svg+xml' }), `${slug(model.name)}.svg`);
}

/** The four isometric views of the same house, as separate PNG files. */
export async function exportFourViews(model, size, onProgress) {
  const names = ['sud-est', 'sud-ouest', 'nord-ouest', 'nord-est'];
  for (let r = 0; r < 4; r++) {
    const view = { ...model, camera: { ...model.camera, rotation: r } };
    const svg = svgFor(view, size);
    const blob = await svgToPng(svg, size.width * size.ratio, size.height * size.ratio);
    download(blob, `${slug(model.name)}-${names[r]}.png`);
    if (onProgress) onProgress(r + 1, 4);
    // Browsers throttle bursts of downloads; a short gap keeps all four.
    await new Promise((r2) => setTimeout(r2, 350));
  }
}

/** Copy the current view to the clipboard, ready to paste into a dashboard. */
export async function copyPngToClipboard(model, size) {
  const svg = svgFor(model, size);
  const blob = await svgToPng(svg, size.width * size.ratio, size.height * size.ratio);
  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error("Le presse-papier image n'est pas disponible dans ce navigateur");
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
