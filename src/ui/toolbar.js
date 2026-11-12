/**
 * The tool palette: seven families, thirty-one tools, each with its icon, its
 * name, and its key when it has one.
 *
 * The families fold, and which are open is remembered: someone who never
 * puts a dish on a roof folds that family once. Folding is done with a
 * button and a class rather than with <details>, because the narrower
 * layouts show every tool at once — a strip of icons on a phone — and a
 * closed <details> cannot be opened by a style sheet.
 */

import { TOOL_GROUPS, TOOLS, toolLabel, toolHint, toolTip, groupTitle } from './texts.js';
import { t as tr, language } from '../i18n/index.js';
import { icon } from './icons.js';
import { prefs, setPrefs } from './prefs.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** A tool's tooltip: its name, its key, and the whole of its help. */
export function toolTitle(t) {
  const words = { label: toolLabel(t.id), key: t.key, tip: toolTip(t.id) };
  return t.key ? tr('tool.titleKey', words) : tr('tool.title', words);
}

export function buildTools(root, store) {
  root.replaceChildren();
  const remembered = prefs().toolGroups;
  for (const group of TOOL_GROUPS) {
    const box = h('section', 'tool-group');
    box.dataset.group = group.id;
    const open = remembered[group.id] ?? !group.folded;
    box.classList.toggle('folded', !open);
    const listId = `tools-${group.id}`;
    const head = h('button', 'tool-group-title');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.setAttribute('aria-controls', listId);
    head.append(h('span', 'tool-group-name', groupTitle(group.id)), h('span', 'tool-group-count', String(group.tools.length)));
    head.addEventListener('click', () => {
      const now = box.classList.toggle('folded');
      head.setAttribute('aria-expanded', String(!now));
      setPrefs({ toolGroups: { ...prefs().toolGroups, [group.id]: !now } });
    });
    const list = h('div', 'tool-list');
    list.id = listId;
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', groupTitle(group.id));
    for (const t of group.tools) {
      const b = h('button', 'tool');
      b.type = 'button';
      b.dataset.tool = t.id;
      b.title = toolTitle(t);
      b.setAttribute('aria-pressed', 'false');
      if (t.key) b.setAttribute('aria-keyshortcuts', t.key);
      b.innerHTML = icon(t.id, 'tool-icon');
      b.appendChild(h('span', 'tool-label', toolLabel(t.id)));
      if (t.key) b.appendChild(h('kbd', 'tool-key', t.key));
      b.addEventListener('click', () => store.setTool(t.id));
      list.appendChild(b);
    }
    box.append(head, list);
    root.appendChild(box);
  }
}

/**
 * Show which tool is active, and say what it does on one line. The active
 * tool's family is unfolded if it was not: a tool picked by its key must be
 * seen to be picked.
 */
export function syncTools(root, hint, store) {
  for (const b of root.querySelectorAll('.tool')) {
    const on = b.dataset.tool === store.tool;
    if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    if (on) {
      const box = b.closest('.tool-group');
      if (box?.classList.contains('folded')) {
        box.classList.remove('folded');
        box.querySelector('.tool-group-title')?.setAttribute('aria-expanded', 'true');
      }
    }
  }
  const t = TOOLS[store.tool];
  const text = toolHint(store.tool);
  // Keyed on the language too: the line is rewritten when it changes.
  const stamp = `${store.tool}:${language()}`;
  if (hint.dataset.tool !== stamp) {
    hint.dataset.tool = stamp;
    hint.replaceChildren();
    if (t) hint.appendChild(h('strong', 'hint-tool', toolLabel(t.id)));
    hint.appendChild(h('span', 'hint-text', text));
    hint.title = t ? tr('tool.title', { label: toolLabel(t.id), tip: toolTip(t.id) || text }) : text;
  }
}

/** Bring the active tool into view in a scrolled strip — the phone's. */
export function revealTool(root, tool) {
  const b = root.querySelector(`.tool[data-tool="${tool}"]`);
  if (!b || root.scrollWidth <= root.clientWidth + 1) return;
  const r = b.getBoundingClientRect(), box = root.getBoundingClientRect();
  if (r.left < box.left || r.right > box.right) b.scrollIntoView({ block: 'nearest', inline: 'center' });
}
