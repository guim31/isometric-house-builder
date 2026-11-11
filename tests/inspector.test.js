/** Inspecteur. */

import { check } from './harness.js';
import { B, near } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { defaultModel, emptyModel, normalise, makeBuilding } from '../src/core/model.js';
import { Store } from '../src/ui/store.js';
import { Inspector } from '../src/ui/panels.js';

check('un panneau replié le reste après une modification du modèle', () => {
  // The inspector is rebuilt from scratch on every change. If the fold state
  // lived in the DOM it would spring open under the hand at the first drag of
  // a slider, which is why it is held on the inspector instead.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  insp.render();
  const first = div.querySelector('details.panel');
  if (!first) return 'aucun panneau repliable';
  if (!first.open) return 'le premier panneau devrait s’ouvrir par défaut';
  first.open = false;
  first.dispatchEvent(new Event('toggle'));
  s.update((m) => ({ ...m, name: 'Autre' }));
  insp.render();
  const again = div.querySelector('details.panel');
  if (again.open) return 'le panneau s’est rouvert tout seul';
  // And the other way round: unfolding something closed by default must stick.
  const shut = [...div.querySelectorAll('details.panel')].find((d) => !d.open && d !== again);
  if (!shut) return 'tous les panneaux sont ouverts';
  const title = shut.querySelector('.panel-name').textContent;
  shut.open = true;
  shut.dispatchEvent(new Event('toggle'));
  s.update((m) => ({ ...m, name: 'Encore' }));
  insp.render();
  const back = [...div.querySelectorAll('details.panel')]
    .find((d) => d.querySelector('.panel-name').textContent === title);
  return back?.open || `« ${title} » s’est refermé`;
});

check('un panneau replié dit ce qu’il contient', () => {
  // A closed section that shows only its title forces everything open to be
  // read, which defeats the folding.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const shut = [...div.querySelectorAll('details.panel')].filter((d) => !d.open);
  if (!shut.length) return 'aucun panneau replié par défaut';
  const mute = shut.filter((d) => !d.querySelector('.panel-badge')?.textContent.trim());
  return mute.length === 0
    || `${mute.length} panneau(x) replié(s) sans indication : `
      + mute.map((d) => d.querySelector('.panel-name').textContent).join(', ');
});

check('les réglages sont rangés en familles', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  new Inspector(div, s).render();
  const groups = [...div.querySelectorAll('.panel-group')].map((g) => g.textContent);
  const want = ['Sélection', 'Bâtiment', 'Projet', 'Vue et export'];
  return want.every((w) => groups.includes(w)) || `familles trouvées : ${groups.join(', ')}`;
});

check('la position d’une ouverture se compte depuis l’angle du mur', () => {
  // A user's report: "0 should intuitively be the corner where the wall
  // begins. But it isn't." It was the start of a one-cell boundary edge, and
  // his own file has a window at -0.75 because that is what it took to move
  // one a little to the left.
  //
  // Body 6 cells wide, so its south wall runs from x = 0 to x = 6. The opening
  // is anchored to the edge at i = 4, four metres along — the case where an
  // edge-relative offset and a wall-relative one differ most visibly.
  const s = new Store(normalise({ ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 3)] })],
    openings: [{ id: 'o1', edge: '4,0,S', kind: 'window', storey: 0,
      offset: 0.5, width: 1.2, height: 1.15, sill: 1 }] }));
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  s.select({ type: 'opening', id: 'o1' });
  insp.render();
  const row = [...div.querySelectorAll('label.field')]
    .find((r) => r.querySelector('.field-label').textContent === 'Position');
  if (!row) return 'pas de champ Position';
  const input = row.querySelector('input[type="range"]');
  if (Number(input.min) !== 0) return `le minimum est ${input.min}, pas 0`;
  // The wall is 6 m long and the window 1.20 m, so it can slide 4.80 m.
  if (Math.abs(Number(input.max) - 4.8) > 1e-9) return `course de ${input.max} m au lieu de 4,80`;
  const edgeOffset = () => s.model.openings[0].offset;
  // At 0 the window's near edge sits on the corner: on edge '4,0,S' the wall
  // starts 4 m back, so the centre lands at -4 + 0.60.
  input.value = '0';
  input.dispatchEvent(new Event('input'));
  if (Math.abs(edgeOffset() - (-3.4)) > 1e-9) return `position 0 donne ${edgeOffset()} au lieu de -3,4`;
  // And at the far end it stops flush with the other corner.
  input.value = String(4.8);
  input.dispatchEvent(new Event('input'));
  return Math.abs(edgeOffset() - 1.4) < 1e-9
    || `position 4,80 donne ${edgeOffset()} au lieu de 1,4`;
});

check('une terrasse se dimensionne en quarts de mètre ronds', () => {
  // A slider offers min + k x step and nothing else, so a minimum off the grid
  // takes every round size with it. At 0.40 wide by 0.20 deep a terrace could
  // be 3.15 by 3.95 but never 3 by 4 — reported by a user who could not line
  // his up with the wall it runs along.
  const s = new Store(normalise({ ...emptyModel(),
    props: [{ id: 'p1', kind: 'terrace', x: 2, y: 2, w: 6, d: 4, material: 'paving', z: 0 }] }));
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  s.select({ type: 'prop', id: 'p1' });
  insp.render();
  const rows = [...div.querySelectorAll('label.field')]
    .filter((r) => ['Largeur', 'Profondeur'].includes(r.querySelector('.field-label').textContent));
  if (rows.length !== 2) return `${rows.length} curseurs de taille au lieu de 2`;
  for (const row of rows) {
    const input = row.querySelector('input[type="range"]');
    const min = Number(input.min), step = Number(input.step);
    for (const want of [1, 3, 4, 6]) {
      const k = (want - min) / step;
      if (Math.abs(k - Math.round(k)) > 1e-9) {
        return `${row.querySelector('.field-label').textContent} : ${want} m hors trame (min ${min}, pas ${step})`;
      }
    }
  }
  return true;
});

check('un curseur en cours de réglage survit au rafraîchissement', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  document.getElementById('stage').appendChild(div);
  const insp = new Inspector(div, s);
  insp.render();
  const input = div.querySelector('input[type="range"]');
  input.focus();
  // Mid-drag: the slider has fired 'input' but not yet 'change'.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  insp.render();
  return div.contains(input) || 'le curseur a été détruit pendant son réglage';
});
