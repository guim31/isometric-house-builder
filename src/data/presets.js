/**
 * Starter houses.
 *
 * Ten shapes rather than ten colour schemes: what makes a house read as
 * northern or as a mountain chalet is the pitch of its roof, the depth of its
 * eaves and the number of storeys far more than its hue. Colours stay in the
 * Horizons register — applied as per-material overrides rather than separate
 * palettes — so any of them still sits comfortably on a dashboard.
 */

import { rectCells } from '../core/grid.js';

const cells = (...rects) => [...new Set(rects.flatMap((r) => [...rectCells(...r)]))].sort();

const win = (edge, o = {}) => ({ edge, storey: 0, kind: 'window', offset: 0.5, width: 1.4, height: 1.35, sill: 0.9, ...o });
const shut = (edge, o = {}) => win(edge, { kind: 'shutter', ...o });
const door = (edge, o = {}) => ({ edge, storey: 0, kind: 'door', offset: 0.5, width: 1.05, height: 2.15, sill: 0, ...o });
const garage = (edge, o = {}) => ({ edge, storey: 0, kind: 'garage', offset: 0.5, width: 2.6, height: 2.2, sill: 0, ...o });

export const PRESETS = [
  {
    id: 'pavillon',
    name: 'Pavillon familial',
    note: 'Le plan le plus répandu en France : un corps rectangulaire, un garage accolé, une toiture à quatre pans.',
    model: {
      cells: cells([13, 14, 22, 21], [23, 14, 27, 18]),
      storeys: 1, storeyHeight: 2.6, plinth: 0,
      roof: { type: 'hip', pitch: 30, overhang: 0.5, fascia: 0.16, shedDir: 'S' },
      texture: { roof: 'tiles', wall: 'none' },
      openings: [
        shut('14,21,N'), win('17,21,N', { width: 1.9, height: 1.45 }), door('20,21,N'),
        garage('25,18,N'), shut('22,20,E'), win('22,19,E'),
      ],
      roofItems: [
        { kind: 'solar', x: 17.5, y: 16.4, w: 4.2, d: 2.4 },
        { kind: 'chimney', x: 20.5, y: 17.5, w: 0.8, d: 0.8, h: 1.1 },
      ],
      props: [
        { kind: 'path', x: 19.2, y: 22.1, w: 2.4, d: 2.6, material: 'paving' },
        { kind: 'car', x: 25, y: 21.5, w: 1.8, d: 4.2 },
        { kind: 'bush', x: 11.6, y: 19, r: 1.1 },
        { kind: 'bush', x: 12.4, y: 15.5, r: 0.9 },
        { kind: 'tree', x: 29.5, y: 22, r: 1.7 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2.5 },
    },
  },
  {
    id: 'nord',
    name: 'Maison de brique du Nord',
    note: 'Flandre et Hainaut : brique rouge, pignon étroit, toiture d’ardoise très pentue et sans débord.',
    model: {
      cells: cells([15, 15, 23, 21]),
      storeys: 2, storeyHeight: 2.7, plinth: 0,
      roof: { type: 'gable', pitch: 45, overhang: 0.2, fascia: 0.1, shedDir: 'S' },
      texture: { roof: 'slate', wall: 'brick' },
      overrides: { wall: '#c68d7d', roof: '#7c8794', trim: '#ffffff', door: '#3f4a5a' },
      openings: [
        win('16,21,N', { width: 1.1, height: 1.7, sill: 0.75 }),
        door('19,21,N'),
        win('22,21,N', { width: 1.1, height: 1.7, sill: 0.75 }),
        win('16,21,N', { storey: 1, width: 1.1, height: 1.6, sill: 0.6 }),
        win('19,21,N', { storey: 1, width: 1.1, height: 1.6, sill: 0.6 }),
        win('22,21,N', { storey: 1, width: 1.1, height: 1.6, sill: 0.6 }),
        win('23,18,E', { width: 1.1, height: 1.6, sill: 0.8 }),
        win('23,18,E', { storey: 1, width: 1.1, height: 1.6, sill: 0.6 }),
      ],
      roofItems: [{ kind: 'chimney', x: 22.6, y: 18, w: 0.9, d: 0.9, h: 1.4 }],
      props: [
        { kind: 'path', x: 18.4, y: 22.1, w: 2.2, d: 2, material: 'paving' },
        { kind: 'hedge', x: 14.5, y: 24, w: 9.5, d: 0.6, h: 1 },
        { kind: 'bush', x: 13.4, y: 18, r: 0.9 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2 },
    },
  },
  {
    id: 'provence',
    name: 'Mas provençal',
    note: 'Plan en L autour d’une terrasse, toiture de tuiles à faible pente et large débord, volets aux teintes d’olivier.',
    model: {
      cells: cells([12, 14, 24, 20], [19, 21, 24, 26]),
      storeys: 1, storeyHeight: 2.8, plinth: 0,
      roof: { type: 'hip', pitch: 25, overhang: 0.85, fascia: 0.2, shedDir: 'S' },
      texture: { roof: 'tiles', wall: 'none' },
      overrides: { wall: '#ead8b6', roof: '#dda678', shutter: '#94b1a0', door: '#7b9a8a', plinth: '#dccfae' },
      openings: [
        shut('13,20,N', { width: 1.4 }), shut('16,20,N', { width: 1.4 }), door('18,20,N'),
        shut('21,26,N', { width: 1.5 }), shut('23,26,N', { width: 1.5 }),
        shut('24,16,E', { width: 1.4 }), shut('24,23,E', { width: 1.4 }),
      ],
      roofItems: [
        { kind: 'chimney', x: 15, y: 17, w: 0.9, d: 0.9, h: 1.2 },
        { kind: 'solar', x: 21.5, y: 16, w: 3.8, d: 2.2 },
      ],
      props: [
        { kind: 'terrace', x: 12, y: 21, w: 6.5, d: 5, material: 'paving' },
        { kind: 'pool', x: 12.5, y: 22, w: 5.5, d: 3, shape: 'rounded' },
        { kind: 'tree', x: 10, y: 27, r: 1.8 },
        { kind: 'tree', x: 27, y: 24, r: 1.5 },
        { kind: 'bush', x: 26.5, y: 16, r: 1 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2.5 },
    },
  },
  {
    id: 'chalet',
    name: 'Chalet de montagne',
    note: 'Soubassement maçonné, bardage bois et surtout un très grand débord de toiture, qui protège les façades de la neige.',
    model: {
      cells: cells([15, 15, 24, 22]),
      storeys: 2, storeyHeight: 2.5, plinth: 0.7,
      roof: { type: 'gable', pitch: 28, overhang: 1.25, fascia: 0.28, shedDir: 'S' },
      texture: { roof: 'slate', wall: 'siding' },
      overrides: { wall: '#b5926e', roof: '#8f857a', plinth: '#c4bdb1', trim: '#f2ebde', door: '#6b5442' },
      openings: [
        win('16,22,N', { width: 1.3, height: 1.4 }), door('19,22,N'), win('22,22,N', { width: 1.3, height: 1.4 }),
        win('17,22,N', { storey: 1, width: 1.5, height: 1.4, sill: 0.5 }),
        win('21,22,N', { storey: 1, width: 1.5, height: 1.4, sill: 0.5 }),
        win('24,18,E', { width: 1.3, height: 1.4 }),
        win('24,20,E', { storey: 1, width: 1.3, height: 1.4, sill: 0.5 }),
      ],
      roofItems: [{ kind: 'chimney', x: 22.5, y: 18.5, w: 1, d: 1, h: 1.5 }],
      props: [
        { kind: 'path', x: 18.3, y: 24.4, w: 2.4, d: 2.4, material: 'gravel' },
        { kind: 'bush', x: 12.8, y: 20, r: 1 },
        { kind: 'tree', x: 28, y: 24, r: 2.1 },
        { kind: 'tree', x: 12, y: 15, r: 1.7 },
      ],
      ground: { enabled: true, material: 'grass', margin: 3 },
    },
  },
  {
    id: 'passive',
    name: 'Maison passive solaire',
    note: 'Volume compact pour limiter les déperditions, toiture à un seul pan entièrement couverte de panneaux, larges baies.',
    model: {
      cells: cells([16, 15, 24, 21]),
      storeys: 2, storeyHeight: 2.6, plinth: 0,
      roof: { type: 'shed', pitch: 18, overhang: 0.6, fascia: 0.18, shedDir: 'N' },
      texture: { roof: 'seam', wall: 'siding' },
      overrides: { wall: '#dfd2b9', roof: '#9aa3a8', trim: '#ffffff', door: '#5d6f5a' },
      openings: [
        win('17,21,N', { width: 2.6, height: 1.9, sill: 0.55 }),
        door('20,21,N'),
        win('22,21,N', { width: 2.6, height: 1.9, sill: 0.55 }),
        win('18,21,N', { storey: 1, width: 2.6, height: 1.6, sill: 0.5 }),
        win('22,21,N', { storey: 1, width: 2.6, height: 1.6, sill: 0.5 }),
        win('24,18,E', { width: 1.4, height: 1.5 }),
      ],
      roofItems: [
        { kind: 'solar', x: 18.4, y: 18, w: 4.4, d: 4.6 },
        { kind: 'solar', x: 22.4, y: 18, w: 3, d: 4.6 },
      ],
      props: [
        { kind: 'path', x: 19.4, y: 22.2, w: 2.2, d: 2.2, material: 'paving' },
        { kind: 'hedge', x: 15, y: 24.5, w: 10, d: 0.7, h: 0.9 },
        { kind: 'bush', x: 14, y: 19, r: 1 }, { kind: 'bush', x: 26.5, y: 17, r: 1.2 },
        { kind: 'tree', x: 27.5, y: 22.5, r: 1.6 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2.5 },
    },
  },
  {
    id: 'longere',
    name: 'Longère bretonne',
    note: 'Très allongée et peu profonde, une pièce dans la largeur, couverte d’ardoise et percée de fenêtres de toit.',
    model: {
      cells: cells([11, 16, 28, 21]),
      storeys: 1, storeyHeight: 2.5, plinth: 0,
      roof: { type: 'gable', pitch: 45, overhang: 0.25, fascia: 0.12, shedDir: 'S' },
      texture: { roof: 'slate', wall: 'stone' },
      overrides: { wall: '#e7e1d3', roof: '#78838f', trim: '#ffffff', door: '#4c5f6b' },
      openings: [
        win('12,21,N', { width: 1.2, height: 1.4 }), win('15,21,N', { width: 1.2, height: 1.4 }),
        door('18,21,N'), win('21,21,N', { width: 1.2, height: 1.4 }),
        win('24,21,N', { width: 1.2, height: 1.4 }), win('27,21,N', { width: 1.2, height: 1.4 }),
      ],
      roofItems: [
        { kind: 'chimney', x: 11.6, y: 18.5, w: 1, d: 1, h: 1.5 },
        { kind: 'chimney', x: 28.4, y: 18.5, w: 1, d: 1, h: 1.5 },
        { kind: 'velux', x: 16, y: 19.6, w: 1, d: 1.2 },
        { kind: 'velux', x: 20, y: 19.6, w: 1, d: 1.2 },
        { kind: 'velux', x: 24, y: 19.6, w: 1, d: 1.2 },
      ],
      props: [
        { kind: 'path', x: 17.4, y: 22.1, w: 2.2, d: 2, material: 'gravel' },
        { kind: 'hedge', x: 11, y: 24.5, w: 18, d: 0.7, h: 1 },
        { kind: 'bush', x: 9.4, y: 19, r: 1 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2.5 },
    },
  },
  {
    id: 'colombages',
    name: 'Maison à colombages',
    note: 'Pays d’Auge et Alsace : ossature bois apparente sur torchis clair, toiture très pentue, volume étroit et haut.',
    model: {
      cells: cells([16, 16, 23, 22]),
      storeys: 2, storeyHeight: 2.5, plinth: 0,
      roof: { type: 'gable', pitch: 50, overhang: 0.45, fascia: 0.14, shedDir: 'S' },
      texture: { roof: 'tiles', wall: 'timber' },
      overrides: { wall: '#efe6d6', roof: '#9a7f6c', trim: '#ffffff', door: '#7a5a41' },
      openings: [
        win('17,22,N', { width: 1.1, height: 1.4 }), door('19,22,N'), win('22,22,N', { width: 1.1, height: 1.4 }),
        win('17,22,N', { storey: 1, width: 1.1, height: 1.3, sill: 0.6 }),
        win('20,22,N', { storey: 1, width: 1.1, height: 1.3, sill: 0.6 }),
        win('23,19,E', { width: 1.1, height: 1.4 }),
        win('23,19,E', { storey: 1, width: 1.1, height: 1.3, sill: 0.6 }),
      ],
      roofItems: [{ kind: 'chimney', x: 22, y: 19, w: 0.9, d: 0.9, h: 1.3 }],
      props: [
        { kind: 'path', x: 18.4, y: 23.1, w: 2.2, d: 2, material: 'paving' },
        { kind: 'bush', x: 14.6, y: 20, r: 1 }, { kind: 'bush', x: 25.4, y: 18, r: 0.9 },
        { kind: 'tree', x: 27, y: 23, r: 1.7 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2.5 },
    },
  },
  {
    id: 'basque',
    name: 'Etxe basque',
    note: 'Large façade blanche sous un grand débord, pans de bois et volets au rouge basque, toiture de tuiles à deux pans.',
    model: {
      cells: cells([13, 14, 25, 22]),
      storeys: 2, storeyHeight: 2.6, plinth: 0,
      roof: { type: 'gable', pitch: 32, overhang: 0.9, fascia: 0.22, shedDir: 'S' },
      texture: { roof: 'tiles', wall: 'none' },
      overrides: { wall: '#f5efe4', roof: '#d9917a', shutter: '#b5544c', door: '#a04a43', trim: '#ffffff' },
      openings: [
        shut('14,22,N', { width: 1.3 }), shut('17,22,N', { width: 1.3 }), door('20,22,N'), shut('23,22,N', { width: 1.3 }),
        shut('15,22,N', { storey: 1, width: 1.3, sill: 0.6 }),
        shut('19,22,N', { storey: 1, width: 1.3, sill: 0.6 }),
        shut('22,22,N', { storey: 1, width: 1.3, sill: 0.6 }),
        shut('25,18,E', { width: 1.3 }),
      ],
      roofItems: [{ kind: 'chimney', x: 23, y: 18, w: 0.9, d: 0.9, h: 1.2 }],
      props: [
        { kind: 'path', x: 19.4, y: 23.1, w: 2.4, d: 2.2, material: 'paving' },
        { kind: 'hedge', x: 13, y: 25, w: 6, d: 0.6, h: 0.8 },
        { kind: 'bush', x: 11, y: 19, r: 1.1 },
        { kind: 'tree', x: 28.5, y: 22, r: 1.9 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2.5 },
    },
  },
  {
    id: 'contemporaine',
    name: 'Maison contemporaine',
    note: 'Volumes décalés, toiture-terrasse et grandes baies vitrées ; le débord se réduit à une acrotère marquée.',
    model: {
      cells: cells([14, 15, 22, 22], [23, 17, 28, 22]),
      storeys: 2, storeyHeight: 2.8, plinth: 0,
      roof: { type: 'flat', pitch: 5, overhang: 0.4, fascia: 0.26, shedDir: 'S' },
      texture: { roof: 'none', wall: 'none' },
      overrides: { wall: '#e9e7e2', roof: '#c9c6c0', trim: '#ffffff', door: '#48555f', glass: '#c3d9ea' },
      openings: [
        win('15,22,N', { width: 3.2, height: 2.1, sill: 0.4 }),
        door('19,22,N'),
        win('21,22,N', { width: 2.2, height: 2.1, sill: 0.4 }),
        win('16,22,N', { storey: 1, width: 3.2, height: 1.8, sill: 0.5 }),
        win('20,22,N', { storey: 1, width: 2.2, height: 1.8, sill: 0.5 }),
        win('25,22,N', { width: 3.2, height: 2.1, sill: 0.4 }),
        win('28,19,E', { width: 2.4, height: 2.1, sill: 0.4 }),
      ],
      roofItems: [
        { kind: 'solar', x: 17.5, y: 18, w: 5, d: 3 },
        { kind: 'solar', x: 25.5, y: 19.5, w: 3.6, d: 2.6 },
      ],
      props: [
        { kind: 'deck', x: 14, y: 23, w: 9, d: 3.5 },
        { kind: 'pool', x: 15, y: 27.2, w: 7, d: 3, shape: 'rect' },
        { kind: 'bush', x: 12, y: 18, r: 1 }, { kind: 'bush', x: 30, y: 20, r: 1.1 },
        { kind: 'car', x: 30.5, y: 25, w: 1.8, d: 4.2 },
      ],
      ground: { enabled: true, material: 'grass', margin: 2.5 },
    },
  },
  {
    id: 'ville',
    name: 'Maison de ville',
    note: 'Étroite et profonde, mitoyenne, élevée sur trois niveaux ; le pignon donne sur la rue et porte toutes les ouvertures.',
    model: {
      cells: cells([18, 16, 23, 25]),
      storeys: 3, storeyHeight: 2.5, plinth: 0,
      roof: { type: 'gable', pitch: 42, overhang: 0.15, fascia: 0.1, shedDir: 'S' },
      texture: { roof: 'slate', wall: 'brick' },
      overrides: { wall: '#dfd3c4', roof: '#7f8996', trim: '#ffffff', door: '#4a5a63' },
      openings: [
        door('19,25,N'), win('22,25,N', { width: 1.2, height: 1.7, sill: 0.7 }),
        win('19,25,N', { storey: 1, width: 1.2, height: 1.6, sill: 0.6 }),
        win('22,25,N', { storey: 1, width: 1.2, height: 1.6, sill: 0.6 }),
        win('19,25,N', { storey: 2, width: 1.2, height: 1.5, sill: 0.6 }),
        win('22,25,N', { storey: 2, width: 1.2, height: 1.5, sill: 0.6 }),
      ],
      roofItems: [{ kind: 'chimney', x: 20.5, y: 16.6, w: 0.9, d: 0.9, h: 1.4 }],
      props: [
        { kind: 'path', x: 18, y: 26, w: 6, d: 2.2, material: 'paving' },
        { kind: 'bush', x: 16.3, y: 25, r: 0.8 },
      ],
      ground: { enabled: true, material: 'paving', margin: 1.5 },
    },
  },
];

export const getPreset = (id) => PRESETS.find((p) => p.id === id) || null;
