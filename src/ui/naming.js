/**
 * The names a new project starts with, in the language of the moment.
 *
 * A name is data: once given, it stays whatever language the interface is
 * later switched to, and a file opens with the same names everywhere. What
 * is named here is what the tool itself creates — a blank page, a template
 * picked from the gallery, the first visit's house. The engine, which has no
 * language, names an unnamed body in French (`normalise`); a model created
 * from the interface is renamed before anyone sees it.
 */

import { emptyModel } from '../core/model.js';
import { t, DICTIONARIES, DEFAULT_LANGUAGE } from '../i18n/index.js';

const reference = DICTIONARIES[DEFAULT_LANGUAGE];

/** The engine's own name for a body, read back as `{ n }` (1 for the main one), or null. */
function engineName(name) {
  if (name === reference['default.mainBody']) return { n: 1 };
  const [before, after] = reference['default.body'].split('{n}');
  if (name.startsWith(before) && name.endsWith(after)) {
    const n = Number(name.slice(before.length, name.length - after.length));
    if (Number.isInteger(n) && n > 1) return { n };
  }
  return null;
}

/** A body's name as the interface would have given it. */
export const bodyName = (n) => (n > 1 ? t('default.body', { n }) : t('default.mainBody'));

/** The model with its bodies' default names in the language of the moment. */
export function withLocalNames(model, name = model.name) {
  return {
    ...model,
    name,
    buildings: model.buildings.map((b) => {
      const auto = engineName(b.name);
      return auto ? { ...b, name: bodyName(auto.n) } : b;
    }),
  };
}

/** A blank page: an empty grid, a body to paint into. */
export function blankModel() {
  return withLocalNames(emptyModel(), t('default.project'));
}
