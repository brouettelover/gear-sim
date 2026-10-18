import { describe, expect, it } from 'vitest';
import { motorModel, torqueSpeedCurve, type MotorSpec } from '../motor';
import { equivalentInertia, simulateTransient, steadyState, type Drivetrain, type LoadSpec } from '../simulation';
import { G } from '../units';

// moteur "idéal" cohérent : R = 2 Ω, K = 0,01 V·s/rad = N·m/A, Tf = 1 mN·m, V = 6 V
const R = 2, K = 0.01, Tf = 0.001, V = 6;
const I0 = Tf / K;
const W0 = (V - R * I0) / K;
const IS = V / R;
const spec: MotorSpec = {
  id: 't', name: 't', voltage: V, noLoadSpeed: W0, noLoadCurrent: I0,
  stallTorque: K * (IS - I0), stallCurrent: IS, inductance: 1e-3, rotorInertia: 1e-6,
};
const NO_LOAD: LoadSpec = { constantTorque: 0, viscous: 0, inertia: 0, mass: 0, drumRadius: 0 };
const DIRECT: Drivetrain = { ratio: 1, efficiency: 1, gearInertia: 0 };

describe('identification du moteur', () => {
  const m = motorModel(spec);
  it('retrouve R, Kt, Ke et Tf à partir de la fiche technique', () => {
    expect(m.R).toBeCloseTo(R, 12);
    expect(m.Kt).toBeCloseTo(K, 12);
    expect(m.Ke).toBeCloseTo(K, 12);
    expect(m.Tf).toBeCloseTo(Tf, 12);
    expect(m.ktKeMismatch).toBeLessThan(1e-9);
  });
  it('courbe couple-vitesse : couple de blocage à ω = 0, nul à vide', () => {
    const c = torqueSpeedCurve(m);
    expect(c[0].torque).toBeCloseTo(spec.stallTorque, 12);
    expect(c[c.length - 1].torque).toBeCloseTo(0, 9);
    expect(c[c.length - 1].omega).toBeCloseTo(W0, 9);
    // puissance maximale au milieu de la plage
    const pmax = Math.max(...c.map((p) => p.power));
    expect(pmax).toBeCloseTo((spec.stallTorque * W0) / 4, 6);
  });
});

describe('régime permanent', () => {
  const m = motorModel(spec);
  it('à vide : vitesse et courant à vide de la fiche', () => {
    const s = steadyState(m, DIRECT, NO_LOAD);
    expect(s.omegaMotor).toBeCloseTo(W0, 9);
    expect(s.current).toBeCloseTo(I0, 9);
  });
  it('avec réducteur 10:1, η = 0,9 et un couple de 0,1 N·m en sortie', () => {
    const d: Drivetrain = { ratio: 10, efficiency: 0.9, gearInertia: 0 };
    const l = { ...NO_LOAD, constantTorque: 0.1 };
    const s = steadyState(m, d, l);
    const Tm = 0.1 / (10 * 0.9) + Tf; // couple électromagnétique nécessaire
    const i = Tm / K;
    const w = (V - R * i) / K;
    expect(s.current).toBeCloseTo(i, 9);
    expect(s.omegaMotor).toBeCloseTo(w, 6);
    expect(s.omegaOut).toBeCloseTo(w / 10, 6);
    expect(s.outputPower).toBeCloseTo(0.1 * (w / 10), 6);
    expect(s.stallOutTorque).toBeCloseTo((K * IS - Tf) * 10 * 0.9, 9);
  });
  it('poids soulevé : couple = m·g·r', () => {
    const d: Drivetrain = { ratio: 50, efficiency: 1, gearInertia: 0 };
    const a = steadyState(m, d, { ...NO_LOAD, mass: 0.5, drumRadius: 0.01 });
    const b = steadyState(m, d, { ...NO_LOAD, constantTorque: 0.5 * G * 0.01 });
    expect(a.omegaOut).toBeCloseTo(b.omegaOut, 9);
  });
  it('détecte le blocage quand la charge dépasse le couple disponible', () => {
    const s = steadyState(m, DIRECT, { ...NO_LOAD, constantTorque: 0.05 });
    expect(s.stalled).toBe(true);
    expect(s.omegaOut).toBe(0);
    expect(s.stallMargin).toBeLessThan(0);
  });
});

