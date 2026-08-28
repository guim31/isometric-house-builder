/**
 * The starter gallery: what a first-time visitor sees instead of an empty grid.
 *
 * Thumbnails are rendered from the presets themselves rather than shipped as
 * images, so they can never drift from what picking one actually gives you.
 */

import { PRESETS } from '../data/presets.js';
import { renderScene } from '../render/svg.js';
import { normalise, emptyModel } from '../core/model.js';

export class Gallery {
  constructor(dialog, onPick) {
    this.dialog = dialog;
    this.onPick = onPick;
    this.grid = dialog.querySelector('.gallery-grid');
    this.built = false;
  }

  build() {
    if (this.built) return;
    this.built = true;
    for (const preset of PRESETS) {
      const model = normalise({ ...preset.model, name: preset.name });
      const { svg } = renderScene(model, { width: 260, height: 176 });
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'gallery-card';
      card.innerHTML =
        `<span class="gallery-thumb">${svg}</span>` +
        `<span class="gallery-name">${preset.name}</span>` +
        `<span class="gallery-note">${preset.note}</span>`;
      card.addEventListener('click', () => {
        this.onPick(model);
        this.dialog.close();
      });
      this.grid.appendChild(card);
    }

    const blank = document.createElement('button');
    blank.type = 'button';
    blank.className = 'gallery-card gallery-blank';
    blank.innerHTML =
      '<span class="gallery-thumb gallery-thumb-empty">+</span>' +
      '<span class="gallery-name">Page blanche</span>' +
      '<span class="gallery-note">Partir d’une grille vide et dessiner l’emprise soi-même.</span>';
    blank.addEventListener('click', () => {
      this.onPick(normalise({ ...emptyModel(), name: 'Ma maison' }));
      this.dialog.close();
    });
    this.grid.appendChild(blank);
  }

  open() {
    this.build();
    this.dialog.showModal();
  }
}
