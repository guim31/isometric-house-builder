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
  for (const list of ['openings', 'fixtures', 'roofItems', 'props', 'buildings']) {
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

const LIST = { opening: 'openings', roofItem: 'roofItems', prop: 'props', fixture: 'fixtures' };

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
  // Drawn at once rather than at the next animation frame: the same code
  // path, a thousand frames sooner.
  const frames = async (w) => w.__app.render();
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
        const was = controls()[k]?.value;
        await act(k, (c) => { c.value = v; }, ['change'], v !== was);
      }
    } else if (el.classList.contains('num')) {
      // The exact-value field: typed at its upper bound, with a comma, as a
      // French hand would; then something unreadable, which must be refused.
      // (The lower bound is the slider's, already worked above.)
      for (const v of [el.dataset.max, 'n’importe quoi']) {
        const c0 = controls()[k];
        if (!c0?.classList.contains('num')) break;
        const target = Number(v);
        const changes = Number.isFinite(target) && Math.abs(Number(c0.value.replace(',', '.')) - target) > 1e-9;
        await act(k, (c) => { c.value = String(v).replace('.', ','); }, ['change'], changes);
      }
    } else if (el.type === 'range') {
      for (const end of ['min', 'max']) {
        const c0 = controls()[k];
        // A list that changed under the first end — a level gone — has
        // moved another control to this place: that one has its own turn.
        if (c0?.type !== 'range') break;
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
  const items = { openings: [], roofItems: [], props: [], fixtures: [] };
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
  const views = [{ id: 'v1', name: 'Vue', camera: {}, focus: { enabled: true } }];
  // Twice: a hip roof, then a gable — whose ridge has a control of its own —
  // on a body that carries something of every list, for the body's buttons
  // (duplicate, turn, mirror) to carry along.
  const plain = { ...fixtureHouse(), views };
  const items = { openings: [], roofItems: [], props: [], fixtures: [] };
  for (const [type, list] of Object.entries(FIXTURE_ITEMS)) {
    list.forEach((it, i) => items[LIST[type]].push({ ...it, id: `other${type}${i}` }));
  }
  const gable = normalise({
    ...plain, ...items,
    buildings: plain.buildings.map((b) => ({ ...b, roof: { ...b.roof, type: 'gable', ridge: 'ew' } })),
  });
  const prompt = win.prompt;
  win.prompt = () => 'Vue d’essai';
  let actions = 0;
  const bad = [];
  const errors = await watch(win, async () => {
    for (const stage of [plain, gable]) {
      actions += await workControls(win, doc, '#inspector details input, #inspector details select, #inspector details button',
        async () => {
          store.reset(stage);
          store.select(null);
          await frames(win, 1);
          doc.querySelectorAll('#inspector details').forEach((d) => { d.open = true; });
        });
      const wrong = invalid(store.model);
      if (wrong) bad.push(wrong);
    }
  });
  win.prompt = prompt;
  const ridge = (() => {
    store.reset(gable);
    return [...doc.querySelectorAll('#inspector .field-label')].some((l) => l.textContent === 'Faîtage');
  })();
  store.reset(before);
  if (errors.length) return `exception : ${errors.slice(0, 3).join(' ; ')}`;
  if (bad.length) return bad.join(' ; ');
  if (!ridge) return 'le réglage du faîtage n’a pas été atteint';
  return actions > 80 || `${actions} actions seulement`;
});

await checkAsync('chaque outil, un clic dans le plan puis dans le rendu, sans exception', async () => {
  const frame = await app();
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const store = await appStore();
  const before = store.model;
  const tools = [...doc.querySelectorAll('#tools .tool')];
  // Both lots' tools, each one: the plan's and the equipment.
  const want = ['select', 'paint', 'rect', 'erase', 'window', 'door', 'solar', 'chimney', 'pool', 'muret', 'gate',
    'frame', 'wallLight', 'camera', 'charger', 'lamppost', 'heatpump', 'mailbox', 'carport'];
  const have = new Set(tools.map((b) => b.dataset.tool));
  const missing = want.filter((t) => !have.has(t));
  if (missing.length) return `outils absents : ${missing.join(', ')}`;
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
      b.closest('.tool-group').classList.remove('folded');
      b.click();
      await frames(win, 1);
      // Over the plan first, without a press: each tool's preview is drawn.
      const plan = doc.querySelector('#plan .plan-svg').getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.4], [0.9, 0.9]]) {
        doc.querySelector('#plan .plan-svg').dispatchEvent(new win.PointerEvent('pointermove', {
          clientX: plan.left + plan.width * fx, clientY: plan.top + plan.height * fy, bubbles: true, pointerId: 32,
        }));
      }
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
