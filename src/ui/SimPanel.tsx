/**
 * Onglet 4 : régime transitoire (intégration RK4) et graphiques temporels.
 */
import { useMemo, useState } from 'react';
import type { Computed, Project } from '../core/project';
import { equivalentInertia, loadInertia, simulateTransient, type TransientResult, type VoltageProfile } from '../core/simulation';
import { fmt, toNmm, toRpm } from '../core/units';
import type { Updater } from './App';
import { Chart } from './Chart';
import { CheckField, NumField, Section, SelectField, Stat } from './fields';

const GCM2 = 1e-7;

export function SimPanel({ project, computed, update }: { project: Project; computed: Computed; update: Updater }) {
  const prof = project.sim.profile;
  const [result, setResult] = useState<{ r: TransientResult; key: string; ms: number } | null>(null);
  const key = JSON.stringify([project.motor, project.load, project.sim, computed.drivetrain]);
  const { motor, drivetrain } = computed;
  const J = equivalentInertia(motor, drivetrain, project.load);

  const setProfile = (kind: VoltageProfile['kind']) =>
    update((d) => {
      const V = d.sim.profile.voltage;
      d.sim.profile =
        kind === 'step' ? { kind, voltage: V, delay: 0 }
          : kind === 'ramp' ? { kind, voltage: V, rampTime: d.sim.duration / 3 }
            : { kind, voltage: V, frequency: 1000, duty: 0.5, averaged: false };
    });
  const setP = (fn: (p: VoltageProfile) => void) => update((d) => fn(d.sim.profile));

  const run = () => {
    const t0 = performance.now();
    const r = simulateTransient(motor, drivetrain, project.load, prof, { duration: project.sim.duration, samples: 1500 });
    setResult({ r, key, ms: performance.now() - t0 });
  };

  const charts = useMemo(() => {
    if (!result) return null;
    const r = result.r;
    const t = Array.from(r.t, (v) => v * 1000);
    // sortie crémaillère : la simulation donne la vitesse de l'arbre du pignon → v = ω·r
    const tr = computed.train;
    const rack = tr.linearOutput ? tr.nodes.find((n) => n.id === tr.outputId) : undefined;
    const pinionR = rack ? tr.nodes.find((n) => n.id === rack.parentId)!.geo.r : 0;
    return {
      t,
      speed: Array.from(r.omegaOut, (w) => (rack ? w * pinionR * 1000 : toRpm(w))),
      current: Array.from(r.current),
      voltage: Array.from(r.voltage),
      motorT: Array.from(r.motorTorque, toNmm),
      outT: Array.from(r.outTorque, toNmm),
      pe: Array.from(r.electricalPower),
      pm: Array.from(r.outputPower),
    };
  }, [result, computed.train]);

  return (
    <div>
      <Section title="Profil de tension">
        <div className="grid2">
          <SelectField
            label="Type"
            value={prof.kind}
            options={[
              { value: 'step', label: 'Échelon' },
              { value: 'ramp', label: 'Rampe' },
              { value: 'pwm', label: 'PWM' },
            ]}
            onChange={setProfile}
          />
          <NumField label="Tension" value={prof.voltage} unit="V" min={0} onChange={(v) => setP((p) => void (p.voltage = v))} />
          {prof.kind === 'step' && <NumField label="Retard" value={prof.delay} factor={1e-3} unit="ms" min={0} onChange={(v) => setP((p) => void ((p as { delay: number }).delay = v))} />}
          {prof.kind === 'ramp' && <NumField label="Durée de la rampe" value={prof.rampTime} factor={1e-3} unit="ms" min={0} onChange={(v) => setP((p) => void ((p as { rampTime: number }).rampTime = v))} />}
          {prof.kind === 'pwm' && (
            <>
              <NumField label="Fréquence" value={prof.frequency} unit="Hz" min={1} digits={0} onChange={(v) => setP((p) => void ((p as { frequency: number }).frequency = v))} />
              <NumField label="Rapport cyclique" value={prof.duty * 100} unit="%" min={0} max={100} digits={1} onChange={(v) => setP((p) => void ((p as { duty: number }).duty = v / 100))} />
            </>
          )}
          <NumField label="Durée simulée" value={project.sim.duration} factor={1e-3} unit="ms" min={1} digits={1} onChange={(v) => update((d) => void (d.sim.duration = v))} />
        </div>
        {prof.kind === 'pwm' && (
          <CheckField label="PWM moyennée (tension = rapport cyclique × V, beaucoup plus rapide)" checked={prof.averaged} onChange={(v) => setP((p) => void ((p as { averaged: boolean }).averaged = v))} />
        )}
        <div className="row">
          <button className="primary" onClick={run}>
            Lancer la simulation
          </button>
          {result && result.key !== key && <span className="muted">Paramètres modifiés : relancez la simulation.</span>}
        </div>
      </Section>

      <Section title="Inertie équivalente ramenée au moteur">
        <div className="grid2 stats">
          <Stat label="Rotor" value={fmt(motor.J / GCM2, 3)} unit="g·cm²" />
          <Stat label="Engrenages Σ J·(ωᵢ/ω)²" value={fmt(drivetrain.gearInertia / GCM2, 4)} unit="g·cm²" />
          <Stat label="Charge J/N²" value={fmt(loadInertia(project.load) / drivetrain.ratio ** 2 / GCM2, 4)} unit="g·cm²" />
          <Stat label="Total J_eq" value={fmt(J / GCM2, 3)} unit="g·cm²" />
          <Stat label="Constante de temps mécanique" value={fmt(((J * motor.R) / (motor.Kt * motor.Ke)) * 1000, 2)} unit="ms" />
        </div>
      </Section>

      {result && charts && (
        <Section title="Résultats">
          <p className="muted small">
            {result.r.steps.toLocaleString('fr-FR')} pas de {fmt(result.r.dt * 1e6, 2)} µs, calculés en {fmt(result.ms, 0)} ms.{' '}
            {result.r.notes.join(' ')}
          </p>
          <Chart title={computed.train.linearOutput ? 'Vitesse de la crémaillère' : 'Vitesse de sortie'} x={charts.t} xLabel="Temps (ms)" yLabel={computed.train.linearOutput ? 'mm/s' : 'tr/min'} series={[{ label: 'Vitesse', values: charts.speed, color: '#2f6fdb' }]} />
          <Chart title="Courant et tension" x={charts.t} xLabel="Temps (ms)" yLabel="Courant (A)" yRightLabel="Tension (V)" series={[{ label: 'Courant', values: charts.current, color: '#d9822b' }, { label: 'Tension', values: charts.voltage, color: '#8a8f98', right: true, dash: [4, 4] }]} />
          <Chart title="Couples" x={charts.t} xLabel="Temps (ms)" yLabel="Moteur (N·mm)" yRightLabel="Sortie (N·mm)" series={[{ label: 'Couple moteur Kt·i', values: charts.motorT, color: '#7b4fc9' }, { label: 'Couple transmis en sortie', values: charts.outT, color: '#1e9e6a', right: true }]} />
          <Chart title="Puissances" x={charts.t} xLabel="Temps (ms)" yLabel="Puissance (W)" series={[{ label: 'Électrique V·i', values: charts.pe, color: '#d9822b' }, { label: 'Mécanique en sortie', values: charts.pm, color: '#1e9e6a' }]} />
        </Section>
      )}

      <Section title="Formules">
        <p className="formula">
          L·di/dt = V(t) − R·i − K<sub>e</sub>·ω ; J<sub>eq</sub>·dω/dt = K<sub>t</sub>·i − T<sub>f</sub>·sgn(ω) − T<sub>charge</sub>/(N·η),
          avec J<sub>eq</sub> = J<sub>rotor</sub> + Σ J<sub>roue</sub>(ω<sub>i</sub>/ω)² + J<sub>charge</sub>/N², intégrées par Runge-Kutta 4 à pas fixe.
          Le pas est choisi pour résoudre la constante mécanique, la PWM et, si possible, la constante électrique L/R ; sinon l'inductance est négligée (courant quasi statique).
          Le frottement sec est lissé autour de ω = 0. En PWM, le moteur est court-circuité à l'état bas (freinage).
        </p>
      </Section>
    </div>
  );
}
