/**
 * Les langues : les dictionnaires, ce que les sources en font, et
 * l'application qui change de langue sans rien changer au projet.
 *
 * The dictionaries are checked against the sources rather than against a
 * list kept by hand: every key must be used somewhere and every key used must
 * exist — a missing one is caught here, not by a user who sees the key.
 */

import { check, checkAsync } from './harness.js';
import { app } from './app-frame.js';
import {
  DICTIONARIES, LANGUAGES, DEFAULT_LANGUAGE, detectLanguage, t, setLanguage, language,
  formatNumber, formatCount,
} from '../src/i18n/index.js';
import { parseDecimal, formatDecimal } from '../src/ui/numeric.js';
import { normalise } from '../src/core/model.js';
import { blankModel, withLocalNames } from '../src/ui/naming.js';
import { presetModel } from '../src/ui/gallery.js';
import { PRESETS } from '../src/data/presets.js';
import { fixtureHouse, FIXTURE_ITEMS } from './reliability.test.js';

/** The test house, with a window on a wall the default camera sees. */
const withWindow = () => normalise({ ...fixtureHouse(), openings: [{ ...FIXTURE_ITEMS.opening[0], id: 'w1' }] });

/* ---------------- reading the sources ---------------- */

/**
 * The string and template literals of a script, comments left out. Templates
 * come back with each `${…}` as `\u0000`, their expressions read in turn.
 * A small lexer rather than a pattern: a quote inside a comment, a regular
 * expression or another kind of string would derail one.
 */
export function literals(src) {
  const out = [];
  let i = 0, prev = '';
  const regexMayFollow = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of)$/.test(prev);
  function template() {
    let text = '';
    i++; // past the backtick
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { text += src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        const start = i;
        while (i < src.length && depth) {
          const c = src[i];
          if (c === '`') { template(); continue; }
          if (c === '\'' || c === '"') { string(c); continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          i++;
        }
        out.push(...literals(src.slice(start, i - 1)).map((l) => ({ ...l, nested: true })));
        text += '\u0000';
        continue;
      }
      text += src[i++];
    }
    i++;
    out.push({ text, template: true });
  }
  function string(q) {
    let text = '';
    i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') { text += src[i + 1] === 'u' ? String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)) : src[i + 1]; i += src[i + 1] === 'u' ? 6 : 2; continue; }
      text += src[i++];
    }
    i++;
    out.push({ text, template: false });
  }
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
    if (c === '\'' || c === '"') { string(c); prev = 'x'; continue; }
    if (c === '`') { template(); prev = 'x'; continue; }
    if (c === '/' && regexMayFollow()) {
      i++;
      let inClass = false;
      while (i < src.length && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] || '')) i++;
      prev = 'x';
      continue;
    }
    if (!/\s/.test(c)) {
      if (/[\w$]/.test(c)) {
        let w = '';
        while (i < src.length && /[\w$]/.test(src[i])) w += src[i++];
        prev = w;
        continue;
      }
      prev = c;
    }
    i++;
  }
  return out;
}

/** Every module the application loads, from main.js along its relative imports, with its text. */
async function appSources() {
  const files = new Map();
  const re = /(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]*\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;
  const visit = async (url) => {
    if (files.has(url)) return;
    const text = await (await fetch(url, { cache: 'no-store' })).text();
    files.set(url, text);
    const next = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) next.push(new URL(m[1], url).href);
    await Promise.all(next.map(visit));
  };
  await visit(new URL('../src/main.js', location.href).href);
  return files;
}

const rel = (url) => url.split('/src/')[1] ? `src/${url.split('/src/')[1]}` : url;
const isDictionary = (url) => /\/src\/i18n\/[a-z]+\.js$/.test(url);

/** A template literal turned into the keys it can name: `tool.${id}` → /^tool\.[^.]+$/. */
const keyPattern = (text) => new RegExp(`^${text.split('\u0000').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\w.-]+')}$`);

