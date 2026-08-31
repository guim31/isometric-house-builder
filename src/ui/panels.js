/**
 * The inspector: global settings, plus whatever is currently selected.
 */

import { THEMES, materialColour } from '../core/palette.js';
import {
  PROJECTIONS, PITCH_RANGE, ROLL_RANGE, DEFAULT_PITCH, viewpointLabel, normaliseYaw,
} from '../core/iso.js';
import { ROOF_TYPES, STEP } from '../core/roof.js';
import {
  withCellSize, cellSizeOf, fmtMetres, cellSet, buildingOfEdge,
  storeyHeightOf, DEFAULT_FOCUS, newId,
} from '../core/model.js';
import { bounds, edgeRunExtent } from '../core/grid.js';
import { ROOF_TEXTURES, WALL_TEXTURES } from '../render/texture.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Separator naming a family of sections. */
const groupTitle = (text) => h('p', 'panel-group', text);

function field(label, control, hint) {
  const row = h('label', 'field');
  row.appendChild(h('span', 'field-label', label));
  row.appendChild(control);
  if (hint) row.appendChild(h('span', 'field-hint', hint));
  return row;
}

function slider(value, { min, max, step, onInput, format }) {
  const wrap = h('span', 'slider');
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min, max, step, value });
  const out = h('output', 'slider-value', format ? format(value) : String(value));
  input.addEventListener('input', () => {
    out.textContent = format ? format(Number(input.value)) : input.value;
    onInput(Number(input.value));
  });
  wrap.append(input, out);
  return wrap;
}

