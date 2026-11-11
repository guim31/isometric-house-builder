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
  props.js         objets extérieurs
  mesh.js          fusion des faces coplanaires
  iso.js           projection, orbite, profondeur
  focus.js         zone de cadrage
  palette.js       palettes et éclairage
src/render/        SVG (svg.js), matières (texture.js), calque de sélection (hit.js)
src/ui/            plan, rendu, inspecteur, galerie, magasin (store.js), actions
src/io/            export d'images, fichiers de projet, lien de partage
src/data/          les dix modèles de départ
tests/             la suite, exécutée dans le navigateur
dev/               lanceur de tests et pages de visuels
```

Les tests sont des fichiers `tests/*.test.js` par domaine, chargés dans l'ordre
par `tests/run.js` (la liste `FILES`). `tests/harness.js` fournit `check`,
`checkAsync` et `uncaught` ; `tests/helpers.js` les aides partagées ;
`tests/app-frame.js` charge l'application réelle dans une iframe, partagée par
`page`, `app`, `reliability` et `smoke`. `window.__app` expose le magasin de
l'application au banc d'essai.

## Commandes

```bash
python3 -m http.server 8000      # puis http://localhost:8000/ (ou tests/)
node dev/run-tests.mjs           # la suite en ligne de commande (Node 22+, Chrome)
CHROME=/chemin/vers/chrome node dev/run-tests.mjs
```

Le lanceur cherche Chrome dans `CHROME`, puis `google-chrome`, `chromium`,
`chromium-browser`, puis sous `/opt/pw-browsers/`. Il échoue sur un test en
échec, sur une suite qui ne se termine pas en trois minutes, et **sur toute
exception non rattrapée ou erreur de console de la page**. Il signale les tests
de plus de trois secondes. `dev/run-tests.sh` n'en est qu'un relais.

La CI (`.github/workflows/tests.yml`) lance la même commande sur chaque push et
chaque pull request.

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
- La caméra est hors de l'historique : on la change par `store.setCamera`,
  jamais par `store.update`. Le cadrage et les vues enregistrées, eux, sont du
  contenu.
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
- Le fragment `#m=…` d'un lien de partage est retiré de l'adresse par
  `history.replaceState`, qui ne déclenche pas `hashchange`.
