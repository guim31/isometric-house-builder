# CLAUDE.md

Guide de travail pour qui modifie ce dépôt — humain ou agent.

## Ce qu'est l'outil

Isometric House Builder modélise une maison en vue isométrique et en exporte
des images PNG ou SVG, pensées pour les tableaux de bord domotiques (Gladys
Assistant en premier lieu). Tout se passe dans le navigateur : rien n'est
envoyé nulle part.

Le site est publié par GitHub Pages depuis la racine de `main`. **Toute fusion
est une mise en production**, pour des utilisateurs qui ont déjà des projets
enregistrés dans leur navigateur et des liens partagés en circulation.

## Ce qui ne se négocie pas

- **Zéro dépendance à l'exécution, zéro build.** Des modules ES et un
  `index.html` ; l'application s'ouvre telle quelle depuis un serveur statique.
  L'outillage de test utilise Node et Chrome, sans `node_modules`.
- **Les fichiers `.house.json`, les projets en `localStorage` et les liens de
  partage existants continuent de s'ouvrir sur la même maison.** Toute
  évolution du format passe par `normalise` (`src/core/model.js`) et
  `MODEL_VERSION`.
- **L'export est l'aperçu, et il est déterministe** : pas de tirage aléatoire
  dans le rendu, pas de filtre SVG. Les dix modèles de départ et l'exemple
  rendent exactement le SVG de référence (`tests/fixtures/reference-svg.json`) ;
  un changement de rendu voulu régénère la référence et le dit.
- **Interface en français**, au niveau d'un produit fini, en clair comme en
  sombre. **Commentaires de code en anglais**, qui disent pourquoi, pas quoi.
- **Chaque correction arrive avec un test qui échoue sans elle**, chaque
  fonction nouvelle avec ses tests. La suite complète passe avant chaque push.
- **Vérifier dans un vrai navigateur**, avec de vrais clics : la plupart des
  défauts passés se voyaient au premier clic et échappaient aux tests unitaires.

## Organisation

```
index.html, styles.css, guide.html   la page, ses styles, le guide utilisateur
src/main.js        câblage : magasin, vues, barre d'outils, clavier, filet d'erreurs
src/core/          le modèle et la géométrie, sans DOM
  model.js         format du projet, normalise (liste blanche, plafonds LIMITS),
                   valeurs par défaut, géométrie des ouvertures
  grid.js          emprise, murs extérieurs, décomposition en rectangles
  roof.js          champ de hauteur et maillage de la toiture
  scene.js         assemblage du maillage : sol, murs, ouvertures, toit, objets
  props.js         objets extérieurs et équipements (muraux compris)
  bodies.js        déplacer, tourner, retourner, dupliquer un corps entier
  mesh.js          fusion des faces coplanaires
  iso.js           projection, orbite, profondeur
  focus.js         zone de cadrage
  palette.js       palettes et éclairage
src/render/        SVG (svg.js), matières (texture.js), sélection (hit.js) : calque de
                   cibles, et choix sur le dessin même (roofAt, rayon de vue)
src/ui/            plan, rendu, inspecteur, galerie, magasin (store.js), actions
  plan.js          la vue de dessus : vue, gestes, calque d'aperçus
  plan-edit.js     géométrie des gestes, sans DOM : trait, aimantation, poignées
src/io/            export d'images, fichiers de projet, lien de partage
src/data/          les dix modèles de départ
tests/             la suite, exécutée dans le navigateur
dev/               lanceur de tests et pages de visuels
```

Les tests sont des fichiers `tests/*.test.js` par domaine, chargés dans l'ordre
par `tests/run.js` (la liste `FILES`). `tests/harness.js` fournit `check`,
`checkAsync` et `uncaught` ; `tests/helpers.js` les aides partagées ;
`tests/app-frame.js` charge l'application réelle dans une iframe, partagée par
`page`, `app`, `reliability`, `smoke` et `plan-app`. Les tests du plan
(`plan-view`, `plan-draw`, `plan-edit`) montent une `PlanView` dans le
`#stage` (`stagePlan` de `plan-view.test.js`) et lui envoient de vrais
événements de pointeur ; `fireOn` vise l'élément dessiné, comme le ferait un
clic. `window.__app` expose le magasin de
l'application au banc d'essai.

