# Isometric House Builder

Modélisez votre maison en vue isométrique et exportez-en des illustrations
PNG ou SVG, prêtes à être posées sur un tableau de bord domotique.

![Deux maisons modélisées avec l'outil](assets/hero.png)

**[▶ Ouvrir l'application](https://guim31.github.io/isometric-house-builder/)** —
rien à installer, tout se passe dans le navigateur, aucune donnée n'est envoyée
nulle part.

---

## Pourquoi cet outil

Il existe déjà d'excellents constructeurs de maisons isométriques, mais ils sont
soit payants, soit fermés, soit pensés pour le jeu plutôt que pour produire une
image réutilisable. Celui-ci a trois partis pris :

- **Libre et gratuit**, sous licence MIT, sans compte ni téléversement.
- **L'image est le produit fini.** Export PNG à fond transparent et jusqu'en 4×,
  export SVG vectoriel, et les quatre faces de la maison en un clic.
- **Aucune étape de construction.** Ni Node, ni bundler, ni dépendance : des
  modules ES et un fichier `index.html`. On clone, on ouvre, ça marche — et
  n'importe qui peut lire le code sans outillage.

Conçu au départ pour illustrer une maison dans
[Gladys Assistant](https://gladysassistant.com/), mais l'export est du PNG et du
SVG ordinaires : Home Assistant, Jeedom, un wiki ou une présentation feront tout
aussi bien l'affaire.

## Ce que l'outil sait faire

![Les quatre types de toiture et les quatre orientations](assets/gallery.png)

| | |
|---|---|
| **Volume** | Emprise dessinée à main levée sur une trame d'un mètre, jusqu'à 4 niveaux, hauteur d'étage et soubassement réglables |
| **Toiture** | Croupe, deux pans, appentis, toit plat — inclinaison, débord et épaisseur de rive ; les noues entre ailes sont calculées |
| **Ouvertures** | Fenêtres, fenêtres à volets, portes, portes de garage, posées sur n'importe quel mur et à n'importe quel niveau |
| **Sur le toit** | Panneaux photovoltaïques, cheminées, fenêtres de toit, paraboles — posés à plat sur la pente |
| **Extérieurs** | Piscine, terrasse, allée, pelouse, haies, clôtures, arbres, voiture |
| **Rendu** | 4 palettes, contours, ombre portée, projection isométrique 30° ou dimétrique 2:1 |
| **Export** | PNG 1×/2×/4× à fond transparent, SVG, les 4 faces en lot, copie directe dans le presse-papier |

## Prise en main

1. **Dessinez l'emprise.** Outil *Rectangle* pour poser un volume, *Pinceau* pour
   affiner, *Gomme* pour retirer. Une case vaut un mètre.
2. **Réglez la toiture** dans le panneau de droite. Le débord se cale par pas de
   25 cm, pour que la rive tombe sur la trame.
3. **Posez les ouvertures.** Choisissez *Fenêtre*, *Porte* ou *Porte de garage*,
   puis cliquez le long d'un mur — dans le plan, ou directement sur le rendu.
4. **Aménagez les abords** avec les outils *Extérieur*.
5. **Exportez.** Le fond transparent est celui à préférer : l'image se pose alors
   sur n'importe quelle couleur de tableau de bord.

À savoir : la vue par défaut regarde les façades **nord et est**. Si vos
ouvertures semblent absentes, elles sont probablement sur les deux façades
opposées — tournez la vue avec `[` et `]`.

Raccourcis : `Ctrl+Z` / `Ctrl+Maj+Z` annuler et rétablir, `[` et `]` tourner,
`Suppr` supprimer la sélection, `Échap` désélectionner. Molette pour zoomer,
`Maj` + glisser pour déplacer la vue.

Le projet en cours est conservé dans le navigateur. *Enregistrer* produit un
fichier `.house.json` lisible et versionnable ; deux exemples sont fournis dans
[`examples/`](examples/).

## Intégrer l'image à Gladys Assistant

1. Exportez en **PNG, fond transparent**. La taille *Widget 640 × 400* convient à
   une carte de tableau de bord ; prenez *2×* ou *4×* pour un écran dense.
2. Dans Gladys, ajoutez une carte **Image** à votre tableau de bord et
   téléversez le fichier.
3. Pour montrer plusieurs orientations, exportez **les 4 faces** : vous obtenez
   quatre fichiers nommés d'après leur point de vue.

Le SVG est utile si vous voulez retoucher les couleurs à la main ensuite : c'est
du vectoriel plat, sans filtre ni dégradé, éditable dans n'importe quel éditeur.

## Développement

Aucune dépendance à installer. Un serveur statique suffit, car les modules ES ne
se chargent pas depuis `file://` :

```bash
git clone https://github.com/guim31/isometric-house-builder.git
cd isometric-house-builder
python3 -m http.server 8000
# puis http://localhost:8000/
```

La suite de tests s'exécute dans le navigateur — ouvrez
<http://localhost:8000/tests/> — ou en ligne de commande avec Chrome :

```bash
./dev/run-tests.sh
```

### Comment c'est construit

Trois décisions portent tout le reste, et valent d'être connues avant de
modifier le moteur :

- **La profondeur isométrique vaut exactement `x + y + z`.** Les deux projections
  sont paramétrées pour que l'axe de vue soit `(1, 1, 1)`. Les faces peuvent donc
  être triées exactement, à n'importe quelle rotation, sans tampon de profondeur.
- **La toiture est l'enveloppe supérieure d'un toit élémentaire par rectangle.**
  L'emprise est décomposée en rectangles maximaux — qui ont le droit de se
  chevaucher — et le toit est le maximum de leurs surfaces. C'est ce qui produit
  les noues correctes là où deux ailes se rejoignent. Les murs, eux, montent
  jusqu'à la sous-face du toit : un pignon n'est pas une pièce à part, c'est une
  conséquence.
- **La géométrie est émise en triangles fins, puis refusionnée.** `mesh.js`
  recombine les triangles coplanaires de même matériau en polygones, en séparant
  les composantes connexes. Sans cette séparation, deux objets coplanaires
  distincts partageraient un centre — donc une profondeur — et l'un traverserait
  la maison.

| Fichier | Rôle |
|---|---|
| `src/core/iso.js` | Projection, rotation, profondeur, cadrage |
| `src/core/grid.js` | Emprise, murs extérieurs, décomposition en rectangles |
| `src/core/roof.js` | Champ de hauteur et maillage de la toiture |
| `src/core/mesh.js` | Fusion des faces coplanaires, trous, composantes |
| `src/core/scene.js` | Assemblage : sol, murs, ouvertures, toit, objets |
| `src/render/svg.js` | Tri, éclairage, émission SVG |
| `src/render/hit.js` | Couche de sélection invisible |
| `src/ui/` | Plan, rendu, inspecteur, historique |
| `src/io/` | Export image, fichiers de projet, lien de partage |

Les contributions sont bienvenues : ouvrez une issue ou une pull request.
Merci de faire passer `./dev/run-tests.sh` avant de proposer un changement.

## Licence

MIT — voir [LICENSE](LICENSE). Faites-en ce que vous voulez, y compris
commercialement.

---

<details>
<summary><b>English summary</b></summary>

**Isometric House Builder** is a free, open-source, build-step-free web tool for
modelling the exterior of a house in isometric view and exporting it as a
transparent PNG or a flat SVG — meant for home-automation dashboards such as
Gladys Assistant, but the output is plain image files usable anywhere.

Draw the footprint on a one-metre grid, pick a roof (hip, gable, shed, flat),
place windows, doors, garage doors, solar panels, chimneys, a pool, trees, then
export the current view or all four isometric orientations at once.

No dependencies, no bundler, no account: clone it, serve the folder, open
`index.html`. Tests live in `tests/` and run in the browser, or headlessly via
`./dev/run-tests.sh`. MIT licensed.

</details>
