/**
 * Flat-illustration colouring.
 *
 * Light is fixed in *camera* space rather than world space, so a wall keeps
 * the same brightness as the house is rotated. That is what makes the four
 * exported views look like a consistent set of illustrations rather than four
 * differently-lit photographs.
 */

/** Brightness per face orientation. Sloped faces blend between these. */
const ORIENT = {
  up: 1.0,
  down: 0.42,
  xPos: 0.74, // right-hand facade on screen
  xNeg: 0.60,
  yPos: 0.90, // left-hand facade on screen
  yNeg: 0.66,
};

/** Shading factor for a normal already expressed in camera space. */
export function shadeFactor(n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const w = ax + ay + az || 1;
  const sum =
    (n[2] > 0 ? ORIENT.up : ORIENT.down) * az +
    (n[0] > 0 ? ORIENT.xPos : ORIENT.xNeg) * ax +
    (n[1] > 0 ? ORIENT.yPos : ORIENT.yNeg) * ay;
  return sum / w;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Apply a shading factor, keeping highlights warm rather than washed out. */
export function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  if (f >= 1) {
    const t = Math.min(1, (f - 1) * 1.6);
    return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
  }
  return rgbToHex(r * f, g * f, b * f);
}

/** Darken a colour, used for outlines derived from the fill. */
export function darken(hex, amount = 0.22) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

export const THEMES = {
  terracotta: {
    label: 'Terre cuite',
    wall: '#e9c98d', roof: '#c8663c', roofEdge: '#f2f0ea',
    trim: '#f4f1e8', door: '#cfd8dc', shutter: '#eef2f4',
  },
  slate: {
    label: 'Ardoise',
    wall: '#eceff1', roof: '#5b6771', roofEdge: '#ffffff',
    trim: '#ffffff', door: '#37474f', shutter: '#607d8b',
  },
  provence: {
    label: 'Provence',
    wall: '#f0dfc0', roof: '#b8563a', roofEdge: '#faf7f0',
    trim: '#ffffff', door: '#6b8fa3', shutter: '#7fa8bd',
  },
  nordic: {
    label: 'Nordique',
    wall: '#8d5c46', roof: '#3c4550', roofEdge: '#f5f1ea',
    trim: '#f5f1ea', door: '#2f3640', shutter: '#f5f1ea',
  },
};

/** Colours that do not belong to the house shell and stay constant per theme. */
export const FIXED = {
  grass: '#9ccb7a', grassEdge: '#8ab868',
  paving: '#dcd7cc', gravel: '#cfc9bb', deck: '#c99a63',
  water: '#4fc3e8', waterDeep: '#2fa9d6', poolRim: '#f2f0ea',
  glass: '#bfe3f2', glassDark: '#6f9fb5', frame: '#ffffff',
  garage: '#e6e6e2', garageLine: '#cfcfc9',
  solar: '#2f4a72', solarCell: '#3d5f8f', solarFrame: '#b9c1cb',
  chimney: '#d8d3c8', chimneyCap: '#8c8880',
  foliage: '#5fa855', foliageDark: '#4a8a44', trunk: '#8a6242',
  fence: '#d9cfbf', carBody: '#d94f4f', carGlass: '#8fb6c9', carTyre: '#33383d',
  shadow: '#000000',
};

export function materialColour(mat, theme, overrides = {}) {
  if (overrides[mat]) return overrides[mat];
  const t = THEMES[theme] || THEMES.terracotta;
  if (t[mat]) return t[mat];
  if (FIXED[mat]) return FIXED[mat];
  return '#cccccc';
}
