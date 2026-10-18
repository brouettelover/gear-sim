/**
 * Simulation moteur + réducteur + charge.
 *
 * Grandeurs ramenées à l'arbre moteur (ω vitesse moteur, N = ω / ω_sortie, η rendement du train) :
 *   L·di/dt   = V(t) − R·i − Ke·ω
 *   J_eq·dω/dt = Kt·i − Tf·sgn(ω) − T_charge / (N·η)
 *   J_eq = J_rotor + Σ J_roue·(ωᵢ/ω)² + J_charge / N²
 *
 * Charge en sortie (positif = s'oppose au sens de rotation positif) :
 *   T_charge = T_constant + b·ω_sortie + m·g·r_tambour        (poids soulevé)
 *   J_charge = J + m·r_tambour²
 * Quand la charge entraîne le moteur (puissance inversée), le rendement s'applique dans
 * l'autre sens : T_charge·η / N.
 *
 * Intégration : Runge-Kutta d'ordre 4 à pas fixe.
 */
import type { MotorModel } from './motor';
import { G } from './units';

export interface LoadSpec {
  /** couple constant en sortie (N·m) */
  constantTorque: number;
  /** frottement visqueux en sortie (N·m·s/rad) */
  viscous: number;
  /** inertie en sortie (kg·m²) */
  inertia: number;
  /** masse soulevée (kg) */
  mass: number;
  /** rayon de la poulie / du tambour (m) */
  drumRadius: number;
}

export interface Drivetrain {
  /** rapport de réduction N = ω_moteur / ω_sortie (valeur absolue) */
  ratio: number;
  /** rendement global du train (0–1) */
  efficiency: number;
  /**
   * rendement quand la charge entraîne le moteur (par défaut = efficiency) ; négatif pour un train
   * irréversible (vis sans fin) : la charge freine au lieu d'entraîner
   */
  backEfficiency?: number;
  /** inertie des engrenages ramenée à l'arbre moteur (kg·m²) */
  gearInertia: number;
}

export const loadTorque = (l: LoadSpec, omegaOut: number) =>
  l.constantTorque + l.viscous * omegaOut + l.mass * G * l.drumRadius;
export const loadInertia = (l: LoadSpec) => l.inertia + l.mass * l.drumRadius ** 2;

/** Couple de charge ramené à l'arbre moteur, avec le rendement dans le bon sens. */
export function reflectedLoad(l: LoadSpec, d: Drivetrain, omegaMotor: number): number {
  const wOut = omegaMotor / d.ratio;
  const T = loadTorque(l, wOut);
  // la charge s'oppose au mouvement → le moteur fournit la puissance
  const motoring = T * (wOut >= 0 ? 1 : -1) >= 0;
  return motoring ? T / (d.ratio * d.efficiency) : (T * (d.backEfficiency ?? d.efficiency)) / d.ratio;
}

export const equivalentInertia = (m: MotorModel, d: Drivetrain, l: LoadSpec) =>
  m.J + d.gearInertia + loadInertia(l) / d.ratio ** 2;

export interface SteadyState {
  stalled: boolean;
  /** vitesse moteur (rad/s) */
  omegaMotor: number;
  /** vitesse de sortie (rad/s) */
  omegaOut: number;
  current: number;
  /** couple utile sur l'arbre moteur (N·m) */
  motorTorque: number;
  /** couple de sortie (N·m) */
  outTorque: number;
  electricalPower: number;
  outputPower: number;
  /** rendement global électrique → mécanique en sortie */
  efficiency: number;
  /** couple de sortie disponible au blocage (N·m) */
  stallOutTorque: number;
  /** marge avant blocage = 1 − T_charge / T_blocage_sortie */
  stallMargin: number;
}

