/** Points de vue. */

import { check } from './harness.js';
import { near } from './helpers.js';
import { Camera, VIEWPOINTS, rotateDir } from '../src/core/iso.js';

/* ---------------- viewpoints ---------------- */

check('le rendu n’est pas l’image miroir du plan', () => {
  // The regression this pins: the video-game iso formula (x - y) forms a
  // left-handed basis once the near side is +x+y, and every render came out
  // mirrored — a pool west of the house on the plan appeared on the wrong
  // side. From the north-east camera of rotation 0, east must extend to the
  // screen LEFT and north to the RIGHT.
  const cam = new Camera({ rotation: 0, centre: [0, 0] });
  cam.scale = 10;
  cam.offset = [0, 0];
  const o = cam.toScreen([0, 0, 0]);
  const e = cam.toScreen([1, 0, 0]);
  const n = cam.toScreen([0, 1, 0]);
  if (e[0] >= o[0]) return 'l’est part vers la droite : vue en miroir';
  if (n[0] <= o[0]) return 'le nord part vers la gauche : vue en miroir';
  return true;
});


check('les libellés de point de vue désignent bien les façades visibles', () => {
  // The regression this guards: rotation 0 shows the north and east facades,
  // so the camera stands to the north-east — yet the labels once started at
  // « Sud-Est », and the four exported files carried the wrong names.
  const DIRS = { Nord: [0, 1, 0], Sud: [0, -1, 0], Est: [1, 0, 0], Ouest: [-1, 0, 0] };
  for (let r = 0; r < 4; r++) {
    for (const part of VIEWPOINTS[r].split('-')) {
      const n = rotateDir(DIRS[part], r * 90);
      if (n[0] + n[1] + n[2] <= 0) {
        return `${VIEWPOINTS[r]} : la façade ${part} n'est pas visible en rotation ${r}`;
      }
    }
  }
  return true;
});
