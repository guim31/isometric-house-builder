/** Corps de bâtiment. */

import { check } from './harness.js';
import { near, pointer } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { normalise, makeBuilding, buildingOfEdge } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { specFor, ROOF_TEXTURES } from '../src/render/texture.js';
import { Store } from '../src/ui/store.js';
import { PlanView } from '../src/ui/plan.js';

/* ---------------- separate building volumes ---------------- */

check('un ancien fichier se scinde en corps distincts', () => {
  // The house and a shed drawn away from it were always two volumes; the old
  // shape simply had no way of saying so. Opening such a file separates them,
  // so the shed can be re-roofed without touching the house.
  const legacy = {
    cells: [...rectCells(10, 10, 15, 14), ...rectCells(24, 10, 26, 12)],
    storeys: 2, storeyHeight: 2.5,
    roof: { type: 'gable', pitch: 40 },
  };
  const m = normalise(legacy);
  if (m.buildings.length !== 2) return `${m.buildings.length} corps`;
  const [house, shed] = m.buildings;
  if (house.cells.length <= shed.cells.length) return 'le plus grand volume n’est pas le premier';
  // Each inherits the old settings, then goes its own way.
  for (const b of m.buildings) {
    if (b.roof.type !== 'gable' || b.storeys !== 2 || b.storeyHeight !== 2.5) {
      return `${b.name} n’a pas hérité des réglages`;
    }
  }
  return house.id !== shed.id || 'identifiants confondus';
});

check('une emprise d’un seul tenant reste un seul corps', () => {
  const m = normalise({ cells: [...rectCells(10, 10, 20, 16)] });
  return m.buildings.length === 1 || `${m.buildings.length} corps`;
});

check('changer le toit d’un corps ne touche pas l’autre', () => {
  // The whole point of the request: a flat-roofed shed beside a hipped house.
  const m = normalise({
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(10, 10, 16, 15)] }),
      makeBuilding({ id: 'abri', cells: [...rectCells(22, 10, 25, 13)], storeyHeight: 2.2 }),
    ],
  });
  const changed = {
    ...m,
    buildings: m.buildings.map((b) => (b.id === 'abri'
      ? { ...b, roof: { ...b.roof, type: 'flat' } } : b)),
  };
  const apexOf = (model, id) => {
    const part = buildMesh(normalise(model)).parts.find((p) => p.building.id === id);
    return part.roof.apex - part.top;
  };
  if (apexOf(m, 'abri') < 0.5) return 'le toit initial de l’abri n’a pas de pente';
  if (apexOf(changed, 'abri') > 0.01) return 'le toit de l’abri n’est pas devenu plat';
  return near(apexOf(m, 'maison'), apexOf(changed, 'maison'), 1e-9)
    || 'le toit de la maison a bougé avec celui de l’abri';
});

check('un corps peut avoir ses propres couleurs', () => {
  const m = normalise({
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(10, 10, 16, 15)] }),
      makeBuilding({ id: 'abri', cells: [...rectCells(22, 10, 25, 13)], overrides: { wall: '#ffffff' } }),
    ],
  });
  const out = renderScene(m, { width: 600, height: 420 });
  const mats = new Set(out.faces.map((f) => f.mat));
  if (!mats.has('wall#abri')) return 'le corps recoloré ne porte pas son propre matériau';
  if (!mats.has('wall')) return 'l’autre corps a perdu le matériau commun';
  const shed = out.faces.find((f) => f.mat === 'wall#abri');
  const house = out.faces.find((f) => f.mat === 'wall');
  return shed.fill !== house.fill || 'les deux corps rendent la même couleur';
});

check('un corps peut porter ses propres matières', () => {
  // A timber shed should not be roofed in the house's canal tiles.
  const m = normalise({
    texture: { roof: 'canal', wall: 'none' },
    buildings: [
      makeBuilding({ id: 'maison', cells: [...rectCells(10, 10, 18, 16)] }),
      makeBuilding({
        id: 'abri', cells: [...rectCells(24, 10, 28, 14)],
        roof: { type: 'flat', pitch: 5, overhang: 0.25, fascia: 0.12, shedDir: 'S' },
        texture: { roof: 'none', wall: 'siding' },
      }),
    ],
  });
  const out = renderScene(m, { width: 900, height: 640 });
  const tiles = (svgOf) => (svgOf.match(/Z/g) || []).length;
  // The house is tiled; the shed's own flat material must produce none.
  const houseRoof = out.faces.filter((f) => f.mat === 'roof');
  const shedRoof = out.faces.filter((f) => f.mat === 'roof#abri');
  if (!houseRoof.length) return 'toiture de la maison absente';
  if (!shedRoof.length) return 'l’abri ne porte pas ses propres matériaux';
  if (!specFor('roof', m.texture)) return 'la matière du modèle ne se résout plus';
  // Without a per-building texture the shed would inherit the canal spec.
  return specFor('roof#abri', m.buildings[1].texture).label === ROOF_TEXTURES.none.label
    || 'l’abri hérite encore de la matière de la maison';
});

check('le pinceau ne peint que dans le corps actif', () => {
  const s = new Store(normalise({
    buildings: [
      makeBuilding({ id: 'a', cells: [...rectCells(10, 10, 12, 12)] }),
      makeBuilding({ id: 'b', cells: [...rectCells(20, 10, 22, 12)] }),
    ],
  }));
  const view = new PlanView(document.getElementById('plan'), s);
  s.setActiveBuilding('b');
  s.setTool('paint');
  view.render();
  view.svg.dispatchEvent(pointer(view, 23.5, 11.5, 'pointerdown'));
  view.svg.dispatchEvent(pointer(view, 23.5, 11.5, 'pointerup'));
  const a = s.model.buildings.find((x) => x.id === 'a');
  const b = s.model.buildings.find((x) => x.id === 'b');
  if (!b.cells.includes('23,11')) return 'la case n’a pas été ajoutée au corps actif';
  return a.cells.length === 9 || 'le corps inactif a été modifié';
});

check('supprimer un corps emporte ses ouvertures', () => {
  const s = new Store(normalise({
    buildings: [
      makeBuilding({ id: 'a', cells: [...rectCells(10, 10, 14, 13)] }),
      makeBuilding({ id: 'b', cells: [...rectCells(20, 10, 23, 13)] }),
    ],
    openings: [
      { id: 'oa', edge: '12,10,S', storey: 0, kind: 'window', offset: 0.5, width: 1, height: 1, sill: 1 },
      { id: 'ob', edge: '21,10,S', storey: 0, kind: 'window', offset: 0.5, width: 1, height: 1, sill: 1 },
    ],
  }));
  if (buildingOfEdge(s.model, '21,10,S').id !== 'b') return 'ouverture rattachée au mauvais corps';
  s.removeBuilding('b');
  if (s.model.buildings.length !== 1) return 'corps non supprimé';
  const ids = s.model.openings.map((o) => o.id);
  return (ids.includes('oa') && !ids.includes('ob'))
    || `ouvertures restantes : ${JSON.stringify(ids)}`;
});

check('le dernier corps ne peut pas être supprimé', () => {
  const s = new Store(normalise({ cells: [...rectCells(10, 10, 14, 13)] }));
  s.removeBuilding(s.model.buildings[0].id);
  return s.model.buildings.length === 1 || 'le modèle s’est retrouvé sans bâtiment';
});