/** Régime permanent sous tension V constante (solution analytique de l'équilibre des couples). */
export function steadyState(m: MotorModel, d: Drivetrain, l: LoadSpec, V = m.V): SteadyState {
  const N = d.ratio;
  const eta = d.efficiency;
  const Tc = l.constantTorque + l.mass * G * l.drumRadius;
  // Kt(V − Ke·ω)/R − Tf − (Tc + b·ω/N)/(N·η) = 0
  const num = (m.Kt * V) / m.R - m.Tf - Tc / (N * eta);
  const den = (m.Kt * m.Ke) / m.R + l.viscous / (N * N * eta);
  const stallOutTorque = Math.max(0, ((m.Kt * V) / m.R - m.Tf) * N * eta);
  if (num <= 0) {
    const current = V / m.R;
    return {
      stalled: true, omegaMotor: 0, omegaOut: 0, current,
      motorTorque: m.Kt * current - m.Tf, outTorque: stallOutTorque,
      electricalPower: V * current, outputPower: 0, efficiency: 0,
      stallOutTorque, stallMargin: stallOutTorque > 0 ? 1 - Tc / stallOutTorque : -Infinity,
    };
  }
  const omegaMotor = num / den;
  const omegaOut = omegaMotor / N;
  const current = (V - m.Ke * omegaMotor) / m.R;
  const motorTorque = m.Kt * current - m.Tf;
  const outTorque = loadTorque(l, omegaOut);
  const electricalPower = V * current;
  const outputPower = outTorque * omegaOut;
  return {
    stalled: false, omegaMotor, omegaOut, current, motorTorque, outTorque,
    electricalPower, outputPower,
    efficiency: electricalPower > 0 ? outputPower / electricalPower : 0,
    stallOutTorque,
    stallMargin: stallOutTorque > 0 ? 1 - outTorque / stallOutTorque : -Infinity,
  };
}

export type VoltageProfile =
  | { kind: 'step'; voltage: number; delay: number }
  | { kind: 'ramp'; voltage: number; rampTime: number }
  | { kind: 'pwm'; voltage: number; frequency: number; duty: number; averaged: boolean };

export function voltageAt(p: VoltageProfile, t: number): number {
  switch (p.kind) {
    case 'step':
      return t >= p.delay ? p.voltage : 0;
    case 'ramp':
      return p.rampTime > 0 ? p.voltage * Math.min(1, t / p.rampTime) : p.voltage;
    case 'pwm': {
      if (p.averaged) return p.voltage * p.duty;
      const phase = t * p.frequency - Math.floor(t * p.frequency);
      // état bas : bornes du moteur court-circuitées (freinage), V = 0
      return phase < p.duty ? p.voltage : 0;
    }
  }
}

export interface TransientOptions {
  duration: number;
  /** nombre maximal de pas d'intégration */
  maxSteps?: number;
  /** nombre de points conservés pour les graphiques */
  samples?: number;
}

export interface TransientResult {
  t: Float64Array;
  voltage: Float64Array;
  current: Float64Array;
  /** vitesse de sortie (rad/s) */
  omegaOut: Float64Array;
  /** angle de sortie (rad) */
  thetaOut: Float64Array;
  /** couple électromagnétique Kt·i (N·m) */
  motorTorque: Float64Array;
  /** couple transmis à la charge en sortie (N·m) */
  outTorque: Float64Array;
  electricalPower: Float64Array;
  outputPower: Float64Array;
  dt: number;
  steps: number;
  /** vrai si l'inductance a été négligée (constante électrique trop courte pour le pas) */
  quasiStaticCurrent: boolean;
  notes: string[];
}

