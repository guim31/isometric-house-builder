/**
 * The interface's words, in one place.
 *
 * Gathered here rather than spread through the wiring so that a translation
 * has one file to work through: the tool names and their help, the keyboard
 * shortcuts, the dialogs, the export window. The inspector still holds the
 * labels of its own fields.
 */

export const APP_NAME = 'Isometric House Builder';

/**
 * The tool palette, family by family. `key` is the one-key shortcut, when the
 * tool has one; `tip` the full help, shown as a tooltip and in the guide —
 * the line above the drawings only has room for `hint`.
 */
export const TOOL_GROUPS = [
  {
    id: 'structure', title: 'Structure', tools: [
      { id: 'select', label: 'Sélectionner', key: 'V' },
      { id: 'paint', label: 'Pinceau', key: 'B' },
      { id: 'rect', label: 'Rectangle', key: 'R' },
      { id: 'erase', label: 'Gomme', key: 'E' },
    ],
  },
  {
    id: 'openings', title: 'Ouvertures', tools: [
      { id: 'window', label: 'Fenêtre', key: 'F' },
      { id: 'shutter', label: 'Fenêtre à volets' },
      { id: 'door', label: 'Porte', key: 'P' },
      { id: 'garage', label: 'Porte de garage', key: 'G' },
    ],
  },
  {
    id: 'roof', title: 'Sur le toit', folded: true, tools: [
      { id: 'solar', label: 'Panneaux solaires', key: 'S' },
      { id: 'chimney', label: 'Cheminée' },
      { id: 'velux', label: 'Fenêtre de toit' },
      { id: 'dish', label: 'Parabole' },
    ],
  },
  {
    id: 'outside', title: 'Extérieur', tools: [
      { id: 'pool', label: 'Piscine' },
      { id: 'terrace', label: 'Terrasse' },
      { id: 'path', label: 'Allée' },
      { id: 'stairs', label: 'Escalier' },
      { id: 'tree', label: 'Arbre', key: 'A' },
      { id: 'bush', label: 'Buisson' },
      { id: 'hedge', label: 'Haie', key: 'H' },
      { id: 'fence', label: 'Clôture' },
      { id: 'muret', label: 'Muret', key: 'M' },
      { id: 'gate', label: 'Portillon / portail' },
      { id: 'car', label: 'Voiture' },
    ],
  },
  {
    // What a home dashboard puts a badge on: the lights, the camera, the
    // charger, the heat pump, the letter box, where the car sleeps.
    id: 'equipment', title: 'Équipements', folded: true, tools: [
      { id: 'wallLight', label: 'Applique' },
      { id: 'camera', label: 'Caméra' },
      { id: 'charger', label: 'Borne de recharge' },
      { id: 'lamppost', label: 'Lampadaire' },
      { id: 'heatpump', label: 'Pompe à chaleur' },
      { id: 'mailbox', label: 'Boîte aux lettres' },
      { id: 'carport', label: 'Carport / pergola' },
    ],
  },
  {
    id: 'framing', title: 'Cadrage', folded: true, tools: [
      { id: 'frame', label: 'Zone de cadrage', key: 'C' },
    ],
  },
];

export const TOOLS = Object.fromEntries(TOOL_GROUPS.flatMap((g) => g.tools.map((t) => [t.id, t])));

/**
 * One line each: the line above the drawings is a reminder, not a manual,
 * and it must not change height from one tool to the next.
 */
export const HINTS = {
  select: 'Cliquez pour régler, glissez pour déplacer. Ailleurs, glisser tourne la vue.',
  paint: 'Peignez l’emprise dans le plan. Alt efface.',
  rect: 'Glissez pour ajouter un volume rectangulaire. Alt retire.',
  erase: 'Glissez pour retirer des cases.',
  window: 'Cliquez un mur, dans le plan ou le rendu.',
  shutter: 'Cliquez un mur, dans le plan ou le rendu.',
  door: 'Cliquez un mur, dans le plan ou le rendu.',
  garage: 'Cliquez un mur, dans le plan ou le rendu.',
  solar: 'Cliquez un toit, dans le plan ou le rendu.',
  chimney: 'Cliquez un toit, dans le plan ou le rendu.',
  velux: 'Cliquez un toit, dans le plan ou le rendu.',
  dish: 'Cliquez un toit, dans le plan ou le rendu.',
  pool: 'Cliquez dans le plan ou sur le rendu.',
  terrace: 'Cliquez dans le plan ou sur le rendu.',
  path: 'Cliquez dans le plan ou sur le rendu.',
  stairs: 'Cliquez au pied d’une terrasse surélevée.',
  tree: 'Cliquez dans le plan ou sur le rendu.',
  bush: 'Cliquez dans le plan ou sur le rendu.',
  hedge: 'Glissez dans le plan pour la tracer.',
  fence: 'Glissez dans le plan pour la tracer.',
  muret: 'Glissez dans le plan pour le tracer.',
  gate: 'Cliquez près d’un muret : le portail s’y aligne.',
  car: 'Cliquez dans le plan ou sur le rendu.',
  wallLight: 'Cliquez un mur, à la hauteur voulue dans le rendu.',
  camera: 'Cliquez un mur, à la hauteur voulue dans le rendu.',
  charger: 'Cliquez un mur, près du garage.',
  lamppost: 'Cliquez dans le plan ou sur le rendu.',
  heatpump: 'Cliquez près d’un mur, dans le plan ou le rendu.',
  mailbox: 'Cliquez dans le plan ou sur le rendu, près du portail.',
  carport: 'Cliquez dans le plan ou sur le rendu.',
  frame: 'Glissez dans le plan pour délimiter la zone à montrer.',
};