describe('régime transitoire (RK4)', () => {
  const m = motorModel({ ...spec, inductance: 0 });
  const J = equivalentInertia(m, DIRECT, NO_LOAD);
  const tau = (J * R) / (K * K);

  it('échelon sans inductance : réponse du 1er ordre, 63,2 % à t = τm', () => {
    const r = simulateTransient(m, DIRECT, NO_LOAD, { kind: 'step', voltage: V, delay: 0 }, { duration: 6 * tau });
    const ss = steadyState(m, DIRECT, NO_LOAD).omegaMotor;
    const k = r.t.findIndex((t) => t >= tau);
    const expected = ss * (1 - Math.exp(-r.t[k] / tau));
    expect(r.omegaOut[k] / expected).toBeCloseTo(1, 2);
    expect(r.omegaOut[r.omegaOut.length - 1] / ss).toBeCloseTo(1, 2);
  });

  it('avec inductance, converge vers le régime permanent sous charge', () => {
    const mL = motorModel(spec);
    const d: Drivetrain = { ratio: 20, efficiency: 0.85, gearInertia: 2e-7 };
    const l = { ...NO_LOAD, constantTorque: 0.05, inertia: 1e-4, viscous: 1e-4 };
    const tauEq = (equivalentInertia(mL, d, l) * R) / (K * K);
    const r = simulateTransient(mL, d, l, { kind: 'step', voltage: V, delay: 0 }, { duration: 10 * tauEq });
    const ss = steadyState(mL, d, l);
    const last = r.omegaOut.length - 1;
    expect(r.omegaOut[last] / ss.omegaOut).toBeCloseTo(1, 3);
    expect(r.current[last] / ss.current).toBeCloseTo(1, 3);
  });

  it('bilan d\'énergie : ∫V·i = ∫R·i² + ½Jω² + ∫Tf·ω (à 0,5 % près)', () => {
    const mL = motorModel({ ...spec, inductance: 2e-3 });
    const r = simulateTransient(mL, DIRECT, NO_LOAD, { kind: 'step', voltage: V, delay: 0 }, { duration: 3 * tau, samples: 1e9 });
    let ein = 0, ejoule = 0, efric = 0;
    for (let k = 1; k < r.t.length; k++) {
      const h = r.t[k] - r.t[k - 1];
      const avg = (f: (j: number) => number) => (f(k) + f(k - 1)) / 2;
      ein += h * avg((j) => r.voltage[j] * r.current[j]);
      ejoule += h * avg((j) => R * r.current[j] ** 2);
      efric += h * avg((j) => Tf * Math.abs(r.omegaOut[j]));
    }
    const w = r.omegaOut[r.omegaOut.length - 1];
    const i = r.current[r.current.length - 1];
    const ekin = 0.5 * J * w * w + 0.5 * 2e-3 * i * i;
    expect((ejoule + ekin + efric) / ein).toBeCloseTo(1, 2);
  });

  it('PWM 50 % : vitesse moyenne ≈ PWM moyennée', () => {
    const mL = motorModel(spec);
    const dur = 8 * tau;
    const pwm = simulateTransient(mL, DIRECT, NO_LOAD, { kind: 'pwm', voltage: V, frequency: 2000, duty: 0.5, averaged: false }, { duration: dur });
    const avg = simulateTransient(mL, DIRECT, NO_LOAD, { kind: 'pwm', voltage: V, frequency: 2000, duty: 0.5, averaged: true }, { duration: dur });
    const tail = (a: Float64Array) => {
      const s = a.slice(Math.floor(a.length * 0.8));
      return s.reduce((x, y) => x + y, 0) / s.length;
    };
    expect(tail(pwm.omegaOut) / tail(avg.omegaOut)).toBeCloseTo(1, 1);
  });

  it('rampe : la tension croît linéairement', () => {
    const r = simulateTransient(m, DIRECT, NO_LOAD, { kind: 'ramp', voltage: V, rampTime: 0.1 }, { duration: 0.2 });
    const k = r.t.findIndex((t) => t >= 0.05);
    expect(r.voltage[k] / (V * r.t[k] / 0.1)).toBeCloseTo(1, 6);
  });
});
