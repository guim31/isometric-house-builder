/** Palettes. */

import { check } from './harness.js';
import { B } from './helpers.js';
import { normalise } from '../src/core/model.js';
import { THEMES, faceColour, materialColour } from '../src/core/palette.js';

/* ---------------- palettes ---------------- */

check('la palette Horizons rend ses teintes exactes sur les faces d’axe', () => {
  // The values are those of the Gladys v5 house-view gallery; drifting from
  // them is exactly what this test is for.
  // The lit tone sits on +x: at rotation 0 the east facade lands on the
  // screen left, which is the side the reference drawing lights.
  const cases = [
    ['wall', [1, 0, 0], '#efe8dc'], ['wall', [0, 1, 0], '#e0d6c6'], ['wall', [0, 0, 1], '#f8f4ed'],
    ['roof', [1, 0, 0], '#e8a37c'], ['roof', [0, 1, 0], '#c97e56'],
    ['grass', [0, 0, 1], '#e3ecdf'],
  ];
  for (const [mat, n, expected] of cases) {
    const got = faceColour(mat, 'horizons', {}, n);
    if (got.toLowerCase() !== expected) return `${mat} ${JSON.stringify(n)} → ${got}, attendu ${expected}`;
  }
  return true;
});

check('une face inclinée reste entre les teintes voisines', () => {
  const n = [0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
  const got = faceColour('roof', 'horizons', {}, n);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(got.slice(i, i + 2), 16));
  const between = (v, lo, hi) => v >= Math.min(lo, hi) - 1 && v <= Math.max(lo, hi) + 1;
  // Bounded by the two anchors it blends: yNeg #bf7550 and up #eeb08d.
  return (between(r, 0xbf, 0xee) && between(g, 0x75, 0xb0) && between(b, 0x50, 0x8d))
    || `teinte hors bornes : ${got}`;
});

check('recolorer un matériau conserve la structure d’ombrage', () => {
  const ov = { wall: '#8fb3d9' };
  const lit = faceColour('wall', 'horizons', ov, [1, 0, 0]);
  const shaded = faceColour('wall', 'horizons', ov, [0, 1, 0]);
  const top = faceColour('wall', 'horizons', ov, [0, 0, 1]);
  const lum = (h) => [1, 3, 5].reduce((a, i) => a + parseInt(h.slice(i, i + 2), 16), 0);
  // Still three distinct values, ordered as the palette orders them.
  if (lit === shaded || lit === top) return 'les faces ne se distinguent plus';
  return lum(top) > lum(lit) && lum(lit) > lum(shaded)
    || `ordre rompu : haut ${lum(top)}, gauche ${lum(lit)}, droite ${lum(shaded)}`;
});

check('chaque palette déclare le style qui va avec', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    if (!t.style) return `${name} ne déclare aucun style`;
    if (typeof t.style.outline !== 'boolean') return `${name} : contours non déclarés`;
  }
  return true;
});

check('un fichier incomplet hérite du style de sa propre palette', () => {
  // No style block at all: the terracotta conventions must win, not whichever
  // palette happens to be the current default.
  const m = normalise({ theme: 'terracotta', cells: ['1,1'] });
  if (m.style.outline !== true) return 'contours non repris de la palette';
  if (B(m).plinth !== 0.2) return `soubassement ${B(m).plinth}`;
  if (m.texture.roof !== 'tiles') return `matière ${m.texture.roof}`;
  // An explicit choice in the file still wins over the palette.
  const forced = normalise({ theme: 'terracotta', cells: ['1,1'], style: { outline: false } });
  return forced.style.outline === false || 'le choix explicite du fichier a été écrasé';
});

check('la palette Horizons se passe de contours et de soubassement', () => {
  const st = THEMES.horizons.style;
  return st.outline === false && st.plinth === 0 && st.windowBars === false;
});

check('materialColour renvoie la teinte de référence d’un matériau orienté', () => {
  return materialColour('wall', 'horizons', {}) === '#efe8dc'
    && materialColour('wall', 'horizons', { wall: '#123456' }) === '#123456';
});
