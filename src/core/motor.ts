/**
 * Modèle d'un moteur à courant continu à aimants permanents.
 *
 *   V = R·i + L·di/dt + Ke·ω         (équation électrique)
 *   T_arbre = Kt·i − Tf               (couple utile, Tf = frottement interne constant)
 *
 * Identification à partir de la fiche technique (tension nominale V, vitesse à vide ω0,
 * courant à vide I0, couple de blocage Ts, courant de blocage Is) :
 *   R  = V / Is                       (à l'arrêt, pas de f.c.é.m.)
 *   Ke = (V − R·I0) / ω0              (à vide)
 *   Kt = Ts / (Is − I0)               (le courant à vide ne sert qu'à vaincre Tf)
 *   Tf = Kt · I0
 * En SI, Kt et Ke devraient être égaux ; un écart signale une fiche technique approximative.
 *
 * Pour un motoréducteur (ex. N20 avec réducteur intégré), les valeurs de la fiche sont
 * données en sortie de réducteur : le modèle est alors un "moteur équivalent" en sortie.
 */
import { NMM, RPM } from './units';

export interface MotorSpec {
  id: string;
  name: string;
  /** tension nominale (V) */
  voltage: number;
  /** vitesse à vide (rad/s) */
  noLoadSpeed: number;
  /** courant à vide (A) */
  noLoadCurrent: number;
  /** couple de blocage (N·m) */
  stallTorque: number;
  /** courant de blocage (A) */
  stallCurrent: number;
  /** inductance (H) */
  inductance: number;
  /** inertie du rotor vue sur l'arbre de sortie du moteur (kg·m²) */
  rotorInertia: number;
  notes?: string;
}

export interface MotorModel {
  R: number;
  Kt: number;
  Ke: number;
  /** couple de frottement interne (N·m) */
  Tf: number;
  L: number;
  J: number;
  V: number;
  /** écart relatif entre Kt et Ke */
  ktKeMismatch: number;
  /** constante de temps électrique L/R (s) */
  tauE: number;
  /** constante de temps mécanique J·R/(Kt·Ke) (s) */
  tauM: number;
}

export function motorModel(m: MotorSpec): MotorModel {
  const R = m.voltage / m.stallCurrent;
  const Ke = (m.voltage - R * m.noLoadCurrent) / m.noLoadSpeed;
  const Kt = m.stallTorque / Math.max(1e-9, m.stallCurrent - m.noLoadCurrent);
  const Tf = Kt * m.noLoadCurrent;
  return {
    R, Kt, Ke, Tf,
    L: m.inductance,
    J: m.rotorInertia,
    V: m.voltage,
    ktKeMismatch: Math.abs(Kt - Ke) / Math.max(Kt, Ke),
    tauE: m.inductance / R,
    tauM: (m.rotorInertia * R) / (Kt * Ke),
  };
}

/** Couple utile en régime permanent à la vitesse ω sous la tension V (droite couple-vitesse). */
export function torqueAtSpeed(mm: MotorModel, omega: number, V = mm.V): number {
  const i = (V - mm.Ke * omega) / mm.R;
  return mm.Kt * i - mm.Tf * Math.sign(omega || 1);
}

/** Courant en régime permanent à la vitesse ω. */
export const currentAtSpeed = (mm: MotorModel, omega: number, V = mm.V) => (V - mm.Ke * omega) / mm.R;

/** Points de la caractéristique couple-vitesse (de 0 à la vitesse à vide). */
export function torqueSpeedCurve(mm: MotorModel, V = mm.V, n = 50) {
  const w0 = (V - mm.R * (mm.Tf / mm.Kt)) / mm.Ke; // vitesse à vide sous V
  const pts: { omega: number; torque: number; current: number; power: number; efficiency: number }[] = [];
  for (let k = 0; k <= n; k++) {
    const omega = (w0 * k) / n;
    const current = currentAtSpeed(mm, omega, V);
    const torque = Math.max(0, mm.Kt * current - mm.Tf);
    const power = torque * omega;
    pts.push({ omega, torque, current, power, efficiency: current > 0 ? power / (V * current) : 0 });
  }
  return pts;
}

/**
 * Préréglages : valeurs typiques relevées sur des fiches de fabricants courants.
 * Elles varient fortement d'un fournisseur à l'autre : vérifiez avec votre moteur.
 * Inductance et inertie : ordres de grandeur.
 */
export const MOTOR_PRESETS: MotorSpec[] = [
  { id: 'n20-6v-50', name: 'N20 6 V, réducteur 50:1 (≈ 600 tr/min)', voltage: 6, noLoadSpeed: 625 * RPM, noLoadCurrent: 0.1, stallTorque: 110 * NMM, stallCurrent: 1.5, inductance: 1.5e-3, rotorInertia: 4e-9 * 50 * 50, notes: 'Valeurs en sortie du réducteur intégré, arbre Ø3 mm en D (méplat 2,5 mm).' },
  { id: 'n20-6v-100', name: 'N20 6 V, réducteur 100:1 (≈ 300 tr/min)', voltage: 6, noLoadSpeed: 320 * RPM, noLoadCurrent: 0.1, stallTorque: 210 * NMM, stallCurrent: 1.5, inductance: 1.5e-3, rotorInertia: 4e-9 * 100 * 100, notes: 'Valeurs en sortie du réducteur intégré, arbre Ø3 mm en D (méplat 2,5 mm).' },
  { id: 'n20-6v-298', name: 'N20 6 V, réducteur 298:1 (≈ 100 tr/min)', voltage: 6, noLoadSpeed: 100 * RPM, noLoadCurrent: 0.1, stallTorque: 590 * NMM, stallCurrent: 1.5, inductance: 1.5e-3, rotorInertia: 4e-9 * 298 * 298, notes: 'Couple de blocage élevé : il peut casser des dents imprimées. Valeurs en sortie du réducteur.' },
  { id: 'n20-12v-1000', name: 'N20 12 V, réducteur 30:1 (≈ 1000 tr/min)', voltage: 12, noLoadSpeed: 1000 * RPM, noLoadCurrent: 0.04, stallTorque: 40 * NMM, stallCurrent: 0.6, inductance: 3e-3, rotorInertia: 4e-9 * 30 * 30, notes: 'Valeurs en sortie du réducteur intégré.' },
  { id: '130-3v', name: 'Moteur 130 (3 V)', voltage: 3, noLoadSpeed: 9100 * RPM, noLoadCurrent: 0.15, stallTorque: 2.5 * NMM, stallCurrent: 2.1, inductance: 0.15e-3, rotorInertia: 1.5e-7, notes: 'Type FA-130, arbre Ø2 mm.' },
  { id: '370-6v', name: 'Moteur 370 (6 V)', voltage: 6, noLoadSpeed: 9000 * RPM, noLoadCurrent: 0.2, stallTorque: 39 * NMM, stallCurrent: 4.5, inductance: 0.25e-3, rotorInertia: 6e-7, notes: 'Arbre Ø2,3 mm, chauffe nettement en charge.' },
  { id: '540-7v2', name: 'Moteur 540 (7,2 V)', voltage: 7.2, noLoadSpeed: 23400 * RPM, noLoadCurrent: 1.6, stallTorque: 100 * NMM, stallCurrent: 60, inductance: 0.03e-3, rotorInertia: 5e-6, notes: 'Arbre Ø3,17 mm. Puissance élevée : vérifiez le premier étage.' },
];
