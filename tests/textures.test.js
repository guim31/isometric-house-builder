/** Matières. */

import { check } from './harness.js';
import { near, stripIds, slopeFace } from './helpers.js';
import { defaultModel, normalise } from '../src/core/model.js';
import { renderScene } from '../src/render/svg.js';
import { textureSegments, textureTiles, tilePalette, specFor, ROOF_TEXTURES, WALL_TEXTURES } from '../src/render/texture.js';
import { hexToRgb, rgbToHsl } from '../src/core/palette.js';

/* ---------------- textures ---------------- */


check('les rangs de tuiles restent horizontaux sur une pente', () => {
  const segs = textureSegments(slopeFace(), ROOF_TEXTURES.tiles, 60);
  if (!segs.length) return 'aucun segment';
  // Courses follow the eaves, so both ends of a course sit at the same height.
  const courses = segs.filter(([a, b]) => Math.abs(a[0] - b[0]) > 0.5);
  if (!courses.length) return 'aucun rang trouvé';
  for (const [a, b] of courses) {
    if (!near(a[2], b[2], 1e-6)) return `rang non horizontal : ${a[2]} vs ${b[2]}`;
  }
  return true;
});

check('les segments de texture restent dans le plan de la face', () => {
  const face = slopeFace();
  const d0 = face.normal[0] * face.loops[0][0][0] + face.normal[1] * face.loops[0][0][1]
    + face.normal[2] * face.loops[0][0][2];
  for (const spec of [ROOF_TEXTURES.tiles, ROOF_TEXTURES.slate, ROOF_TEXTURES.seam]) {
    for (const [a, b] of textureSegments(face, spec, 60)) {
      for (const p of [a, b]) {
        const d = face.normal[0] * p[0] + face.normal[1] * p[1] + face.normal[2] * p[2];
        if (!near(d, d0, 1e-6)) return 'segment hors du plan';
      }
    }
  }
  return true;
});

check('une texture trop fine à l’écran n’est pas dessinée', () => {
  // At three pixels per metre a 0.38 m course would be sub-pixel noise.
  return textureSegments(slopeFace(), ROOF_TEXTURES.tiles, 3).length === 0;
});

check('les joints d’un appareillage sont décalés d’un rang à l’autre', () => {
  const wall = {
    normal: [0, 1, 0],
    loops: [[[0, 5, 0], [4, 5, 0], [4, 5, 2.5], [0, 5, 2.5]]],
  };
  const segs = textureSegments(wall, WALL_TEXTURES.brick, 80);
  const joints = segs.filter(([a, b]) => Math.abs(a[2] - b[2]) > 0.01);
  if (joints.length < 4) return `${joints.length} joints seulement`;
  const xs = new Set(joints.map(([a]) => Math.round(a[0] * 100) / 100));
  return xs.size > 2 || 'joints tous alignés';
});

check('les tuiles canal couvrent la face et restent dans son plan', () => {
  const face = slopeFace();
  const tiles = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  if (tiles.length < 200) return `${tiles.length} tuiles seulement`;
  const d0 = face.normal[0] * face.loops[0][0][0] + face.normal[1] * face.loops[0][0][1]
    + face.normal[2] * face.loops[0][0][2];
  for (const t of tiles) {
    if (t.pts.length !== 4) return 'tuile non quadrangulaire';
    for (const p of t.pts) {
      const d = face.normal[0] * p[0] + face.normal[1] * p[1] + face.normal[2] * p[2];
      if (!near(d, d0, 1e-6)) return 'tuile hors du plan de la face';
    }
  }
  return true;
});

check('le panachage est déterministe', () => {
  // An export must match the preview, and re-exporting tomorrow must give the
  // same image — hence a positional hash rather than Math.random.
  const face = slopeFace();
  const a = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  const b = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  for (let i = 0; i < a.length; i++) {
    if (a[i].colour !== b[i].colour) return `tuile ${i} : ${a[i].colour} puis ${b[i].colour}`;
  }
  const m = normalise({ ...defaultModel(), texture: { roof: 'canal', wall: 'none' } });
  // Clip-path ids are deliberately unique per render, so they are normalised
  // out: what must be identical is the geometry and the shades.
  return stripIds(renderScene(m, { width: 500, height: 380 }).svg)
    === stripIds(renderScene(m, { width: 500, height: 380 }).svg) || 'deux rendus divergent';
});

