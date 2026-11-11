/** Vue de nuit. */

import { check, checkAsync } from './harness.js';
import { near, stripIds, loadBlob } from './helpers.js';
import { defaultModel, normalise } from '../src/core/model.js';
import { renderScene } from '../src/render/svg.js';
import { hexToRgb, rgbToHsl, nightColour, NIGHT } from '../src/core/palette.js';
import { svgFor, svgToPng } from '../src/io/export.js';

/* ---------------- night ---------------- */

check('la nuit assombrit et désature, sans toucher aux fenêtres', () => {
  const lum = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const sat = (hex) => { const [r, g, b] = hexToRgb(hex); return rgbToHsl(r, g, b)[1]; };
  for (const day of ['#e9c98d', '#c8663c', '#eceff1', '#5fa855']) {
    const n = nightColour('wall', day);
    if (lum(n) >= lum(day) * 0.6) return `${day} → ${n} : à peine assombri`;
    if (sat(n) > sat(day) + 0.02) return `${day} → ${n} : plus saturé qu'en plein jour`;
  }
  // A lawn goes darker still: nothing lights it, whereas a wall catches the
  // moon. Graded alike, the lawn came out brighter than the house on it.
  if (lum(nightColour('grass', '#9ccb7a')) >= lum(nightColour('wall', '#9ccb7a'))) {
    return 'le terrain n’est pas plus sombre que les murs';
  }
  // Windows are the whole point: they say whether the house is awake.
  const glass = nightColour('glass', '#bfe3f2');
  if (glass !== NIGHT.lit.glass) return 'les fenêtres ne sont pas allumées';
  return lum(glass) > 150 || 'les fenêtres allumées sont trop sombres';
});

check('la nuit s’applique aussi aux matériaux d’un corps donné', () => {
  // Per-building materials carry a suffix; the grade has to see through it.
  return nightColour('wall#b3', '#e9c98d') === nightColour('wall', '#e9c98d')
    || 'le suffixe de corps échappe au traitement de nuit';
});

check('le ciel étoilé est identique d’un rendu à l’autre', () => {
  // Same reason as the roof tiles: the export has to match the preview, and
  // re-exporting tomorrow has to give the same image.
  const m = normalise({ ...defaultModel(), style: { ...defaultModel().style, night: true } });
  const a = renderScene(m, { width: 400, height: 300 }).svg;
  const b = renderScene(m, { width: 400, height: 300 }).svg;
  if (stripIds(a) !== stripIds(b)) {
    return 'deux rendus successifs diffèrent';
  }
  return (a.match(/<circle/g) || []).length > 30 || 'aucune étoile';
});

check('les étoiles s’arrêtent avant le bas de l’image', () => {
  // Reported in use: a starfield under the garden reads as a house floating in
  // space. The plot is finite, so there is sky all round it — but only what is
  // overhead should be starry.
  const m = normalise({ ...defaultModel(), style: { ...defaultModel().style, night: true } });
  const svg = renderScene(m, { width: 400, height: 400 }).svg;
  let low = 0, high = 0;
  for (const [, cy] of [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r=/g)].map((x) => x)) {
    (Number(cy) > 340 ? () => { low++; } : () => { high++; })();
  }
  if (!high) return 'aucune étoile';
  return low === 0 || `${low} étoiles dans le dernier dixième de l’image`;
});

check('sous cadrage, la nuit garde son ciel', () => {
  // The daytime frame is backed by a plain fill of the ground colour, to stop
  // a tight crop showing a wedge of nothing. At night that fill hid the sky
  // entirely. Worth stating why they cannot both apply: an unbounded ground
  // plane projects over the whole image in axonometry, so a sky exists only
  // because the plot is finite.
  const base = defaultModel();
  const focus = { enabled: true, x: 12, y: 12, w: 8, d: 6, margin: 1, hide: true };
  const day = renderScene(normalise({ ...base, focus }), { width: 300, height: 220 }).svg;
  const dark = renderScene(normalise({
    ...base, focus, style: { ...base.style, night: true },
  }), { width: 300, height: 220 }).svg;
  if (!/linearGradient/.test(dark)) return 'pas de ciel sous cadrage';
  // Exactly one full-frame rectangle at night — the sky — and none by day,
  // where the ground is a pad and everything round it stays transparent.
  const rects = (svg) => (svg.match(/<rect width="300" height="220"/g) || []).length;
  if (rects(dark) !== 1) return `${rects(dark)} fonds pleins de nuit`;
  return rects(day) === 0 || `${rects(day)} fonds pleins de jour`;
});

await checkAsync('une vue de nuit a un ciel, même en fond transparent', async () => {
  // The one setting this mode overrides, and on purpose: a transparent picture
  // of a dark house is not a night view. Checked on pixels — the sky is a
  // gradient, and gradients are the part of SVG worth distrusting on export.
  const W = 160, H = 120;
  const base = defaultModel();
  const m = normalise({ ...base, style: { ...base.style, background: 'transparent', night: true } });
  const blob = await svgToPng(svgFor(m, { width: W, height: H, ratio: 1 }), W, H);
  const img = await loadBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const top = ctx.getImageData(W - 4, 2, 1, 1).data;
  const horizon = ctx.getImageData(W - 4, Math.round(H * 0.46), 1, 1).data;
  const bottom = ctx.getImageData(W - 4, H - 3, 1, 1).data;
  if (top[3] !== 255 || bottom[3] !== 255) return `ciel absent (alpha ${top[3]}, ${bottom[3]})`;
  if (top[2] <= top[0]) return 'le ciel n’est pas bleu';
  // Three stops: dark at the zenith, lighter at the horizon, dark again below.
  // Sampling only the two ends would now compare two near-identical darks and
  // pass whether or not the gradient survived — which is how the first version
  // of this check would have missed it.
  if (horizon[2] <= top[2] + 6) return 'le dégradé du ciel n’a pas survécu';
  return horizon[2] > bottom[2] + 6 || 'le ciel ne s’assombrit pas sous l’horizon';
});
