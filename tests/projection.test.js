/** Projection et caméra. */

import { check } from './harness.js';
import { near } from './helpers.js';
import { Camera, rotatePoint, project, projectionFor, PROJECTIONS, PITCH_RANGE, viewpointLabel, rotateDir, depthOf, facingOf, DEFAULT_PITCH } from '../src/core/iso.js';
import { screenToGround } from '../src/render/hit.js';

/* ---------------- projection ---------------- */

check('l’axe de vue reste (1, 1, lambda) à toutes les hauteurs de caméra', () => {
  // The invariant the whole depth sort rests on: moving a point along the view
  // axis must not move it on screen, so depth is a plain linear form. If this
  // breaks, faces stop sorting and nothing else in the renderer is trustworthy.
  for (const name of Object.keys(PROJECTIONS)) {
    for (const pitch of [PITCH_RANGE[0], 20, DEFAULT_PITCH, 55, PITCH_RANGE[1]]) {
      const proj = projectionFor(name, pitch);
      // Two points one view-axis step apart. The axis is (1, 1, lambda), so
      // advancing x and y by 2 means advancing z by 2*lambda.
      const a = project([1, 2, 3], proj);
      const b = project([3, 4, 3 + 2 * proj.lambda], proj);
      if (!near(a[0], b[0], 1e-9) || !near(a[1], b[1], 1e-9)) {
        return `${name} @ ${Math.round(pitch)}° dévie`;
      }
      if (!near(depthOf([1, 1, 1], proj.lambda), 2 + proj.lambda, 1e-9)) return 'depthOf incohérent';
    }
  }
  return true;
});

check('la projection par défaut reproduit exactement les constantes d’origine', () => {
  // sqrt(3)/2 : 1/2 : 1 — the values hard-coded before the pitch was a dial.
  const p = projectionFor('iso30', DEFAULT_PITCH);
  return (near(p.kx, Math.cos(Math.PI / 6), 1e-12)
    && near(p.ky, 0.5, 1e-12) && near(p.kz, 1, 1e-12) && near(p.lambda, 1, 1e-12))
    || `obtenu ${p.kx}, ${p.ky}, ${p.kz}`;
});

check('quatre quarts de tour ramènent exactement au point de départ', () => {
  // Exactly, not nearly: cos(90°) is 6e-17 in floating point, and the four
  // default views have to stay pixel-identical from one release to the next.
  let p = [3, 7, 2];
  for (let i = 0; i < 4; i++) p = rotatePoint(p, 90, 5, 5);
  return (p[0] === 3 && p[1] === 7 && p[2] === 2) || `obtenu ${p.join(', ')}`;
});

check('une rotation libre est réversible et conserve les distances', () => {
  const p = rotatePoint([3, 7, 2], 37, 5, 5);
  const back = rotatePoint(p, -37, 5, 5);
  const d = (a) => Math.hypot(a[0] - 5, a[1] - 5);
  if (!near(d(p), d([3, 7, 2]), 1e-9)) return 'la rotation change la distance au centre';
  return (near(back[0], 3) && near(back[1], 7)) || 'aller-retour non nul';
});

check('à un lacet quelconque, deux volumes disjoints se trient dans le bon ordre', () => {
  // The claim that made free orbit possible: for axis-aligned geometry, any
  // yaw keeps the painter's order exact, because the separating plane between
  // two disjoint boxes is perpendicular to a world axis. Checked directly —
  // the near box must sort after the far one at every angle tried.
  for (const yaw of [0, 17, 45, 63, 90, 128, 180, 233, 271, 344]) {
    for (const pitch of [15, DEFAULT_PITCH, 65]) {
      const cam = new Camera({ yaw, pitch, centre: [0, 0] });
      // Two boxes separated along x only. Which one is nearer depends on the
      // sign of the view axis' x component, so derive it rather than assume.
      const far = cam.depth([0, 0, 0]);
      const near2 = cam.depth([10, 0, 0]);
      const expectNearer = rotateDir([1, 0, 0], yaw);
      const sign = expectNearer[0] + expectNearer[1];
      if (Math.abs(sign) < 1e-9) continue; // camera looks straight down that axis
      if (Math.sign(near2 - far) !== Math.sign(sign)) {
        return `lacet ${yaw}° : ordre inversé sur x`;
      }
    }
  }
  return true;
});

check('une face regardant la caméra est visible à tout angle', () => {
  for (const yaw of [0, 33, 90, 150, 200, 300]) {
    const cam = new Camera({ yaw, centre: [0, 0] });
    // The roof always faces up, and up is always towards the camera.
    if (facingOf(rotateDir([0, 0, 1], yaw), cam.lambda) <= 0) return `lacet ${yaw}° : toit invisible`;
    // A wall and its opposite can never both be visible.
    const a = facingOf(rotateDir([1, 0, 0], yaw), cam.lambda);
    const b = facingOf(rotateDir([-1, 0, 0], yaw), cam.lambda);
    if (a > 1e-9 && b > 1e-9) return `lacet ${yaw}° : deux façades opposées visibles`;
  }
  return true;
});

check('le libellé de point de vue suit le lacet en continu', () => {
  const cases = [[0, 'Nord-Est'], [90, 'Sud-Est'], [180, 'Sud-Ouest'], [270, 'Nord-Ouest'],
    [45, 'Est'], [315, 'Nord'], [22, 'Est-Nord-Est']];
  for (const [yaw, want] of cases) {
    if (viewpointLabel(yaw) !== want) return `${yaw}° donne ${viewpointLabel(yaw)}, attendu ${want}`;
  }
  return true;
});

check('écran → sol est bien la réciproque de sol → écran', () => {
  // Dropping a tree straight onto the render inverts this mapping, so it has
  // to hold at the free angles too, not only on the four quarter turns.
  for (const yaw of [0, 90, 180, 270, 23, 137, 291]) {
    for (const pitch of [18, DEFAULT_PITCH, 62]) {
      const cam = new Camera({ yaw, pitch, centre: [10, 10] });
      cam.scale = 24;
      cam.offset = [300, 200];
      const s = cam.toScreen([13, 7, 0]);
      const g = screenToGround(cam, s[0], s[1]);
      if (!near(g[0], 13, 1e-6) || !near(g[1], 7, 1e-6)) return `lacet ${yaw}°/${pitch}° → ${g}`;
    }
  }
  return true;
});