## Commandes

```bash
python3 -m http.server 8000      # puis http://localhost:8000/ (ou tests/)
node dev/run-tests.mjs           # la suite en ligne de commande (Node 22+, Chrome)
CHROME=/chemin/vers/chrome node dev/run-tests.mjs
ONLY=equipements,moteur node dev/run-tests.mjs   # quelques fichiers seulement
```

`ONLY` (ou `tests/?only=…` dans le navigateur) sert à itérer ; la suite
complète passe toujours avant un push.

Le lanceur cherche Chrome dans `CHROME`, puis `google-chrome`, `chromium`,
`chromium-browser`, puis sous `/opt/pw-browsers/`. Il échoue sur un test en
échec, sur une suite qui ne se termine pas en trois minutes, et **sur toute
exception non rattrapée ou erreur de console de la page**. Il signale les tests
de plus de trois secondes. `dev/run-tests.sh` n'en est qu'un relais.

La CI (`.github/workflows/tests.yml`) lance la même commande sur chaque push et
chaque pull request.

`dev/equipment-shot.html` produit `assets/equipment.png` (capture de la
grille, 1280 px de large).

`dev/reference-svg.html` affiche les empreintes de référence des modèles de
départ, à recopier dans `tests/fixtures/reference-svg.json` après un changement
de rendu voulu.

## Conventions

- Messages de commit en français, comme l'historique : un titre à l'infinitif
  présent de la troisième personne (« Garde… », « Corrige… »), puis le pourquoi.
  Un commit par sujet.
- Le modèle est immuable : chaque modification produit un nouvel objet, ce que
  les caches comparent par identité (`geometryOf` dans `viewport.js`,
  `focusModel`).
- La vue du plan (centre, échelle) est hors du modèle : elle s'ajuste par
  `plan.refit()` à l'ouverture d'un projet (galerie, fichier, lien, nouveau),
  jamais sur une modification.
- Un geste du plan qui modifie le modèle en continu s'ouvre par
  `store.beginGesture()` et se ferme par `endGesture()` : une seule entrée
  d'historique, quelle que soit sa durée ; `cancelGesture()` (Échap, second
  doigt) rend le modèle d'avant le geste. Les refus se disent par
  `store.notify`.
- La caméra est hors de l'historique : on la change par `store.setCamera`,
  jamais par `store.update`. Le cadrage et les vues enregistrées, eux, sont du
  contenu. `setCamera` émet la raison `'camera'` : `main.js` ne redessine
  alors que le rendu et appelle `inspector.syncCamera()`, qui met la section
  Vue à jour sur place. Un contrôle qui lit la caméra au clic doit la lire
  dans `store.model` à ce moment, pas dans la fermeture du dernier rendu.
