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
- **Interface en français et en anglais**, au niveau d'un produit fini, en
  clair comme en sombre. Le français est la langue de référence ; un
  utilisateur français ne doit voir aucune différence d'une version à
  l'autre hormis ce qui est voulu. **Commentaires de code en anglais**, qui disent pourquoi, pas quoi.
- **Chaque correction arrive avec un test qui échoue sans elle**, chaque
  fonction nouvelle avec ses tests. La suite complète passe avant chaque push.
- **Vérifier dans un vrai navigateur**, avec de vrais clics : la plupart des
  défauts passés se voyaient au premier clic et échappaient aux tests unitaires.

## Organisation

```
index.html, styles.css, guide.html   la page, ses styles, le guide utilisateur ;
                   index.html porte aussi la garde de démarrage (voir plus bas)
src/main.js        câblage : magasin, vues, en-tête, clavier, dépôt de fichier, filet d'erreurs
src/version.js     le numéro de version affiché (= première entrée de CHANGELOG.md)
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
  texts.js         la forme des textes : familles d'outils et leurs touches,
                   indications partagées, grammaire des raccourcis (les mots
                   eux-mêmes sont dans src/i18n/)
  naming.js        les noms par défaut de ce que l'outil crée, dans la langue du moment
  words.js         petites phrases partagées (le point de la rose d'une caméra)
  icons.js         les icônes, tracés SVG en ligne d'un seul trait
  prefs.js         réglages de l'interface (disposition, sections, taille d'export),
                   en localStorage sous leur propre clé, hors du projet
  layout.js        plan / les deux / rendu, séparateur, onglets du téléphone
  toolbar.js       la palette d'outils
  dialogs.js       ask, askText, showText : les <dialog> qui remplacent confirm/prompt
  numeric.js       lecture des nombres tapés (virgule ou point), bornes, pas
  export-dialog.js la fenêtre d'export : aperçu, tailles, fond, archives
src/i18n/          index.js (t, langue, nombres, pluriels), fr.js (référence), en.js
src/io/            export d'images, fichiers de projet (enregistrement en place par
                   File System Access), lien de partage, zip.js (archive sans
                   compression écrite à la main)
src/data/          les dix modèles de départ
tests/             la suite, exécutée dans le navigateur
dev/               lanceur de tests et pages de visuels
CHANGELOG.md       ce qui change pour l'utilisateur, version par version
```

Les tests sont des fichiers `tests/*.test.js` par domaine, chargés dans l'ordre
par `tests/run.js` (la liste `FILES`). `tests/harness.js` fournit `check`,
`checkAsync` et `uncaught` ; `tests/helpers.js` les aides partagées ;
`tests/app-frame.js` charge l'application réelle dans une iframe, partagée par
`page`, `app`, `reliability`, `smoke` et `plan-app`. `croisements` vérifie ce
que le plan et le rendu se doivent (même action, même modèle) et ce que les
transformations de corps doivent aux équipements ; `interface`, ce que le lot 4 a
ajouté (archive relue octet par octet, saisie exacte, disposition, dialogues,
raccourcis, export) ; `langues`, les dictionnaires contre les sources et
l'application qui change de langue ; `demarrage`, la garde de
démarrage, devant une mise en ligne rejouée par le lanceur. Les tests du plan
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
échec, sur une suite qui ne se termine pas en quatre minutes, et **sur toute
exception non rattrapée ou erreur de console de la page**. Il signale les tests
de plus de trois secondes. `dev/run-tests.sh` n'en est qu'un relais.

Le lanceur rejoue aussi une mise en ligne pour `demarrage.test.js` : sous
`/__boot/<scénario>-<n°>/`, il sert le dépôt avec dix minutes de cache, comme
GitHub Pages, et un `roof.js` d'avant (`deploy` : périmé à la première
requête seulement ; `stuck` : toujours ; `slow` : un `main.js` qui ne se dit
pas prêt, garde réglée à 1,5 s ; `ok`). `/__boot-log/<…>` dit ce qui a été
demandé, et comment. Les erreurs de ces pages-là sont voulues : le lanceur ne
les compte pas. Servie par `python3 -m http.server`, la suite saute ces
quatre tests (ils passent en le disant).

La CI (`.github/workflows/tests.yml`) lance la même commande sur chaque push et
chaque pull request.

`dev/equipment-shot.html` produit `assets/equipment.png` (capture de la
grille, 1280 px de large).