/** Intégration RK4 du système électromécanique. */
export function simulateTransient(
  m: MotorModel,
  d: Drivetrain,
  l: LoadSpec,
  profile: VoltageProfile,
  opts: TransientOptions,
): TransientResult {
  const notes: string[] = [];
  const T = opts.duration;
  const maxSteps = opts.maxSteps ?? 2_000_000;
  const samples = opts.samples ?? 2000;
  const J = equivalentInertia(m, d, l);
  const tauM = (J * m.R) / (m.Kt * m.Ke);
  // pas d'intégration : résoudre la mécanique, la PWM et (si possible) l'électrique
  let dt = Math.min(tauM / 200, T / 2000);
  if (profile.kind === 'pwm' && !profile.averaged) dt = Math.min(dt, 1 / (profile.frequency * 50));
  let quasi = !(m.L > 0);
  if (!quasi) {
    const dtE = m.tauE / 10;
    if (T / Math.min(dt, dtE) > maxSteps) {
      quasi = true;
      notes.push('Inductance négligée : la constante de temps électrique est trop courte devant la durée simulée.');
    } else {
      dt = Math.min(dt, dtE);
    }
  }
  let steps = Math.ceil(T / dt);
  if (steps > maxSteps) {
    steps = maxSteps;
    dt = T / steps;
    notes.push('Pas de temps limité par le nombre maximal de pas : précision réduite (essayez la PWM moyennée ou une durée plus courte).');
  }
  // lissage du frottement sec autour de ω = 0 (évite un système raide)
  const w0 = m.V / m.Ke;
  const wEps = 1e-3 * w0;
  const friction = (w: number) => m.Tf * Math.tanh(w / wEps);

  const current = (V: number, w: number, i: number) => (quasi ? (V - m.Ke * w) / m.R : i);
  // dérivées de l'état (i, ω, θ)
  const f = (t: number, i: number, w: number): [number, number, number] => {
    const V = voltageAt(profile, t);
    const ii = current(V, w, i);
    const di = quasi ? 0 : (V - m.R * ii - m.Ke * w) / m.L;
    const dw = (m.Kt * ii - friction(w) - reflectedLoad(l, d, w)) / J;
    return [di, dw, w];
  };

  const every = Math.max(1, Math.floor(steps / samples));
  const n = Math.floor(steps / every) + 1;
  const res: TransientResult = {
    t: new Float64Array(n), voltage: new Float64Array(n), current: new Float64Array(n),
    omegaOut: new Float64Array(n), thetaOut: new Float64Array(n), motorTorque: new Float64Array(n),
    outTorque: new Float64Array(n), electricalPower: new Float64Array(n), outputPower: new Float64Array(n),
    dt, steps, quasiStaticCurrent: quasi, notes,
  };
  let i = 0;
  let w = 0;
  let th = 0;
  let k = 0;
  const Jl = loadInertia(l);
  const record = (t: number, dw: number) => {
    const V = voltageAt(profile, t);
    const ii = current(V, w, i);
    const wOut = w / d.ratio;
    const tOut = loadTorque(l, wOut) + (Jl * dw) / d.ratio;
    res.t[k] = t;
    res.voltage[k] = V;
    res.current[k] = ii;
    res.omegaOut[k] = wOut;
    res.thetaOut[k] = th / d.ratio;
    res.motorTorque[k] = m.Kt * ii;
    res.outTorque[k] = tOut;
    res.electricalPower[k] = V * ii;
    res.outputPower[k] = tOut * wOut;
    k++;
  };
  record(0, f(0, i, w)[1]);
  for (let s = 1; s <= steps && k < n; s++) {
    const t = (s - 1) * dt;
    const k1 = f(t, i, w);
    const k2 = f(t + dt / 2, i + (dt / 2) * k1[0], w + (dt / 2) * k1[1]);
    const k3 = f(t + dt / 2, i + (dt / 2) * k2[0], w + (dt / 2) * k2[1]);
    const k4 = f(t + dt, i + dt * k3[0], w + dt * k3[1]);
    i += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    w += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    th += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    if (s % every === 0) record(s * dt, f(s * dt, i, w)[1]);
  }
  if (k < n) {
    // tronque si l'arrondi a laissé des cases vides
    for (const key of ['t', 'voltage', 'current', 'omegaOut', 'thetaOut', 'motorTorque', 'outTorque', 'electricalPower', 'outputPower'] as const) {
      res[key] = res[key].slice(0, k);
    }
  }
  return res;
}