check('le camaïeu reste discret et proche de la teinte du toit', () => {
  // Shades must vary, but a tile straying far would read as a defect rather
  // than as a fired-clay variation. The bounds are deliberately tight: the
  // first version of this material was judged too vivid.
  const fill = '#d98d64';
  const [h0, s0, l0] = rgbToHsl(...hexToRgb(fill));
  const shades = tilePalette(fill);
  if (shades.length < 12) return `${shades.length} nuances`;
  if (new Set(shades).size < 12) return 'nuances dupliquées';
  for (const c of shades) {
    const [h, sat, l] = rgbToHsl(...hexToRgb(c));
    let dh = Math.abs(h - h0); if (dh > 180) dh = 360 - dh;
    if (dh > 12) return `teinte à ${dh.toFixed(0)}° de la base : ${c}`;
    if (Math.abs(l - l0) > 0.085) return `clarté trop écartée : ${c}`;
    if (sat > s0 * 1.1) return `nuance plus vive que la base : ${c}`;
  }
  return true;
});

check('les tuiles canal sont allongées et assez grandes', () => {
  const t = ROOF_TEXTURES.canal.tile;
  if (t.slope / t.width < 1.7) return `rapport ${(t.slope / t.width).toFixed(2)} : pas assez allongée`;
  // Fewer, larger tiles: a roof should not dissolve into speckle.
  const perM2 = 1 / (t.slope * t.width);
  return perM2 < 7 || `${perM2.toFixed(1)} tuiles au m², trop nombreuses`;
});

check('les tuiles canal courent dans le sens de la pente', () => {
  // A canal tile is a channel from ridge to eaves. Laid the other way the
  // roof is shingled sideways, which is what this pins down: the long side of
  // a tile must climb, never follow the eaves line.
  const face = slopeFace();
  const tiles = textureTiles(face, ROOF_TEXTURES.canal, 60, '#d98d64');
  if (!tiles.length) return 'aucune tuile';
  const t = tiles[Math.floor(tiles.length / 2)];
  // Edge lengths of the quad, and how much height each one gains.
  const edge = (p, q) => ({
    len: Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]),
    rise: Math.abs(q[2] - p[2]),
  });
  const e1 = edge(t.pts[0], t.pts[1]);
  const e2 = edge(t.pts[1], t.pts[2]);
  const long = e1.len >= e2.len ? e1 : e2;
  const short = e1.len >= e2.len ? e2 : e1;
  if (long.len / short.len < 1.5) return 'la tuile n’est pas franchement allongée';
  // The long edge climbs; the short one stays level with the eaves.
  return (long.rise > short.rise + 0.05)
    || `côté long à ${long.rise.toFixed(3)} m de dénivelé contre ${short.rise.toFixed(3)} : posée en travers`;
});

check('les tuiles disparaissent quand elles deviennent illisibles', () => {
  return textureTiles(slopeFace(), ROOF_TEXTURES.canal, 3, '#d98d64').length === 0;
});

check('les tuiles sont regroupées par nuance, pas émises une à une', () => {
  // Thousands of tiles, a score of shades: without the grouping the SVG would
  // carry one path per tile and grow by an order of magnitude.
  const m = normalise({ ...defaultModel(), texture: { roof: 'canal', wall: 'none' } });
  const svg = renderScene(m, { width: 1200, height: 800 }).svg;
  const paths = (svg.match(/<path/g) || []).length;
  const tiles = (svg.match(/Z/g) || []).length;
  if (tiles < 500) return `${tiles} tuiles : le panachage ne s'est pas déclenché`;
  return paths < 400 || `${paths} chemins pour ${tiles} facettes`;
});

check('seuls les murs et la toiture reçoivent une matière', () => {
  const t = { roof: 'tiles', wall: 'brick' };
  return specFor('roof', t) && specFor('wall', t)
    && !specFor('grass', t) && !specFor('water', t) && !specFor('glass', t);
});

check('le rendu texturé produit des chemins de découpe uniques', () => {
  const m = normalise({ ...defaultModel(), texture: { roof: 'tiles', wall: 'brick' } });
  const a = renderScene(m, { width: 600, height: 400 }).svg;
  const b = renderScene(m, { width: 600, height: 400 }).svg;
  const ids = (svg) => [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((x) => x[1]);
  const ia = ids(a), ib = ids(b);
  if (!ia.length) return 'aucune découpe émise';
  if (new Set(ia).size !== ia.length) return 'identifiants dupliqués dans un même rendu';
  // Two renders on one page must not share ids, or they clip each other.
  return ia.every((id) => !ib.includes(id)) || 'identifiants partagés entre deux rendus';
});
