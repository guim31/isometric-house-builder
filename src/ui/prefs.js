/**
 * Settings of the interface itself: which drawings share the centre and how,
 * which inspector sections are open, the export size last chosen.
 *
 * Outside the project on purpose. A project file or a shared link carries a
 * house, not the way one person likes their screen laid out — and a layout
 * stored in the model would make every resize of the splitter an entry in
 * the history.
 *
 * Every value read back is checked: the storage is the user's, and anything
 * odd found there falls back to the default rather than breaking the page.
 */

export const PREFS_KEY = 'isometric-house-builder/ui';

export const LAYOUT_IDS = ['plan', 'both', 'render'];
export const TAB_IDS = ['plan', 'render', 'settings'];

/** Share of the centre given to the plan when both drawings show. */
export const SPLIT_RANGE = [0.2, 0.8];
const DEFAULT_SPLIT = 0.4;

export const DEFAULT_PREFS = Object.freeze({
  layout: 'both',
  split: DEFAULT_SPLIT,
  tab: 'plan',
  sections: {},
  toolGroups: {},
  exportSize: 'gladys',
  customSize: [1600, 1000],
});

const clampSplit = (v) => Math.max(SPLIT_RANGE[0], Math.min(SPLIT_RANGE[1], v));
const isBoolMap = (o) => o && typeof o === 'object' && !Array.isArray(o);

/** Prefs as stored, or the defaults for whatever is missing or odd. */
export function readPrefs(raw) {
  const p = { ...DEFAULT_PREFS, sections: {}, toolGroups: {} };
  if (!raw || typeof raw !== 'object') return p;
  if (LAYOUT_IDS.includes(raw.layout)) p.layout = raw.layout;
  if (TAB_IDS.includes(raw.tab)) p.tab = raw.tab;
  if (Number.isFinite(raw.split)) p.split = clampSplit(raw.split);
  for (const k of ['sections', 'toolGroups']) {
    if (!isBoolMap(raw[k])) continue;
    // A few dozen names at most; a runaway map is not worth keeping.
    for (const [id, open] of Object.entries(raw[k]).slice(0, 200)) {
      if (typeof open === 'boolean' && id.length < 80) p[k][id] = open;
    }
  }
  if (typeof raw.exportSize === 'string' && raw.exportSize.length < 40) p.exportSize = raw.exportSize;
  if (Array.isArray(raw.customSize) && raw.customSize.length === 2 && raw.customSize.every(Number.isFinite)) {
    p.customSize = raw.customSize.map((v) => Math.round(v));
  }
  return p;
}

export function loadPrefs() {
  try {
    return readPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'));
  } catch {
    return readPrefs(null);
  }
}

/**
 * The prefs in use. One object for the whole page, so that the inspector, the
 * layout and the export window never write over each other's keys.
 */
let current = null;

export function prefs() {
  if (!current) current = loadPrefs();
  return current;
}

/** Change some prefs and store them. Returns the prefs as they now are. */
export function setPrefs(patch) {
  const next = readPrefs({ ...prefs(), ...patch });
  current = next;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private browsing: kept for this visit */ }
  return next;
}

/** Forget them: the next read starts from the defaults. For tests and « reset ». */
export function clearPrefs() {
  current = null;
  try { localStorage.removeItem(PREFS_KEY); } catch { /* nothing to clear */ }
}
