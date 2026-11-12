/**
 * The starter gallery: what a first-time visitor sees instead of an empty grid.
 *
 * Thumbnails are rendered from the presets themselves rather than shipped as
 * images, so they can never drift from what picking one actually gives you.
 */

import { PRESETS } from '../data/presets.js';
import { renderScene } from '../render/svg.js';
import { normalise } from '../core/model.js';
import { t } from '../i18n/index.js';
import { withLocalNames, blankModel } from './naming.js';

/** A starter house, named in the language of the moment. */
export function presetModel(preset) {
  return withLocalNames(normalise({ ...preset.model, name: preset.name }), t(`preset.${preset.id}`));
}

export class Gallery {
  constructor(dialog, onPick) {
    this.dialog = dialog;
    this.onPick = onPick;
    this.grid = dialog.querySelector('.gallery-grid');
    this.thumbs = null;
  }

  /**
   * The cards, in the language of the moment. The thumbnails are drawn once:
   * a change of language rewrites the words, not the houses.
   */
  build() {
    if (!this.thumbs) {
      this.thumbs = PRESETS.map((preset) => renderScene(
        normalise({ ...preset.model, name: preset.name }), { width: 260, height: 176 },
      ).svg);
    }
    this.grid.replaceChildren();
    PRESETS.forEach((preset, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'gallery-card';
      card.dataset.preset = preset.id;
      card.innerHTML = `<span class="gallery-thumb">${this.thumbs[i]}</span>`
        + '<span class="gallery-name"></span><span class="gallery-note"></span>';
      card.querySelector('.gallery-name').textContent = t(`preset.${preset.id}`);
      card.querySelector('.gallery-note').textContent = t(`preset.${preset.id}.note`);
      card.addEventListener('click', () => {
        this.onPick(presetModel(preset));
        this.dialog.close();
      });
      this.grid.appendChild(card);
    });

    const blank = document.createElement('button');
    blank.type = 'button';
    blank.className = 'gallery-card gallery-blank';
    blank.innerHTML = '<span class="gallery-thumb gallery-thumb-empty">+</span>'
      + '<span class="gallery-name"></span><span class="gallery-note"></span>';
    blank.querySelector('.gallery-name').textContent = t('gallery.blank');
    blank.querySelector('.gallery-note').textContent = t('gallery.blankNote');
    blank.addEventListener('click', () => {
      this.onPick(normalise(blankModel()));
      this.dialog.close();
    });
    this.grid.appendChild(blank);
  }

  /** The words of the open gallery, again — after a change of language. */
  relabel() {
    if (this.thumbs) this.build();
    const note = this.dialog.querySelector('#gallery-replace');
    if (note) note.textContent = t('gallery.replace');
  }

  /**
   * Show the gallery. `replacing` says that a project is open and would give
   * way to the model picked — said plainly, with the way back.
   */
  open({ replacing = false } = {}) {
    this.build();
    this.replacing = replacing;
    const note = this.dialog.querySelector('#gallery-replace');
    if (note) {
      note.textContent = t('gallery.replace');
      note.hidden = !replacing;
    }
    this.dialog.showModal();
  }
}
