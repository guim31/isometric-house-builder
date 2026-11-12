/**
 * The shape of the interface's words: which tools, in which families, with
 * which keys; which shortcuts the help lists. The words themselves are in the
 * dictionaries (src/i18n/), read through `t` at the moment they are shown, so
 * that a change of language redraws them in place.
 */

import { t } from '../i18n/index.js';

export const APP_NAME = 'Isometric House Builder';

/**
 * The tool palette, family by family. `key` is the one-key shortcut, when the
 * tool has one — the same letter in every language, so that a hand used to it
 * keeps it. A tool's name is `tool.<id>`, its full help `tip.<id>`; the line
 * above the drawings only has room for its hint (`HINTS`).
 */
export const TOOL_GROUPS = [
  {
    id: 'structure', tools: [
      { id: 'select', key: 'V' },
      { id: 'paint', key: 'B' },
      { id: 'rect', key: 'R' },
      { id: 'erase', key: 'E' },
    ],
  },
  {
    id: 'openings', tools: [
      { id: 'window', key: 'F' },
      { id: 'shutter' },
      { id: 'door', key: 'P' },
      { id: 'garage', key: 'G' },
    ],
  },
  {
    id: 'roof', folded: true, tools: [
      { id: 'solar', key: 'S' },
      { id: 'chimney' },
      { id: 'velux' },
      { id: 'dish' },
    ],
  },
  {
    id: 'outside', tools: [
      { id: 'pool' },
      { id: 'terrace' },
      { id: 'path' },
      { id: 'stairs' },
      { id: 'tree', key: 'A' },
      { id: 'bush' },
      { id: 'hedge', key: 'H' },
      { id: 'fence' },
      { id: 'muret', key: 'M' },
      { id: 'gate' },
      { id: 'car' },
    ],
  },
  {
    // What a home dashboard puts a badge on: the lights, the camera, the
    // charger, the heat pump, the letter box, where the car sleeps.
    id: 'equipment', folded: true, tools: [
      { id: 'wallLight' },
      { id: 'camera' },
      { id: 'charger' },
      { id: 'lamppost' },
      { id: 'heatpump' },
      { id: 'mailbox' },
      { id: 'carport' },
    ],
  },
  {
    id: 'framing', folded: true, tools: [
      { id: 'frame', key: 'C' },
    ],
  },
];

export const TOOLS = Object.fromEntries(TOOL_GROUPS.flatMap((g) => g.tools.map((x) => [x.id, x])));

/**
 * One line each: the line above the drawings is a reminder, not a manual,
 * and it must not change height from one tool to the next. Tools that are
 * placed the same way share their line.
 */
const HINTS = {
  select: 'hint.select', paint: 'hint.paint', rect: 'hint.rect', erase: 'hint.erase',
  window: 'hint.wall', shutter: 'hint.wall', door: 'hint.wall', garage: 'hint.wall',
  solar: 'hint.roof', chimney: 'hint.roof', velux: 'hint.roof', dish: 'hint.roof',
  pool: 'hint.ground', terrace: 'hint.ground', path: 'hint.ground', tree: 'hint.ground',
  bush: 'hint.ground', car: 'hint.ground', lamppost: 'hint.ground', carport: 'hint.ground',
  stairs: 'hint.stairs', hedge: 'hint.hedge', fence: 'hint.fence', muret: 'hint.muret',
  gate: 'hint.gate', wallLight: 'hint.wallHeight', camera: 'hint.wallHeight',
  charger: 'hint.charger', heatpump: 'hint.heatpump', mailbox: 'hint.mailbox', frame: 'hint.frame',
};

export const toolLabel = (id) => t(`tool.${id}`);
export const toolHint = (id) => (HINTS[id] ? t(HINTS[id]) : '');
export const toolTip = (id) => t(`tip.${id}`);
export const groupTitle = (id) => t(`group.${id}`);

/** The three ways the drawings share the centre, and their keys. */
export const LAYOUTS = [
  { id: 'plan', key: '1' },
  { id: 'both', key: '2' },
  { id: 'render', key: '3' },
];

/** The phone's three screens. */
export const TABS = ['plan', 'render', 'settings'];

/**
 * Every shortcut, as the help dialog lists them. `keys` is a small grammar:
 * `|` separates key combinations from the words between them (`or`, `and`,
 * `dot`, `with`), `+` the keys of one combination; a key with a name of its
 * own (`ctrl`, `shift`, `esc`…) is translated, any other is shown as it is.
 * The tool keys come from the palette above, so the two cannot disagree.
 */
export const SHORTCUT_SECTIONS = [
  {
    id: 'project', keys: [
      ['ctrl+S', 'save'],
      ['ctrl+shift+S', 'saveAs'],
      ['ctrl+O', 'open'],
      ['ctrl+E', 'export'],
      ['ctrl+Z', 'undo'],
      ['ctrl+shift+Z|or|ctrl+Y', 'redo'],
      ['?', 'help'],
    ],
  },
  {
    id: 'selection', keys: [
      ['esc', 'escape'],
      ['del', 'delete'],
      ['ctrl+D', 'duplicate'],
      ['arrows', 'nudge'],
    ],
  },
  {
    id: 'views', keys: [
      ['1|dot|2|dot|3', 'layouts'],
      ['[|and|]', 'rotate'],
      ['space|with|drag', 'panPlan'],
      ['wheel', 'zoom'],
      ['shift|with|drag', 'panRender'],
      ['alt|with|drag', 'tilt'],
    ],
  },
];

const NAMED_KEYS = new Set(['ctrl', 'shift', 'alt', 'esc', 'del', 'arrows', 'space', 'drag', 'wheel']);

/** A key's name as the language writes it. */
export const keyName = (k) => (NAMED_KEYS.has(k) ? t(`key.${k}`) : k);

/**
 * A shortcut as parts to lay out: `{ keys: [...] }` for a combination,
 * `{ text }` for the words between two. A word of the grammar is translated
 * (`keys.or`…).
 */
export function shortcutParts(spec) {
  return spec.split('|').map((part, i) => (i % 2
    ? { text: t(`keys.${part}`) }
    : { keys: part.split('+').map(keyName) }));
}