`dev/ui-shot.html` monte l'application dans un cadre de taille donnée, réglée
comme sur les captures (modèle, sélection, fenêtre ouverte) ; Chrome sans
fenêtre en fait `assets/screenshot.png`, `assets/export.png` et
`assets/telephone.png` (la commande est en tête du fichier, par exemple
`?w=1440&h=900&preset=provence&select=opening`, `&open=export`,
`?w=390&h=844&preset=provence&tab=render`).

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
  transformations de corps) doit réancrer `fixtures` de la même
  façon — c'est fait dans `bodies.js`, où un quart de tour échange aussi un
  faîtage imposé (`roof.ridge` `ew` ↔ `ns`). `fitOpening` les garde entiers
  sur leur pan, leur largeur (`wallSpan`) venant de `FIXTURE_DEFAULTS`.
- Glisser une ouverture ou un équipement mural le long d'un même pan garde
  son arête et fait croître `offset` (`offsetOnRun`), dans le plan comme dans
  le rendu et aux flèches ; seul un changement de pan change l'arête. Ainsi
  le même geste donne les mêmes valeurs dans les deux vues.
- Un glisser de la sélection dans le rendu est un geste du magasin, comme
  ceux du plan (`beginGesture`… ; Échap l'annule). Supprimer un corps les supprime (`removeBuilding`),
  le cadrage les garde avec leur corps (`focus.js`).
- Les objets qui doivent être rangés exactement contre la coque (murs, toits)
  sont faits de boîtes qui ne s'interpénètrent pas, dans un groupe
  `equip:<id>` (ou `parked:<id>` pour une voiture sous carport), que
  `repairSolids` (`svg.js`) prend avec la coque. Un objet fait d'étages
  séparés par des plans horizontaux peut aussi se ranger « d'un bloc » :
  groupe `stack:<id>:<étage>` (le conifère).
- Toute valeur venue d'un fichier ou d'un lien passe par `normalise` ;
  `svg.js` n'écrit encore dans un attribut qu'un nombre ou une couleur vérifiés.
- Les réglages de l'interface (disposition, partage plan / rendu, sections
  ouvertes, familles d'outils repliées, taille d'export) passent par
  `prefs.js`, jamais par le modèle ni par l'historique. Le fond de l'image,
  lui, reste `model.style.background` : il se choisit dans la fenêtre
  d'export, et s'annule comme toute modification.
- Pas de `confirm()` ni de `prompt()` : `dialogs.js`.
- **Un texte nouveau** va dans `src/i18n/fr.js` **et** `src/i18n/en.js`, même
  clé (`domaine.quoi`), et s'affiche par `t('clé', { paramètres })` au moment
  où il est dessiné — jamais calculé une fois pour toutes au chargement d'un
  module, sinon un changement de langue ne le verrait pas. `{nom}` est
  rempli par les paramètres, un nombre écrit avec la marque décimale de la
  langue ; un texte qui dépend d'un compte est un objet `{ one, other }` choisi
  par `n` (`Intl.PluralRules`). Une clé construite (`` t(`tool.${id}`) ``)
  doit nommer au moins une clé, et une clé doit servir : `langues.test.js`
  le vérifie sur les sources, et qu'aucune chaîne française ne reste en dur
  dans `src/ui/` ni `src/main.js`. Les mots de `index.html` portent
  `data-i18n` (texte), `data-i18n-title`, `data-i18n-aria` ; leur français y
  reste écrit pour l'instant d'avant les modules.
- **Une langue nouvelle** : un dictionnaire `src/i18n/xx.js` avec exactement
  les clés de `fr.js`, déclaré dans `DICTIONARIES` et `LANGUAGES` (nom dans
  la langue même, locale, marque décimale) ; les mots de la garde de
  démarrage (`WORDS`, dans `index.html`) ; un `guide.xx.html` et la clé
  `page.guide`. Le sélecteur la propose seul.
- Changer de langue (`setLanguage`) prévient `onLanguageChange` : `main.js`
  réécrit la page sur place (`applyPageWords`, palette, pavé, aide,
  `relabel()` de la disposition, du plan, de l'export et de la galerie, puis
  tout le rendu). Un composant qui écrit des mots une seule fois à sa
  construction doit avoir son `relabel()`.
