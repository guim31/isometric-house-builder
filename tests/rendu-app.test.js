/** Le rendu dans l'application réelle : ce que coûte une rotation, les gestes au vrai clic. */

import { checkAsync } from './harness.js';
import { app } from './app-frame.js';
import { frames } from './app.test.js';
import { answerDialog } from './helpers.js';

await checkAsync('une rotation ne redessine que le rendu et ce qui montre la caméra', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  win.__app.render();
  const planBefore = doc.querySelector('#plan svg').firstChild;
  const panelBefore = doc.querySelector('#inspector details[data-section="Vue"]');
  if (!panelBefore) return 'section Vue introuvable';
  const isoBefore = doc.querySelector('#iso svg');
  store.setCamera({ yaw: 123, pitch: 40 });
  await frames(win, 2);
  if (doc.querySelector('#plan svg').firstChild !== planBefore) return 'le plan a été redessiné';
  const panel = doc.querySelector('#inspector details[data-section="Vue"]');
  if (panel !== panelBefore) return 'l’inspecteur a été reconstruit';
  if (doc.querySelector('#iso svg') === isoBefore) return 'le rendu n’a pas été redessiné';
  const yaw = panel.querySelector('input[type="range"]');
  if (yaw.value !== '123') return `orientation affichée : ${yaw.value}`;
  if (!/123°/.test(panel.querySelector('.panel-badge').textContent)) return 'résumé de la section non mis à jour';
  if (!/Sud/.test(doc.getElementById('rot-label').textContent)) return `libellé : ${doc.getElementById('rot-label').textContent}`;
  // A change to the model, by contrast, still redraws everything.
  store.update((m) => ({ ...m, name: `${m.name} ` }));
  await frames(win, 2);
  const rebuilt = doc.querySelector('#inspector details[data-section="Vue"]') !== panelBefore;
  store.undo();
  await frames(win, 2);
  return rebuilt || 'une modification du modèle n’a plus reconstruit l’inspecteur';
});

await checkAsync('« Enregistrer cette vue » prend la caméra du moment, pas celle du dernier rebuild', async () => {
  const frame = await app();
  const win = frame.contentWindow, doc = frame.contentDocument;
  const { store } = win.__app;
  win.__app.render();
  store.setCamera({ yaw: 211 });
  await frames(win, 2);
  const save = [...doc.querySelectorAll('#inspector button')].find((b) => /Enregistrer cette vue/.test(b.textContent));
  save.click();
  // The name is asked in the page's dialog; the camera turns meanwhile.
  store.setCamera({ yaw: 211 });
  await answerDialog(doc, 'essai');
  const v = store.model.views[store.model.views.length - 1];
  const yaw = v?.camera.yaw;
  store.undo();
  await frames(win, 2);
  return yaw === 211 || `vue enregistrée à ${yaw}°`;
});
