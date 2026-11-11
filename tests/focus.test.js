/** Cadrage. */

import { check, checkAsync } from './harness.js';
import { near, loadBlob } from './helpers.js';
import { mergeCoplanar } from '../src/core/mesh.js';
import { rectCells } from '../src/core/grid.js';
import { DEFAULT_PITCH } from '../src/core/iso.js';
import { focusModel } from '../src/core/focus.js';
import { defaultModel, emptyModel, normalise, makeBuilding } from '../src/core/model.js';
import { buildMesh } from '../src/core/scene.js';
import { renderScene } from '../src/render/svg.js';
import { svgFor, svgToPng } from '../src/io/export.js';

/* ---------------- framing ---------------- */

check('un ancien fichier retrouve sa vue : rotation 2 devient 180°', () => {
  // Share links already in circulation carry `rotation`. They must open on the
  // same view they were saved from, not silently swing round to the front.
  const m = normalise({ ...emptyModel(), camera: { rotation: 2, projection: 'iso30' } });
  if (m.camera.yaw !== 180) return `lacet ${m.camera.yaw}`;
  if (m.camera.rotation !== undefined) return 'le champ hérité subsiste';
  return near(m.camera.pitch, DEFAULT_PITCH) || `hauteur ${m.camera.pitch}`;
});

check('sans cadrage, le modèle traverse le filtre intact', () => {
  // Identity, not just equality: the viewport compares by reference to decide
  // whether its built mesh is still good.
  const m = normalise(defaultModel());
  return focusModel(m) === m || 'le modèle a été recopié sans raison';
});

check('le cadrage retire ce qui est hors zone et coupe ce qui la traverse', () => {
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [
      { id: 'p1', kind: 'tree', x: 40, y: 40, r: 1.5 },      // far away
      { id: 'p2', kind: 'hedge', x: 3, y: -2, w: 12, d: 0.6 }, // starts inside, runs out
      { id: 'p3', kind: 'bush', x: 2, y: 2, r: 1 },           // inside
    ],
    focus: { enabled: true, hide: true, x: 0, y: -3, w: 8, d: 8, margin: 1 },
  });
  const out = focusModel(m);
  const kinds = out.props.map((p) => p.kind).sort().join(',');
  if (kinds !== 'bush,hedge') return `restants : ${kinds || 'aucun'}`;
  // Cut at the frame, not kept whole. The ground is a pad with transparency
  // around it, so a hedge kept whole runs off the pad and ends in mid-air —
  // and widening the pad to meet it turns the export back into a green tile.
  const hedge = out.props.find((p) => p.kind === 'hedge');
  if (hedge.w >= 12) return `la haie n’a pas été coupée (${hedge.w} m)`;
  if (hedge.x < 0 - 1e-9) return `la haie déborde encore du cadre (x = ${hedge.x})`;
  // A compact object is not cut: half a tree is not a smaller tree.
  const bush = out.props.find((p) => p.kind === 'bush');
  return bush.r === 1 || 'le buisson a été rogné';
});

check('le cadrage emporte les ouvertures du corps qu’il retire', () => {
  const m = normalise({
    ...emptyModel(),
    buildings: [
      makeBuilding({ id: 'b1', cells: [...rectCells(0, 0, 4, 4)] }),
      makeBuilding({ id: 'b2', cells: [...rectCells(30, 30, 33, 33)] }),
    ],
    openings: [
      { id: 'o1', edge: '0,0,S', kind: 'door', offset: 0.5 },
      { id: 'o2', edge: '30,30,S', kind: 'door', offset: 0.5 },
    ],
    focus: { enabled: true, hide: true, x: -1, y: -1, w: 8, d: 8, margin: 1 },
  });
  const out = focusModel(m);
  if (out.buildings.length !== 1) return `${out.buildings.length} corps restants`;
  return out.openings.map((o) => o.id).join(',') === 'o1' || 'porte orpheline conservée';
});

check('le dessin est centré dans l’image, cadré ou non', () => {
  // Reported in use: the export sat low and to the right, with white above it.
  // The camera was fitted on the zone's eight corners — its ground rectangle
  // and that rectangle raised to the height of the tallest thing in it. Most
  // of that box was imaginary: a corner six metres over an empty patch of lawn
  // projects above anything actually there, and the camera made room for it.
  const base = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    props: [{ id: 'm', kind: 'muret', x: -2, y: 8, w: 16, d: 0.24, h: 1.5 }],
    ground: { enabled: true, material: 'grass', margin: 1 },
  });
  const W = 600, H = 420;
  const offset = (patch) => {
    const out = renderScene({ ...base, ...patch }, { width: W, height: H });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of out.faces) {
      for (const l of f.loops) {
        for (const p of l) {
          const s2 = out.camera.toScreen(p);
          x0 = Math.min(x0, s2[0]); x1 = Math.max(x1, s2[0]);
          y0 = Math.min(y0, s2[1]); y1 = Math.max(y1, s2[1]);
        }
      }
    }
    return [(x0 + x1) / 2 - W / 2, (y0 + y1) / 2 - H / 2];
  };
  const cases = [
    ['sans cadrage', {}],
    ['cadré serré', { focus: { enabled: true, x: 2, y: 7, w: 6, d: 3, margin: 1 } }],
    ['cadré large', { focus: { enabled: true, x: -1, y: -1, w: 12, d: 12, margin: 4 } }],
  ];
  for (const [label, patch] of cases) {
    const [dx, dy] = offset(patch);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      return `${label} : décalé de ${Math.round(dx)}, ${Math.round(dy)} px`;
    }
  }
  return true;
});

