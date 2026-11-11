/** Rendu interactif. */

import { check, uncaught } from './harness.js';
import { near, stripIds, pointer, stageViewport, dragOn } from './helpers.js';
import { Camera, normaliseYaw, ROLL_RANGE } from '../src/core/iso.js';
import { defaultModel, normalise } from '../src/core/model.js';
import { renderScene } from '../src/render/svg.js';
import { screenToGround } from '../src/render/hit.js';
import { Store } from '../src/ui/store.js';
import { Viewport } from '../src/ui/viewport.js';

check('un extérieur peut se poser directement sur le rendu', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  s.setTool('tree');
  const before = s.model.props.length;
  const r = div.getBoundingClientRect();
  div.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    bubbles: true, pointerId: 9, isPrimary: true, button: 0,
  }));
  div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9 }));
  return s.model.props.length === before + 1 || 'aucun arbre posé';
});



check('glisser sur la maison elle-même la fait tourner', () => {
  // Reported in use: both modes appeared to do the same thing, because both
  // did nothing. Grabbing the house — the obvious way to turn it — was read
  // as a selection and stopped there; only the background navigated.
  const { s, div, vp } = stageViewport();
  const target = div.querySelector('.hit-layer [data-pick]');
  if (!target) return 'aucune cible de sélection dans le rendu';
  const yaw0 = s.model.camera.yaw;
  dragOn(target, div, 61, 70);
  if (s.model.camera.yaw === yaw0) return 'la maison n’a pas tourné';
  // Twice in a row: each press starts from the camera as it stands, and a
  // gesture that only works once is worse than one that never works.
  const yaw1 = s.model.camera.yaw;
  dragOn(target, div, 611, -40);
  if (s.model.camera.yaw === yaw1) return 'le deuxième glisser n’a rien fait';
  // And the same grab in the other mode slides the picture instead.
  vp.setDragMode('pan');
  const yaw2 = s.model.camera.yaw;
  const pan0 = vp.pan[0];
  dragOn(target, div, 62, 70);
  if (s.model.camera.yaw !== yaw2) return 'le mode déplacement a fait tourner';
  return vp.pan[0] !== pan0 || 'le mode déplacement n’a rien déplacé';
});

check('un clic sans mouvement sélectionne toujours', () => {
  // The other half of the bargain: the press only becomes a gesture once the
  // pointer has actually travelled.
  const { s, div } = stageViewport();
  const target = div.querySelector('.hit-layer [data-pick="prop"]');
  if (!target) return 'aucun extérieur à sélectionner';
  const yaw0 = s.model.camera.yaw;
  dragOn(target, div, 63, 2);
  if (s.model.camera.yaw !== yaw0) return 'un simple clic a fait tourner la maison';
  return (s.selection?.type === 'prop' && s.selection.id === target.dataset.id)
    || `sélection : ${JSON.stringify(s.selection)}`;
});

check('cliquer un mur dans le rendu choisit son corps', () => {
  const { s, div } = stageViewport();
  const target = div.querySelector('.hit-layer [data-pick="wall"]');
  if (!target) return 'aucun mur dans la couche de sélection';
  dragOn(target, div, 64, 1);
  if (s.selection?.type !== 'building') return `sélection : ${JSON.stringify(s.selection)}`;
  return s.activeBuildingId === target.dataset.building || 'le corps actif n’a pas suivi';
});

check('un clic dans le vide désélectionne', () => {
  const { s, div } = stageViewport();
  const prop = div.querySelector('.hit-layer [data-pick="prop"]');
  dragOn(prop, div, 65, 1);
  if (!s.selection) return 'rien n’a été sélectionné au départ';
  dragOn(div, div, 66, 1);
  return s.selection === null || `sélection restante : ${JSON.stringify(s.selection)}`;
});

check('le pavé de navigation tourne, incline et zoome', () => {
  // The gestures already did all of this; what the buttons add is that anyone
  // can find it. They drive the same code, so this checks the code they drive.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  const c0 = { ...s.model.camera };
  vp.nudge(15, 0);
  if (s.model.camera.yaw !== normaliseYaw(c0.yaw + 15)) return `lacet ${s.model.camera.yaw}`;
  vp.nudge(0, 6);
  if (!near(s.model.camera.pitch, c0.pitch + 6, 1e-9)) return `hauteur ${s.model.camera.pitch}`;
  const z0 = vp.zoom;
  vp.zoomBy(1.25);
  if (!(vp.zoom > z0)) return 'le zoom n’a pas bougé';
  vp.resetView();
  return vp.zoom === 1 || 'recadrer n’a pas remis le zoom à 1';
});

check('le mode « déplacer » échange ce que font glisser et Maj + glisser', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const drag = (id, shift) => {
    const at = (dx, type) => div.dispatchEvent(new PointerEvent(type, {
      clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2,
      bubbles: true, pointerId: id, isPrimary: true, button: 0, shiftKey: shift,
    }));
    at(0, 'pointerdown'); at(50, 'pointermove'); at(50, 'pointerup');
  };
  vp.setDragMode('pan');
  const yaw0 = s.model.camera.yaw;
  const pan0 = vp.pan[0];
  drag(21, false);
  if (s.model.camera.yaw !== yaw0) return 'un glisser simple a fait pivoter en mode déplacement';
  if (vp.pan[0] === pan0) return 'un glisser simple n’a pas déplacé la vue';
  drag(22, true);
  if (s.model.camera.yaw === yaw0) return 'Maj + glisser n’a pas fait pivoter';
  vp.setDragMode('orbit');
  return true;
});