/** The whole story of each tool, for its tooltip. */
export const TIPS = {
  select: 'Cliquez un élément pour le régler, glissez pour le déplacer — une ouverture coulisse le long des murs. Dans le rendu, l’élément sélectionné se déplace aussi au glisser ; ailleurs, glisser fait tourner la maison. Le pavé du rendu bascule entre pivoter et déplacer.',
  paint: 'Dessinez l’emprise de la maison case par case. Alt efface.',
  rect: 'Glissez pour ajouter un volume rectangulaire. Alt retire.',
  erase: 'Glissez pour retirer des cases.',
  window: 'Cliquez près d’un mur, dans le plan ou sur le rendu, pour poser une fenêtre.',
  shutter: 'Cliquez près d’un mur pour poser une fenêtre à volets.',
  door: 'Cliquez près d’un mur pour poser une porte.',
  garage: 'Cliquez près d’un mur pour poser une porte de garage.',
  solar: 'Cliquez sur le toit, dans le plan ou sur le rendu, pour poser des panneaux.',
  chimney: 'Cliquez sur le toit, dans le plan ou sur le rendu, pour poser une cheminée.',
  velux: 'Cliquez sur le toit, dans le plan ou sur le rendu, pour poser une fenêtre de toit.',
  dish: 'Cliquez sur le toit, dans le plan ou sur le rendu, pour poser une parabole.',
  pool: 'Cliquez dans le plan — ou directement sur le rendu — pour poser la piscine.',
  terrace: 'Cliquez dans le plan ou sur le rendu pour poser la terrasse.',
  path: 'Cliquez dans le plan ou sur le rendu pour poser l’allée.',
  stairs: 'Cliquez au pied d’une terrasse surélevée : l’escalier prend sa hauteur et se tourne vers elle.',
  tree: 'Cliquez dans le plan ou sur le rendu pour planter un arbre.',
  bush: 'Cliquez dans le plan ou sur le rendu pour planter un buisson.',
  hedge: 'Glissez dans le plan pour tracer la haie.',
  fence: 'Glissez dans le plan pour tracer la clôture.',
  car: 'Cliquez dans le plan ou sur le rendu pour garer la voiture.',
  muret: 'Glissez dans le plan pour tracer le muret — sa longueur s’affiche pendant le tracé.',
  frame: 'Glissez dans le plan pour délimiter la zone à montrer : le rendu se recadre dessus et le reste disparaît.',
  gate: 'Cliquez près d’un muret : le portail s’y aligne et l’ouvre automatiquement.',
  wallLight: 'Cliquez un mur, dans le plan ou sur le rendu — à la hauteur voulue — pour fixer une applique. Elle s’allume en vue de nuit.',
  camera: 'Cliquez un mur, dans le plan ou sur le rendu, pour fixer une caméra de surveillance.',
  charger: 'Cliquez un mur, près du garage, pour fixer une borne de recharge.',
  lamppost: 'Cliquez dans le plan ou sur le rendu pour planter un lampadaire. Il s’allume en vue de nuit.',
  heatpump: 'Cliquez près d’un mur, dans le plan ou sur le rendu, pour poser la pompe à chaleur.',
  mailbox: 'Cliquez dans le plan ou sur le rendu pour planter la boîte aux lettres, près du portail.',
  carport: 'Cliquez dans le plan ou sur le rendu pour poser un carport ; une voiture se gare dessous.',
};

/** The three ways the drawings share the centre, and their keys. */
export const LAYOUTS = [
  { id: 'plan', label: 'Plan', title: 'Le plan seul', key: '1' },
  { id: 'both', label: 'Les deux', title: 'Le plan et le rendu côte à côte', key: '2' },
  { id: 'render', label: 'Rendu', title: 'Le rendu seul', key: '3' },
];

/** The phone's three screens. */
export const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'render', label: 'Rendu' },
  { id: 'settings', label: 'Réglages' },
];

/**
 * Every shortcut, as the help dialog lists them. The tool keys come from the
 * palette above, so the two cannot disagree.
 */
