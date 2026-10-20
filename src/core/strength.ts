/**
 * Résistance des dents en flexion (formule de Lewis, cf. Shigley).
 *
 *   σ = Kv · Ft / (b · m · Y)
 *
 *   Ft : effort tangentiel au primitif (N) = couple / rayon primitif
 *   b  : largeur de denture en prise (m)
 *   m  : module normal (m)
 *   Y  : facteur de forme de Lewis (denture 20°, pleine hauteur), fonction de z
 *        (nombre de dents virtuel zv = z / cos³β pour les hélicoïdaux)
 *   Kv : facteur dynamique simplifié (profil "moulé/brut") = (3,05 + V) / 3,05, V en m/s
 *
 * Coefficient de sécurité n = σ_admissible / σ.
 */
import type { GearGeometry } from './involute';

/** Table de Lewis (Shigley, tab. 14-2) : z → Y, angle de pression 20°, pleine hauteur. */
const LEWIS_TABLE: [number, number][] = [
  [12, 0.245], [13, 0.261], [14, 0.277], [15, 0.290], [16, 0.296], [17, 0.303],
  [18, 0.309], [19, 0.314], [20, 0.322], [21, 0.328], [22, 0.331], [24, 0.337],
  [26, 0.346], [28, 0.353], [30, 0.359], [34, 0.371], [38, 0.384], [43, 0.397],
  [50, 0.409], [60, 0.422], [75, 0.435], [100, 0.447], [150, 0.460], [300, 0.472],
  [400, 0.480],
];
export const LEWIS_RACK = 0.485;

/** Facteur de forme de Lewis interpolé linéairement ; extrapolé (prudemment) sous 12 dents. */
export function lewisFormFactor(z: number): number {
  if (!Number.isFinite(z)) return LEWIS_RACK;
  const t = LEWIS_TABLE;
  if (z <= t[0][0]) {
    // pente entre 12 et 13 dents prolongée, bornée à 0,15
    const slope = (t[1][1] - t[0][1]) / (t[1][0] - t[0][0]);
    return Math.max(0.15, t[0][1] - slope * (t[0][0] - z));
  }
  for (let i = 1; i < t.length; i++) {
    if (z <= t[i][0]) {
      const [z0, y0] = t[i - 1];
      const [z1, y1] = t[i];
      return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
    }
  }
  // au-delà de 400 dents : vers la crémaillère
  return Math.min(LEWIS_RACK, t[t.length - 1][1] + ((LEWIS_RACK - t[t.length - 1][1]) * (z - 400)) / 600);
}

/** Facteur dynamique de Barth pour un profil brut (le plus pénalisant), V en m/s. */
export const dynamicFactor = (v: number) => (3.05 + Math.abs(v)) / 3.05;

export interface BendingResult {
  /** effort tangentiel (N) */
  ft: number;
  /** vitesse au primitif (m/s) */
  v: number;
  y: number;
  kv: number;
  /** contrainte en pied de dent (Pa) */
  stress: number;
  /** coefficient de sécurité */
  safety: number;
}

/**
 * Contrainte de Lewis pour une roue.
 * @param ft effort tangentiel au primitif (N)
 * @param v vitesse linéaire au primitif (m/s)
 * @param width largeur en prise (m)
 * @param allowable contrainte admissible (Pa)
 */
export function lewisBending(g: GearGeometry, ft: number, v: number, width: number, allowable: number): BendingResult {
  // couronne intérieure : dents plus épaisses à la base ; on prend la valeur crémaillère
  const z = g.kind === 'external' ? g.zv : Infinity;
  const y = lewisFormFactor(z);
  const kv = dynamicFactor(v);
  const stress = (kv * Math.abs(ft)) / (width * g.mn * y);
  const safety = stress > 0 ? allowable / stress : Infinity;
  return { ft, v, y, kv, stress, safety };
}

export type SafetyLevel = 'ok' | 'marginal' | 'danger';

/** Seuils du code couleur : vert ≥ 2, orange ≥ 1,25, rouge en dessous. */
export function safetyLevel(n: number): SafetyLevel {
  if (n >= 2) return 'ok';
  if (n >= 1.25) return 'marginal';
  return 'danger';
}
