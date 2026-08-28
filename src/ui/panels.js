/**
 * The inspector: global settings, plus whatever is currently selected.
 */

import { THEMES, materialColour } from '../core/palette.js';
import { PROJECTIONS } from '../core/iso.js';
import { ROOF_TYPES, STEP } from '../core/roof.js';
import { ROOF_TEXTURES, WALL_TEXTURES } from '../render/texture.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

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
  pool: 'Piscine', terrace: 'Terrasse', path: 'Allée', deck: 'Terrasse bois',
  tree: 'Arbre', hedge: 'Haie', fence: 'Clôture', car: 'Voiture',
};

export class Inspector {
  constructor(root, store) {
    this.root = root;
    this.store = store;
  }

  render() {
    this.root.replaceChildren();
    const sel = this.store.selected;
    if (sel) this.root.appendChild(this.selectionSection(sel));
    this.root.appendChild(this.buildingSection());
    this.root.appendChild(this.roofSection());
    this.root.appendChild(this.appearanceSection());
    this.root.appendChild(this.coloursSection());
    this.root.appendChild(this.groundSection());
    this.root.appendChild(this.viewSection());
  }

  section(title) {
    const s = h('section', 'panel');
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
    const s = this.section('Bâtiment');
    s.append(
      field('Étages', slider(m.storeys, {
        min: 1, max: 4, step: 1,
        onInput: (v) => this.set({ storeys: v }, 'storeys'),
      })),
      field('Hauteur d’étage', slider(m.storeyHeight, {
        min: 2.2, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)} m`,
        onInput: (v) => this.set({ storeyHeight: v }, 'storeyHeight'),
      })),
      field('Soubassement', slider(m.plinth, {
        min: 0, max: 0.8, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
        onInput: (v) => this.set({ plinth: v }, 'plinth'),
      })),
    );
    return s;
  }

  roofSection() {
    const m = this.store.model;
    const s = this.section('Toiture');
    s.appendChild(field('Type', select(m.roof.type, ROOF_TYPES.map((t) => [t, ROOF_LABELS[t]]),
      (v) => this.setIn('roof', { type: v }))));
    if (m.roof.type === 'shed') {
      s.appendChild(field('Pente', select(m.roof.shedDir, Object.entries(DIR_LABELS),
        (v) => this.setIn('roof', { shedDir: v }))));
    }
    if (m.roof.type !== 'flat') {
      s.appendChild(field('Inclinaison', slider(m.roof.pitch, {
        min: 5, max: 55, step: 1, format: (v) => `${v}°`,
        onInput: (v) => this.setIn('roof', { pitch: v }, 'pitch'),
      })));
    }
    s.append(
      field('Débord', slider(m.roof.overhang, {
        min: 0, max: 1.25, step: STEP, format: (v) => `${v.toFixed(2)} m`,
        onInput: (v) => this.setIn('roof', { overhang: v }, 'overhang'),
      }), `par pas de ${STEP} m, pour que la rive reste sur la trame`),
      field('Épaisseur de rive', slider(m.roof.fascia, {
        min: 0, max: 0.4, step: 0.02, format: (v) => `${v.toFixed(2)} m`,
        onInput: (v) => this.setIn('roof', { fascia: v }, 'fascia'),
      })),
    );
    return s;
  }

  appearanceSection() {
    const m = this.store.model;
    const s = this.section('Apparence');
    s.append(
      field('Palette', select(m.theme, Object.entries(THEMES).map(([k, v]) => [k, v.label]),
        (v) => this.set({ theme: v }))),
      field('Contours', toggle(m.style.outline, (v) => this.setIn('style', { outline: v }))),
      field('Ombre portée', toggle(m.style.shadow, (v) => this.setIn('style', { shadow: v }))),
      field('Fond', select(m.style.background, [
        ['transparent', 'Transparent (recommandé)'],
        ['#ffffff', 'Blanc'],
        ['#f4f6f8', 'Gris clair'],
        ['#0f172a', 'Sombre'],
      ], (v) => this.setIn('style', { background: v })), 'appliqué à l’export seulement'),
    );
    return s;
  }

  /** Textures and per-material colour overrides. */
  coloursSection() {
    const m = this.store.model;
    const s = this.section('Couleurs et matières');
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
    return s;
  }

  groundSection() {
    const m = this.store.model;
    const s = this.section('Terrain');
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
    return s;
  }

  viewSection() {
    const m = this.store.model;
    const s = this.section('Vue');
    s.appendChild(field('Projection', select(m.camera.projection,
      Object.entries(PROJECTIONS).map(([k, v]) => [k, v.label]),
      (v) => this.setIn('camera', { projection: v }))));
    return s;
  }

  selectionSection(item) {
    const type = this.store.selection.type;
    const label = { opening: OPENING_LABELS, roofItem: ROOF_ITEM_LABELS, prop: PROP_LABELS }[type][item.kind]
      || item.kind;
    const s = this.section(label);
    s.classList.add('panel-selected');
    const patch = (p, c) => this.store.patchSelected(p, c);

    if (type === 'opening') {
      const m = this.store.model;
      s.appendChild(field('Type', select(item.kind, Object.entries(OPENING_LABELS), (v) => patch({ kind: v }))));
      if (m.storeys > 1) {
        s.appendChild(field('Étage', select(String(item.storey || 0),
          Array.from({ length: m.storeys }, (_, i) => [String(i), i === 0 ? 'Rez-de-chaussée' : `Étage ${i}`]),
          (v) => patch({ storey: Number(v) }))));
      }
      s.append(
        field('Position', slider(item.offset ?? 0.5, {
          min: -1, max: 2, step: 0.05, format: (v) => `${v.toFixed(2)} m`,
          onInput: (v) => patch({ offset: v }, 'offset'),
        }), 'le long du mur, depuis le début du segment'),
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
      );
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
          field('Largeur', slider(item.w ?? 2, {
            min: 0.4, max: 24, step: 0.25, format: (v) => `${v.toFixed(2)} m`,
            onInput: (v) => patch({ w: v }, 'w'),
          })),
          field('Profondeur', slider(item.d ?? 2, {
            min: 0.2, max: 24, step: 0.25, format: (v) => `${v.toFixed(2)} m`,
            onInput: (v) => patch({ d: v }, 'd'),
          })),
        );
      }
      if (item.kind === 'pool') {
        s.appendChild(field('Forme', select(item.shape || 'rounded',
          [['rounded', 'Arrondie'], ['rect', 'Rectangulaire']], (v) => patch({ shape: v }))));
      }
      if (item.kind === 'terrace' || item.kind === 'path') {
        s.appendChild(field('Revêtement', select(item.material || 'paving',
          [['paving', 'Dallage'], ['gravel', 'Gravier'], ['deck', 'Bois']], (v) => patch({ material: v }))));
      }
      if (item.kind === 'hedge' || item.kind === 'fence') {
        s.appendChild(field('Hauteur', slider(item.h ?? 1, {
          min: 0.3, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)} m`,
          onInput: (v) => patch({ h: v }, 'h'),
        })));
      }
    }

    const del = h('button', 'danger', 'Supprimer');
    del.addEventListener('click', () => this.store.deleteSelected());
    s.appendChild(del);
    return s;
  }
}
