/** Modèles de départ. */

import { check } from './harness.js';
import { B, cellsOf } from './helpers.js';
import { decomposeRects, boundaryEdges } from '../src/core/grid.js';
import { heightField } from '../src/core/roof.js';
import { normalise, cellSet } from '../src/core/model.js';
import { renderScene } from '../src/render/svg.js';
import { PRESETS, getPreset } from '../src/data/presets.js';
import { Gallery } from '../src/ui/gallery.js';
import { DICTIONARIES } from '../src/i18n/index.js';

/* ---------------- starter models ---------------- */

check('la galerie propose dix modèles, tous identifiés', () => {
  if (PRESETS.length !== 10) return `${PRESETS.length} modèles`;
  const ids = PRESETS.map((p) => p.id);
  if (new Set(ids).size !== ids.length) return 'identifiants en double';
  for (const p of PRESETS) {
    // The name and the description shown are the dictionaries'; the French
    // name is also the model's own, and the two must not drift apart.
    for (const [lang, dict] of Object.entries(DICTIONARIES)) {
      if (!dict[`preset.${p.id}`] || !dict[`preset.${p.id}.note`]) return `${p.id} : nom ou description manquant (${lang})`;
    }
    if (DICTIONARIES.fr[`preset.${p.id}`] !== p.name) return `${p.id} : nom différent du dictionnaire`;
    if (!p.model.cells.length) return `${p.id} : emprise vide`;
  }
  return getPreset('chalet') !== null && getPreset('inconnu') === null;
});

check('chaque ouverture d’un modèle est posée sur un mur qui existe', () => {
  // A dangling wall reference fails silently: the opening is simply never
  // drawn, which is easy to miss when eyeballing a thumbnail.
  for (const p of PRESETS) {
    const m = normalise(p.model);
    const walls = new Set(boundaryEdges(cellSet(m)).map((e) => e.id));
    for (const op of m.openings) {
      if (!walls.has(op.edge)) return `${p.id} : ${op.kind} sur le mur inexistant ${op.edge}`;
      if ((op.storey || 0) >= m.storeys) return `${p.id} : ${op.kind} à l’étage ${op.storey} sur ${m.storeys}`;
    }
  }
  return true;
});

check('chaque objet de toiture d’un modèle repose bien sur le toit', () => {
  for (const p of PRESETS) {
    const m = normalise(p.model);
    const field = heightField(decomposeRects(cellSet(m)), B(m).roof);
    for (const it of m.roofItems) {
      if (!field.inside(it.x, it.y)) return `${p.id} : ${it.kind} hors toiture en (${it.x}, ${it.y})`;
    }
  }
  return true;
});

check('les dix modèles se rendent sans coordonnée invalide', () => {
  for (const p of PRESETS) {
    const out = renderScene(normalise(p.model), { width: 320, height: 220 });
    if (out.svg.includes('NaN')) return `${p.id} : coordonnée NaN`;
    if (out.faces.length < 12) return `${p.id} : ${out.faces.length} faces seulement`;
  }
  return true;
});

check('les modèles couvrent des formes réellement différentes', () => {
  // Ten variations on one shape would defeat the point of the gallery.
  const seen = new Set();
  for (const p of PRESETS) {
    const m = normalise(p.model);
    seen.add(`${B(m).roof.type}|${B(m).storeys}`);
  }
  return seen.size >= 6 || `seulement ${seen.size} combinaisons toit/étages`;
});

check('la galerie construit une vignette par modèle, plus la page blanche', () => {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<div class="gallery-grid"></div>';
  document.getElementById('stage').appendChild(dialog);
  let picked = null;
  const gallery = new Gallery(dialog, (m) => { picked = m; });
  gallery.build();
  const cards = dialog.querySelectorAll('.gallery-card');
  if (cards.length !== PRESETS.length + 1) return `${cards.length} cartes`;
  if (!dialog.querySelector('.gallery-thumb svg')) return 'vignette sans rendu';
  cards[0].click();
  return (picked && cellsOf(picked).length > 0) || 'le choix ne renvoie aucun modèle';
});
