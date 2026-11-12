/**
 * Line icons, inline SVG on a 20-pixel grid.
 *
 * Inline rather than a font or a sprite sheet: nothing more to load, and the
 * stroke is `currentColor`, so every icon follows the light and dark themes —
 * and the pressed state of its button — for free. One stroke width for all,
 * set in the style sheet, so they read as one family.
 */

const P = {
  // Tools
  select: 'M5.5 3.2v12.3l3.2-3 2.3 5 2.1-.9-2.3-5h4.4z',
  paint: 'M15.8 3.2 17 4.4l-7.1 7.4-1.6-1.6zM8.1 11.9c-2.3-.4-3.6 1-3.6 3.1 0 .8-.4 1.4-1.2 1.8 2.6.9 5.9.2 6.1-3z',
  rect: 'M3.5 7.5h9v9h-9zM15.5 2.5v6M12.5 5.5h6',
  erase: 'M3.5 13.2 10.7 6l5.6 5.6-4.9 4.9H6.8zM7.7 9l5.6 5.6M9 16.5h8',
  window: 'M5 3.5h10v13H5zM10 3.5v13M5 10h10',
  shutter: 'M7.5 4h5v12h-5zM10 4v12M3 4h3v12H3zM14 4h3v12h-3zM3 8h3M3 12h3M14 8h3M14 12h3',
  door: 'M6 17V3.5h8V17M3.5 17h13M11.5 10.5v.5',
  garage: 'M3 17V8l7-4.5L17 8v9M6 17v-6.5h8V17M6 13h8M6 15h8',
  solar: 'M2.8 14.5 5.5 6h11.7l-2.7 8.5zM4.1 10.2h11.7M11.4 6l-2.7 8.5M8.5 14.5v2.5M6 17h5',
  chimney: 'M2.5 13 10 6.5l7.5 6.5M12.5 8.7V3.5h2.6v7.4M4.5 11.3V17h11v-6',
  velux: 'M2.5 16 10 4l7.5 12zM8 10.5h4v3.5H8zM10 10.5V14',
  dish: 'M5.4 5.4a6.5 6.5 0 0 0 9.2 9.2zM10 10l3.2-3.2M13.5 6.5h.5M8 15l-1.5 2.5h5L10 15',
  pool: 'M3 4.5h14v11H3zM5.5 9c1.5 1.1 3 1.1 4.5 0s3-1.1 4.5 0M5.5 12.2c1.5 1.1 3 1.1 4.5 0s3-1.1 4.5 0',
  terrace: 'M2.5 12 10 8l7.5 4-7.5 4zM6.3 10l7.5 4M13.8 10l-7.5 4',
  path: 'M6.5 17.5c0-3.5 4.5-4.2 4.5-7.4 0-2.1-1.4-3.3-1.9-6.6M11 17.5c0-2.8 4.5-3.6 4.5-7.1 0-2.6-1.6-4.3-1.8-6.9M4.5 9h2M12.7 12.5h2',
  stairs: 'M2.5 16.5h4v-3.5h3.5V9.5h3.5V6h4',
  tree: 'M10 2.8a4.8 4.8 0 0 1 4.8 4.8c0 2.7-2.2 4.8-4.8 4.8S5.2 10.3 5.2 7.6A4.8 4.8 0 0 1 10 2.8zM10 12.4v5M7 17.4h6',
  bush: 'M3.5 15c-1.2-2.8 1-5.6 3.8-4.7.5-3.1 5-3.7 6.1-.3 2.5-.6 4.4 1.9 3.1 5zM2.5 15.5h15',
  hedge: 'M2.5 15V9.6c0-1.9 1.9-3 3.4-2 .8-1.9 3.3-1.9 4.1 0 .8-1.9 3.3-1.9 4.1 0 1.5-1 3.4.1 3.4 2V15zM2 15.5h16',
  fence: 'M4.5 17V6.7L5.8 4.5l1.2 2.2V17M8.8 17V6.7L10 4.5l1.3 2.2V17M13 17V6.7l1.2-2.2 1.3 2.2V17M2.5 9h15M2.5 13.5h15',
  muret: 'M2.5 8h15v8.5h-15zM2.5 12.2h15M7 8v4.2M13 8v4.2M10 12.2v4.3M4.5 12.2v4.3M15.5 12.2v4.3',
  gate: 'M3 17.5v-13M17 17.5v-13M5.5 7h9v9.5h-9zM8.5 7v9.5M11.5 7v9.5',
  car: 'M3 13.5V11l2.2-4.3h9.6L17 11v2.5M3 11h14M6.8 14.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM16.2 14.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6.8 13.5h6.4',
  wallLight: 'M3.5 3.5v13M3.5 8h2.8l3-2.2v8.4l-3-2.2H3.5M12.5 7.5l2.6-1.2M12.8 10h3.2M12.5 12.5l2.6 1.2',
  camera: 'M3 3.5v13M3 9.5h2.5M5.5 7h8.3l2.7 2.5-2.7 2.5H5.5zM9 12v2.5',
  charger: 'M5 3.5h7.5v13H5zM7 6.5h3.5M8.9 9 7.8 11.2h2.4L9 13.5M12.5 11h1.8a1.7 1.7 0 0 1 1.7 1.7v1.6a1.2 1.2 0 0 0 2.4 0V8',
  lamppost: 'M10 17V7.5M7.5 17h5M7 7.5h6l-1.2-3.5H8.2zM10 4V2.5',
  heatpump: 'M2.5 5h15v10h-15zM10.5 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM13.5 7.5v5M15.5 7.5v5M7.5 7v6M4.5 10h6',
  mailbox: 'M3.5 8.5a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3V12h-13zM9.5 12V8.5a3 3 0 0 0-3-3M8 12v5.5M12.5 5.5V3h2.5',
  carport: 'M2 6.5 10 4l8 2.5M3.5 6v11M16.5 6v11M5.5 15V13l1.2-2.2h6.6l1.2 2.2v2zM5.5 15h9',
  frame: 'M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7.5 8h5v4h-5z',
  // Application bar
  undo: 'M7.5 5 4 8.5 7.5 12M4 8.5h8.5a4 4 0 0 1 0 8H9',
  redo: 'M12.5 5 16 8.5 12.5 12M16 8.5H7.5a4 4 0 0 0 0 8H11',
  gallery: 'M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z',
  new: 'M5 2.5h6.5L15 6v11.5H5zM11 2.5v4h4M10 9.5v5M7.5 12h5',
  open: 'M2.5 15.5V4.5h5l1.5 1.7h8.5v9.3zM2.5 8.5h15',
  save: 'M4 3.5h9.8l2.7 2.7v10.3H4zM7 3.5v4h6v-4M7 16.5v-5h6v5',
  share: 'M8.5 11.5l3-3M7.2 9.3 5.8 10.7a2.6 2.6 0 0 0 3.6 3.6l1.4-1.4M12.8 10.7l1.4-1.4a2.6 2.6 0 0 0-3.6-3.6L9.2 7.1',
  export: 'M10 3v9.5M6.3 8.8 10 12.5l3.7-3.7M3.5 13.5v3h13v-3',
  keyboard: 'M2.5 5.5h15v9h-15zM5.5 8.5h1M8.5 8.5h1M11.5 8.5h1M14.5 8.5h.5M6 11.5h8',
  guide: 'M3.5 4.5c2.3-1 4.5-.8 6.5.6 2-1.4 4.2-1.6 6.5-.6v11c-2.3-1-4.5-.8-6.5.6-2-1.4-4.2-1.6-6.5-.6zM10 5.1v11',
  more: 'M4.5 10h.5M9.8 10h.5M15 10h.5',
  close: 'M5 5l10 10M15 5 5 15',
  rename: 'M4 16l.8-3.2 8.4-8.4 2.4 2.4-8.4 8.4zM11.6 6.2 14 8.6',
  refresh: 'M15.5 8a6 6 0 0 0-10.9-1.5M4.5 3.5v3h3M4.5 12a6 6 0 0 0 10.9 1.5M15.5 16.5v-3h-3',
  trash: 'M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6',
  // Layouts and phone screens
  viewPlan: 'M3 3.5h14v13H3zM3 10h7M10 3.5v8.5M13.5 10v6.5',
  viewBoth: 'M2.5 4h15v12h-15zM8.5 4v12',
  viewRender: 'M10 2.5l6.5 3.8v7.4L10 17.5l-6.5-3.8V6.3zM10 10l6.5-3.7M10 10v7.5M10 10 3.5 6.3',
  settings: 'M3.5 6h13M3.5 14h13M7.5 3.8v4.4M12.5 11.8v4.4',
};

/** An icon as markup, hidden from assistive technology: its button carries the name. */
export function icon(name, cls = '') {
  const d = P[name];
  if (!d) return '';
  return `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

export const ICON_NAMES = Object.keys(P);