export const SHORTCUT_SECTIONS = [
  {
    title: 'Projet', keys: [
      ['Ctrl+S', 'Enregistrer le projet'],
      ['Ctrl+Maj+S', 'Enregistrer sous…'],
      ['Ctrl+O', 'Ouvrir un projet'],
      ['Ctrl+E', 'Exporter une image'],
      ['Ctrl+Z', 'Annuler'],
      ['Ctrl+Maj+Z ou Ctrl+Y', 'Rétablir'],
      ['?', 'Cette aide'],
    ],
  },
  {
    title: 'Sélection', keys: [
      ['Échap', 'Annuler le geste en cours, puis revenir à Sélectionner, puis désélectionner'],
      ['Suppr', 'Supprimer l’élément sélectionné'],
      ['Ctrl+D', 'Dupliquer la sélection (ou le corps)'],
      ['Flèches', 'Déplacer la sélection (Maj : plus loin)'],
    ],
  },
  {
    title: 'Vues', keys: [
      ['1 · 2 · 3', 'Plan seul · les deux · rendu seul'],
      ['[ et ]', 'Tourner le rendu d’un quart de tour'],
      ['Espace + glisser', 'Déplacer le plan'],
      ['Molette', 'Zoomer, dans le plan comme dans le rendu'],
      ['Maj + glisser', 'Dans le rendu : déplacer au lieu de pivoter'],
      ['Alt + glisser', 'Dans le rendu : incliner l’image'],
    ],
  },
];

export const T = {
  newTitle: 'Repartir de zéro ?',
  newBody: 'Le projet ouvert est remplacé par une page blanche. Ctrl+Z (« Annuler ») le ramène.',
  newConfirm: 'Page blanche',
  cancel: 'Annuler',
  close: 'Fermer',
  newDone: 'Nouveau projet — Ctrl+Z ramène le précédent',
  galleryLead: 'Choisissez le modèle le plus proche de votre maison, puis ajustez-le. Rien n’est définitif : tout se remodèle ensuite.',
  galleryReplace: 'Le modèle remplace le projet ouvert ; Ctrl+Z (« Annuler ») le ramène.',
  galleryDone: (name) => `« ${name} » ouvert — Ctrl+Z ramène le projet précédent`,
  saved: 'Projet enregistré',
  savedTo: (name) => `Projet enregistré dans « ${name} »`,
  saveFailed: (msg) => `Enregistrement impossible : ${msg}`,
  opened: 'Projet chargé',
  openedNewer: 'Projet chargé — enregistré par une version plus récente : certains réglages peuvent manquer',
  dropHere: 'Déposez le fichier .house.json pour l’ouvrir',
  dropRefused: 'Seul un fichier de projet (.house.json) s’ouvre ici',
  shareCopied: 'Lien copié — il contient tout le projet',
  shareTitle: 'Lien de partage',
  shareBody: 'Copiez ce lien : il contient tout le projet, rien n’est envoyé nulle part.',
  viewName: 'Nom de la vue',
  viewNew: 'Enregistrer cette vue',
  viewRename: 'Renommer la vue',
  viewSave: 'Enregistrer',
  viewRenameOk: 'Renommer',
  viewUpdated: (name) => `Vue « ${name} » mise à jour avec la vue en cours`,
  viewDeleted: (name) => `Vue « ${name} » supprimée`,
  undo: 'Annuler',
  shortcutsTitle: 'Raccourcis clavier',
  shortcutsLead: 'Aucun raccourci à une touche n’agit pendant une saisie dans un champ.',
  shortcutsTools: 'Outils',
  menu: 'Actions du projet',
};

export const EXPORT_T = {
  title: 'Exporter une image',
  lead: 'Le fond transparent permet de déposer l’image sur n’importe quel tableau de bord.',
  size: 'Taille',
  custom: 'Personnalisée…',
  width: 'Largeur',
  height: 'Hauteur',
  pixels: 'px',
  background: 'Fond',
  backgrounds: [
    ['transparent', 'Transparent'],
    ['#ffffff', 'Blanc'],
    ['#f4f6f8', 'Gris clair'],
    ['#0f172a', 'Sombre'],
  ],
  customColour: 'Couleur',
  nightNote: 'Vue de nuit : son ciel étoilé est le fond de l’image, qui ne peut donc pas être transparente. Désactivez la vue de nuit (Apparence) pour choisir un fond.',
  preview: 'Aperçu de l’image exportée',
  png: 'PNG',
  svg: 'SVG',
  copy: 'Copier',
  four: 'Les 4 faces (.zip)',
  views: 'Vues enregistrées (.zip)',
  fourTitle: 'Une image par quart de tour, réunies dans une archive',
  viewsTitle: 'Une image par vue enregistrée, réunies dans une archive',
  noViews: 'Aucune vue enregistrée — cadrez une zone puis « Enregistrer cette vue » (Réglages, Vue).',
  rendering: 'Rendu en cours…',
  pngDone: 'Image PNG téléchargée.',
  svgDone: 'Fichier SVG téléchargé.',
  copyDone: 'Image copiée dans le presse-papier.',
  face: (n, total) => `Face ${n} sur ${total}…`,
  view: (n, total) => `Vue ${n} sur ${total}…`,
  zipDone: (n) => `Archive de ${n} image${n > 1 ? 's' : ''} téléchargée.`,
  failed: (msg) => `Échec : ${msg}`,
  tooBig: (max) => `jusqu’à ${max} px de côté`,
  file: (w, h) => `${w} × ${h} px`,
};