- Les équipements muraux sont dans `model.fixtures` : `{ id, kind, edge,
  storey, offset, z }`, ancrés exactement comme les ouvertures (`edge` =
  `"i,j,côté"` d'une case du corps, `offset` = mètres depuis le début de
  l'arête, `z` = hauteur du centre au-dessus du plancher du niveau). Toute
  transformation qui réancre les ouvertures (`withCellSize`, et les
  transformations de corps à venir) doit réancrer `fixtures` de la même
  façon ; `fitOpening` les garde entiers sur leur pan, leur largeur venant
  de `FIXTURE_DEFAULTS`. Supprimer un corps les supprime (`removeBuilding`),
  le cadrage les garde avec leur corps (`focus.js`).
- Les objets qui doivent être rangés exactement contre la coque (murs, toits)
  sont faits de boîtes qui ne s'interpénètrent pas, dans un groupe
  `equip:<id>` (ou `parked:<id>` pour une voiture sous carport), que
  `repairSolids` (`svg.js`) prend avec la coque. Un objet fait d'étages
  séparés par des plans horizontaux peut aussi se ranger « d'un bloc » :
  groupe `stack:<id>:<étage>` (le conifère).
- Toute valeur venue d'un fichier ou d'un lien passe par `normalise` ;
  `svg.js` n'écrit encore dans un attribut qu'un nombre ou une couleur vérifiés.
- Les plafonds (`LIMITS`) valent à l'ouverture comme à l'édition : `Store.update`
  refuse la modification qui en franchirait un et le dit.

## Pièges rencontrés

- **Un gestionnaire d'événement qui lève ne fait échouer aucun `check`** :
  l'exception part vers `window.onerror`, pas vers l'appelant de
  `dispatchEvent`. D'où `uncaught()` dans le harnais, et le lanceur qui échoue
  sur toute exception de la page.
- **Le temps virtuel de Chrome** (`--virtual-time-budget`) saute par-dessus
  les délais de la page pendant que les images d'animation attendent l'horloge
  réelle : des tests de la page échouaient sous charge sans faute du code. Le
  lanceur attend en temps réel, et l'application dessine sa première image
  aussitôt, sans attendre `requestAnimationFrame`.
- **Une iframe que Chrome juge cachée ne reçoit pas d'images d'animation.**
  L'iframe du banc est en haut de la page, et il n'y en a qu'une.
- **Les sauvegardes automatiques des tests** (400 ms) peuvent atterrir après un
  `clearLocal()` : `app-frame.js` attend avant de vider à nouveau.
- **`focusModel` est appelé deux fois par image** (par la vue, puis par le
  rendu sur le modèle déjà cadré) : son mémo ne doit pas se laisser remplacer
  par le second appel.
- **Tout changement de `decomposeRects` change les toits** : l'ordre des
  rectangles de même aire décide de la toiture. La version actuelle reproduit
  l'ordre de l'ancienne énumération exhaustive.
- Dans le rendu, les identifiants de `clipPath` portent une marque de session
  aléatoire : comparer deux SVG demande de les ôter (`stripIds`).
- Le plan a deux couches : le dessin (`render`, tout reconstruit) et le calque
  `.plan-overlay` (`renderOverlay`, seul redessiné au survol). Rien du calque
  ne capte le pointeur, sauf les poignées (`data-handle`).
- `#plan` contient plusieurs `svg` (le plan et les icônes de son pavé) :
  viser `#plan .plan-svg`.
- Échap est intercepté par le plan en phase de capture sur `window`, pour
  qu'annuler un geste ne désélectionne pas aussi. Chaque `PlanView` des tests
  garde ses écouteurs : un test qui laisse un geste ouvert le voit annulé par
  l'Échap d'un test suivant.
- Le coloriage d'une face dépend de sa normale, au bruit d'arrondi près : comparer
  deux rendus « identiques » par géométries différentes tolère une unité de
  couleur (`sameColour` dans `plan-edit.test.js`).
- **Le calque de sélection n'a pas de toit** : ses cibles sont triées sur leur
  centre, et le mur du fond ressortait au travers du toit. Le rendu choisit
  donc d'abord sur le dessin (`roofAt` dans `hit.js` : la face dessinée en
  dernier, puis le plan de cette face) ; le calque ne répond que si ce qui
  est dessiné n'est pas un toit.
- **La caméra suit le dessin** (`camera.fit` à chaque rendu) : déplacer un
  objet vers le bord décale tout. Pendant un glisser de la sélection, la
  vue fige `scale` et `offset` (`viewport.frozen`) et recadre au relâcher.
- Un objet tout juste posé reste sélectionné avec son outil actif : l'appui
  sur la sélection doit passer avant l'outil, sinon le saisir en repose un.
- **La voiture se trie mal contre elle-même** (roues enfoncées dans la
  carrosserie) depuis toujours ; la corriger change le SVG des modèles de
  départ. Les tests de recouvrement l'excluent explicitement.
- `tests/fixtures/model-v2.js` est le `model.js` du lot 1 figé : il vérifie
  qu'un fichier écrit aujourd'hui s'ouvre dans la version précédente. Ne pas
  le mettre à jour ; en figer un nouveau à la prochaine montée de version.
- Le fragment `#m=…` d'un lien de partage est retiré de l'adresse par
  `history.replaceState`, qui ne déclenche pas `hashchange`.