check('la marge du cadrage laisse de l’air autour du dessin', () => {
  // It is padding, not geometry: it must shrink the drawing, not shift it.
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    ground: { enabled: true, material: 'grass', margin: 0 },
  });
  const width = (margin) => {
    const out = renderScene({
      ...m, focus: { enabled: true, x: -1, y: -1, w: 12, d: 9, margin },
    }, { width: 600, height: 420 });
    let x0 = Infinity, x1 = -Infinity;
    for (const f of out.faces) {
      for (const l of f.loops) for (const p of l) {
        const s2 = out.camera.toScreen(p)[0];
        x0 = Math.min(x0, s2); x1 = Math.max(x1, s2);
      }
    }
    return x1 - x0;
  };
  const tight = width(0.5), airy = width(6);
  return airy < tight * 0.8 || `${Math.round(tight)} px puis ${Math.round(airy)} px`;
});

check('cadrer sur une zone agrandit vraiment ce qu’elle contient', () => {
  // The whole point: the gate has to end up bigger on the image than it was.
  const base = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    props: [{ id: 'p1', kind: 'tree', x: 40, y: 40, r: 1.5 }],
  });
  const framed = normalise({
    ...base,
    focus: { enabled: true, x: 0, y: 0, w: 6, d: 5, margin: 1, hide: true },
  });
  const a = renderScene(base, { width: 400, height: 300 });
  const b = renderScene(framed, { width: 400, height: 300 });
  if (!(b.camera.scale > a.camera.scale * 1.5)) {
    return `échelle ${a.camera.scale.toFixed(1)} → ${b.camera.scale.toFixed(1)}`;
  }
  return b.model.props.length === 0 || 'l’arbre lointain est resté';
});

check('une vue enregistrée survit à l’enregistrement du projet', () => {
  const m = normalise({
    ...emptyModel(),
    views: [{ name: 'Portail', camera: { yaw: 137, pitch: 24 }, focus: { enabled: true, w: 5, d: 4 } }],
  });
  const back = normalise(JSON.parse(JSON.stringify(m)));
  const v = back.views[0];
  if (!v || v.name !== 'Portail') return 'vue perdue';
  if (!v.id) return 'vue sans identifiant';
  return (near(v.camera.yaw, 137) && v.focus.enabled) || 'réglages perdus';
});

check('le sol est un tapis à coins arrondis, pas un rectangle', () => {
  // Four corners make a rectangle of lawn; a rounded outline reads as a base
  // the model sits on. It is the difference between an illustration that drops
  // onto a dashboard and one that covers it.
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    ground: { enabled: true, material: 'grass', margin: 2 },
  });
  const ground = mergeCoplanar(buildMesh(m).mesh.tris).filter((f) => f.group === 'ground');
  if (ground.length !== 1) return `${ground.length} faces de sol`;
  const n = ground[0].loops[0].length;
  return n > 8 || `${n} sommets : le sol est resté rectangulaire`;
});

check('la marge du cadrage est de l’air, pas de la pelouse', () => {
  // Reported in use: a generous margin filled the picture with empty lawn.
  // It is what the camera leaves round the zone, not part of the ground.
  const base = {
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 4, 3)] })],
    ground: { enabled: true, material: 'grass', margin: 0 },
  };
  const zone = { enabled: true, x: 20, y: 20, w: 5, d: 4 };
  const span = (margin) => {
    const g = mergeCoplanar(buildMesh(focusModel(normalise({
      ...base, focus: { ...zone, margin },
    }))).mesh.tris).find((f) => f.group === 'ground');
    const xs = g.loops[0].map((p) => p[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const tight = span(1), wide = span(8);
  return near(tight, wide, 1e-9) || `sol de ${tight.toFixed(1)} m à ${wide.toFixed(1)} m selon la marge`;
});

check('un corps qui effleure la zone n’est pas gardé', () => {
  // A house whose wall runs along the edge of a zone drawn in front of it
  // grazes it by a centimetre. Kept for that, it was drawn whole and then
  // sliced by the picture's own border.
  const b = makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] });
  const grazing = normalise({
    ...emptyModel(), buildings: [b],
    focus: { enabled: true, x: 9.9, y: 2, w: 6, d: 4, margin: 1 },
  });
  if (focusModel(grazing).buildings.some((x) => x.cells.length)) {
    return 'le corps effleuré est encore là';
  }
  const standing = normalise({
    ...emptyModel(), buildings: [b],
    focus: { enabled: true, x: 6, y: 2, w: 6, d: 4, margin: 1 },
  });
  return focusModel(standing).buildings.some((x) => x.cells.length)
    || 'un corps réellement dans la zone a été retiré';
});