/* ---------------- the dictionaries ---------------- */

const placeholders = (v) => [...new Set((typeof v === 'string' ? [v] : Object.values(v))
  .flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join();

check('les dictionnaires ont exactement les mêmes clés, de même forme', () => {
  const ref = DICTIONARIES[DEFAULT_LANGUAGE];
  const out = [];
  for (const [lang, dict] of Object.entries(DICTIONARIES)) {
    const missing = Object.keys(ref).filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !(k in ref));
    if (missing.length) out.push(`${lang} sans ${missing.slice(0, 5).join(', ')}`);
    if (extra.length) out.push(`${lang} en trop : ${extra.slice(0, 5).join(', ')}`);
    for (const [k, v] of Object.entries(dict)) {
      if (!(k in ref)) continue;
      if (typeof v !== typeof ref[k]) out.push(`${lang} ${k} : forme différente`);
      else if (typeof v === 'object' && !('other' in v)) out.push(`${lang} ${k} : pas de forme « other »`);
      else if (!v || (typeof v === 'string' && !v.trim())) out.push(`${lang} ${k} : vide`);
      // {n} may be left out of a singular (« une autre ouverture »): compare
      // the placeholders over all the forms together.
      else if (placeholders(v) !== placeholders(ref[k])) out.push(`${lang} ${k} : paramètres {${placeholders(v)}} au lieu de {${placeholders(ref[k])}}`);
    }
  }
  if (LANGUAGES.map((l) => l.id).sort().join() !== Object.keys(DICTIONARIES).sort().join()) out.push('langues et dictionnaires ne correspondent pas');
  return !out.length || out.slice(0, 8).join(' ; ');
});

check('les plurielles suivent la langue : 0 et 1 au singulier en français, 1 seul en anglais', () => {
  const was = language();
  const said = {};
  for (const lang of ['fr', 'en']) {
    setLanguage(lang, { remember: false });
    said[lang] = [0, 1, 2].map((n) => t('insp.viewsCount', { n }));
  }
  setLanguage(was, { remember: false });
  const want = { fr: ['0 vue', '1 vue', '2 vues'], en: ['0 views', '1 view', '2 views'] };
  return JSON.stringify(said) === JSON.stringify(want) || JSON.stringify(said);
});

check('les nombres suivent la langue : virgule en français, point en anglais, jamais « -0 »', () => {
  const was = language();
  const said = {};
  for (const lang of ['fr', 'en']) {
    setLanguage(lang, { remember: false });
    said[lang] = [formatNumber(3.4), formatNumber(-0.001, 2), formatDecimal(12.5, 2), t('plan.metres', { v: 2.75 }), formatCount(3000)];
  }
  setLanguage(was, { remember: false });
  const ok = said.fr.slice(0, 4).join('|') === '3,4|0,00|12,50|2,75 m'
    && said.en.slice(0, 4).join('|') === '3.4|0.00|12.50|2.75 m'
    && /^3\D000$/.test(said.fr[4]) && said.en[4] === '3,000';
  return ok || JSON.stringify(said);
});

check('la saisie lit la virgule comme le point, dans les deux langues', () => {
  const was = language();
  const bad = [];
  for (const lang of ['fr', 'en']) {
    setLanguage(lang, { remember: false });
    for (const [typed, want] of [['3,40', 3.4], ['3.40', 3.4], ['3,4 m', 3.4], [' -0.5', -0.5], ['abc', NaN]]) {
      const got = parseDecimal(typed);
      if (!(Object.is(got, want) || got === want)) bad.push(`${lang} « ${typed} » → ${got}`);
    }
  }
  setLanguage(was, { remember: false });
  return !bad.length || bad.join(', ');
});

check('la langue de départ : celle choisie, sinon celle du navigateur, sinon le français', () => {
  const cases = [
    [['en', ['fr-FR']], 'en'],
    [[null, ['en-US', 'fr']], 'en'],
    [[null, ['de-DE', 'fr-CA']], 'fr'],
    [[null, ['de', 'es']], 'fr'],
    [['xx', ['EN_gb']], 'en'],
    [[null, []], 'fr'],
    [[null, undefined], 'fr'],
  ];
  const bad = cases.filter(([args, want]) => detectLanguage(...args) !== want);
  return !bad.length || bad.map(([a]) => JSON.stringify(a)).join(' ; ');
});

check('une clé absente rend le français, puis la clé, et ne lève pas', () => {
  const was = language();
  setLanguage('en', { remember: false });
  const en = DICTIONARIES.en;
  const saved = en['dialog.close'];
  const err = console.error;
  const said = [];
  console.error = (m) => said.push(m);
  try {
    delete en['dialog.close'];
    const fallback = t('dialog.close');
    const unknown = t('nulle.part');
    return (fallback === DICTIONARIES.fr['dialog.close'] && unknown === 'nulle.part' && said.length === 2)
      || `${fallback} / ${unknown} / ${said.length} signalement(s)`;
  } finally {
    en['dialog.close'] = saved;
    console.error = err;
    setLanguage(was, { remember: false });
  }
});

/* ---------------- the dictionaries against the sources ---------------- */

const sources = await appSources();
const html = await (await fetch('../index.html', { cache: 'no-store' })).text();

await checkAsync('aucune clé utilisée n’est absente des dictionnaires, aucune clé n’est inutilisée', async () => {
  const keys = new Set(Object.keys(DICTIONARIES[DEFAULT_LANGUAGE]));
  const used = new Set();
  const patterns = [];
  const missing = [];
  for (const [url, text] of sources) {
    if (isDictionary(url)) continue;
    const found = literals(text);
    const plain = found.filter((l) => !l.template).map((l) => l.text);
    for (const l of found) {
      if (!l.template && keys.has(l.text)) used.add(l.text);
      // A key built from parts: `tool.${id}`, `layout.${id}Title`.
      if (l.template && /^[a-zA-Z]+\.[^\s/<#]*\u0000[^\s/<#]*$/.test(l.text)) patterns.push({ re: keyPattern(l.text), text: l.text, url });
      // Or from a prefix handed over as a word: options(ids, 'roof') makes
      // `${prefix}.${id}` — the module's own words are the prefixes.
      if (l.template && l.text === '\u0000.\u0000') {
        for (const k of keys) if (plain.includes(k.slice(0, k.lastIndexOf('.')))) used.add(k);
      }
    }
    // A key spelt out in a call must exist.
    for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) if (!keys.has(m[1])) missing.push(`${m[1]} (${rel(url)})`);
  }
  for (const m of html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) {
    if (keys.has(m[1])) used.add(m[1]); else missing.push(`${m[1]} (index.html)`);
  }
  // …and must name at least one.
  const empty = patterns.filter((p) => ![...keys].some((k) => p.re.test(k)));
  for (const k of keys) if (!used.has(k) && patterns.some((p) => p.re.test(k))) used.add(k);
  const unused = [...keys].filter((k) => !used.has(k));
  if (missing.length) return `clés absentes : ${missing.slice(0, 8).join(', ')}`;
  if (empty.length) return `motifs sans clé : ${empty.slice(0, 5).map((p) => `${p.text.replace(/\u0000/g, '${…}')} (${rel(p.url)})`).join(', ')}`;
  return !unused.length || `clés inutilisées : ${unused.slice(0, 12).join(', ')}`;
});

/*
 * French written straight into the interface's code. Accented letters, French
 * quotes and apostrophes, or a French word between two others give it away;
 * an identifier never has a space, a class list has no such word.
 */
const FRENCH = /[À-ÿŒœ’«»]|(^|[\s'’])(le|la|les|des|du|une|un|pour|dans|sur|avec|aux|au|est|pas|plus|cette|vers|depuis|ou|et|de|ce|ne|en)\s+[a-zà-ÿ]/i;
/*
 * The inspector's sections are remembered open or closed under their French
 * titles of before, in the settings of every returning visitor: kept as
 * identifiers, never shown.
 */
const LEGACY_IDS = new Set(['Tous les corps', 'Couleurs et matières', 'Cadrage de l’export']);

await checkAsync('plus aucune chaîne française en dur dans src/ui/ ni dans src/main.js', async () => {
  const found = [];
  for (const [url, text] of sources) {
    if (!/\/src\/(ui\/[^/]+|main)\.js$/.test(url)) continue;
    for (const l of literals(text)) {
      if (LEGACY_IDS.has(l.text)) continue;
      const shown = l.text.replace(/\u0000/g, ' ');
      if (FRENCH.test(shown)) found.push(`${rel(url)} : « ${shown.slice(0, 50)} »`);
    }
  }
  return !found.length || found.slice(0, 8).join(' ; ');
});

check('le détecteur de chaînes françaises en trouve bien : il échouerait sans la traduction', () => {
  const sample = "const a = 'Supprimer ce corps'; // la note\nconst b = `Case déjà occupée par « ${n} »`; const c = 'nav-btn plan-fit'; const r = /'/;";
  const hits = literals(sample).filter((l) => FRENCH.test(l.text.replace(/\u0000/g, ' '))).map((l) => l.text);
  return (hits.length === 2 && !hits.some((h) => /la note|nav-btn/.test(h))) || JSON.stringify(hits);
});

/* ---------------- names: data, not interface ---------------- */

check('un fichier s’ouvre à l’identique dans les deux langues', () => {
  const was = language();
  const raw = JSON.parse(JSON.stringify({ ...fixtureHouse(), buildings: [{ cells: ['0,0', '1,0'] }, { cells: ['5,5'] }], views: [{ camera: {} }] }));
  const opened = {};
  for (const lang of ['fr', 'en']) {
    setLanguage(lang, { remember: false });
    opened[lang] = JSON.stringify(normalise(JSON.parse(JSON.stringify(raw))));
  }
  setLanguage(was, { remember: false });
  const strip = (s) => s.replace(/"id":"[^"]*"/g, '');
  return strip(opened.fr) === strip(opened.en) || 'le même fichier diffère selon la langue';
});

check('ce que l’outil crée est nommé dans la langue du moment ; ce qui est nommé le reste', () => {
  const was = language();
  setLanguage('en', { remember: false });
  const blank = blankModel();
  const preset = presetModel(PRESETS[0]);
  const kept = withLocalNames({ name: 'Chez nous', buildings: [{ name: 'Garage' }, { name: 'Corps principal' }, { name: 'Bâtiment 3' }] });
  setLanguage('fr', { remember: false });
  const blankFr = blankModel();
  setLanguage(was, { remember: false });
  const out = [];
  if (blank.name !== 'My house' || blank.buildings[0].name !== 'Main building') out.push(`page blanche : ${blank.name} / ${blank.buildings[0].name}`);
  if (preset.name !== 'Family house' || preset.buildings[0].name !== 'Main building') out.push(`modèle : ${preset.name} / ${preset.buildings[0].name}`);
  if (kept.name !== 'Chez nous' || kept.buildings.map((b) => b.name).join() !== 'Garage,Main building,Building 3') out.push(`noms : ${kept.buildings.map((b) => b.name)}`);
  if (blankFr.name !== 'Ma maison' || blankFr.buildings[0].name !== 'Corps principal') out.push('page blanche en français changée');
  return !out.length || out.join(' ; ');
});

/* ---------------- the running application ---------------- */

/** Switch the running application's language, as its selector does. */
export async function switchApp(lang) {
  const frame = await app();
  const doc = frame.contentDocument, win = frame.contentWindow;
  const pick = doc.getElementById('lang-select');
  pick.value = lang;
  pick.dispatchEvent(new win.Event('change', { bubbles: true }));
  win.__app.render();
  return frame;
}

await checkAsync('dans l’application, changer de langue réécrit la page sur place sans toucher au projet', async () => {
  const frame = await app();
  const doc = frame.contentDocument, win = frame.contentWindow;
  const { store } = win.__app;
  store.reset({ ...withWindow(), views: [{ id: 'v1', name: 'Entrée', camera: { yaw: 37 }, focus: { enabled: true, x: 0, y: 0, w: 4, d: 4 } }] });
  store.select({ type: 'opening', id: store.model.openings[0]?.id });
  const before = JSON.stringify(store.model);
  const history = store.past.length;
  const mark = doc.getElementById('views');
  const out = [];
  try {
    await switchApp('en');
    if (doc.documentElement.lang !== 'en') out.push(`lang=${doc.documentElement.lang}`);
    if (!/model your house/.test(doc.title)) out.push(`titre : ${doc.title}`);
    if (!/home-automation/.test(doc.querySelector('meta[name="description"]').content)) out.push('description non traduite');
    if (doc.querySelector('#btn-export .btn-label').textContent !== 'Export') out.push('bouton Exporter non traduit');
    if (doc.querySelector('.tool[data-tool="muret"] .tool-label').textContent !== 'Garden wall') out.push('outil non traduit');
    if (!/^Window/.test(doc.querySelector('.panel-block .panel-title')?.textContent || '')) out.push('sélection non traduite');
    if (!doc.querySelector('.app-link').href.endsWith('guide.en.html')) out.push('lien du guide non traduit');
    if (!doc.querySelector('#inspector').textContent.includes('Entrée')) out.push('le nom de la vue a été traduit');
    if (doc.getElementById('views') !== mark) out.push('la page a été reconstruite');
    if (localStorage.getItem('isometric-house-builder/ui')?.includes('"lang":"en"') !== true) out.push('choix non retenu');
    if (JSON.stringify(store.model) !== before || store.past.length !== history) out.push('le projet ou son historique a changé');
    if (store.selection?.type !== 'opening') out.push('la sélection est perdue');
  } finally {
    await switchApp('fr');
  }
  if (doc.documentElement.lang !== 'fr' || doc.querySelector('#btn-export .btn-label').textContent !== 'Exporter') out.push('retour au français incomplet');
  if (JSON.stringify(store.model) !== before) out.push('le projet a changé au retour');
  return !out.length || out.join(' ; ');
});

await checkAsync('dans l’application en anglais, les cotes, la rose et les champs écrivent le point', async () => {
  const frame = await switchApp('en');
  const doc = frame.contentDocument, win = frame.contentWindow;
  const { store } = win.__app;
  const out = [];
  try {
    store.reset(withWindow());
    store.setCamera({ yaw: 0 });
    store.select({ type: 'opening', id: store.model.openings[0].id });
    win.__app.render();
    const dims = [...doc.querySelectorAll('#plan .plan-svg text')].map((n) => n.textContent).join(' | ');
    if (/\d,\d/.test(dims)) out.push(`cote à virgule : ${dims.slice(0, 80)}`);
    if (!/from the corner/.test(dims)) out.push('distance à l’angle non traduite');
    if (doc.getElementById('rot-label').textContent !== 'North-east') out.push(`rose : ${doc.getElementById('rot-label').textContent}`);
    const num = doc.querySelector('#inspector .panel-block input.num');
    if (!/^\d+\.\d+$/.test(num.value)) out.push(`champ : ${num.value}`);
    num.value = '1,5';
    num.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.__app.render();
    const again = doc.querySelector('#inspector .panel-block input.num');
    if (again.value !== '1.50') out.push(`virgule tapée relue « ${again.value} »`);
  } finally {
    await switchApp('fr');
  }
  return !out.length || out.join(' ; ');
});
