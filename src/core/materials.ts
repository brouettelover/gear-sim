/**
 * Matériaux d'impression FDM.
 * Les contraintes admissibles sont des valeurs prudentes pour des pièces imprimées
 * (fatigue en flexion, couches mal fusionnées, porosité), bien en dessous des valeurs
 * de fiches techniques mesurées sur éprouvettes injectées. À ajuster selon vos essais.
 */
import { MPA } from './units';

export interface Material {
  id: string;
  name: string;
  /** masse volumique (kg/m³) */
  density: number;
  /** contrainte admissible en flexion en pied de dent (Pa) */
  allowableBending: number;
  /** température de transition vitreuse (°C) */
  tg: number;
  /** température d'usage maximale conseillée sous charge (°C) */
  maxServiceTemp: number;
  notes: string;
}

export const DEFAULT_MATERIALS: Material[] = [
  { id: 'PLA', name: 'PLA', density: 1240, allowableBending: 20 * MPA, tg: 60, maxServiceTemp: 45, notes: 'Rigide, facile, mais flue dès 45–50 °C : à éviter au contact d\'un moteur chaud.' },
  { id: 'PETG', name: 'PETG', density: 1270, allowableBending: 15 * MPA, tg: 80, maxServiceTemp: 65, notes: 'Plus tenace que le PLA, un peu moins rigide.' },
  { id: 'ABS', name: 'ABS', density: 1040, allowableBending: 15 * MPA, tg: 105, maxServiceTemp: 85, notes: 'Bonne tenue en température, sensible au délaminage.' },
  { id: 'ASA', name: 'ASA', density: 1070, allowableBending: 15 * MPA, tg: 100, maxServiceTemp: 85, notes: 'Comme l\'ABS, résistant aux UV.' },
  { id: 'PA', name: 'PA (nylon)', density: 1140, allowableBending: 18 * MPA, tg: 50, maxServiceTemp: 80, notes: 'Très bon frottement et tenue aux chocs ; hygroscopique (sécher la bobine). Tg basse mais semi-cristallin.' },
  { id: 'PA-CF', name: 'PA-CF', density: 1200, allowableBending: 28 * MPA, tg: 60, maxServiceTemp: 100, notes: 'Rigide et résistant ; buse acier trempé, abrasif pour la roue en face.' },
  { id: 'POM', name: 'POM (acétal)', density: 1410, allowableBending: 22 * MPA, tg: -60, maxServiceTemp: 90, notes: 'Excellent coefficient de frottement ; adhésion au plateau difficile.' },
];

export function findMaterial(list: Material[], id: string): Material {
  return list.find((m) => m.id === id) ?? list[0];
}
