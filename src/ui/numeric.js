/**
 * Numbers typed by hand, the French way or not.
 *
 * Someone copying out their own house types « 3,40 » — a comma, as on their
 * plans — or « 3.40 », or « 3,4 m ». All of them mean 3.4, in either
 * language, and the field says it back the language's way: 3,40 in French,
 * 3.40 in English. What cannot be read is refused rather than guessed: a field
 * emptied by mistake used to come through as 0, a zone zero metres wide.
 */

import { formatNumber } from '../i18n/index.js';

/** The number in a typed text, or NaN. Units and spaces are let through. */
export function parseDecimal(text) {
  const t = String(text ?? '').trim()
    .replace(/[\s  ]/g, '')
    .replace(/(m|°|deg|px)$/i, '')
    .replace(',', '.');
  if (!/^[-+−]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t.replace('−', '-'));
}

/** Decimals worth showing for a step: none for whole steps, else to the centimetre. */
export const digitsFor = (step) => (step >= 1 ? 0 : step >= 0.1 && Math.abs(step * 10 - Math.round(step * 10)) < 1e-9 ? 1 : 2);

/** A value as the field shows it: the language's decimal mark, a fixed number of decimals. */
export function formatDecimal(v, digits) {
  return formatNumber(v, digits);
}

/**
 * A typed value brought within bounds and onto the grid the model accepts:
 * `exact` is the finest step it keeps — a centimetre for a length, a whole
 * number for a count of storeys, the roof's own step for an overhang. The
 * grid starts at `min`, as a slider's does.
 */
export function settle(v, { min, max, exact }) {
  if (!Number.isFinite(v)) return NaN;
  let out = Math.max(min, Math.min(max, v));
  if (exact > 0) {
    out = min + Math.round((out - min) / exact) * exact;
    if (out > max + 1e-9) out -= exact;
    // Rid the float of its tail: 0.1 * 3 is not 0.3.
    out = Math.round(out * 1e6) / 1e6;
  }
  return out;
}