check('sous cadrage, le sol suit le cadre et non la parcelle', () => {
  // The reported fault: a garden eighty metres long, cropped to the gate,
  // filled the picture with lawn — the very thing the framing was asked to
  // avoid. The pad follows what is shown.
  const b = makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] });
  const base = {
    ...emptyModel(),
    buildings: [b],
    props: [{ id: 'h', kind: 'hedge', x: -30, y: 20, w: 70, d: 0.6, h: 1 }],
    ground: { enabled: true, material: 'grass', margin: 1 },
  };
  // Through focusModel, as the renderer does: the frame first removes what it
  // excludes, and only then is the ground sized to what is left.
  const span = (model) => {
    const g = mergeCoplanar(buildMesh(focusModel(normalise(model))).mesh.tris)
      .find((f) => f.group === 'ground');
    const xs = g.loops[0].map((p) => p[0]);
    return Math.max(...xs) - Math.min(...xs);
  };
  const wide = span(base);
  const framed = span({
    ...base,
    focus: { enabled: true, x: 18, y: 19, w: 6, d: 3, margin: 1, hide: true },
  });
  if (!(wide > 60)) return `sans cadrage le sol ne fait que ${wide.toFixed(0)} m`;
  return framed < 12 || `sous cadrage le sol fait encore ${framed.toFixed(0)} m`;
});

await checkAsync('un export cadré pose la scène sur un tapis, pas sur un aplat', async () => {
  // What makes an exported image sit on a dashboard rather than cover it: the
  // ground is a pad under what is shown, with transparency all round. Filling
  // the frame with lawn — which is what backing it with a plain rectangle did
  // — hands the dashboard a green tile with a house on it. Reported in use,
  // and only visible on real pixels.
  const W = 200, H = 150;
  const m = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 5, 4)] })],
    ground: { enabled: true, material: 'grass', margin: 0 },
    focus: { enabled: true, x: 1, y: 1, w: 4, d: 3, margin: 0.5, hide: true },
  });
  const blob = await svgToPng(svgFor(m, { width: W, height: H, ratio: 1 }), W, H);
  const img = await loadBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
  for (const [x, y] of [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]]) {
    if (alpha(x, y) !== 0) return `coin (${x}, ${y}) opaque (alpha ${alpha(x, y)})`;
  }
  return alpha(W >> 1, H >> 1) === 255 || 'le centre de l’image est vide';
});

check('rien n’est coupé par le bord de l’image', () => {
  // Why the fade went. It softened a crop by the picture's own border, and
  // there is no longer one to soften: the frame removes what falls outside and
  // cuts what crosses it, then the camera fits what is left, whole. Measured
  // rather than asserted — every drawn vertex has to land inside the canvas.
  const base = normalise({
    ...emptyModel(),
    buildings: [makeBuilding({ cells: [...rectCells(0, 0, 9, 6)] })],
    props: [{ id: 'm', kind: 'muret', x: -6, y: 8, w: 22, d: 0.24, h: 1.5 }],
    ground: { enabled: true, material: 'grass', margin: 1 },
  });
  const W = 400, H = 300;
  const cases = [
    ['sans cadrage', {}],
    ['cadré serré', { focus: { enabled: true, x: 2, y: 7, w: 6, d: 3, margin: 1 } }],
    ['cadré sur la maison', { focus: { enabled: true, x: 0, y: 0, w: 10, d: 7, margin: 2 } }],
  ];
  for (const [label, patch] of cases) {
    const out = renderScene({ ...base, ...patch }, { width: W, height: H });
    for (const f of out.faces) {
      for (const l of f.loops) {
        for (const p of l) {
          const [x, y] = out.camera.toScreen(p);
          if (x < -0.5 || x > W + 0.5 || y < -0.5 || y > H + 0.5) {
            return `${label} : un point tombe en (${Math.round(x)}, ${Math.round(y)})`;
          }
        }
      }
    }
  }
  return true;
});

check('un réglage de fondu hérité est simplement oublié', () => {
  const m = normalise({ ...emptyModel(), focus: { enabled: true, vignette: 0.4, hide: false } });
  return (m.focus.vignette === undefined && m.focus.hide === undefined)
    || `réglages hérités conservés : ${JSON.stringify(m.focus)}`;
});
