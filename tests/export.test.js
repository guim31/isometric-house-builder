/** Export PNG. */

import { checkAsync } from './harness.js';
import { loadBlob } from './helpers.js';
import { defaultModel, normalise } from '../src/core/model.js';
import { svgFor, svgToPng } from '../src/io/export.js';

// The whole export path in one test: model -> SVG -> raster -> PNG blob.
await checkAsync('le SVG se rasterise en PNG à la bonne taille', async () => {
  const m = normalise(defaultModel());
  const size = { width: 320, height: 240, ratio: 2 };
  const blob = await svgToPng(svgFor(m, size), size.width * size.ratio, size.height * size.ratio);
  if (blob.type !== 'image/png') return `type ${blob.type}`;
  if (blob.size < 1000) return `PNG suspect : ${blob.size} octets`;
  const img = await loadBlob(blob);
  return (img.naturalWidth === 640 && img.naturalHeight === 480)
    || `${img.naturalWidth}×${img.naturalHeight}`;
});

await checkAsync('le PNG conserve la transparence du fond', async () => {
  const m = normalise(defaultModel());
  const blob = await svgToPng(svgFor(m, { width: 200, height: 150, ratio: 1 }), 200, 150);
  const img = await loadBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 150;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  // The top-left corner falls outside the ground plane, so it must stay clear.
  const alpha = ctx.getImageData(1, 1, 1, 1).data[3];
  return alpha === 0 || `alpha du coin : ${alpha}`;
});
