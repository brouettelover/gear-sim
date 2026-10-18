/**
 * Onglet 2 : construction du train (simple, composé ou planétaire) et cinématique.
 */
import type { Computed, Project } from '../core/project';
import { defaultGear, newId } from '../core/project';
import { describeRatio, directionLabel, type Placement, type PlanetaryMember } from '../core/train';
import { DEG, fmt, toMm, toRpm } from '../core/units';
import type { Updater } from './App';
import { NumField, Section, SelectField, Stat } from './fields';

interface Props {
  project: Project;
  computed: Computed;
  update: Updater;
  selectedId?: string;
  onSelect: (id: string) => void;
}

const MEMBERS: { value: PlanetaryMember; label: string }[] = [
  { value: 'sun', label: 'Soleil' },
  { value: 'ring', label: 'Couronne' },
  { value: 'carrier', label: 'Porte-satellites' },
];

export function TrainPanel({ project, computed, update, selectedId, onSelect }: Props) {
  const { train, steady } = computed;
  const omega = steady.stalled ? 0 : steady.omegaMotor;
  return (
    <div>
      <Section title="Type de train">
        <div className="chips">
          <button className={project.mode === 'chain' ? 'chip active' : 'chip'} onClick={() => update((d) => void (d.mode = 'chain'))}>
            Simple / composé
          </button>
          <button className={project.mode === 'planetary' ? 'chip active' : 'chip'} onClick={() => update((d) => void (d.mode = 'planetary'))}>
            Planétaire
          </button>
        </div>
        <NumField label="Rendement par engrènement" value={project.meshEfficiency * 100} unit="%" min={50} max={100} digits={1} onChange={(v) => update((d) => void (d.meshEfficiency = v / 100))} hint="0,90–0,95 pour du plastique imprimé, constant (simplification)" />
      </Section>

      {project.mode === 'chain' ? (
        <ChainEditor project={project} update={update} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <PlanetaryEditor project={project} update={update} />
      )}

      <Section title="Résultats cinématiques">
        <div className="grid2 stats">
          <Stat label="Rapport de réduction global" value={describeRatio(train.ratio)} />
          <Stat label="Sens de la sortie" value={directionLabel(1 / train.ratio)} />
          <Stat label="Rendement estimé du train" value={fmt(train.efficiency * 100, 1)} unit="%" />
          <Stat label="Inertie des roues ramenée au moteur" value={fmt(train.gearInertia * 1e7, 3)} unit="g·cm²" />
          {train.linearOutput ? (
            <Stat label="Avance de la crémaillère" value={fmt(toMm(Math.abs(omega / train.ratio)), 2)} unit="mm/s" />
          ) : (
            <Stat label="Vitesse de sortie" value={fmt(Math.abs(toRpm(omega / train.ratio)), 2)} unit="tr/min" />
          )}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Roue</th>
              <th>z</th>
              <th>Arbre / plan</th>
              <th>Vitesse</th>
              <th>Sens</th>
            </tr>
          </thead>
          <tbody>
            {train.nodes.map((n) => (
              <tr key={n.id} className={n.id === selectedId ? 'selected' : ''} onClick={() => onSelect(n.id)}>
                <td>{n.spec.name}{n.count > 1 ? ` (×${n.count})` : ''}</td>
                <td>{n.geo.z}</td>
                <td>{n.geo.kind === 'rack' ? '—' : `plan ${n.layer}`}</td>
                <td>{n.geo.kind === 'rack' ? `${fmt(toMm(Math.abs(n.ratio * omega)), 1)} mm/s` : `${fmt(Math.abs(toRpm(n.ratio * omega)), 1)} tr/min`}</td>
                <td>{n.geo.kind === 'rack' ? '—' : directionLabel(n.ratio)}</td>
              </tr>
            ))}
            {train.planetary && (
              <tr>
                <td>Porte-satellites</td>
                <td>—</td>
                <td>—</td>
                <td>{fmt(Math.abs(toRpm(train.planetary.carrier * omega)), 1)} tr/min</td>
                <td>{directionLabel(train.planetary.carrier)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Formules">
        <p className="formula">
          Engrènement extérieur : ω₂ = −ω₁·z₁/z₂ ; intérieur : ω₂ = +ω₁·z₁/z₂ ; crémaillère : v = r·ω. Les roues coaxiales partagent la vitesse de leur arbre.
          Rapport global N = ω<sub>moteur</sub>/ω<sub>sortie</sub> = produit des rapports d'étage. Rendement : η<sup>k</sup>, k engrènements entre moteur et sortie.
          Planétaire (Willis) : (ω<sub>s</sub> − ω<sub>c</sub>)/(ω<sub>r</sub> − ω<sub>c</sub>) = −z<sub>r</sub>/z<sub>s</sub>, avec z<sub>r</sub> = z<sub>s</sub> + 2z<sub>p</sub> et (z<sub>s</sub> + z<sub>r</sub>) divisible par le nombre de satellites.
          L'entraxe de chaque engrènement est calculé automatiquement (avec déport : inv α<sub>w</sub> = inv α + 2 tan α (x₁ + x₂)/(z₁ + z₂)).
        </p>
      </Section>
    </div>
  );
}

function ChainEditor({ project, update, selectedId, onSelect }: { project: Project; update: Updater; selectedId?: string; onSelect: (id: string) => void }) {
  const gears = project.chain.gears;
  const sel = gears.find((g) => g.gear.id === selectedId) ?? gears[0];

  const add = (kind: 'mesh' | 'coaxial') =>
    update((d) => {
      const parent = d.chain.gears.find((g) => g.gear.id === sel.gear.id)!.gear;
      const helix = parent.type === 'helical' || parent.type === 'herringbone';
      const g = defaultGear({
        id: newId(),
        name: `Roue ${d.chain.gears.length + 1}`,
        module: parent.module,
        pressureAngle: parent.pressureAngle,
        faceWidth: parent.faceWidth,
        materialId: parent.materialId,
        teeth: kind === 'coaxial' ? 14 : 30,
        profileShift: kind === 'coaxial' ? 0.2 : 0,
        type: kind === 'mesh' && helix ? parent.type : 'spur',
        helixAngle: kind === 'mesh' && helix ? -parent.helixAngle : 0,
        bore: kind === 'coaxial' ? { ...parent.bore } : { type: 'round', diameter: parent.bore.diameter, flat: 0 },
      });
      // nouvelle roue : on l'écarte des roues déjà placées autour de la roue menante
      const used = d.chain.gears.filter((x) => x.placement.kind === 'mesh' && x.placement.parent === parent.id).length;
      const placement: Placement = kind === 'mesh' ? { kind: 'mesh', parent: parent.id, angle: (used * 120 * Math.PI) / 180 } : { kind: 'coaxial', parent: parent.id };
      d.chain.gears.push({ gear: g, placement });
      d.chain.outputId = g.id;
      setTimeout(() => onSelect(g.id));
    });

  const remove = () =>
    update((d) => {
      const doomed = new Set([sel.gear.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const g of d.chain.gears) {
          if (g.placement.kind !== 'root' && doomed.has(g.placement.parent) && !doomed.has(g.gear.id)) {
            doomed.add(g.gear.id);
            grew = true;
          }
        }
      }
      d.chain.gears = d.chain.gears.filter((g) => !doomed.has(g.gear.id));
      if (doomed.has(d.chain.outputId)) d.chain.outputId = d.chain.gears[d.chain.gears.length - 1].gear.id;
    });

  const setPlacement = (fn: (p: Placement) => Placement) =>
    update((d) => {
      const g = d.chain.gears.find((x) => x.gear.id === sel.gear.id)!;
      g.placement = fn(g.placement);
    });

  const others = gears.filter((g) => g.gear.id !== sel.gear.id);
  return (
    <Section title="Roues du train">
      <ul className="tree">
        {gears.map((g) => {
          const p = g.placement;
          const parentName = p.kind !== 'root' ? gears.find((x) => x.gear.id === p.parent)?.gear.name : '';
          return (
            <li key={g.gear.id} className={g.gear.id === sel.gear.id ? 'selected' : ''} onClick={() => onSelect(g.gear.id)}>
              <b>{g.gear.name}</b> ({g.gear.teeth} d.){' '}
              <span className="muted">
                {p.kind === 'root' ? 'sur l\'arbre moteur' : p.kind === 'mesh' ? `engrène avec ${parentName}` : `même arbre que ${parentName}`}
                {g.gear.id === project.chain.outputId ? ' · sortie' : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button onClick={() => add('mesh')}>+ Roue qui engrène avec « {sel.gear.name} »</button>
        <button onClick={() => add('coaxial')}>+ Roue sur le même arbre</button>
        {sel.placement.kind !== 'root' && (
          <button className="danger" onClick={remove}>
            Supprimer
          </button>
        )}
      </div>
      {sel.placement.kind !== 'root' && (
        <div className="grid2">
          <SelectField
            label="Liaison"
            value={sel.placement.kind}
            options={[
              { value: 'mesh', label: 'Engrène avec…' },
              { value: 'coaxial', label: 'Même arbre que…' },
            ]}
            onChange={(v) => setPlacement((p) => (v === 'mesh' ? { kind: 'mesh', parent: (p as { parent: string }).parent, angle: 0 } : { kind: 'coaxial', parent: (p as { parent: string }).parent }))}
          />
          <SelectField
            label="Roue liée"
            value={sel.placement.parent}
            options={others.map((g) => ({ value: g.gear.id, label: g.gear.name }))}
            onChange={(v) => setPlacement((p) => ({ ...(p as { kind: 'mesh'; angle: number }), parent: v }) as Placement)}
          />
          {sel.placement.kind === 'mesh' && (
            <NumField label="Angle de placement" value={sel.placement.angle} factor={DEG} unit="°" step={5} digits={1} onChange={(v) => setPlacement((p) => ({ ...(p as { kind: 'mesh'; parent: string; angle: number }), angle: v }))} hint="Direction de la roue menante vers le point primitif ; vous pouvez aussi glisser la roue dans la vue" />
          )}
        </div>
      )}
      <SelectField label="Arbre de sortie" value={project.chain.outputId} options={gears.map((g) => ({ value: g.gear.id, label: g.gear.name }))} onChange={(v) => update((d) => void (d.chain.outputId = v))} />
      <p className="muted small">Une roue sur le même arbre est placée dans le plan suivant : c'est ainsi qu'on construit un train composé.</p>
    </Section>
  );
}

function PlanetaryEditor({ project, update }: { project: Project; update: Updater }) {
  const pl = project.planetary;
  const zr = pl.sun.teeth + 2 * pl.planet.teeth;
  return (
    <Section title="Train planétaire">
      <div className="grid2">
        <NumField label="Dents du soleil" value={pl.sun.teeth} integer min={6} onChange={(v) => update((d) => void (d.planetary.sun.teeth = v))} />
        <NumField label="Dents des satellites" value={pl.planet.teeth} integer min={6} onChange={(v) => update((d) => void (d.planetary.planet.teeth = v))} />
        <NumField label="Dents de la couronne" value={pl.ring.teeth} integer min={20} onChange={(v) => update((d) => void (d.planetary.ring.teeth = v))} />
        <NumField label="Nombre de satellites" value={pl.planets} integer min={1} max={8} onChange={(v) => update((d) => void (d.planetary.planets = v))} />
        <SelectField label="Entrée (moteur)" value={pl.input} options={MEMBERS} onChange={(v) => update((d) => void (d.planetary.input = v))} />
        <SelectField label="Membre fixe" value={pl.fixed} options={MEMBERS} onChange={(v) => update((d) => void (d.planetary.fixed = v))} />
      </div>
      {pl.ring.teeth !== zr && (
        <button className="small" onClick={() => update((d) => void (d.planetary.ring.teeth = zr))}>
          Corriger : z couronne = {zr}
        </button>
      )}
      <p className="muted small">
        Module et angle de pression se règlent dans l'onglet Engrenage (communs aux trois roues). Satellites sans déport, couronne à denture droite.
      </p>
    </Section>
  );
}
