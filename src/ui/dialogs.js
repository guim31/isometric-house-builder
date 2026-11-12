/**
 * Questions put to the user, in the page's own dialogs.
 *
 * `confirm()` and `prompt()` stop the whole page, cannot be styled, follow no
 * theme, and some browsers let a page silence them for good — after which
 * « Nouveau » did nothing at all. A `<dialog>` is modal too, answers to the
 * keyboard (Entrée confirms, Échap cancels, Tab stays inside) and to the
 * pointer, and reads as part of the tool.
 */

import { T } from './texts.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Build a dialog, show it, and resolve with what it was closed with. Each
 * question gets a fresh element, removed once answered: two questions never
 * share state, and a test can find the one open.
 */
function open({ title, body, fields = [], confirm, cancel = T.cancel, danger = false, className = '' }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', `dialog dialog-ask ${className}`.trim());
    dlg.setAttribute('aria-labelledby', 'ask-title');
    const form = h('form');
    form.method = 'dialog';
    const head = h('h2', null, title);
    head.id = 'ask-title';
    form.appendChild(head);
    if (body) {
      dlg.setAttribute('aria-describedby', 'ask-body');
      const p = h('p', 'dialog-lead', body);
      p.id = 'ask-body';
      form.appendChild(p);
    }
    for (const f of fields) form.appendChild(f);
    const actions = h('div', 'dialog-buttons');
    const no = h('button', null, cancel);
    no.type = 'button';
    no.value = 'cancel';
    no.addEventListener('click', () => dlg.close('cancel'));
    const yes = h('button', danger ? 'primary danger-primary' : 'primary', confirm);
    yes.type = 'submit';
    yes.value = 'ok';
    if (cancel) actions.appendChild(no);
    actions.appendChild(yes);
    form.appendChild(actions);
    dlg.appendChild(form);
    // Submitting by Entrée in a field gives no submitter value: say it here.
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      dlg.close('ok');
    });
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    }, { once: true });
    document.body.appendChild(dlg);
    dlg.showModal();
    // The field when there is one, otherwise the safe answer: an Entrée
    // pressed out of habit must not erase a project.
    (fields.length ? dlg.querySelector('input') : (danger ? no : yes))?.focus();
  });
}

/** A yes-or-no question. Resolves with `true` only for the confirming button. */
export function ask(options) {
  return open(options);
}

/**
 * A short text to type: a name. Resolves with the text, trimmed, or null when
 * cancelled or left empty.
 */
export async function askText({ title, label, value = '', confirm, body = null, maxLength = 80 }) {
  const row = h('label', 'field');
  row.appendChild(h('span', 'field-label', label));
  const input = h('input');
  input.type = 'text';
  input.value = value;
  input.maxLength = maxLength;
  input.spellcheck = false;
  input.autocomplete = 'off';
  row.appendChild(input);
  // Selected, so typing replaces the suggestion and Entrée keeps it.
  queueMicrotask(() => input.select());
  const ok = await open({ title, body, fields: [row], confirm });
  const text = input.value.trim();
  return ok && text ? text : null;
}

/**
 * Something to copy by hand — a share link where the clipboard is out of
 * reach. The text is selected and the dialog has only a closing button.
 */
export function showText({ title, body, text }) {
  const input = h('input', 'copy-field');
  input.type = 'text';
  input.readOnly = true;
  input.value = text;
  input.setAttribute('aria-label', title);
  queueMicrotask(() => input.select());
  return open({ title, body, fields: [input], confirm: T.close, cancel: null });
}
