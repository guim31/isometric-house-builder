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
  xPos: 0.90, // at rotation 0, the east facade lands on the screen LEFT — lit
  xNeg: 0.66,
  yPos: 0.74, // and the north facade on the screen right — shaded
  yNeg: 0.60,
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
  horizons: {
    label: 'Horizons — terre cuite',
    // Taken from the Gladys Assistant v5 house-view gallery, so a house
    // modelled here sits in that widget without looking like a foreign body.
    // Light stays fixed to the camera rather than to the world: the palette's
    // own drawings light the far slope, which looks right from one angle only,
    // whereas this tool has to give four exportable views of equal quality.
    style: { outline: false, shadow: false, windowBars: false, plinth: 0, texture: { roof: 'none', wall: 'none' } },
    wall: { base: '#efe8dc', up: '#f8f4ed', xPos: '#efe8dc', yPos: '#e0d6c6', xNeg: '#e7ded0', yNeg: '#d6cab4', down: '#cfc2ab' },
    roof: { base: '#d98d64', up: '#eeb08d', xPos: '#e8a37c', yPos: '#c97e56', xNeg: '#d98d64', yNeg: '#bf7550', down: '#b06c48' },
    roofEdge: '#f8f4ed',
    plinth: '#e0d6c6',
    trim: '#ffffff', door: '#54749e', shutter: '#f2f2f0', garage: '#f2f2f0',
    glass: '#bcd6f2', glassDark: '#aac9e8',
    grass: '#e3ecdf', grassEdge: '#d7e4d1',
    paving: '#eef0f2', gravel: '#e0d6c6', deck: '#e0d6c6',
    water: '#aac9e8', waterDeep: '#8fb8de', poolRim: '#f2f2f0',
    foliage: '#9fd0b2', foliageDark: '#8cc7a4', trunk: '#c9b79c',
    solar: '#41608f', solarCell: '#54749e', solarFrame: '#2e4468',
    chimney: '#efe8dc', chimneyCap: '#e0d6c6',
    fence: '#efe8dc', carBody: '#54749e', carGlass: '#bcd6f2', carTyre: '#48555f',
  },
  horizonsSlate: {
    label: 'Horizons — ardoise',
    style: { outline: false, shadow: false, windowBars: false, plinth: 0, texture: { roof: 'none', wall: 'none' } },
    wall: { base: '#eef0f2', up: '#f7f8f9', xPos: '#eef0f2', yPos: '#e0d6c6', xNeg: '#e6e9ec', yNeg: '#d6cab4', down: '#cdd2d6' },
    roof: { base: '#54636f', up: '#6b7d8b', xPos: '#5f7183', yPos: '#48555f', xNeg: '#54636f', yNeg: '#404b54', down: '#39434b' },
    roofEdge: '#f2f2f0',
    plinth: '#e0d6c6',
    trim: '#ffffff', door: '#54749e', shutter: '#eef0f2', garage: '#f2f2f0',
    glass: '#bcd6f2', glassDark: '#aac9e8',
    grass: '#e3ecdf', grassEdge: '#d7e4d1',
    paving: '#eef0f2', gravel: '#e0d6c6', deck: '#e0d6c6',
    water: '#aac9e8', waterDeep: '#8fb8de', poolRim: '#f2f2f0',
    foliage: '#9fd0b2', foliageDark: '#8cc7a4', trunk: '#c9b79c',
    solar: '#41608f', solarCell: '#54749e', solarFrame: '#2e4468',
    chimney: '#eef0f2', chimneyCap: '#e0d6c6',
    fence: '#eef0f2', carBody: '#54749e', carGlass: '#bcd6f2', carTyre: '#48555f',
  },
  terracotta: {
    label: 'Terre cuite',
    style: { outline: true, shadow: true, windowBars: true, plinth: 0.2, texture: { roof: 'tiles', wall: 'none' } },
    plinth: '#cdb894',
    wall: '#e9c98d', roof: '#c8663c', roofEdge: '#f2f0ea',
    trim: '#f4f1e8', door: '#cfd8dc', shutter: '#eef2f4',
  },
  slate: {
    label: 'Ardoise',
    style: { outline: true, shadow: true, windowBars: true, plinth: 0.2, texture: { roof: 'slate', wall: 'none' } },
    plinth: '#ccd1d5',
    wall: '#eceff1', roof: '#5b6771', roofEdge: '#ffffff',
    trim: '#ffffff', door: '#37474f', shutter: '#607d8b',
  },
  provence: {
    label: 'Provence',
    style: { outline: true, shadow: true, windowBars: true, plinth: 0.2, texture: { roof: 'tiles', wall: 'stone' } },
    plinth: '#d8c7a8',
    wall: '#f0dfc0', roof: '#b8563a', roofEdge: '#faf7f0',
    trim: '#ffffff', door: '#6b8fa3', shutter: '#7fa8bd',
  },
  nordic: {
    label: 'Nordique',
    style: { outline: true, shadow: true, windowBars: true, plinth: 0.2, texture: { roof: 'seam', wall: 'siding' } },
    plinth: '#6d4636',
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

/**
 * Blend a set of per-orientation colours by the face normal.
 *
 * Some palettes cannot be reproduced by darkening one base colour: their
 * shadows shift hue rather than just value. Naming a colour per orientation
 * and interpolating between them reproduces those palettes exactly on the
 * axis-aligned faces, and stays inside the same family on the sloped ones.
 */
function blendOriented(spec, n) {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const w = ax + ay + az || 1;
  const pick = (key, fallback) => hexToRgb(spec[key] || spec[fallback] || spec.base);
  const up = pick(n[2] > 0 ? 'up' : 'down', 'up');
  const sx = pick(n[0] > 0 ? 'xPos' : 'xNeg', 'xPos');
  const sy = pick(n[1] > 0 ? 'yPos' : 'yNeg', 'yPos');
  const out = [0, 1, 2].map((i) => (up[i] * az + sx[i] * ax + sy[i] * ay) / w);
  return rgbToHex(out[0], out[1], out[2]);
}

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Final colour of a face.
 *
 * A recoloured material keeps how *light* its palette makes each orientation,
 * not the palette's own hues. Carrying the anchors over as per-channel ratios
 * was the obvious approach and is wrong: going from a warm base to a neutral
 * target multiplies the blue channel by well over one, and the lighter anchors
 * blow out — a grey roof comes back pale cyan. Transposing the luminance ratio
 * instead keeps the shading structure and honours the chosen hue exactly.
 */
export function faceColour(mat, theme, overrides, n) {
  const t = THEMES[theme] || THEMES.terracotta;
  const spec = t[mat] !== undefined ? t[mat] : FIXED[mat];
  const override = overrides[mat];

  if (spec && typeof spec === 'object') {
    const blended = blendOriented(spec, n);
    if (!override) return blended;
    const baseL = luminance(spec.base);
    return shade(override, baseL < 1 ? 1 : luminance(blended) / baseL);
  }
  const base = override || spec || '#cccccc';
  return shade(base, shadeFactor(n));
}

export function materialColour(mat, theme, overrides = {}) {
  if (overrides[mat]) return overrides[mat];
  const t = THEMES[theme] || THEMES.terracotta;
  const spec = t[mat] !== undefined ? t[mat] : FIXED[mat];
  if (spec && typeof spec === 'object') return spec.base;
  return spec || '#cccccc';
}
