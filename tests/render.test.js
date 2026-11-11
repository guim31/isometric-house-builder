/** Scène et rendu. */

import { check } from './harness.js';
import { B } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise, wallTop } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { hitLayer } from '../src/render/hit.js';
import { svgFor, SIZES } from '../src/io/export.js';

/* ---------------- scene and rendering ---------------- */

check('un rendu peut réutiliser les faces déjà fusionnées', () => {
  // What the viewport's pan/zoom cache relies on.
  const m = normalise({ ...emptyModel(), cells: [...rectCells(10, 10, 16, 14)] });
  const first = renderScene(m, { width: 400, height: 300 });
  const second = renderScene(m, { width: 400, height: 300, built: first.built, faces: first.merged });
  return first.svg === second.svg || 'rendus différents';
});


check('tous les types de toit et toutes les rotations se rendent sans erreur', () => {
  for (const type of ['hip', 'gable', 'flat', 'shed']) {
    for (let rot = 0; rot < 4; rot++) {
      const m = normalise({
        ...defaultModel(),
        roof: { ...defaultModel().roof, type },
        camera: { rotation: rot, projection: 'iso30' },
      });
      const out = renderScene(m, { width: 400, height: 300 });
      if (!out.svg.startsWith('<svg')) return `${type}/${rot} : SVG invalide`;
      if (out.svg.includes('NaN')) return `${type}/${rot} : coordonnée NaN`;
      if (out.faces.length < 5) return `${type}/${rot} : ${out.faces.length} faces seulement`;
    }
  }
  return true;
});

check('un modèle vide ne fait pas planter le rendu', () => {
  const out = renderScene(normalise(emptyModel()), { width: 200, height: 150 });
  return out.svg.startsWith('<svg');
});

check('plusieurs étages surélèvent bien la toiture', () => {
  const base = normalise(defaultModel());
  const tall = normalise({ ...base, buildings: base.buildings.map((b) => ({ ...b, storeys: 2 })) });
  return wallTop(B(tall)) > wallTop(B(base)) + 2;
});

check('le pignon monte au-dessus de la ligne de rive', () => {
  const d = defaultModel();
  const m = normalise({ ...d, buildings: d.buildings.map((b) => ({ ...b, roof: { ...b.roof, type: 'gable' } })) });
  const { mesh } = buildMesh(m);
  const top = wallTop(B(m));
  const highest = mesh.tris
    .filter((t) => t.mat === 'wall')
    .reduce((acc, t) => Math.max(acc, t.a[2], t.b[2], t.c[2]), 0);
  return highest > top + 0.5 || `mur le plus haut : ${highest.toFixed(2)} m pour une rive à ${top} m`;
});

check('la couche de sélection expose murs, ouvertures et objets', () => {
  const m = normalise(defaultModel());
  const { camera } = renderScene(m, { width: 400, height: 300 });
  const html = hitLayer(m, camera);
  for (const kind of ['wall', 'opening', 'roofItem', 'prop']) {
    if (!html.includes(`data-pick="${kind}"`)) return `cible « ${kind} » absente`;
  }
  return true;
});

check('l’export applique la densité de pixels sans toucher au viewBox', () => {
  const m = normalise(defaultModel());
  const svg = svgFor(m, SIZES.find((s) => s.id === 'uhd'));
  return (svg.includes('width="4800"') && svg.includes('viewBox="0 0 1200 800"'))
    || 'dimensions ou viewBox inattendus';
});

check('le fond transparent n’ajoute aucun rectangle de fond', () => {
  const m = normalise(defaultModel());
  const opaque = normalise({ ...m, style: { ...m.style, background: '#ffffff' } });
  return !svgFor(m, SIZES[0]).includes('<rect') && svgFor(opaque, SIZES[0]).includes('<rect');
});
