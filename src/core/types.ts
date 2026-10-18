/**
 * Types partagés par les modules de calcul.
 * Toutes les grandeurs physiques sont en SI (m, rad, kg, N·m…).
 */

/**
 * bevel : conique droit (axes concourants à 90°) ; worm : vis sans fin ; wormwheel : roue de vis sans fin
 * (axes croisés à 90°).
 */
export type GearType = 'spur' | 'helical' | 'herringbone' | 'rack' | 'internal' | 'bevel' | 'worm' | 'wormwheel';
export type BoreType = 'none' | 'round' | 'd' | 'hex';

export interface BoreSpec {
  type: BoreType;
  /** rond / D : diamètre de l'arbre ; hexagonal : cote sur plats (m) */
  diameter: number;
  /** D : distance entre le méplat et le côté opposé (m), ex. 2,5 mm pour l'arbre N20 */
  flat: number;
}

export interface GearSpec {
  id: string;
  name: string;
  type: GearType;
  /** module normal mn (m) ; vis sans fin et sa roue : module axial de la vis (= module apparent de la roue) */
  module: number;
  /** nombre de dents (crémaillère : nombre de dents de la longueur imprimée) */
  teeth: number;
  /** angle de pression normal αn (rad) */
  pressureAngle: number;
  /** largeur de denture b (m) ; chevron : largeur totale des deux demi-dentures */
  faceWidth: number;
  /** coefficient de déport de profil x (sans unité) */
  profileShift: number;
  /** angle d'hélice β (rad), signé : > 0 hélice à droite, < 0 hélice à gauche ; vis sans fin : seul le signe compte (sens du filet) */
  helixAngle: number;
  /** vis sans fin : coefficient diamétral q = d / m (diamètre primitif / module axial), 10 par défaut */
  diameterFactor?: number;
  bore: BoreSpec;
  /** couronne intérieure : épaisseur de jante sous le pied (m) ; crémaillère : hauteur de dos sous le pied ; conique : épaisseur du dos */
  rimWidth: number;
  materialId: string;
}

/** Réglages propres à l'impression FDM, communs à tout le projet. */
export interface PrintSettings {
  /** jeu au flanc total par engrènement (m), mesuré sur le cercle primitif ; chaque roue est amincie de la moitié */
  backlash: number;
  /** coefficient de jeu radial c* (jeu en pied = c*·m), 0,25 en standard */
  clearanceCoef: number;
  /** compensation ajoutée au diamètre des alésages (m), ex. +0,1 mm */
  boreTolerance: number;
  /** diamètre de buse (m) */
  nozzle: number;
  /** densité effective de la pièce imprimée / densité du matériau (0–1), pour l'inertie */
  fillFactor: number;
}

export type Severity = 'info' | 'warning' | 'error';

export interface Warning {
  severity: Severity;
  message: string;
}

export interface Point {
  x: number;
  y: number;
}

/** Contour fermé avec trous éventuels (contour extérieur anti-horaire, trous horaires). */
export interface Shape {
  outer: Point[];
  holes: Point[][];
}
