/** Historique. */

import { check } from './harness.js';
import { B, near } from './helpers.js';
import { defaultModel } from '../src/core/model.js';
import { Store } from '../src/ui/store.js';

/* ---------------- store ---------------- */

check('annuler et rétablir reviennent au bon état', () => {
  const s = new Store(defaultModel());
  const n0 = s.model.storeys;
  s.update((m) => ({ ...m, storeys: 3 }));
  if (s.model.storeys !== 3) return 'modification non appliquée';
  s.undo();
  if (s.model.storeys !== n0) return 'annulation incorrecte';
  s.redo();
  return s.model.storeys === 3 || 'rétablissement incorrect';
});

check('les modifications continues se regroupent en une seule annulation', () => {
  const s = new Store(defaultModel());
  const n0 = B(s.model).storeyHeight;
  for (const v of [2.8, 2.9, 3.0]) s.patchBuilding({ storeyHeight: v }, 'h');
  s.undo();
  return near(B(s.model).storeyHeight, n0) || `revenu à ${B(s.model).storeyHeight}`;
});

check('supprimer la sélection retire l’élément', () => {
  const s = new Store(defaultModel());
  const id = s.model.props[0].id;
  s.select({ type: 'prop', id });
  s.deleteSelected();
  return !s.model.props.some((p) => p.id === id);
});