check('Alt + glisser incline l’image', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const at = (dx, type) => div.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2,
    bubbles: true, pointerId: 31, isPrimary: true, button: 0, altKey: true,
  }));
  const yaw0 = s.model.camera.yaw;
  at(0, 'pointerdown'); at(60, 'pointermove'); at(60, 'pointerup');
  if (s.model.camera.roll === 0) return 'l’inclinaison n’a pas bougé';
  return s.model.camera.yaw === yaw0 || 'incliner a aussi fait pivoter';
});

check('l’inclinaison tourne le dessin sans toucher au tri des faces', () => {
  // The third rotation happens after the projection, so it can change where
  // things land on screen but never which of them is in front.
  const m = normalise(defaultModel());
  const flat = renderScene(m, { width: 400, height: 300 });
  const tilted = renderScene({ ...m, camera: { ...m.camera, roll: 22 } },
    { width: 400, height: 300 });
  const order = (o) => o.faces.map((f) => `${f.mat}|${f.group}`).join(',');
  if (order(flat) !== order(tilted)) return 'l’ordre des faces a changé';
  if (flat.svg === tilted.svg) return 'le dessin n’a pas tourné';
  // And zero must be exactly the identity, not merely close to it.
  const zero = renderScene({ ...m, camera: { ...m.camera, roll: 0 } },
    { width: 400, height: 300 });
  return stripIds(zero.svg) === stripIds(flat.svg)
    || 'une inclinaison nulle modifie le rendu';
});

check('écran → sol tient compte de l’inclinaison', () => {
  // Dropping a tree onto a tilted render has to land where it was aimed.
  for (const roll of [ROLL_RANGE[0], -17, 0, 23, ROLL_RANGE[1]]) {
    const cam = new Camera({ yaw: 47, pitch: 28, roll, centre: [10, 10] });
    cam.scale = 24;
    cam.offset = [300, 200];
    const p = cam.toScreen([13, 7, 0]);
    const g = screenToGround(cam, p[0], p[1]);
    if (!near(g[0], 13, 1e-6) || !near(g[1], 7, 1e-6)) return `inclinaison ${roll}° → ${g}`;
  }
  return true;
});

check('glisser sur le rendu fait pivoter la maison', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const at = (dx, dy, type, extra = {}) => div.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy,
    bubbles: true, pointerId: 11, isPrimary: true, button: 0, ...extra,
  }));
  const yaw0 = s.model.camera.yaw, pitch0 = s.model.camera.pitch;
  at(0, 0, 'pointerdown');
  at(60, -30, 'pointermove');
  at(60, -30, 'pointerup');
  const c = s.model.camera;
  if (c.yaw === yaw0) return 'le lacet n’a pas bougé';
  if (c.pitch <= pitch0) return 'monter la souris n’a pas levé la caméra';
  // One gesture, one undo step — not sixty.
  s.undo();
  return (s.model.camera.yaw === yaw0) || `annuler laisse le lacet à ${s.model.camera.yaw}`;
});

check('avec Maj, glisser déplace la vue sans la faire pivoter', () => {
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  s.setTool('select');
  vp.render();
  const r = div.getBoundingClientRect();
  const at = (dx, type) => div.dispatchEvent(new PointerEvent(type, {
    clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2,
    bubbles: true, pointerId: 12, isPrimary: true, button: 0, shiftKey: true,
  }));
  const yaw0 = s.model.camera.yaw;
  at(0, 'pointerdown');
  at(50, 'pointermove');
  at(50, 'pointerup');
  if (s.model.camera.yaw !== yaw0) return 'la vue a pivoté malgré Maj';
  return vp.pan[0] !== 0 || 'la vue ne s’est pas déplacée';
});

check('pivoter ne reconstruit pas le maillage', () => {
  // The cache that makes the orbit usable: a new camera on a new model object
  // must not rebuild the house. Sixty times a second, it would be unusable.
  const s = new Store(defaultModel());
  const div = document.createElement('div');
  div.style.cssText = 'width:440px;height:400px';
  document.getElementById('stage').appendChild(div);
  const vp = new Viewport(div, s);
  vp.render();
  const built = vp.cache.built;
  s.update((m) => ({ ...m, camera: { ...m.camera, yaw: 33, pitch: 28 } }));
  vp.render();
  if (vp.cache.built !== built) return 'le maillage a été reconstruit';
  // But moving a wall must.
  s.update((m) => ({
    ...m,
    buildings: m.buildings.map((b, i) => (i ? b : { ...b, cells: [...b.cells, '99,99'] })),
  }));
  vp.render();
  return vp.cache.built !== built || 'le maillage n’a pas suivi la modification';
});

check('un appui que le navigateur refuse de capturer ne lève rien', () => {
  const { div, vp } = stageViewport();
  const r = div.getBoundingClientRect();
  const errors = uncaught(() => {
    for (const type of ['pointerdown', 'pointerup']) {
      vp.root.dispatchEvent(new PointerEvent(type, {
        clientX: r.left + 20, clientY: r.top + 20, bubbles: true, pointerId: 77, button: 0,
      }));
    }
  });
  div.remove();
  return !errors.length || errors.join(' ; ');
});
