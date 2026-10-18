/**
 * Onglet 3 : moteur DC (préréglages, fiche technique, paramètres identifiés),
 * courbe couple-vitesse avec point de fonctionnement, charge et régime permanent.
 */
import { useMemo } from 'react';
import type { Computed, Project } from '../core/project';
import { MOTOR_PRESETS, torqueSpeedCurve } from '../core/motor';
import { G, MM, NMM, RPM, fmt, toMm, toNmm, toRpm } from '../core/units';
import type { Updater } from './App';
import { Chart } from './Chart';
import { NumField, Section, SelectField, Stat } from './fields';

const GCM2 = 1e-7; // 1 g·cm² en kg·m²

export function MotorPanel({ project, computed, update }: { project: Project; computed: Computed; update: Updater }) {
  const m = project.motor;
  const mm = computed.motor;
  const s = computed.steady;
  const t = computed.train;
  const preset = MOTOR_PRESETS.find((p) => p.id === m.id) ? m.id : 'custom';
  const setM = (fn: (d: Project['motor']) => void) =>
    update((d) => {
      fn(d.motor);
      d.motor.id = 'custom';
    });

  // courbe couple-vitesse à l'arbre moteur, et point de fonctionnement
  const curve = useMemo(() => {
    const c = torqueSpeedCurve(mm, mm.V, 60);
    const x = c.map((p) => toRpm(p.omega));
    const op = c.map(() => null as number | null);
    const opX = toRpm(s.omegaMotor);
    // insère le point de fonctionnement dans l'axe x (uPlot partage l'axe)
    let k = x.findIndex((v) => v > opX);
    if (k < 0) k = x.length;
    x.splice(k, 0, opX);
    const torque = c.map((p) => toNmm(p.torque)) as (number | null)[];
    const current = c.map((p) => p.current) as (number | null)[];
    torque.splice(k, 0, null);
    current.splice(k, 0, null);
    op.splice(k, 0, toNmm(s.motorTorque));
    return { x, torque, current, op };
  }, [mm, s]);

  const load = project.load;
  return (
    <div>
      <Section title="Moteur">
        <SelectField
          label="Préréglage"
          value={preset}
          options={[...MOTOR_PRESETS.map((p) => ({ value: p.id, label: p.name })), { value: 'custom', label: 'Personnalisé' }]}
          onChange={(v) => {
            const p = MOTOR_PRESETS.find((x) => x.id === v);
            if (p) update((d) => {
              d.motor = { ...p };
              if (d.sim.profile.voltage > 0) d.sim.profile.voltage = p.voltage;
            });
          }}
        />
        {m.notes && <p className="muted small">{m.notes} Valeurs typiques : vérifiez la fiche de votre moteur.</p>}
        <div className="grid2">
          <NumField label="Tension nominale" value={m.voltage} unit="V" min={0.5} onChange={(v) => setM((d) => void (d.voltage = v))} />
          <NumField label="Vitesse à vide" value={m.noLoadSpeed} factor={RPM} unit="tr/min" digits={0} min={1} onChange={(v) => setM((d) => void (d.noLoadSpeed = v))} />
          <NumField label="Courant à vide" value={m.noLoadCurrent} unit="A" min={0} onChange={(v) => setM((d) => void (d.noLoadCurrent = v))} />
          <NumField label="Couple de blocage" value={m.stallTorque} factor={NMM} unit="N·mm" min={0.01} onChange={(v) => setM((d) => void (d.stallTorque = v))} />
          <NumField label="Courant de blocage" value={m.stallCurrent} unit="A" min={0.01} onChange={(v) => setM((d) => void (d.stallCurrent = v))} />
          <NumField label="Inductance (optionnel)" value={m.inductance} factor={1e-3} unit="mH" min={0} onChange={(v) => setM((d) => void (d.inductance = v))} />
          <NumField label="Inertie du rotor (optionnel)" value={m.rotorInertia} factor={GCM2} unit="g·cm²" min={0} digits={4} onChange={(v) => setM((d) => void (d.rotorInertia = v))} hint="Pour un motoréducteur : inertie vue en sortie du réducteur (≈ J_rotor × rapport²)" />
        </div>
      </Section>

      <Section title="Paramètres identifiés">
        <div className="grid2 stats">
          <Stat label="Résistance R = V/Is" value={fmt(mm.R, 3)} unit="Ω" />
          <Stat label="Kt = Ts/(Is − I0)" value={fmt(toNmm(mm.Kt), 3)} unit="N·mm/A" />
          <Stat label="Ke = (V − R·I0)/ω0" value={fmt(mm.Ke * 1000, 3)} unit="mV/(rad/s)" />
          <Stat label="Frottement interne Tf = Kt·I0" value={fmt(toNmm(mm.Tf), 3)} unit="N·mm" />
          <Stat label="Constante électrique L/R" value={fmt(mm.tauE * 1000, 3)} unit="ms" />
          <Stat label="Constante mécanique J·R/(Kt·Ke)" value={fmt(mm.tauM * 1000, 2)} unit="ms" />
          <Stat label="Puissance maxi ≈ Ts·ω0/4" value={fmt((m.stallTorque * m.noLoadSpeed) / 4, 2)} unit="W" />
          <Stat label="Écart Kt / Ke" value={fmt(mm.ktKeMismatch * 100, 0)} unit="%" tone={mm.ktKeMismatch > 0.15 ? 'marginal' : undefined} />
        </div>
        <Chart
          title="Caractéristique couple-vitesse (arbre moteur)"
          x={curve.x}
          xLabel="Vitesse (tr/min)"
          yLabel="Couple (N·mm)"
          yRightLabel="Courant (A)"
          series={[
            { label: 'Couple', values: curve.torque, color: '#2f6fdb' },
            { label: 'Courant', values: curve.current, color: '#d9822b', right: true, dash: [6, 4] },
            { label: 'Point de fonctionnement', values: curve.op, color: '#c0392b', points: true },
          ]}
        />
      </Section>

      <Section title="Charge en sortie">
        <div className="grid2">
          <NumField label="Couple constant" value={load.constantTorque} factor={NMM} unit="N·mm" onChange={(v) => update((d) => void (d.load.constantTorque = v))} hint="Sens fixe, comme un poids : il peut entraîner le moteur à l'envers si celui-ci ne tient pas" />
          <NumField label="Frottement visqueux" value={load.viscous} factor={NMM} unit="N·mm·s/rad" min={0} onChange={(v) => update((d) => void (d.load.viscous = v))} />
          <NumField label="Inertie" value={load.inertia} factor={GCM2} unit="g·cm²" min={0} onChange={(v) => update((d) => void (d.load.inertia = v))} />
          <NumField label="Masse soulevée" value={load.mass} factor={1e-3} unit="g" min={0} digits={1} onChange={(v) => update((d) => void (d.load.mass = v))} />
          <NumField label="Rayon de poulie / tambour" value={load.drumRadius} factor={MM} unit="mm" min={0} onChange={(v) => update((d) => void (d.load.drumRadius = v))} />
        </div>
        {t.linearOutput && <p className="muted small">Sortie crémaillère : la charge s'applique sur l'arbre du pignon. Pour une force F, utilisez une masse F/g avec un rayon de tambour égal au rayon primitif du pignon.</p>}
        <p className="muted small">Couple de charge = couple constant + b·ω + m·g·r = {fmt(toNmm(load.constantTorque + load.mass * G * load.drumRadius), 2)} N·mm (+ visqueux).</p>
      </Section>

      <Section title="Régime permanent">
        {s.stalled && <p className="error-text">Le moteur cale : la charge dépasse le couple disponible en sortie ({fmt(toNmm(s.stallOutTorque), 1)} N·mm).</p>}
        <div className="grid2 stats">
          {t.linearOutput ? (
            <Stat label="Vitesse de la crémaillère" value={fmt(toMm(s.omegaMotor / Math.abs(t.ratio)), 2)} unit="mm/s" />
          ) : (
            <Stat label="Vitesse de sortie" value={fmt(toRpm(s.omegaOut), 2)} unit="tr/min" />
          )}
          <Stat label="Couple de sortie" value={fmt(toNmm(s.outTorque), 2)} unit="N·mm" />
          <Stat label="Vitesse moteur" value={fmt(toRpm(s.omegaMotor), 0)} unit="tr/min" />
          <Stat label="Couple moteur" value={fmt(toNmm(s.motorTorque), 3)} unit="N·mm" />
          <Stat label="Courant" value={fmt(s.current, 3)} unit="A" tone={s.current > 0.7 * (m.voltage / mm.R) ? 'danger' : undefined} />
          <Stat label="Puissance électrique" value={fmt(s.electricalPower, 3)} unit="W" />
          <Stat label="Puissance mécanique en sortie" value={fmt(s.outputPower, 3)} unit="W" />
          <Stat label="Rendement global" value={fmt(s.efficiency * 100, 1)} unit="%" />
          <Stat label="Couple de sortie au blocage" value={fmt(toNmm(s.stallOutTorque), 1)} unit="N·mm" />
          <Stat label="Marge avant blocage" value={fmt(s.stallMargin * 100, 0)} unit="%" tone={s.stallMargin < 0.3 ? 'danger' : s.stallMargin < 0.5 ? 'marginal' : 'ok'} />
          {load.mass > 0 && load.drumRadius > 0 && !t.linearOutput && <Stat label="Vitesse de levage" value={fmt(toMm(s.omegaOut * load.drumRadius), 1)} unit="mm/s" />}
        </div>
      </Section>

      <Section title="Formules">
        <p className="formula">
          R = V/I<sub>s</sub>, K<sub>e</sub> = (V − R·I₀)/ω₀, K<sub>t</sub> = T<sub>s</sub>/(I<sub>s</sub> − I₀), T<sub>f</sub> = K<sub>t</sub>·I₀.
          Régime permanent : K<sub>t</sub>(V − K<sub>e</sub>ω)/R − T<sub>f</sub> = T<sub>charge</sub>/(N·η), résolu analytiquement.
          Marge avant blocage = 1 − T<sub>charge</sub>/T<sub>blocage, sortie</sub>, avec T<sub>blocage, sortie</sub> = (K<sub>t</sub>V/R − T<sub>f</sub>)·N·η.
        </p>
      </Section>
    </div>
  );
}
