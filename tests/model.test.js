/** Modèle et stockage. */

import { check } from './harness.js';
import { B, cellsOf } from './helpers.js';
import { defaultModel, normalise, MODEL_VERSION } from '../src/core/model.js';
import { toShareUrl, fromShareUrl } from '../src/io/project.js';

/* ---------------- model and storage ---------------- */

check('normalise complète un modèle incomplet', () => {
  const m = normalise({ cells: ['1,1'], storeys: 99 });
  return B(m).roof.type === 'hip' && B(m).storeys === 4 && Array.isArray(m.props) && m.version === MODEL_VERSION;
});

check('un lien de partage refait le modèle à l’identique', () => {
  const m = normalise(defaultModel());
  const url = toShareUrl(m);
  const hash = url.slice(url.indexOf('#'));
  const saved = location.hash;
  location.hash = hash;
  const back = fromShareUrl();
  location.hash = saved;
  return (back && cellsOf(back).length === cellsOf(m).length && B(back).roof.pitch === B(m).roof.pitch)
    || 'modèle non restitué';
});
