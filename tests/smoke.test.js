/**
 * Tests de fumée de l'application réelle : chaque contrôle de l'inspecteur
 * pour chaque type d'objet, chaque outil dans le plan puis dans le rendu.
 *
 * The defects these stand for were visible at the first click — a palette
 * list that threw, a bush whose sliders did nothing — and invisible to every
 * module test, because no test clicked.
 */

import { checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { appStore, frames } from './app.test.js';
import { FIXTURE_ITEMS, fixtureHouse } from './reliability.test.js';
import { normalise, limitBreach } from '../src/core/model.js';

/** Keys sorted, so two models compare whatever order their fields came in. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/** Is this model what normalise would make of it — nothing out of range, nothing missing? */
function invalid(m) {
  const breach = limitBreach(m);
  if (breach) return `plafond franchi : ${breach}`;
  if (/NaN|Infinity/.test(JSON.stringify(m))) return 'valeur non finie';
  const again = normalise(JSON.parse(JSON.stringify(m)));
  for (const list of ['openings', 'roofItems', 'props', 'buildings']) {
    if (again[list].length !== m[list].length) return `${list} : un élément écarté par normalise`;
  }
  return null;
}

/** Collect what escapes to the frame's window while `fn` runs. */
async function watch(win, fn) {
  const seen = [];
  const onError = (e) => seen.push(e.message);
  const onReject = (e) => seen.push(String(e.reason?.message || e.reason));
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onReject);
  try {
    await fn();
  } finally {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onReject);
  }
  return seen;
}

const LIST = { opening: 'openings', roofItem: 'roofItems', prop: 'props' };

/**
 * Work every control of a part of the inspector, as a hand would: each option
 * of each list, each box, each slider at both ends, each number field at its
 * bounds and emptied, each button that destroys nothing.
 *
 * `scope` selects the controls; `reset` puts back what the panel is about
 * before each one (the selection, say); `onChange(label, el)` is told of every
 * actual change, with the drawing before and after, for those who care.
 */
async function workControls(win, doc, scope, reset, onChange = null) {
  const controls = () => [...doc.querySelectorAll(scope)].filter((el) => el.offsetParent !== null || el.closest('details'));
  await reset();
  await frames(win, 1);
  const count = controls().length;
  let actions = 0;
  const label = (el) => el.closest('.field')?.querySelector('.field-label')?.textContent || el.textContent;
  const drawing = () => doc.querySelector('#iso svg')?.innerHTML || '';
  const act = async (k, set, kinds, changes) => {
    const cur = controls()[k];
    if (!cur) return;
    const shot = drawing();
    set(cur);
    for (const kind of kinds) cur.dispatchEvent(new win.Event(kind, { bubbles: true }));
    actions++;
    await frames(win, 1);
    if (changes && onChange) onChange(label(cur), shot, drawing());
  };
  for (let k = 0; k < count; k++) {
    await reset();
    await frames(win, 1);
    const el = controls()[k];
    if (!el) continue;
    if (el.tagName === 'BUTTON') {
      if (el.classList.contains('danger')) continue; // deleting is the point of those
      el.click();
      actions++;
      await frames(win, 1);
      doc.querySelectorAll('dialog[open]').forEach((d) => d.close());
      continue;
    }
    if (el.tagName === 'SELECT') {
      for (const v of [...el.options].map((o) => o.value)) {
        await reset();
        await frames(win, 1);
        const was = controls()[k]?.value;
        await act(k, (c) => { c.value = v; }, ['change'], v !== was);
      }
    } else if (el.type === 'range') {
      for (const end of ['min', 'max']) {
        await reset();
        await frames(win, 1);
        const c0 = controls()[k];
        const changes = c0 && Number(c0.value) !== Number(c0[end]);
        await act(k, (c) => { c.value = c[end]; }, ['input', 'change'], changes);
      }
    } else if (el.type === 'number') {
      for (const v of ['min', 'max', '']) {
        const c0 = controls()[k];
        const target = v ? c0?.[v] : '';
        const changes = v && c0 && Number(c0.value) !== Number(target);
        await act(k, (c) => { c.value = target; }, ['change'], changes);
      }
    } else if (el.type === 'checkbox') {
      await act(k, (c) => { c.checked = !c.checked; }, ['change'], true);
    } else if (el.type === 'color') {
      await act(k, (c) => { c.value = '#123456'; }, ['input', 'change'], false);
    } else if (el.type === 'text') {
      await act(k, (c) => { c.value = 'Essai'; }, ['input'], false);
    }
  }
  return actions;
}

