/**
 * The interface's languages: one dictionary each, and `t` to read them.
 *
 * No library and no build step. A dictionary is a flat object of keys and
 * texts (`fr.js`, `en.js`); French is the reference, the one every key is
 * written in first and the one a missing key falls back on. A text may hold
 * `{name}` placeholders, filled from the parameters — numbers written the
 * way the language writes them — and a text that depends on a count is an
 * object of plural forms (`one`, `other`…), chosen by `Intl.PluralRules`
 * from the parameter `n`.
 *
 * Only the interface is translated. A project keeps the names it was given,
 * and the format of its file does not depend on the language it was made in.
 */

import fr from './fr.js';
import en from './en.js';
import { prefs, setPrefs } from '../ui/prefs.js';

export const DICTIONARIES = { fr, en };

/** The languages offered, in the order the selector lists them. */
export const LANGUAGES = [
  { id: 'fr', name: 'Français', locale: 'fr-FR', decimal: ',' },
  { id: 'en', name: 'English', locale: 'en-GB', decimal: '.' },
];

export const DEFAULT_LANGUAGE = 'fr';

const known = (id) => Object.prototype.hasOwnProperty.call(DICTIONARIES, id);

/**
 * The language to start in: the one chosen before, else the first of the
 * browser's that the tool speaks, else French. `fr-CA` and `en-US` count as
 * French and English: the dictionaries are per language, not per country.
 */
export function detectLanguage(stored, browser = []) {
  if (stored && known(stored)) return stored;
  for (const tag of browser || []) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (known(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

let current = null;
const listeners = new Set();

const browserLanguages = () => {
  try {
    return navigator.languages?.length ? navigator.languages : [navigator.language];
  } catch {
    return [];
  }
};

/** The language in use. Resolved at the first call, then kept until changed. */
export function language() {
  if (!current) current = detectLanguage(prefs().lang, browserLanguages());
  return current;
}

/** The BCP 47 locale `Intl` is given for the language in use. */
const entry = () => LANGUAGES.find((l) => l.id === language()) || LANGUAGES[0];

export function locale() {
  return entry().locale;
}

/**
 * Change the language. Kept in the interface's settings unless `remember`
 * is false (the test bench), and told to whoever listens: the page redraws
 * its words in place, nothing is reloaded and the project is not touched.
 */
export function setLanguage(id, { remember = true } = {}) {
  if (!known(id)) return false;
  const changed = id !== language();
  current = id;
  if (remember && prefs().lang !== id) setPrefs({ lang: id });
  if (changed) for (const fn of listeners) fn(id);
  return changed;
}

/** Forget the language in use, so the next call resolves it again. For tests. */
export function resetLanguage() {
  current = null;
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/*
 * Keys asked for and found nowhere. Reported once each on the console, which
 * the test runner treats as a failure: a missing key is seen in the tests,
 * not by a user — who gets the French text, or at worst the key itself.
 */
export const missingKeys = new Set();

function report(key, lang) {
  const id = `${lang}:${key}`;
  if (missingKeys.has(id)) return;
  missingKeys.add(id);
  console.error(`i18n: missing key « ${key} » (${lang})`);
}

const pluralRules = {};
function pluralForm(n) {
  const loc = locale();
  pluralRules[loc] ||= new Intl.PluralRules(loc);
  return pluralRules[loc].select(Number(n) || 0);
}

/** The decimal mark of the language in use: a comma in French, a point in English. */
export function decimalMark() {
  return entry().decimal;
}

/**
 * A number as the interface shows it: to `digits` decimals when given, else
 * as it is up to the centimetre, with the language's decimal mark. Never
 * grouped by thousands: these are dimensions and pixels, read next to a field
 * that would not accept the separator back.
 */
export function formatNumber(v, digits = null) {
  if (!Number.isFinite(v)) return '';
  const text = digits == null ? String(Math.round(v * 100) / 100) : v.toFixed(digits);
  // No « -0 » for a value that rounds to nothing.
  return text.replace(/^-(0\.?0*)$/, '$1').replace('.', decimalMark());
}

/** A large count, grouped by thousands the language's way: 12 000, 12,000. */
export function formatCount(n) {
  return Number(n).toLocaleString(locale());
}

/** Metres to the centimetre, as the plan's dimensions and the inspector read them. */
export const metres = (v) => formatNumber(v);

const fill = (text, params) => text.replace(/\{(\w+)\}/g, (whole, name) => {
  if (!(name in params)) return whole;
  const v = params[name];
  return typeof v === 'number' ? formatNumber(v) : String(v);
});

/**
 * The text of a key in the language in use, its placeholders filled.
 * `params.n`, when the text has plural forms, picks the form.
 */
export function t(key, params = {}) {
  const lang = language();
  let v = DICTIONARIES[lang][key];
  if (v === undefined) {
    report(key, lang);
    v = DICTIONARIES[DEFAULT_LANGUAGE][key];
    if (v === undefined) return key;
  }
  if (v && typeof v === 'object') v = v[pluralForm(params.n)] ?? v.other;
  return fill(v, params);
}

/** Whether a key exists in the reference dictionary — for optional texts. */
export const hasKey = (key) => known(DEFAULT_LANGUAGE) && key in DICTIONARIES[DEFAULT_LANGUAGE];