- **Les données ne se traduisent pas.** Le moteur (`src/core/`) n'a pas de
  langue : `normalise` nomme un corps sans nom en français, `limitBreach`
  rend `{ key, max }`, `duplicateBody` reçoit le nom de la copie. Ce que
  l'interface crée est nommé dans la langue du moment (`naming.js`), et un
  nom donné ne change plus. Les noms de fichiers exportés suivent la langue.
- Un champ exact (`numberField` dans `panels.js`) n'écrit qu'au `change`
  (Entrée, sortie du champ), jamais à la frappe ; ce qui ne se lit pas est
  refusé et la valeur remise. `onChange` peut renvoyer `false` pour refuser
  (un objet de toit tapé hors de son toit).
- Les raccourcis à une touche n'agissent jamais dans un champ de saisie ni dans
  un dialogue ; `Ctrl+S`, `Ctrl+O`, `Ctrl+E` agissent partout. Les touches des
  outils sont dans `TOOL_GROUPS` (`texts.js`), l'aide `?` les lit là.
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
- **Une mise en ligne peut servir des modules d'âges différents** : GitHub
  Pages garde dix minutes de cache et les imports n'ont pas de version, si
  bien qu'un `main.js` neuf peut recevoir un `roof.js` ancien ; l'import
  échoue et `main.js`, son filet d'erreurs compris, ne démarre jamais. La
  garde de démarrage d'`index.html` (script classique `#boot-guard`, hors du
  graphe) le constate — erreur d'un module, ou pas de signal
  `window.__bootReady()` (fin de `main.js`) dans `data-timeout`, 20 s —,
  recharge tout le graphe d'imports avec `fetch(…, { cache: 'reload' })`
  depuis le `<script type="module">`, plus les feuilles de style, puis relance
  la page **une fois** (marque `ihb-boot-retry` en `sessionStorage`) ; ensuite
  elle affiche un message qui propose de recharger. Elle ne touche jamais au
  `localStorage`. Un module ajouté n'a rien à déclarer : elle suit les
  `import`/`export … from` relatifs. Un import d'une autre forme (chemin
  absolu, construit) lui échapperait. Un démarrage réussi pose
  `data-boot="ready"` sur `<html>`.
- **Les tests de l'application démarrent sur des réglages d'interface vides**
  (`clearPrefs()` dans `app-frame.js` et `run.js`) : un test qui change la
  disposition ou ouvre une section doit savoir qu'un rechargement du cadre la
  remet à zéro, et qu'un test de la page de tests partage le même
  `localStorage` que le cadre.
- Les questions posées dans un `<dialog>` se résolvent sur son événement
  `close`, qui est une tâche à part : `answerDialog` (`helpers.js`) attend que
  le dialogue ait quitté la page.
- **`[hidden]` ne cache pas un élément auquel une classe donne `display`** :
  la feuille de style le force (`[hidden] { display: none !important }`).
- Sur écran tactile, un second tapotement rapide passait pour la fin d'un
  double-tapotement et perdait son clic : les contrôles ont
  `touch-action: manipulation`.
- Le test de fumée de l'inspecteur parcourt les contrôles par rang : un
  réglage qui fait disparaître un champ (Étages à 1 retire « Étage ») décale
  les suivants. Il vérifie le type du contrôle avant chaque action.
- Le rendu demande au dessin s'il montre un équipement mural sous le pointeur
  (`equipmentAt` dans `hit.js`, à trois pixels près) avant le toit et le
  calque : une caméra sous le débord est dessinée contre la rive.
- Le fragment `#m=…` d'un lien de partage est retiré de l'adresse par
  `history.replaceState`, qui ne déclenche pas `hashchange`.
- **Chrome sans fenêtre dit `en-US`** : sans langue choisie, l'application y
  démarrerait en anglais. Le banc la force en français (`setLanguage('fr')`
  dans `run.js`, `lang: 'fr'` dans les réglages avant de charger le cadre) ;
  la passe anglaise des tests de fumée change de langue par le sélecteur de
  la page, puis revient au français. Un test qui charge `index.html` lui-même
  doit poser la langue qu'il attend.
- Les sections de l'inspecteur sont retenues ouvertes ou fermées sous leur
  ancien titre français (`id` de `section()` : « Tous les corps », « Vue »…),
  jamais affiché : changer ces identifiants refermerait les sections de chaque
  utilisateur. `langues.test.js` les laisse passer nommément.
- Les guillemets et apostrophes du français d'origine sont gardés tels quels,
  droits ou courbes (« vers l'ouest », « vue d'ensemble ») : un utilisateur
  français ne doit voir aucune différence.