await checkAsync('chaque contrôle de l’inspecteur, pour chaque type d’objet, sans exception et avec effet', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  const items = { openings: [], roofItems: [], props: [] };
  for (const [type, list] of Object.entries(FIXTURE_ITEMS)) {
    list.forEach((it, i) => items[LIST[type]].push({ ...it, id: `smoke${type}${i}` }));
  }
  const stage = { ...fixtureHouse(), ...items };
  store.reset(stage);
  store.setTool('select');
  const problems = [];
  const dead = [];
  let actions = 0;
  const errors = await watch(win, async () => {
    for (const [type, list] of Object.entries(FIXTURE_ITEMS)) {
      for (let i = 0; i < list.length; i++) {
        const id = `smoke${type}${i}`;
        actions += await workControls(win, doc, '#inspector .panel-selected input, #inspector .panel-selected select, #inspector .panel-selected button',
          async () => { store.reset(stage); store.select({ type, id }); },
          (name, a, b) => { if (a === b) dead.push(`${list[i].kind} : ${name}`); });
        const bad = invalid(store.model);
        if (bad) problems.push(`${type} ${list[i].kind} : ${bad}`);
      }
    }
  });
  store.reset(before);
  if (errors.length) return `exception : ${errors.slice(0, 3).join(' ; ')}`;
  if (problems.length) return problems.slice(0, 4).join(' ; ');
  if (dead.length) return `sans effet visible : ${dead.slice(0, 6).join(', ')}`;
  return actions > 200 || `${actions} actions seulement`;
});

await checkAsync('chaque contrôle des autres sections de l’inspecteur, sans exception', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  const stage = { ...fixtureHouse(), views: [{ id: 'v1', name: 'Vue', camera: {}, focus: { enabled: true } }] };
  const prompt = win.prompt;
  win.prompt = () => 'Vue d’essai';
  let actions = 0;
  const errors = await watch(win, async () => {
    actions = await workControls(win, doc, '#inspector details input, #inspector details select, #inspector details button',
      async () => {
        store.reset(stage);
        store.select(null);
        await frames(win, 1);
        doc.querySelectorAll('#inspector details').forEach((d) => { d.open = true; });
      });
  });
  win.prompt = prompt;
  const bad = invalid(store.model);
  store.reset(before);
  if (errors.length) return `exception : ${errors.slice(0, 3).join(' ; ')}`;
  if (bad) return bad;
  return actions > 40 || `${actions} actions seulement`;
});

await checkAsync('chaque outil, un clic dans le plan puis dans le rendu, sans exception', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  const tools = [...doc.querySelectorAll('#tools .tool')];
  if (tools.length < 20) return `${tools.length} outils`;
  const press = (target, x, y) => {
    const opts = { clientX: x, clientY: y, bubbles: true, pointerId: 31, isPrimary: true, button: 0, buttons: 1 };
    target.dispatchEvent(new win.PointerEvent('pointerdown', opts));
    target.dispatchEvent(new win.PointerEvent('pointermove', { ...opts, clientX: x + 30, clientY: y + 12 }));
    target.dispatchEvent(new win.PointerEvent('pointerup', { ...opts, clientX: x + 30, clientY: y + 12, buttons: 0 }));
    target.dispatchEvent(new win.PointerEvent('pointerdown', opts));
    target.dispatchEvent(new win.PointerEvent('pointerup', { ...opts, buttons: 0 }));
  };
  const errors = await watch(win, async () => {
    for (const b of tools) {
      b.closest('details').open = true;
      b.click();
      await frames(win, 1);
      for (const id of ['plan', 'iso']) {
        const svg = doc.querySelector(`#${id} svg`);
        const r = svg.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const target = doc.elementFromPoint(x, y) || svg;
        press(target, x, y);
        await frames(win, 1);
      }
    }
  });
  const bad = invalid(store.model);
  store.reset(before);
  store.setTool('select');
  if (errors.length) return `exception : ${errors.slice(0, 3).join(' ; ')}`;
  return !bad || bad;
});
