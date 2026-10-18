/**
 * Vis sans fin et roue, axes croisés à 90°.
 *
 *   q = d1 / m (coefficient diamétral), z1 filets, m module axial de la vis
 *   tan γ = z1 / q                 angle d'inclinaison du filet
 *   d1 = q·m, d2 = z2·m, a = (d1 + d2)/2, rapport i = z2 / z1
 *
 * Modélisation : la vis est une roue hélicoïdale à z1 dents et à angle d'hélice 90° − γ
 * (vis à flancs en développante, type ZI), la roue une roue hélicoïdale cylindrique d'angle γ,
 * de même sens d'hélice (contact ponctuel : pas de gorge, simplification adaptée à l'impression).
 * Module normal commun mn = m·cos γ.
 *
 * Rendement (frottement μ, angle de frottement φ' = atan(μ / cos αn)) :
 *   vis menante  η = tan γ / tan(γ + φ')
 *   roue menante η' = tan(γ − φ') / tan γ, négatif ou nul : irréversible (la charge ne peut pas entraîner la vis).
 */
import { gearGeometry, meshGeometry, type GearGeometry } from './involute';
import type { GearSpec, PrintSettings, Warning } from './types';
import { fmt } from './units';

/** Coefficient de frottement plastique sur plastique à sec (PLA, PETG), simplification. */
export const WORM_FRICTION = 0.2;
export const DEFAULT_Q = 10;

export const wormHand = (worm: GearSpec) => (worm.helixAngle < 0 ? -1 : 1);
export const leadAngle = (worm: GearSpec) => Math.atan(worm.teeth / (worm.diameterFactor ?? DEFAULT_Q));

/** Définition équivalente de la vis (roue hélicoïdale), utilisée pour le profil et l'export. */
export function wormCutSpec(worm: GearSpec): GearSpec {
  const g = leadAngle(worm);
  return { ...worm, type: 'helical', module: worm.module * Math.cos(g), helixAngle: wormHand(worm) * (Math.PI / 2 - g), profileShift: 0 };
}

/** Définition équivalente de la roue, d'après la vis avec laquelle elle engrène. */
export function wheelCutSpec(wheel: GearSpec, worm: GearSpec | undefined): GearSpec {
  const g = worm ? leadAngle(worm) : Math.atan(1 / DEFAULT_Q);
  const h = worm ? wormHand(worm) : 1;
  return { ...wheel, type: 'helical', module: wheel.module * Math.cos(g), helixAngle: h * g, profileShift: 0 };
}

export function wormEfficiency(gamma: number, alphaN: number, mu = WORM_FRICTION) {
  const phi = Math.atan(mu / Math.cos(alphaN));
  const forward = Math.tan(gamma) / Math.tan(gamma + phi);
  const backward = Math.tan(gamma - phi) / Math.tan(gamma);
  return { forward, backward, selfLocking: backward <= 0, frictionAngle: phi };
}

export interface WormPair {
  worm: GearGeometry;
  wheel: GearGeometry;
  gamma: number;
  centerDistance: number;
  /** z2 / z1 */
  ratio: number;
  efficiency: ReturnType<typeof wormEfficiency>;
  contactRatio: number;
  warnings: Warning[];
}

export function wormPair(worm: GearSpec, wheel: GearSpec, print: PrintSettings): WormPair {
  const gamma = leadAngle(worm);
  const gw = gearGeometry(wormCutSpec(worm), print);
  const gg = gearGeometry(wheelCutSpec(wheel, worm), print);
  const warnings: Warning[] = [];
  if (Math.abs(worm.module - wheel.module) > 1e-12) warnings.push({ severity: 'error', message: 'Vis et roue doivent avoir le même module.' });
  if (Math.abs(worm.pressureAngle - wheel.pressureAngle) > 1e-12) warnings.push({ severity: 'error', message: 'Vis et roue doivent avoir le même angle de pression.' });
  // conduite : roue face à la section axiale de la vis (crémaillère), approximation
  const rack = gearGeometry({ ...wheel, type: 'rack', module: gg.mn, helixAngle: 0, profileShift: 0 }, print);
  const contactRatio = meshGeometry({ ...gg, beta: 0 }, rack).contactRatio;
  const efficiency = wormEfficiency(gamma, worm.pressureAngle);
  if (gg.x < gg.xMin - 1e-9) warnings.push({ severity: 'warning', message: `Roue de vis : ${wheel.teeth} dents, dégagement en pied (au moins ${Math.ceil(gg.zMin)} dents conseillées).` });
  if (gamma > (25 * Math.PI) / 180) warnings.push({ severity: 'warning', message: `Filet très incliné (γ = ${fmt((gamma * 180) / Math.PI, 1)}°) : forte poussée axiale, réduisez le nombre de filets ou augmentez q.` });
  return { worm: gw, wheel: gg, gamma, centerDistance: gw.r + gg.r, ratio: wheel.teeth / worm.teeth, efficiency, contactRatio, warnings };
}
