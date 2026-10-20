/**
 * Onglet 5 : résistance en flexion (Lewis), matériaux, rappels d'impression.
 */
import type { Computed, Project } from '../core/project';
import { printAdvice } from '../core/project';
import { DEFAULT_MATERIALS } from '../core/materials';
import { MPA, fmt, toMm } from '../core/units';
import type { Updater } from './App';
import { NumField, Section } from './fields';

const LEVEL_LABEL = { ok: 'Vert', marginal: 'Orange', danger: 'Rouge' } as const;

export function StrengthPanel({ project, computed, update, onSelect }: { project: Project; computed: Computed; update: Updater; onSelect: (id: string) => void }) {
  return (
    <div>
      <Section title="Coefficient de sécurité par roue">
        <table className="table">
          <thead>
            <tr>
              <th>Roue</th>
              <th>Matériau</th>
              <th>Ft (N)</th>
              <th>V (m/s)</th>
              <th>Kv</th>
              <th>Y</th>
              <th>σ (MPa)</th>
              <th>n en service</th>
              <th>n au blocage</th>
            </tr>
          </thead>
          <tbody>
            {computed.strength.map((s) => (
              <tr key={s.node.id} onClick={() => onSelect(s.node.id)}>
                <td>{s.node.spec.name}{s.node.count > 1 ? ` (×${s.node.count})` : ''}</td>
                <td>{s.node.material.name}</td>
                <td>{fmt(s.operating.ft, 2)}</td>
                <td>{fmt(s.operating.v, 3)}</td>
                <td>{fmt(s.operating.kv, 3)}</td>
                <td>{fmt(s.operating.y, 3)}</td>
                <td>{fmt(s.operating.stress / MPA, 2)}</td>
                <td className={`level ${s.level}`} title={LEVEL_LABEL[s.level]}>{fmt(s.operating.safety, 2)}</td>
                <td className={`level ${s.stallLevel}`} title="Moteur bloqué sous pleine tension">{fmt(s.stall.safety, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Vert : n ≥ 2 · Orange : 1,25 ≤ n &lt; 2 · Rouge : n &lt; 1,25. « Au blocage » : couple de blocage du moteur sous sa tension nominale, cas
          d'un mécanisme coincé. Les roues hors du chemin moteur → sortie ne transmettent pas de couple.
        </p>
      </Section>

      <Section title="Réglages d'impression conseillés">
        <table className="table">
          <thead>
            <tr>
              <th>Roue</th>
              <th>Orientation</th>
              <th>Parois</th>
              <th>Remplissage</th>
              <th>Couche</th>
            </tr>
          </thead>
          <tbody>
            {computed.strength.map((s) => {
              const a = printAdvice(s.node, project.print, s.operating.safety);
              return (
                <tr key={s.node.id}>
                  <td>{s.node.spec.name}</td>
                  <td>{a.orientation}</td>
                  <td>{a.walls}</td>
                  <td>{a.infill} %</td>
                  <td>≤ {fmt(toMm(a.layer), 2)} mm</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">Assez de parois pour que toute la hauteur de dent soit en périmètres pleins : le remplissage ne touche alors que le moyeu.</p>
      </Section>

      <Section title="Rappels">
        <ul className="reminders">
          {computed.reminders.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          <li>Les contraintes admissibles ci-dessous sont prudentes ; un essai de casse sur une roue imprimée avec vos réglages reste la meilleure référence.</li>
          <li>Le nylon (PA) absorbe l'humidité : séchez la bobine, ses propriétés changent avec l'hygrométrie.</li>
        </ul>
      </Section>

      <Section title="Matériaux" aside={<button className="small" onClick={() => update((d) => void (d.materials = DEFAULT_MATERIALS.map((m) => ({ ...m }))))}>Valeurs par défaut</button>}>
        <table className="table materials">
          <thead>
            <tr>
              <th>Matériau</th>
              <th>Densité (kg/m³)</th>
              <th>σ admissible (MPa)</th>
              <th>Tg (°C)</th>
              <th>T max (°C)</th>
            </tr>
          </thead>
          <tbody>
            {project.materials.map((m, i) => (
              <tr key={m.id} title={m.notes}>
                <td>{m.name}</td>
                <td><NumField label="" value={m.density} digits={0} min={100} onChange={(v) => update((d) => void (d.materials[i].density = v))} /></td>
                <td><NumField label="" value={m.allowableBending} factor={MPA} digits={1} min={0.1} onChange={(v) => update((d) => void (d.materials[i].allowableBending = v))} /></td>
                <td><NumField label="" value={m.tg} digits={0} onChange={(v) => update((d) => void (d.materials[i].tg = v))} /></td>
                <td><NumField label="" value={m.maxServiceTemp} digits={0} onChange={(v) => update((d) => void (d.materials[i].maxServiceTemp = v))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Formules">
        <p className="formula">
          Lewis : σ = K<sub>v</sub>·F<sub>t</sub>/(b·m·Y), F<sub>t</sub> = T<sub>arbre</sub>/r (couple de l'arbre menant, rendement amont inclus),
          K<sub>v</sub> = (3,05 + V)/3,05 (facteur dynamique de Barth, profil brut), Y tabulé (Shigley, 20°) au nombre de dents virtuel z/cos³β.
          Planétaire : effort partagé également entre les satellites. Coefficient de sécurité n = σ<sub>adm</sub>/σ.
          Le modèle ignore la pression de contact (usure), la fatigue détaillée, l'échauffement et la qualité d'adhésion des couches.
        </p>
      </Section>
    </div>
  );
}
