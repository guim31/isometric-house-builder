/**
 * The isometric viewport: what gets exported, and where things are inspected.
 */

import { renderScene } from '../render/svg.js';
import {
  hitLayer, screenToGround, roofItemCorners, roofAt, rayOnRoof, equipmentAt, snapOntoBuilding, fixtureOutline,
} from '../render/hit.js';
import { boundaryEdges } from '../core/grid.js';
import {
  cellSizeOf, buildingOfEdge, storeyBase, openingSpan, fitOpening, storeyHeightOf, fixtureZRange,
} from '../core/model.js';
import { buildMesh } from '../core/scene.js';
import { mergeCoplanar } from '../core/mesh.js';
import { rotateDir, project, clampPitch, clampRoll, normaliseYaw } from '../core/iso.js';
import { focusModel } from '../core/focus.js';
import { t } from '../i18n/index.js';
import {
  OPENING_DEFAULTS, PROP_DEFAULTS, ROOF_ITEM_DEFAULTS, CENTRED_KINDS, LINEAR_KINDS, FIXTURE_DEFAULTS,
  placeOpening, placeProp, placeRoofItem, placeFixture, OFF_ROOF,
} from './actions.js';

/** Degrees of orbit per pixel dragged. */
const ORBIT_YAW = 0.4;
const ORBIT_PITCH = 0.3;
const ROLL_PER_PX = 0.2;
/** What a drag on the selection can move. */
const MOVABLE = new Set(['prop', 'opening', 'roofItem', 'fixture']);
/** Pixels of travel before a press stops being a click and becomes a gesture. */
const DRAG_SLOP = 4;

/**
 * What the built mesh depends on. Everything here is replaced by reference
 * whenever it changes, so identity comparison is exact — and cheap.
 */
