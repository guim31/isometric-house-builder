/**
 * The isometric viewport: what gets exported, and where things are inspected.
 */

import { renderScene } from '../render/svg.js';
import { hitLayer, screenToGround } from '../render/hit.js';
import { boundaryEdges } from '../core/grid.js';
import { cellSet, cellSizeOf, buildingOfEdge, storeyBase } from '../core/model.js';
import { buildMesh } from '../core/scene.js';
import { mergeCoplanar } from '../core/mesh.js';
import { rotateDir, project, clampPitch, clampRoll, normaliseYaw } from '../core/iso.js';
import { focusModel } from '../core/focus.js';
import { OPENING_DEFAULTS, PROP_DEFAULTS, CENTRED_KINDS, placeOpening, placeProp } from './actions.js';

/** Degrees of orbit per pixel dragged. */
const ORBIT_YAW = 0.4;
const ORBIT_PITCH = 0.3;
const ROLL_PER_PX = 0.2;
/** Pixels of travel before a press stops being a click and becomes a gesture. */
const DRAG_SLOP = 4;

/**
 * What the built mesh depends on. Everything here is replaced by reference
 * whenever it changes, so identity comparison is exact — and cheap.
 */
const geometryOf = (m) => [
  m.buildings, m.openings, m.roofItems, m.props,
  m.grid, m.ground, m.style.shadow, m.style.windowBars,
];

const sameSig = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * What a click on a pick target selects.
 *
 * A wall and a roof both stand for the volume they belong to — clicking either
 * in the render picks that body, which is what the plan already does when a
 * footprint is clicked.
 */
function pickTarget(pick, data) {
  if (!pick) return null;
  if (pick === 'wall' || pick === 'building') {
    const id = data.building || data.id;
    return id ? { type: 'building', id } : null;
  }
  return { type: pick, id: data.id };
}