function select(value, options, onChange) {
  const s = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    if (v === value) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function toggle(value, onChange) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function number(value, { min, max, step, onChange }) {
  const input = document.createElement('input');
  Object.assign(input, { type: 'number', min, max, step, value });
  input.addEventListener('change', () => onChange(Number(input.value)));
  return input;
}

/** Materials the user can recolour, grouped as they are presented. */
const COLOUR_GROUPS = [
  ['Bâtiment', [['wall', 'Murs'], ['roof', 'Toiture'], ['roofEdge', 'Rive'], ['plinth', 'Soubassement']]],
  ['Menuiseries', [['trim', 'Dormants'], ['door', 'Porte'], ['shutter', 'Volets'], ['garage', 'Garage'], ['glass', 'Vitrage']]],
  ['Extérieur', [['grass', 'Pelouse'], ['paving', 'Dallage'], ['water', 'Eau'], ['foliage', 'Feuillage']]],
];

const ROOF_LABELS = { hip: 'Croupe (4 pans)', gable: 'Deux pans', flat: 'Plat', shed: 'Appentis (1 pan)' };
const DIR_LABELS = { S: 'vers le sud', N: 'vers le nord', W: "vers l'ouest", E: "vers l'est" };
const GROUND_LABELS = { grass: 'Pelouse', paving: 'Dallage', gravel: 'Gravier' };
const OPENING_LABELS = { window: 'Fenêtre', shutter: 'Fenêtre à volets', door: 'Porte', garage: 'Porte de garage' };
const ROOF_ITEM_LABELS = { solar: 'Panneaux solaires', chimney: 'Cheminée', velux: 'Fenêtre de toit', dish: 'Parabole' };
const PROP_LABELS = {
  pool: 'Piscine', terrace: 'Terrasse', path: 'Allée', deck: 'Terrasse bois', bush: 'Buisson',
  muret: 'Muret', gate: 'Portillon / portail',
  tree: 'Arbre', hedge: 'Haie', fence: 'Clôture', car: 'Voiture',
};

/**
 * Where an opening sits along its wall, counted the way a person would.
 *
 * Stored, an offset is the *centre* of the opening measured from the start of
 * a boundary edge — and a boundary edge is one cell long, so the origin is
 * some cell corner partway along the facade. A user reported the obvious
 * consequence: "0 should intuitively be the corner where the wall begins, but
 * it isn't", and his own file has a window at -0.75 to prove how he got there.
 *
 * Only the reading changes. The file keeps its offsets exactly as they were,
 * so a project saved or shared before this still opens where it was left, and
 * placing or dragging an opening goes on speaking the edge's language.
 */
function positionField(m, item, patch) {
  const cs = cellSizeOf(m);
  const host = buildingOfEdge(m, item.edge);
  const run = host ? edgeRunExtent(new Set(host.cells), item.edge, cs) : null;
  const w = item.width ?? 1.2;
  if (!run) {
    // The wall has been erased under it; fall back rather than show nothing.
    return field('Position', slider(item.offset ?? 0.5, {
      min: -1, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
      onInput: (v) => patch({ offset: v }, 'offset'),
    }), 'le long du mur');
  }
  const max = Math.max(0, run.hi - run.lo - w);
  const from = Math.min(max, Math.max(0, (item.offset ?? 0.5) - w / 2 - run.lo));
  return field('Position', slider(from, {
    min: 0, max, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
    onInput: (v) => patch({ offset: v + run.lo + w / 2 }, 'offset'),
  }), 'depuis l’angle du mur, jusqu’au bord de l’ouverture');
}

export class Inspector {
  constructor(root, store, { onExport = null } = {}) {
    this.root = root;
    this.store = store;
    this.onExport = onExport;
    // Which sections are unfolded. Kept here rather than in the DOM: the panel
    // is rebuilt on every change to the model, and a <details> rebuilt from
    // scratch would spring shut under the hand.
    this.open = new Map();
  }

  render() {
    // Never rebuild under a control that is being used: replacing a range or
    // colour input mid-gesture detaches it, which kills the drag and can
    // close a native colour picker. The control's 'change' event fires on
    // release, and the shell listens for it to run the deferred refresh.
    const active = document.activeElement;
    if (active && this.root.contains(active) && (active.type === 'range' || active.type === 'color')) return;
    this.root.replaceChildren();
    const sel = this.store.selected;
    // Three families, in the order the work goes: what is selected, then the
    // volume being edited, then the project as a whole, then how it is looked
    // at and exported. Everything below the first is folded away by default —
    // there is now far more here than fits on a screen, and a wall of open
    // panels reads as clutter rather than as capability.
    this.root.append(
      groupTitle('Sélection'),
      sel ? this.selectionSection(sel) : this.emptySelection(),
      groupTitle('Bâtiment'),
      this.activeSection(),
      this.buildingSection(),
      groupTitle('Projet'),
      this.appearanceSection(),
      this.coloursSection(),
      this.groundSection(),
      groupTitle('Vue et export'),
      this.viewSection(),
      this.focusSection(),
    );
  }

  /** Stands in for the selection panel, so the group is never a bare title. */
  emptySelection() {
    return h('p', 'panel-empty',
      'Cliquez un élément dans le plan ou sur le rendu pour le régler.');
  }

  /**
   * A collapsible section. Returns its body, with the <details> itself hanging
   * off `.panel` so the caller can hand it back.
   *
   * `badge` is what the section says about itself while folded: a palette
   * name, a camera bearing, how many volumes there are. Without it a closed
   * panel is a title and nothing else, and everything has to be opened to be
   * read.
   */
  section(title, { id = title, open = false, badge = '', accent = false } = {}) {
    const d = h('details', `panel${accent ? ' panel-selected' : ''}`);
    d.open = this.open.has(id) ? this.open.get(id) : open;
    const sum = document.createElement('summary');
    sum.className = 'panel-title';
    sum.appendChild(h('span', 'panel-name', title));
    if (badge) sum.appendChild(h('span', 'panel-badge', badge));
    d.appendChild(sum);
    // Attached after the initial state is set, so restoring it fires nothing.
    d.addEventListener('toggle', () => this.open.set(id, d.open));
    const body = h('div', 'panel-body');
    d.appendChild(body);
    body.panel = d;
    return body;
  }

  /** A plain block: the selection is transient, folding it away helps nobody. */
  block(title) {
    const s = h('section', 'panel panel-selected panel-block');
    s.appendChild(h('h2', 'panel-title', title));
    return s;
  }

  set(patch, coalesce) {
    this.store.update((m) => ({ ...m, ...patch }), { coalesce });
  }

  setIn(keyName, patch, coalesce) {
    this.store.update((m) => ({ ...m, [keyName]: { ...m[keyName], ...patch } }), { coalesce });
  }

  buildingSection() {
    const m = this.store.model;
    const cs = cellSizeOf(m);
    const b = bounds(cellSet(m));
    const dims = b.empty ? '—'
      : `${fmtMetres(b.w * cs)} × ${fmtMetres(b.d * cs)} m`;
    const n = m.buildings.length;
    const s = this.section('Tous les corps', {
      badge: `${n} · ${dims}`,
    });
    s.append(
      field('Emprise totale', h('span', 'field-static', dims), 'hors débord de toiture'),
      field('Trame', select(String(cs), [['1', '1 m'], ['0.5', '0,50 m']],
        (v) => this.store.update((mm) => withCellSize(mm, Number(v)))),
        'le pas de dessin du plan — affiner ne change pas les dimensions de la maison'),
    );

    // The list of volumes. Each one owns its roof and its height, so a garden
    // shed can be flat-roofed and timber-clad while the house keeps its tiles.
    const list = h('div', 'building-list');
    for (const bd of m.buildings) {
      const active = bd.id === this.store.activeBuildingId;
      const row = h('button', `building-row${active ? ' active' : ''}`);
      const area = bd.cells.length * cs * cs;
      row.type = 'button';
      row.innerHTML = `<span class="building-name"></span><span class="building-meta"></span>`;
      row.querySelector('.building-name').textContent = bd.name;
      row.querySelector('.building-meta').textContent =
        bd.cells.length ? `${fmtMetres(Math.round(area * 10) / 10)} m² — ${ROOF_LABELS[bd.roof.type]}` : 'à dessiner';
      row.addEventListener('click', () => {
        this.store.setActiveBuilding(bd.id);
        this.store.select({ type: 'building', id: bd.id });
      });
      list.appendChild(row);
    }
    s.appendChild(list);

    const add = h('button', 'subtle', '+ Nouveau corps');
    add.addEventListener('click', () => this.store.addBuilding());
    s.appendChild(add);
    return s.panel;
  }

  /** Settings of the volume currently being edited. */
  /**
   * The volume being edited, in three sections rather than one.
   *
   *
   * As one, it ran to a dozen controls and pushed everything else in the panel
   * below the fold — which is how a tool ends up looking as though it has one
   * screen of settings and a mystery. Shape, roof and materials are three
   * different questions, and they are asked at different moments.
   */
  activeSection() {
    const b = this.store.activeBuilding;
    if (!b) return document.createDocumentFragment();
    const m = this.store.model;
    const frag = document.createDocumentFragment();
    const s = this.section('Corps', {
      id: 'active', open: true, accent: true,
      badge: `${b.name} · ${b.storeys} niveau${b.storeys > 1 ? 'x' : ''}`,
    });
    frag.appendChild(s.panel);

    const name = document.createElement('input');
    name.type = 'text';
    name.value = b.name;
    name.addEventListener('input', () => this.store.patchBuilding({ name: name.value }, 'bname'));
    s.appendChild(field('Nom', name));

    s.append(
      field('Étages', slider(b.storeys, {
        min: 1, max: 4, step: 1,
        onInput: (v) => this.store.patchBuilding({ storeys: v }, 'storeys'),
      })),
    );
    /*
     * One height per level once there is more than one level. The recurring
     * real house this serves has full storeys below and a short one under the
     * roof — the level where the slopes already start. A single shared height
     * cannot say that, and rounding it to 2 or 3 whole storeys misses the
     * house by half a metre either way.
     */
    if (b.storeys <= 1) {
      s.append(field('Hauteur d’étage', slider(b.storeyHeight, {
        min: 1, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)} m`,
        onInput: (v) => this.store.patchBuilding({ storeyHeight: v, storeyHeights: null }, 'storeyHeight'),
      })));
    } else {
      const LEVEL = ['Rez-de-chaussée', 'Étage 1', 'Étage 2', 'Étage 3'];
      for (let i = 0; i < b.storeys; i++) {
        const level = i;
        s.append(field(`Hauteur — ${LEVEL[i]}`, slider(storeyHeightOf(b, i), {
          min: 1, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)} m`,
          onInput: (v) => {
            const heights = Array.from({ length: b.storeys }, (_, k) => storeyHeightOf(b, k));
            heights[level] = v;
            this.store.patchBuilding({ storeyHeights: heights }, `sh${level}`);
          },
        }), i === b.storeys - 1 ? 'un dernier niveau bas donne l’étage sous combles' : undefined));
      }
    }
    s.append(
      field('Soubassement', slider(b.plinth, {
        min: 0, max: 0.8, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
        onInput: (v) => this.store.patchBuilding({ plinth: v }, 'plinth'),
      })),
    );

    if (m.buildings.length > 1) {
      const del = h('button', 'danger', 'Supprimer ce corps');
      del.addEventListener('click', () => this.store.removeBuilding(b.id));
      s.appendChild(del);
    }

    const roof = this.section('Toiture', {
      id: 'active-roof', open: true, badge: ROOF_LABELS[b.roof.type],
    });
    roof.appendChild(this.roofFields(b));
    frag.appendChild(roof.panel);

    // Materials of this volume, defaulting to the model's.
    const tex = b.texture || m.texture;
    const own = Object.keys(b.overrides || {}).length || b.texture;
    const mat = this.section('Matières', {
      id: 'active-mat',
      badge: own ? 'réglages propres' : 'comme le projet',
    });
    frag.appendChild(mat.panel);
    mat.append(
      field('Matière du toit', select(tex.roof,
        Object.entries(ROOF_TEXTURES).map(([k, v]) => [k, v.label]),
        (v) => this.store.patchBuilding({ texture: { ...tex, roof: v } })),
        b.texture ? 'propre à ce corps' : 'reprise des réglages généraux'),
      field('Matière des murs', select(tex.wall,
        Object.entries(WALL_TEXTURES).map(([k, v]) => [k, v.label]),
        (v) => this.store.patchBuilding({ texture: { ...tex, wall: v } }))),
    );

    // Per-volume colours, over the palette. This is what lets one building be
    // timber-clad white while the rest of the model stays as it is.
    const grid = h('div', 'colour-grid');
    for (const [key, label] of [['wall', 'Murs'], ['roof', 'Toiture'], ['roofEdge', 'Rive']]) {
      const cell = h('label', 'colour-cell');
      const input = document.createElement('input');
      input.type = 'color';
      input.value = materialColour(key, m.theme, { ...m.overrides, ...b.overrides });
      input.addEventListener('input', () => {
        this.store.patchBuilding(
          { overrides: { ...b.overrides, [key]: input.value } }, `bcol:${key}`,
        );
      });
      cell.append(input, h('span', null, label));
      grid.appendChild(cell);
    }
    const group = h('div', 'colour-group');
    group.appendChild(h('span', 'colour-group-title', 'Couleurs de ce corps'));
    group.appendChild(grid);
    mat.appendChild(group);

    if (own) {
      const reset = h('button', 'subtle', 'Reprendre les réglages généraux');
      reset.addEventListener('click', () => this.store.patchBuilding({ overrides: {}, texture: null }));
      mat.appendChild(reset);
    }
    return frag;
  }

  /** Roof controls for one volume. */
  roofFields(b) {
    const s = h('div', 'roof-fields');
    s.appendChild(field('Forme', select(b.roof.type, ROOF_TYPES.map((t) => [t, ROOF_LABELS[t]]),
      (v) => this.store.patchRoof({ type: v }))));
    if (b.roof.type === 'shed') {
      s.appendChild(field('Pente', select(b.roof.shedDir, Object.entries(DIR_LABELS),
        (v) => this.store.patchRoof({ shedDir: v }))));
    }
    if (b.roof.type !== 'flat') {
      s.appendChild(field('Inclinaison', slider(b.roof.pitch, {
        min: 5, max: 55, step: 1, format: (v) => `${v}°`,
        onInput: (v) => this.store.patchRoof({ pitch: v }, 'pitch'),
      })));
    }
    s.append(
      field('Débord', slider(b.roof.overhang, {
        min: 0, max: 1.25, step: STEP, format: (v) => `${v.toFixed(2)} m`,
        onInput: (v) => this.store.patchRoof({ overhang: v }, 'overhang'),
      }), `par pas de ${STEP} m, pour que la rive reste sur la trame`),
      field('Épaisseur de rive', slider(b.roof.fascia, {
        min: 0, max: 0.4, step: 0.02, format: (v) => `${v.toFixed(2)} m`,
        onInput: (v) => this.store.patchRoof({ fascia: v }, 'fascia'),
      })),
    );
    return s;
  }

  appearanceSection() {
    const m = this.store.model;
    const s = this.section('Apparence', {
      badge: `${(THEMES[m.theme] || {}).label || m.theme}${m.style.night ? ' · nuit' : ''}`,
    });
    s.append(
      field('Palette', select(m.theme, Object.entries(THEMES).map(([k, v]) => [k, v.label]),
        (v) => this.applyTheme(v)), 'certaines palettes règlent aussi contours et matières'),
      field('Contours', toggle(m.style.outline, (v) => this.setIn('style', { outline: v }))),
      field('Ombre portée', toggle(m.style.shadow, (v) => this.setIn('style', { shadow: v }))),
      field('Croisillons des fenêtres', toggle(m.style.windowBars !== false,
        (v) => this.setIn('style', { windowBars: v }))),
      field('Vue de nuit', toggle(m.style.night, (v) => this.setIn('style', { night: v })),
        'ciel étoilé, teintes de lune, fenêtres allumées — le fond ne peut alors plus être transparent'),
      field('Fond', select(m.style.background, [
        ['transparent', 'Transparent (recommandé)'],
        ['#ffffff', 'Blanc'],
        ['#f4f6f8', 'Gris clair'],
        ['#0f172a', 'Sombre'],
      ], (v) => this.setIn('style', { background: v })),
        m.style.night ? 'sans effet : la vue de nuit dessine son propre ciel' : 'appliqué à l’export seulement'),
    );
    return s.panel;
  }

  /** Textures and per-material colour overrides. */
  coloursSection() {
    const m = this.store.model;
    const tweaks = Object.keys(m.overrides).length;
    const s = this.section('Couleurs et matières', {
      badge: [
        ROOF_TEXTURES[m.texture.roof]?.label,
        tweaks ? `${tweaks} retouche${tweaks > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' · '),
    });
    s.append(
      field('Matière du toit', select(m.texture.roof,
        Object.entries(ROOF_TEXTURES).map(([k, v]) => [k, v.label]),
        (v) => this.setIn('texture', { roof: v }))),
      field('Matière des murs', select(m.texture.wall,
        Object.entries(WALL_TEXTURES).map(([k, v]) => [k, v.label]),
        (v) => this.setIn('texture', { wall: v }))),
    );

    for (const [title, mats] of COLOUR_GROUPS) {
      const group = h('div', 'colour-group');
      group.appendChild(h('span', 'colour-group-title', title));
      const grid = h('div', 'colour-grid');
      for (const [mat, label] of mats) {
        const cell = h('label', 'colour-cell');
        const input = document.createElement('input');
        input.type = 'color';
        input.value = materialColour(mat, m.theme, m.overrides);
        input.addEventListener('input', () => {
          this.store.update(
            (mm) => ({ ...mm, overrides: { ...mm.overrides, [mat]: input.value } }),
            { coalesce: `colour:${mat}` },
          );
        });
        cell.append(input, h('span', null, label));
        grid.appendChild(cell);
      }
      group.appendChild(grid);
      s.appendChild(group);
    }

    const count = Object.keys(m.overrides).length;
    const reset = h('button', 'subtle', count ? `Revenir à la palette (${count})` : 'Revenir à la palette');
    reset.disabled = !count;
    reset.addEventListener('click', () => this.store.update((mm) => ({ ...mm, overrides: {} })));
    s.appendChild(reset);
    return s.panel;
  }

  groundSection() {
    const m = this.store.model;
    const s = this.section('Terrain', {
      badge: m.ground.enabled ? GROUND_LABELS[m.ground.material] : 'masqué',
    });
    s.appendChild(field('Afficher', toggle(m.ground.enabled, (v) => this.setIn('ground', { enabled: v }))));
    if (m.ground.enabled) {
      s.append(
        field('Revêtement', select(m.ground.material, Object.entries(GROUND_LABELS),
          (v) => this.setIn('ground', { material: v }))),
        field('Marge', slider(m.ground.margin, {
          min: 0, max: 10, step: 0.5, format: (v) => `${v} m`,
          onInput: (v) => this.setIn('ground', { margin: v }, 'margin'),
        })),
      );
    }
    return s.panel;
  }

  viewSection() {
    const m = this.store.model;
    const nv = m.views.length;
    const s = this.section('Vue', {
      open: true,
      badge: `${Math.round(m.camera.yaw)}° — ${viewpointLabel(m.camera.yaw)}`
        + (nv ? ` · ${nv} vue${nv > 1 ? 's' : ''}` : ''),
    });
    const deg = (v) => `${Math.round(v)}°`;
    s.append(
      // Free orbit, in numbers as well as by dragging: a saved view is worth
      // little if it cannot be reproduced, and "37°" can be typed back in.
      field('Orientation', slider(Math.round(m.camera.yaw), {
        min: 0, max: 359, step: 1,
        format: (v) => `${deg(v)} — ${viewpointLabel(v)}`,
        onInput: (v) => this.setIn('camera', { yaw: normaliseYaw(v) }, 'camera'),
      }), 'ou glissez directement dans le rendu'),
      field('Hauteur de vue', slider(Math.round(m.camera.pitch), {
        min: PITCH_RANGE[0], max: PITCH_RANGE[1], step: 1, format: deg,
        onInput: (v) => this.setIn('camera', { pitch: v }, 'camera'),
      }), 'de rasante à quasi verticale'),
      field('Inclinaison de l’image', slider(Math.round(m.camera.roll), {
        min: ROLL_RANGE[0], max: ROLL_RANGE[1], step: 1, format: deg,
        onInput: (v) => this.setIn('camera', { roll: v }, 'camera'),
      }), 'fait pivoter le dessin dans son cadre — ou Alt + glisser dans le rendu'),
      field('Projection', select(m.camera.projection,
        Object.entries(PROJECTIONS).map(([k, v]) => [k, v.label]),
        (v) => this.setIn('camera', { projection: v }))),
    );

    const reset = h('button', 'subtle', 'Revenir à la vue isométrique');
    reset.addEventListener('click', () => this.setIn('camera', {
      yaw: Math.round(m.camera.yaw / 90) % 4 * 90, pitch: DEFAULT_PITCH, roll: 0,
    }));
    s.appendChild(reset);

    // Saved views: one framing per widget, all re-exportable in one pass.
    if (m.views.length) {
      const list = h('div', 'building-list');
      for (const v of m.views) {
        const row = h('div', 'view-row');
        const apply = h('button', 'building-row');
        apply.type = 'button';
        apply.innerHTML = '<span class="building-name"></span><span class="building-meta"></span>';
        apply.querySelector('.building-name').textContent = v.name;
        apply.querySelector('.building-meta').textContent = v.focus.enabled
          ? `${viewpointLabel(v.camera.yaw)} — cadré ${fmtMetres(v.focus.w)} × ${fmtMetres(v.focus.d)} m`
          : `${viewpointLabel(v.camera.yaw)} — vue d'ensemble`;
        apply.addEventListener('click', () => this.set({
          camera: { ...v.camera }, focus: { ...DEFAULT_FOCUS, ...v.focus },
        }));
        const del = h('button', 'icon-button', '×');
        del.type = 'button';
        del.title = 'Supprimer cette vue';
        del.addEventListener('click', () =>
          this.set({ views: m.views.filter((x) => x.id !== v.id) }));
        row.append(apply, del);
        list.appendChild(row);
      }
      s.appendChild(list);
    }

    const save = h('button', 'subtle', '+ Enregistrer cette vue');
    save.addEventListener('click', () => {
      const name = window.prompt('Nom de la vue :', m.focus.enabled ? 'Portail' : "Vue d'ensemble");
      if (!name) return;
      this.set({
        views: [...m.views, {
          id: newId('v'), name,
          camera: { ...m.camera }, focus: { ...m.focus },
        }],
      });
    });
    s.appendChild(save);
    return s.panel;
  }

  /**
   * The framing rectangle.
   *
   * Its reason for existing is the dashboard widget that drives one device: a
   * picture of the whole property makes the gate a dozen pixels wide. Here the
   * zone is nudged numerically; the "Zone de cadrage" tool draws it directly
   * on the plan, which is faster for a first pass.
   */
  focusSection() {
    const m = this.store.model;
    const f = m.focus;
    const s = this.section('Cadrage de l’export', {
      badge: f.enabled ? `${fmtMetres(f.w)} × ${fmtMetres(f.d)} m` : 'désactivé',
    });
    s.append(field('Cadrer sur une zone', toggle(f.enabled, (v) => {
      if (!v) { this.setIn('focus', { enabled: false }); return; }
      // Switching it on frames the house. The zone stored by default sits at
      // the origin, which on most plans is an empty patch of lawn — turning
      // the setting on would then appear to blank the drawing.
      const b = bounds(cellSet(m));
      const cs = cellSizeOf(m);
      const box = b.empty ? {} : {
        x: b.i0 * cs, y: b.j0 * cs, w: (b.i1 - b.i0 + 1) * cs, d: (b.j1 - b.j0 + 1) * cs,
      };
      this.setIn('focus', { enabled: true, ...box });
    }), 'l’outil « Zone de cadrage » la dessine directement sur le plan'));
    if (!f.enabled) {
      s.appendChild(h('p', 'field-hint', 'Désactivé : l’export montre tout le modèle.'));
      s.appendChild(this.exportButton());
      return s.panel;
    }

    const num = (label, k, opts) => field(label, number(f[k], {
      ...opts, onChange: (v) => this.setIn('focus', { [k]: v }),
    }));
    s.append(
      num('Coin ouest (x)', 'x', { min: -200, max: 200, step: 0.25 }),
      num('Coin sud (y)', 'y', { min: -200, max: 200, step: 0.25 }),
      num('Largeur', 'w', { min: 2, max: 200, step: 0.25 }),
      num('Profondeur', 'd', { min: 2, max: 200, step: 0.25 }),
      field('Marge', slider(f.margin, {
        min: 0, max: 10, step: 0.25, format: (v) => `${fmtMetres(v)} m`,
        onInput: (v) => this.setIn('focus', { margin: v }, 'focus'),
      }), 'air laissé autour de la zone, sans étendre le terrain'),
    );
    s.appendChild(h('p', 'field-hint',
      'Ce qui est hors zone est retiré, et ce qui la traverse y est coupé : '
      + 'sans cela l’image serait tranchée par son propre bord.'));
    s.appendChild(this.exportButton());
    return s.panel;
  }

  /**
   * The way out of the panel where the framing is set up.
   *
   * The button in the app bar remains, and does the same thing. Having one here
   * as well is not duplication so much as the answer to "and now what?": the
   * settings above exist for the export, and leaving them without a way to
   * reach it makes the reader hunt back up the screen for it.
   */
  exportButton() {
    const b = h('button', 'subtle export-link', 'Exporter une image…');
    b.type = 'button';
    b.addEventListener('click', () => this.onExport?.());
    return b;
  }

  selectionSection(item) {
    const type = this.store.selection.type;
    const label = { opening: OPENING_LABELS, roofItem: ROOF_ITEM_LABELS, prop: PROP_LABELS }[type][item.kind]
      || item.kind;
    const s = this.block(label);
    const patch = (p, c) => this.store.patchSelected(p, c);

    if (type === 'opening') {
      const m = this.store.model;
      const host = buildingOfEdge(m, item.edge) || this.store.activeBuilding;
      const storeys = host ? host.storeys : 1;
      s.appendChild(field('Type', select(item.kind, Object.entries(OPENING_LABELS), (v) => patch({ kind: v }))));
      if (storeys > 1) {
        s.appendChild(field('Étage', select(String(item.storey || 0),
          Array.from({ length: storeys }, (_, i) => [String(i), i === 0 ? 'Rez-de-chaussée' : `Étage ${i}`]),
          (v) => patch({ storey: Number(v) }))));
      }
      s.append(
        positionField(m, item, patch),
        field('Largeur', slider(item.width, {
          min: 0.4, max: 5, step: 0.1, format: (v) => `${v.toFixed(1)} m`,
          onInput: (v) => patch({ width: v }, 'w'),
        })),
        field('Hauteur', slider(item.height, {
          min: 0.4, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
          onInput: (v) => patch({ height: v }, 'h'),
        })),
        field('Allège', slider(item.sill ?? 0, {
          min: 0, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
          onInput: (v) => patch({ sill: v }, 'sill'),
        }), 'hauteur du bas de l’ouverture'),
        field('Renfoncement', slider(item.depth ?? 0, {
          min: 0, max: 0.8, step: 0.05,
          format: (v) => (v > 0 ? `${v.toFixed(2)} m` : 'aucun'),
          onInput: (v) => patch({ depth: v }, 'depth'),
        }), 'creuse l’ouverture dans le mur — l’étage au-dessus continue'),
      );
      // Only once there is a recess to widen: two sliders that do nothing are
      // worse than none, and this panel is already long.
      if ((item.depth ?? 0) >= 0.01) {
        s.append(
          field('Débord latéral', slider(item.sides ?? 0, {
            min: 0, max: 2, step: 0.05,
            format: (v) => (v > 0 ? `${v.toFixed(2)} m` : 'aucun'),
            onInput: (v) => patch({ sides: v }, 'sides'),
          }), 'de chaque côté — pour une porte au fond d’un porche'),
          field('Débord en tête', slider(item.head ?? 0, {
            min: 0, max: 1, step: 0.05,
            format: (v) => (v > 0 ? `${v.toFixed(2)} m` : 'aucun'),
            onInput: (v) => patch({ head: v }, 'head'),
          }), 'au-dessus de l’ouverture'),
        );
      }
    } else if (type === 'roofItem') {
      s.append(
        field('Type', select(item.kind, Object.entries(ROOF_ITEM_LABELS), (v) => patch({ kind: v }))),
        field('X', number(item.x, { min: 0, max: 60, step: 0.25, onChange: (v) => patch({ x: v }) })),
        field('Y', number(item.y, { min: 0, max: 60, step: 0.25, onChange: (v) => patch({ y: v }) })),
        field('Largeur', slider(item.w ?? 2, {
          min: 0.4, max: 10, step: 0.2, format: (v) => `${v.toFixed(1)} m`,
          onInput: (v) => patch({ w: v }, 'w'),
        })),
        field('Profondeur', slider(item.d ?? 1.5, {
          min: 0.4, max: 8, step: 0.2, format: (v) => `${v.toFixed(1)} m`,
          onInput: (v) => patch({ d: v }, 'd'),
        })),
      );
      if (item.kind === 'chimney') {
        s.appendChild(field('Hauteur', slider(item.h ?? 1.1, {
          min: 0.3, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)} m`,
          onInput: (v) => patch({ h: v }, 'h'),
        })));
      }
    } else if (type === 'prop') {
      s.append(
        field('X', number(item.x, { min: -20, max: 80, step: 0.25, onChange: (v) => patch({ x: v }) })),
        field('Y', number(item.y, { min: -20, max: 80, step: 0.25, onChange: (v) => patch({ y: v }) })),
      );
      if (item.kind === 'tree') {
        s.appendChild(field('Taille', slider(item.r ?? 1.4, {
          min: 0.5, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)} m`,
          onInput: (v) => patch({ r: v }, 'r'),
        })));
      } else {
        s.append(
          // A slider's values are min + k x step, so the minimum sets the grid
          // as much as the step does. At 0.40 and 0.20 a terrace could be 3.15
          // by 3.95 but never 3 by 4, and no amount of care aligned it on the
          // building it adjoins — reported by a user trying to do exactly that.
          field('Largeur', slider(item.w ?? 2, {
            min: 0.25, max: 24, step: 0.25, format: (v) => `${v.toFixed(2)} m`,
            onInput: (v) => patch({ w: v }, 'w'),
          })),
          field('Profondeur', slider(item.d ?? 2, {
            min: 0.25, max: 24, step: 0.25, format: (v) => `${v.toFixed(2)} m`,
            onInput: (v) => patch({ d: v }, 'd'),
          })),
        );
      }
      if (item.kind === 'pool') {
        s.appendChild(field('Forme', select(item.shape || 'rounded',
          [['rounded', 'Arrondie'], ['rect', 'Rectangulaire']], (v) => patch({ shape: v }))));
      }
      if (item.kind === 'terrace' || item.kind === 'path' || item.kind === 'deck') {
        s.appendChild(field('Revêtement', select(item.material || (item.kind === 'deck' ? 'deck' : 'paving'),
          [['paving', 'Dallage'], ['gravel', 'Gravier'], ['deck', 'Bois']], (v) => patch({ material: v }))));
      }
      if (['terrace', 'path', 'deck', 'pool'].includes(item.kind)) {
        s.appendChild(field('Élévation', slider(item.z ?? 0, {
          // Up to a full storey: on sloping ground a terrace can sit level
          // with the first floor, the garage opening underneath it.
          min: 0, max: 3, step: 0.05, format: (v) => (v > 0 ? `${v.toFixed(2)} m` : 'au sol'),
          onInput: (v) => patch({ z: v }, 'z'),
        }), 'la dalle reçoit ses joues — et masque ce qui reste au sol dessous'));
      }
      if (item.kind === 'gate') {
        s.appendChild(field('Type', select(item.style || 'swing',
          [['swing', 'Portillon battant'], ['sliding', 'Portail coulissant']],
          (v) => patch({ style: v }))));
      }
      if (['hedge', 'fence', 'muret', 'gate'].includes(item.kind)) {
        s.appendChild(field('Hauteur', slider(item.h ?? 1, {
          min: 0.3, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
          onInput: (v) => patch({ h: v }, 'h'),
        })));
      }
    }

    const dup = h('button', 'subtle', 'Dupliquer (Ctrl+D)');
    dup.addEventListener('click', () => this.store.duplicateSelected());
    s.appendChild(dup);
    const del = h('button', 'danger', 'Supprimer');
    del.addEventListener('click', () => this.store.deleteSelected());
    s.appendChild(del);
    return s;
  }
}
