# Journal des changements

Ce qui change pour qui utilise l’outil, version après version. Les projets
enregistrés, les fichiers `.house.json` et les liens de partage des versions
précédentes s’ouvrent toujours sur la même maison.

## 2.1.0 — français et anglais

- **L’interface parle anglais.** Tout ce qui se lit — outils et aides,
  inspecteur, dialogues, export, messages, info-bulles, galerie, rose des
  vents, cotes — existe en français et en anglais. La langue suit celle du
  navigateur ; un sélecteur discret dans l’en-tête (dans le menu ⋯ sur
  téléphone) la change sur-le-champ, sans recharger la page ni toucher au
  projet, et le choix est retenu.
- Les nombres suivent la langue : 3,40 en français, 3.40 en anglais. La
  saisie accepte la virgule comme le point, dans les deux langues.
- **Un projet garde ses noms.** Ce que l’outil crée — page blanche, modèle de
  la galerie, nouveau corps, copie, vue — est nommé dans la langue du moment ;
  un fichier, un projet enregistré ou un lien s’ouvrent à l’identique dans
  les deux langues, et le format ne change pas.
- Le guide existe en anglais (`guide.en.html`), et l’application ouvre celui
  de sa langue ; le README aussi (`README.en.md`).
- Pour un utilisateur français, rien ne change hormis le sélecteur.

## 2.0.0 — l’interface

- **Le rendu en grand.** Plan et rendu se partagent le centre avec un
  séparateur que l’on fait glisser ; une bascule montre le plan seul, les
  deux, ou le rendu seul (touches 1, 2, 3). Le partage choisi est retrouvé à
  la visite suivante.
- **Des outils lisibles.** Chaque outil a son icône ; les plus courants ont
  une touche (V, B, R, E, F, P, G, S, A, H, M, C). L’aide de l’outil tient
  sur une ligne, le détail est dans l’info-bulle. `Échap` revient à
  Sélectionner, `?` affiche tous les raccourcis.
- **Au centimètre près.** Chaque curseur de dimension ou de position est
  doublé d’un champ : on tape 3,40 (virgule ou point) et c’est 3,40.
- **Un export que l’on voit avant de le télécharger.** Aperçu aux
  proportions exactes de l’image, sur damier quand le fond est transparent ;
  tailles libres ; le fond se choisit là, couleur libre comprise. « Les 4
  faces » et « Vues enregistrées » donnent une seule archive ZIP au lieu
  d’une rafale de téléchargements.
- **Enregistrer dans le même fichier**, là où le navigateur le permet
  (Chrome, Edge) : plus de « maison (3).house.json ». `Ctrl+S` enregistre,
  `Ctrl+O` ouvre, `Ctrl+E` exporte ; un fichier glissé sur la fenêtre
  s’ouvre.
- **Vues enregistrées** : renommer, mettre à jour avec la vue du moment,
  supprimer — et revenir sur la suppression.
- **De vraies boîtes de dialogue** au lieu de celles du navigateur ;
  « Nouveau » et le choix d’un modèle disent qu’ils remplacent le projet, et
  que `Ctrl+Z` le ramène.
- **Tablette et téléphone.** Jusqu’à 1100 px l’inspecteur reste à côté des
  dessins. Sur téléphone, l’outil devient une application : barre compacte,
  bandeau d’outils, onglets Plan / Rendu / Réglages, cibles tactiles larges.
- Les sections de l’inspecteur restent ouvertes ou fermées d’une visite à
  l’autre. Contrastes renforcés, focus visible partout, animations coupées
  quand le système le demande.
- Corrigé : X et Y d’un objet de toit ne le font plus sortir de son toit ; une
  caméra posée haut sous un débord se saisit dans le rendu ; les cotes de la
  sélection ne sont plus coupées au bord du plan ni écrites sur celles des
  murs.

## 1.3 — le rendu et le moteur (lot 3)

- Toit cliquable : on pose panneaux, cheminée, fenêtre de toit et parabole
  directement sur le rendu, et l’on y déplace la sélection en la faisant
  glisser.
- Sept équipements pour les tableaux de bord : applique, caméra, borne de
  recharge, lampadaire, pompe à chaleur, boîte aux lettres, carport.
- Sens du faîtage, quart de tour, sens de la voiture, conifère.

## 1.2 — le plan (lot 2)

- Le plan devient un outil de dessin : vue stable avec son pavé de zoom,
  aperçu de ce qu’un clic posera, poignées, aimantation et repères, flèches
  du clavier, déplacement et transformations d’un corps entier (dupliquer,
  tourner, retourner).

## 1.1 — la fiabilité (lot 1)

- Annuler / rétablir fiables (la caméra n’entre plus dans l’historique),
  sauvegarde automatique qui ne se perd pas à la fermeture, liens de partage
  qui n’écrasent pas le projet ouvert, fichiers abîmés mis de côté au lieu
  d’être perdus, plafonds de taille qui protègent le navigateur, filet
  d’erreurs visible.