export class Viewport {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.zoom = 1;
    this.pan = [0, 0];
    this.drag = null;
    this.pinch = null;
    this.pointers = new Map();
    this.lastRender = null;
    this.cache = null;
    // What a plain drag does. The other one is always available with Shift, so
    // nothing is lost by choosing — but the choice is what makes the whole
    // thing usable with a mouse and no modifier keys.
    this.dragMode = 'orbit';
    this.onModeChange = null;
    this.bindEvents();
  }

  render() {
    const r = this.root.getBoundingClientRect();
    const width = Math.max(320, Math.round(r.width));
    const height = Math.max(240, Math.round(r.height));
    const m = focusModel(this.store.model);

    // Cached on what the mesh is actually made of, not on the model as a
    // whole. Orbiting writes a new camera onto a new model object sixty times
    // a second; keying the cache on model identity would rebuild the entire
    // house on every frame of a drag, for a change that moves no vertex.
    const sig = geometryOf(m);
    if (!this.cache || !sameSig(this.cache.sig, sig)) {
      const built = buildMesh(m);
      this.cache = { sig, built, merged: mergeCoplanar(built.mesh.tris) };
    }

    // The on-screen view always has a background; only exports honour the
    // transparent setting, where it is what makes the image drop cleanly onto
    // a dashboard of any colour.
    const shown = { ...m, style: { ...m.style, background: 'transparent' } };
    const out = renderScene(shown, {
      width, height, zoom: this.zoom, panX: this.pan[0], panY: this.pan[1],
      built: this.cache.built, faces: this.cache.merged,
    });
    this.lastRender = out;

    const hits = hitLayer(m, out.camera, this.cache.built);
    const selected = this.selectionOverlay(out.camera);
    const compass = this.compass(out.camera, height);
    this.root.innerHTML = out.svg.replace(
      '</svg>',
      `<g class="hit-layer">${hits}</g>${selected}${compass}</svg>`,
    );
    this.svg = this.root.querySelector('svg');
  }

  /**
   * Small compass showing where north lands on screen for this rotation —
   * the direct answer to "why is my window not visible from here?".
   */
  compass(camera, height) {
    const dir = rotateDir([0, 1, 0], this.store.model.camera.yaw);
    const v = project(dir, camera.proj);
    const l = Math.hypot(v[0], v[1]) || 1;
    const ux = (v[0] / l) * 10, uy = (v[1] / l) * 10;
    const cx = 30, cy = height - 30;
    return '<g class="iso-compass">' +
      `<circle cx="${cx}" cy="${cy}" r="17"/>` +
      `<line x1="${(cx - ux).toFixed(1)}" y1="${(cy - uy).toFixed(1)}" x2="${(cx + ux * 0.2).toFixed(1)}" y2="${(cy + uy * 0.2).toFixed(1)}"/>` +
      `<text x="${(cx + ux).toFixed(1)}" y="${(cy + uy).toFixed(1)}" dy="3.5">N</text>` +
      '</g>';
  }

  /** A dashed outline over whatever is selected. */
  selectionOverlay(camera) {
    const sel = this.store.selection;
    if (!sel) return '';
    const item = this.store.selected;
    if (!item) return '';
    const pts = [];
    if (sel.type === 'prop' || sel.type === 'roofItem') {
      const centred = CENTRED_KINDS.has(item.kind) || sel.type === 'roofItem';
      const w = item.r ? item.r * 2 : item.w ?? 2;
      const d = item.r ? item.r * 2 : item.d ?? 2;
      const x0 = centred ? item.x - w / 2 : item.x;
      const y0 = centred ? item.y - d / 2 : item.y;
      const z = sel.type === 'roofItem' ? 6 : (item.z ?? 0) + 0.06;
      pts.push([x0, y0, z], [x0 + w, y0, z], [x0 + w, y0 + d, z], [x0, y0 + d, z]);
    } else if (sel.type === 'opening') {
      const m = this.store.model;
      const cs = cellSizeOf(m);
      const e = boundaryEdges(cellSet(m)).find((x) => x.id === item.edge);
      if (!e) return '';
      const a = [e.a[0] * cs, e.a[1] * cs];
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
      const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
      // Through the opening's building: the model itself has carried no
      // plinth or storey height since volumes became independent, and reading
      // the deleted fields made this overlay quietly disappear.
      const host = buildingOfEdge(m, item.edge);
      if (!host) return '';
      const zb = storeyBase(host, item.storey || 0) + (item.sill ?? 0);
      const w = item.width ?? 1.2, h = item.height ?? 1.25, c = item.offset ?? 0.5;
      const p = (s, z) => [a[0] + u[0] * s + e.n[0] * 0.06, a[1] + u[1] * s + e.n[1] * 0.06, z];
      pts.push(p(c - w / 2, zb), p(c + w / 2, zb), p(c + w / 2, zb + h), p(c - w / 2, zb + h));
    }
    if (!pts.length) return '';
    const d = pts.map((p, i) => {
      const s = camera.toScreen(p);
      return `${i === 0 ? 'M' : 'L'}${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
    }).join('') + 'Z';
    return `<path d="${d}" class="selection-outline" fill="none"/>`;
  }

  bindEvents() {
    const s = this.store;

    this.root.addEventListener('pointerdown', (ev) => {
      this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.pointers.size === 2) { this.startPinch(); return; }
      if (this.pinch) return;

      const pick = ev.target.dataset?.pick;
      const tool = s.tool;

      // Outdoor items can be dropped straight onto the render: the ground
      // plane is exactly invertible, so a click maps back to a grid position.
      if (!pick && ev.button === 0 && !ev.shiftKey && PROP_DEFAULTS[tool] && this.lastRender) {
        const rect = this.root.getBoundingClientRect();
        placeProp(s, tool, screenToGround(this.lastRender.camera, ev.clientX - rect.left, ev.clientY - rect.top));
        return;
      }

      // A tool that acts on a wall acts at once: it is a click, not a gesture.
      if (pick === 'wall' && OPENING_DEFAULTS[tool]) {
        this.addOpening(tool, ev.target.dataset.edge, Number(ev.target.dataset.storey), ev);
        return;
      }

      /*
       * From here the press is ambiguous, and stays that way until the pointer
       * either moves or does not.
       *
       * It used to be settled immediately: a press on the house selected, a
       * press on the background navigated. Which meant that grabbing the house
       * — the obvious thing to do when you want to turn it — did nothing at
       * all, in either mode. The two modes then felt identical, because both
       * of them did nothing. Reported in use, and rightly.
       *
       * So the press starts a gesture whatever it lands on, and the release
       * decides: moved, it was navigation; still, it was a selection.
       */
      const wantPan = ev.button === 1 || ((this.dragMode === 'pan') !== ev.shiftKey);
      const mode = ev.altKey ? 'roll' : (wantPan ? 'pan' : 'orbit');
      this.drag = {
        mode,
        from: [ev.clientX, ev.clientY],
        pan: [...this.pan],
        camera: { ...s.model.camera },
        pick: pickTarget(pick, ev.target.dataset),
        moved: false,
      };
      this.root.setPointerCapture?.(ev.pointerId);
    });

    this.root.addEventListener('pointermove', (ev) => {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.pinch && this.pointers.size >= 2) { this.movePinch(); return; }
      if (!this.drag) return;
      const dx = ev.clientX - this.drag.from[0];
      const dy = ev.clientY - this.drag.from[1];
      // Below the threshold the press is still a click in waiting: a hand that
      // wobbles by a pixel on the way to selecting a window should select it,
      // not swing the camera a degree.
      if (!this.drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        this.drag.moved = true;
      }
      if (this.drag.mode === 'roll') {
        this.store.update((mm) => ({
          ...mm,
          camera: { ...mm.camera, roll: clampRoll(this.drag.camera.roll + dx * ROLL_PER_PX) },
        }), { coalesce: 'orbit' });
        return;
      }
      if (this.drag.mode === 'orbit') {
        // Dragging right turns the house to the right. That is the direction
        // increasing yaw moves it: at yaw 0 the east corner sits on the screen
        // left, and every added degree walks it back towards the centre.
        this.store.update((mm) => ({
          ...mm,
          camera: {
            ...mm.camera,
            yaw: normaliseYaw(this.drag.camera.yaw + dx * ORBIT_YAW),
            pitch: clampPitch(this.drag.camera.pitch - dy * ORBIT_PITCH),
          },
        }), { coalesce: 'orbit' });
        return;
      }
      // Pan lives upstream of the zoom in the projection, so the on-screen
      // shift is the raw delta divided by the zoom — without the division,
      // panning while zoomed in overshoots the cursor.
      this.pan = [
        this.drag.pan[0] + dx / this.zoom,
        this.drag.pan[1] + dy / this.zoom,
      ];
      this.render();
    });

    const end = (ev) => {
      if (ev) {
        this.pointers.delete(ev.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
      }
      if (this.drag && !this.drag.moved) {
        // It was a click after all.
        const sel = this.drag.pick;
        if (sel?.type === 'building') this.store.setActiveBuilding(sel.id);
        this.store.select(sel);
      } else if (this.drag?.mode === 'orbit' || this.drag?.mode === 'roll') {
        this.store.commit();
      }
      this.drag = null;
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);

    this.root.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = this.root.getBoundingClientRect();
      const c = [ev.clientX - rect.left, ev.clientY - rect.top];
      this.zoomAbout(c, this.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), rect);
      this.render();
    }, { passive: false });
  }

  /**
   * Change the zoom while keeping the screen point `c` fixed.
   *
   * The projection applies `zoom * (base + pan - centre) + centre`; solving
   * that for an invariant `c` gives the `1/z` terms below.
   */
  zoomAbout(c, targetZoom, rect) {
    const c0 = [rect.width / 2, rect.height / 2];
    const z = this.zoom;
    const z2 = Math.max(0.4, Math.min(5, targetZoom));
    this.pan = [
      this.pan[0] + (c[0] - c0[0]) * (1 / z2 - 1 / z),
      this.pan[1] + (c[1] - c0[1]) * (1 / z2 - 1 / z),
    ];
    this.zoom = z2;
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.drag = null;
    this.pinch = {
      dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    };
  }

  movePinch() {
    const [a, b] = [...this.pointers.values()];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const rect = this.root.getBoundingClientRect();
    this.zoomAbout(
      [this.pinch.mid[0] - rect.left, this.pinch.mid[1] - rect.top],
      this.zoom * (dist / this.pinch.dist), rect,
    );
    // Then follow the midpoint's own travel.
    this.pan = [
      this.pan[0] + (mid[0] - this.pinch.mid[0]) / this.zoom,
      this.pan[1] + (mid[1] - this.pinch.mid[1]) / this.zoom,
    ];
    this.pinch.dist = dist;
    this.pinch.mid = mid;
    this.render();
  }

  /** Place an opening where the wall was actually clicked, not at its centre. */
  addOpening(kind, edgeId, storey, ev) {
    const camera = this.lastRender?.camera;
    const e = boundaryEdges(cellSet(this.store.model)).find((x) => x.id === edgeId);
    if (!camera || !e) return;
    const rect = this.svg.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const a = camera.toScreen([e.a[0], e.a[1], 0]);
    const b = camera.toScreen([e.b[0], e.b[1], 0]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
    // t is a fraction of the edge; openings store metres along the wall.
    placeOpening(this.store, kind, edgeId, storey || 0, t * cellSizeOf(this.store.model));
  }

  /** Switch what a plain drag does. */
  setDragMode(mode) {
    if (this.dragMode === mode) return;
    this.dragMode = mode;
    this.root.classList.toggle('panning', mode === 'pan');
    this.onModeChange?.(mode);
  }

  /**
   * Turn the camera by a fixed step.
   *
   * The same movement the drag makes, in a size someone can aim at. Dragging
   * is quicker once you know it exists, which is exactly the thing a button
   * on screen tells you.
   */
  nudge(dYaw, dPitch) {
    this.store.update((m) => ({
      ...m,
      camera: {
        ...m.camera,
        yaw: normaliseYaw(m.camera.yaw + dYaw),
        pitch: clampPitch(m.camera.pitch + dPitch),
      },
    }), { coalesce: 'orbit' });
  }

  /** Slide the view, as the pad's arrows do in « déplacer » mode. */
  panBy(dx, dy) {
    this.pan = [this.pan[0] + dx / this.zoom, this.pan[1] + dy / this.zoom];
    this.render();
  }

  /** Zoom about the middle of the panel, as the buttons do. */
  zoomBy(factor) {
    const rect = this.root.getBoundingClientRect();
    this.zoomAbout([rect.width / 2, rect.height / 2], this.zoom * factor, rect);
    this.render();
  }

  resetView() {
    this.zoom = 1;
    this.pan = [0, 0];
    this.render();
  }
}