const geometryOf = (m) => [
  m.buildings, m.openings, m.fixtures, m.roofItems, m.props,
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
      // Held still while an item is dragged: the fit follows what is drawn,
      // and an item dragged towards the edge would otherwise pull the whole
      // picture along under the pointer.
      camera: this.frozen || undefined,
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

  /** A pointer event's position in the drawing's own pixels. */
  localPoint(ev) {
    const rect = (this.svg || this.root).getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
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
    if (sel.type === 'roofItem') {
      const corners = roofItemCorners(this.store.model, item, this.cache?.built);
      if (!corners) return '';
      pts.push(...corners);
    } else if (sel.type === 'prop') {
      const centred = CENTRED_KINDS.has(item.kind);
      const w = item.r ? item.r * 2 : item.w ?? 2;
      const d = item.r ? item.r * 2 : item.d ?? 2;
      const x0 = centred ? item.x - w / 2 : item.x;
      const y0 = centred ? item.y - d / 2 : item.y;
      // Equipment outlined at its top, where it is picked: a carport's
      // outline on the lawn under it said nothing about which one it was.
      const z = ['lamppost', 'heatpump', 'mailbox', 'carport'].includes(item.kind)
        ? (item.h ?? 1) : (item.z ?? 0) + 0.06;
      pts.push([x0, y0, z], [x0 + w, y0, z], [x0 + w, y0 + d, z], [x0, y0 + d, z]);
    } else if (sel.type === 'fixture') {
      const m = this.store.model;
      const host = buildingOfEdge(m, item.edge);
      const e = host && boundaryEdges(new Set(host.cells)).find((x) => x.id === item.edge);
      if (!e) return '';
      pts.push(...fixtureOutline(item, e, host, cellSizeOf(m)));
    } else if (sel.type === 'opening') {
      const m = this.store.model;
      const cs = cellSizeOf(m);
      // Through the opening's building: the model itself has carried no
      // plinth or storey height since volumes became independent, and reading
      // the deleted fields made this overlay quietly disappear. Its edges too,
      // as the renderer does: on the union of every volume, a wall another one
      // was later built against is no edge at all, and the outline vanished.
      const host = buildingOfEdge(m, item.edge);
      if (!host) return '';
      const e = boundaryEdges(new Set(host.cells)).find((x) => x.id === item.edge);
      if (!e) return '';
      const a = [e.a[0] * cs, e.a[1] * cs];
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
      const u = [(e.b[0] * cs - a[0]) / len, (e.b[1] * cs - a[1]) / len];
      const { z0, z1 } = openingSpan(item, host);
      const w = item.width ?? 1.2, c = item.offset ?? 0.5;
      const p = (s, z) => [a[0] + u[0] * s + e.n[0] * 0.06, a[1] + u[1] * s + e.n[1] * 0.06, z];
      pts.push(p(c - w / 2, z0), p(c + w / 2, z0), p(c + w / 2, z1), p(c - w / 2, z1));
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

    // Échap takes back a drag of the selection, as it does in the plan: the
    // item returns where it was, still selected, and the history is as before.
    window.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || this.drag?.mode !== 'move') return;
      this.store.cancelGesture();
      this.frozen = null;
      this.root.classList.remove('moving');
      this.drag = { mode: 'cancelled' };
      this.render();
      ev.preventDefault();
      ev.stopPropagation();
    }, true);

    this.root.addEventListener('pointerdown', (ev) => {
      // As in the plan: the main button acts, the middle one pans, and the
      // others are left to the browser.
      if (ev.button !== 0 && ev.button !== 1) return;
      this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.pointers.size === 2) { this.startPinch(); return; }
      if (this.pinch) return;

      const pick = ev.target.dataset?.pick;
      const tool = s.tool;
      const [sx, sy] = this.localPoint(ev);
      // What is drawn under the pointer, when it is a roof: the pick layer has
      // nothing there, and must not answer for it — a tree standing behind the
      // house got selected through its roof.
      // A wall fixture drawn there comes first: hung under the eaves, it is
      // drawn against the roof's edge, and the roof took its clicks.
      const fixture = this.lastRender && !ROOF_ITEM_DEFAULTS[tool] ? equipmentAt(this.lastRender, sx, sy) : null;
      const roof = !fixture && this.lastRender ? roofAt(this.lastRender, sx, sy) : null;

      const target = fixture || (roof
        ? (roof.item ? { type: 'roofItem', id: roof.item.id } : { type: 'building', id: roof.building.id })
        : pickTarget(pick, ev.target.dataset));

      // A press on what is already selected takes hold of it, whatever the
      // tool — a freshly placed item is selected with its tool still active.
      // A drag then moves it rather than the camera. Anything else — another
      // item, the house, the lawn — still turns or slides the view, so the
      // gesture everybody already uses is left as it was.
      const sel = s.selection;
      if (ev.button === 0 && !ev.shiftKey && !ev.altKey && target && sel && this.lastRender
        && target.type === sel.type && target.id === sel.id && MOVABLE.has(sel.type) && s.selected) {
        this.startMove(ev, sx, sy, target);
        return;
      }

      // A roof item lands on the slope under the pointer, at the point the
      // view ray meets it. Anywhere else, the tool places nothing.
      if (ROOF_ITEM_DEFAULTS[tool] && ev.button === 0 && !ev.shiftKey && !ev.altKey && roof) {
        const at = roof.item ? rayOnRoof(this.lastRender.camera, sx, sy, roof.part) || roof.point : roof.point;
        const spot = snapOntoBuilding(roof.building, cellSizeOf(s.model), at[0], at[1]);
        if (spot) placeRoofItem(s, tool, spot);
        return;
      }

      // Outdoor items can be dropped straight onto the render: the ground
      // plane is exactly invertible, so a click maps back to a grid position.
      // Not the runs — wall, fence, hedge: those are dragged out on the plan,
      // and a click here dropped a default length nobody asked for. Nor onto
      // a roof: what is under the pointer there is the house, not the lawn.
      if (!pick && !roof && ev.button === 0 && !ev.shiftKey && PROP_DEFAULTS[tool] && !LINEAR_KINDS.has(tool)
        && this.lastRender) {
        placeProp(s, tool, screenToGround(this.lastRender.camera, sx, sy));
        return;
      }

      // A tool that acts on a wall acts at once: it is a click, not a gesture.
      if (pick === 'wall' && !roof && OPENING_DEFAULTS[tool]) {
        this.addOpening(tool, ev.target.dataset.edge, Number(ev.target.dataset.storey), ev);
        return;
      }
      // A fixture hangs where the wall was clicked, at that height too.
      if (pick === 'wall' && !roof && FIXTURE_DEFAULTS[tool]) {
        const edge = ev.target.dataset.edge, storey = Number(ev.target.dataset.storey) || 0;
        const at = this.wallPoint(edge, storey, sx, sy);
        if (at) {
          const [lo, hi] = fixtureZRange(storeyHeightOf(at.host, storey));
          placeFixture(s, tool, edge, storey, Math.max(0, Math.min(at.len, at.s)), Math.max(lo, Math.min(hi, at.h)));
        }
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
        pick: target,
        moved: false,
        button: ev.button,
      };
      // Capture is a convenience, not a requirement: a pointer the browser
      // did not issue — a synthetic one, or a pen some drivers report late —
      // is refused with an exception that would abort the whole gesture.
      try { this.root.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    });

    this.root.addEventListener('pointermove', (ev) => {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.pinch && this.pointers.size >= 2) { this.movePinch(); return; }
      if (this.drag?.mode === 'cancelled') return;
      if (!this.drag) {
        // The cursor says what a press would do: take hold of the selection,
        // or turn the view.
        const sel = this.store.selection;
        this.root.classList.toggle('can-move', !!sel && MOVABLE.has(sel.type)
          && ev.target.dataset?.id === sel.id && ev.target.dataset?.pick === sel.type);
        return;
      }
      const dx = ev.clientX - this.drag.from[0];
      const dy = ev.clientY - this.drag.from[1];
      // Below the threshold the press is still a click in waiting: a hand that
      // wobbles by a pixel on the way to selecting a window should select it,
      // not swing the camera a degree.
      if (!this.drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        this.drag.moved = true;
      }
      if (this.drag.mode === 'move') {
        const [sx, sy] = this.localPoint(ev);
        this.moveTo(sx, sy);
        return;
      }
      if (this.drag.mode === 'roll') {
        this.store.setCamera({ roll: clampRoll(this.drag.camera.roll + dx * ROLL_PER_PX) });
        return;
      }
      if (this.drag.mode === 'orbit') {
        // Dragging right turns the house to the right. That is the direction
        // increasing yaw moves it: at yaw 0 the east corner sits on the screen
        // left, and every added degree walks it back towards the centre.
        this.store.setCamera({
          yaw: normaliseYaw(this.drag.camera.yaw + dx * ORBIT_YAW),
          pitch: clampPitch(this.drag.camera.pitch - dy * ORBIT_PITCH),
        });
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
      if (this.drag?.mode === 'cancelled') { this.drag = null; return; }
      if (this.drag?.mode === 'move') {
        // One gesture, one step of the history, however long it lasted; and
        // the camera fits the drawing again now that nothing is held.
        this.store.endGesture();
        this.frozen = null;
        this.root.classList.remove('moving');
        this.drag = null;
        this.render();
        return;
      }
      if (this.drag && !this.drag.moved) {
        // It was a click after all. With a roof tool, a click off every roof
        // places nothing, and says so — as the plan does.
        if (ROOF_ITEM_DEFAULTS[this.store.tool] && this.drag.button === 0) this.store.notify(t(OFF_ROOF));
        const sel = this.drag.pick;
        if (sel?.type === 'building') this.store.setActiveBuilding(sel.id);
        this.store.select(sel);
      }
      this.drag = null;
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointerleave', () => this.root.classList.remove('can-move'));
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

  /** Take hold of the selected item, for a drag that moves it. */
  startMove(ev, sx, sy, target) {
    const cam = this.lastRender.camera;
    const origin = { ...this.store.selected };
    this.drag = {
      mode: 'move', from: [ev.clientX, ev.clientY], start: [sx, sy], origin, pick: target, moved: false,
    };
    if (target.type === 'roofItem') {
      const part = this.roofPartOf(origin);
      this.drag.part = part;
      this.drag.grab = part && rayOnRoof(cam, sx, sy, part);
    } else if (target.type === 'opening' || target.type === 'fixture') {
      this.drag.grab = this.wallPoint(origin.edge, origin.storey || 0, sx, sy);
    }
    this.frozen = { scale: cam.scale, offset: [...cam.offset] };
    // One history entry for the whole drag, as a gesture of the plan: a
    // coalescing run broke in two when the hand paused for a second.
    this.store.beginGesture();
    this.root.classList.add('moving');
    try { this.root.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
  }

  /** The volume part carrying a roof item, from the last build. */
  roofPartOf(it) {
    const cs = cellSizeOf(this.store.model);
    const k = `${Math.floor(it.x / cs)},${Math.floor(it.y / cs)}`;
    return this.cache?.built?.parts?.find((p) => p.building.cells.includes(k)) || null;
  }

  /**
   * Follow the pointer with the item held: an outdoor item over the ground
   * plane, an opening along its wall, a roof item over its own roof. The
   * camera is held for the whole gesture, so the item stays under the
   * pointer — by the difference since the press, not by jumping its centre
   * to where it was grabbed.
   */
  moveTo(sx, sy) {
    const d = this.drag;
    const cam = this.lastRender.camera;
    const o = d.origin;
    const s = this.store;
    const snap = (v) => Math.round(v * 4) / 4;
    if (d.pick.type === 'prop') {
      const g0 = screenToGround(cam, d.start[0], d.start[1]);
      const g = screenToGround(cam, sx, sy);
      const x = snap(o.x + g[0] - g0[0]), y = snap(o.y + g[1] - g0[1]);
      s.patchSelected((it) => (it.x === x && it.y === y ? {} : { x, y }));
    } else if (d.pick.type === 'opening') {
      const at = this.wallPoint(o.edge, o.storey || 0, sx, sy);
      if (!at || !d.grab) return;
      const offset = Math.round((o.offset + at.s - d.grab.s) * 20) / 20;
      // Along its own run of wall, never past its corners — as the plan and
      // the inspector already keep it.
      s.patchSelected((it, m) => fitOpening(m, { ...it, offset }));
    } else if (d.pick.type === 'fixture') {
      // Along its wall and up it: a fixture has a height of its own.
      const at = this.wallPoint(o.edge, o.storey || 0, sx, sy);
      if (!at || !d.grab) return;
      const offset = Math.round((o.offset + at.s - d.grab.s) * 20) / 20;
      const [lo, hi] = fixtureZRange(storeyHeightOf(at.host, o.storey || 0));
      const z = Math.max(lo, Math.min(hi, Math.round((o.z + at.h - d.grab.h) * 20) / 20));
      s.patchSelected((it, m) => fitOpening(m, { ...it, offset, z }));
    } else if (d.pick.type === 'roofItem') {
      if (!d.part || !d.grab) return;
      const p = rayOnRoof(cam, sx, sy, d.part);
      if (!p) return;
      const spot = snapOntoBuilding(d.part.building, cellSizeOf(s.model),
        o.x + p[0] - d.grab[0], o.y + p[1] - d.grab[1]);
      if (spot) s.patchSelected({ x: spot[0], y: spot[1] });
    }
  }

  /**
   * A screen point solved on the plane of a wall: metres along the edge from
   * its start, and metres above the given level's floor. Not clamped — a
   * drag past the end of the wall is the caller's to bound.
   */
  wallPoint(edgeId, storey, sx, sy) {
    const camera = this.lastRender?.camera;
    const m = this.store.model;
    const host = buildingOfEdge(m, edgeId);
    const e = host && boundaryEdges(new Set(host.cells)).find((x) => x.id === edgeId);
    if (!camera || !e) return null;
    const cs = cellSizeOf(m);
    const z = storeyBase(host, storey || 0);
    const A = camera.toScreen([e.a[0] * cs, e.a[1] * cs, z]);
    const B = camera.toScreen([e.b[0] * cs, e.b[1] * cs, z]);
    const C = camera.toScreen([e.a[0] * cs, e.a[1] * cs, z + 1]);
    // P = A + t·(B − A) + h·(C − A), solved for t and h.
    const u = [B[0] - A[0], B[1] - A[1]], v = [C[0] - A[0], C[1] - A[1]];
    const det = u[0] * v[1] - u[1] * v[0];
    const dx = sx - A[0], dy = sy - A[1];
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) * cs;
    if (Math.abs(det) > 1e-9) {
      const t = (dx * v[1] - dy * v[0]) / det;
      const h = (u[0] * dy - u[1] * dx) / det;
      return { s: t * len, h, edge: e, host, len };
    }
    // Seen edge-on: only the position along it means anything.
    const t = (dx * u[0] + dy * u[1]) / (u[0] * u[0] + u[1] * u[1] || 1);
    return { s: t * len, h: 0, edge: e, host, len };
  }

  /**
   * Place an opening where the wall was actually clicked, not at its centre.
   *
   * The click is solved on the wall's own plane — so many metres along, so
   * many up — rather than projected onto its foot: a wall seen from above
   * leans on screen, and a click high on it landed metres off along the line
   * at ground level.
   */
  addOpening(kind, edgeId, storey, ev) {
    const [sx, sy] = this.localPoint(ev);
    const at = this.wallPoint(edgeId, storey, sx, sy);
    if (!at) return;
    // Openings store metres along the wall, from the start of their edge.
    placeOpening(this.store, kind, edgeId, storey || 0, Math.max(0, Math.min(at.len, at.s)));
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
    this.store.setCamera((c) => ({
      yaw: normaliseYaw(c.yaw + dYaw),
      pitch: clampPitch(c.pitch + dPitch),
    }));
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
