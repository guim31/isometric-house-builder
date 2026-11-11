/** Murets et portails. */

import { check } from './harness.js';
import { near, muretSpans, pointer } from './helpers.js';
import { rectCells } from '../src/core/grid.js';
import { emptyModel, normalise } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { Store } from '../src/ui/store.js';
import { placeRun, placeProp, LINEAR_KINDS } from '../src/ui/actions.js';

check('un portail ouvre le muret à l’endroit où il est posé', () => {
  const wall = { id: 'w', kind: 'muret', x: 4, y: 10, w: 12, d: 0.24, h: 1.5 };
  const base = { ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)] };
  const solid = muretSpans({ ...base, props: [wall] });
  if (!solid.length) return 'muret absent';
  const withGate = muretSpans({
    ...base,
    props: [wall, { id: 'g', kind: 'gate', x: 9, y: 9.96, w: 2, d: 0.16, h: 1.5 }],
  });
  // Nothing of the wall may remain inside the gate's span.
  const inGap = withGate.filter(([lo, hi]) => hi > 9.05 && lo < 10.95);
  if (inGap.length) return `${inGap.length} morceaux de muret dans l'ouverture`;
  // And the wall must survive on both sides of it.
  const left = withGate.some(([lo]) => lo < 8.5);
  const right = withGate.some(([, hi]) => hi > 11.5);
  return (left && right) || `muret restant à gauche : ${left}, à droite : ${right}`;
});

check('deux portails ouvrent le muret en deux endroits distincts', () => {
  const spans = muretSpans({
    ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)],
    props: [
      { id: 'w', kind: 'muret', x: 4, y: 10, w: 14, d: 0.24, h: 1.5 },
      { id: 'a', kind: 'gate', x: 7, y: 9.96, w: 1.2, d: 0.16, h: 1.5 },
      { id: 'b', kind: 'gate', x: 13, y: 9.96, w: 3.5, d: 0.16, h: 1.5, style: 'sliding' },
    ],
  });
  for (const [lo, hi] of [[7.05, 8.15], [13.05, 16.45]]) {
    if (spans.some(([a, b]) => b > lo && a < hi)) return `ouverture ${lo}–${hi} non dégagée`;
  }
  // Three runs of masonry remain: before, between and after.
  const starts = new Set(spans.map(([a]) => Math.round(a * 4) / 4));
  return starts.size >= 3 || `${starts.size} tronçons seulement`;
});

check('un portail posé près d’un muret s’y aligne tout seul', () => {
  const s = new Store(normalise({
    ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)],
    props: [{ id: 'w', kind: 'muret', x: 4, y: 10, w: 12, d: 0.24, h: 1.5 }],
  }));
  s.setTool('gate');
  placeProp(s, 'gate', [9.4, 10.9]); // dropped a good half-metre off the wall
  const g = s.model.props.find((p) => p.kind === 'gate');
  if (!g) return 'portail non créé';
  // Centred on the wall's own line, not where the pointer happened to land.
  const centre = g.y + g.d / 2;
  return near(centre, 10.12, 0.13) || `axe du portail à ${centre.toFixed(2)} au lieu de 10,12`;
});

check('un muret se trace en glissant, à la longueur voulue', () => {
  const s = new Store(emptyModel());
  placeRun(s, 'muret', [6.1, 12.2], [15.9, 12.4]);
  const w = s.model.props.find((p) => p.kind === 'muret');
  if (!w) return 'muret non créé';
  if (!near(w.w, 10, 0.3)) return `longueur ${w.w} m`;
  if (!(w.d < 0.4)) return `épaisseur ${w.d} m`;
  // A mostly-vertical drag gives a run along the other axis.
  placeRun(s, 'muret', [20, 6], [20.2, 14]);
  const v = s.model.props.filter((p) => p.kind === 'muret')[1];
  return (v.d > 7 && v.w < 0.4) || `run vertical : ${v.w} × ${v.d}`;
});

check('portail coulissant et portillon se distinguent au rendu', () => {
  const of = (style) => {
    const m = normalise({
      ...emptyModel(), cells: [...rectCells(20, 20, 24, 24)],
      props: [{ id: 'g', kind: 'gate', x: 8, y: 10, w: 3.2, d: 0.16, h: 1.5, style }],
    });
    return buildMesh(m).mesh.tris.filter((t) => t.group === 'gate:g').length;
  };
  const swing = of('swing');
  const sliding = of('sliding');
  if (!swing) return 'portillon vide';
  return sliding > swing || 'le coulissant ne se distingue pas du battant';
});

check('les éléments linéaires sont bien déclarés comme tels', () => {
  return LINEAR_KINDS.has('muret') && LINEAR_KINDS.has('fence') && LINEAR_KINDS.has('hedge')
    && !LINEAR_KINDS.has('pool');
});
