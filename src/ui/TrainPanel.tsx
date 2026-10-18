/**
 * Onglet 2 : construction du train (simple, composé ou planétaire) et cinématique.
 */
import type { Computed, Project } from '../core/project';
import { defaultGear, newId } from '../core/project';
import { describeRatio, directionLabel, type Placement, type PlanetaryMember } from '../core/train';
import { suggestMeshGear, type AssemblySpec } from '../core/assembly';
import { DEG, MM, fmt, toMm, toRpm } from '../core/units';
import type { Updater } from './App';
import { CheckField, NumField, Section, SelectField, Stat, TextField } from './fields';

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
        <ChainEditor project={project} computed={computed} update={update} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <PlanetaryEditor project={project} update={update} />
      )}

      <AssemblyEditor project={project} computed={computed} update={update} selectedId={selectedId} />

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
              <th>Position axiale</th>
              <th>Vitesse</th>
              <th>Sens</th>
            </tr>
          </thead>
          <tbody>
            {train.nodes.map((n) => (
              <tr key={n.id} className={n.id === selectedId ? 'selected' : ''} onClick={() => onSelect(n.id)}>
                <td>{n.spec.name}{n.count > 1 ? ` (×${n.count})` : ''}</td>
                <td>{n.geo.z}</td>
                <td>{`z ${fmt(toMm(computed.assembly.placed[n.id]?.z ?? 0), 2)} mm`}</td>
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

function ChainEditor({ project, computed, update, selectedId, onSelect }: { project: Project; computed: Computed; update: Updater; selectedId?: string; onSelect: (id: string) => void }) {
  const gears = project.chain.gears;
  const sel = gears.find((g) => g.gear.id === selectedId) ?? gears[0];

  /** `end` : roue sur la même tige, à l'autre bout (tige de transmission) */
  const add = (kind0: 'mesh' | 'coaxial' | 'end') =>
    update((d) => {
      const kind = kind0 === 'end' ? 'coaxial' : kind0;
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
      // roue conjuguée d'une roue conique ou d'une vis : même famille
      if (kind === 'mesh' && parent.type === 'bevel') Object.assign(g, { type: 'bevel', teeth: parent.teeth, faceWidth: parent.faceWidth, rimWidth: parent.rimWidth, profileShift: 0 });
      if (kind === 'mesh' && parent.type === 'worm') Object.assign(g, { type: 'wormwheel', teeth: 30, profileShift: 0 });
      if (kind === 'mesh' && parent.type === 'wormwheel') Object.assign(g, { type: 'worm', teeth: 1, diameterFactor: 10, helixAngle: 1, profileShift: 0, faceWidth: Math.ceil((4 * Math.PI * parent.module) / MM) * MM });
      // nouvelle roue : on l'écarte des roues déjà placées autour de la roue menante
      const used = d.chain.gears.filter((x) => x.placement.kind === 'mesh' && x.placement.parent === parent.id).length;
      // direction préférée : dans le prolongement de l'arbre moteur vers la roue menante, puis une place libre
      const pn = computed.train.nodes.find((n) => n.id === parent.id);
      const preferred = pn && Math.hypot(pn.x, pn.y) > 1e-9 ? Math.atan2(pn.y, pn.x) : (used * 120 * Math.PI) / 180;
      let angle = 0;
      if (kind === 'mesh') {
        const sug = suggestMeshGear(computed.train, computed.assembly, parent.id, g, d.print, d.assembly.rodDiameter / 2, preferred);
        angle = sug.angle;
        g.teeth = sug.teeth;
      }
      const placement: Placement = kind === 'mesh' ? { kind: 'mesh', parent: parent.id, angle } : { kind: 'coaxial', parent: parent.id };
      // à l'autre bout : tige de 20 mm entre les roues (derrière une conique, devant sinon), réglable en glissant la roue en 3D
      const axialOffset = kind0 === 'end' ? (parent.type === 'bevel' ? -20 : 20) * MM : undefined;
      if (kind0 === 'end') g.name = `Bout de tige ${d.chain.gears.length + 1}`;
      d.chain.gears.push({ gear: g, placement, ...(axialOffset ? { axialOffset } : {}) });
      d.chain.outputId = g.id;
      setTimeout(() => onSelect(g.id));
    });

  /** renvoi d'angle : conique ou vis sans fin, accroché à la roue sélectionnée (ou ajouté sur son arbre) */
  const addAngle = (kind: 'bevel' | 'worm') =>
    update((d) => {
      const sg = d.chain.gears.find((g) => g.gear.id === sel.gear.id)!.gear;
      const base = { module: sg.module, pressureAngle: sg.pressureAngle, materialId: sg.materialId, profileShift: 0, helixAngle: 0 };
      const n = d.chain.gears.length;
      let parent = sg;
      const push = (gear: ReturnType<typeof defaultGear>, placement: Placement) => {
        d.chain.gears.push({ gear, placement });
        return gear;
      };
      if (kind === 'bevel') {
        if (sg.type !== 'bevel') {
          parent = push(defaultGear({ ...base, id: newId(), name: `Conique ${n + 1}`, type: 'bevel', teeth: 20, faceWidth: 4.5 * MM, rimWidth: 2 * MM, bore: { ...sg.bore } }), { kind: 'coaxial', parent: sg.id });
        }
        const child = push(defaultGear({ ...base, id: newId(), name: `Conique ${d.chain.gears.length + 1}`, type: 'bevel', teeth: parent.teeth, faceWidth: parent.faceWidth, rimWidth: 2 * MM, bore: { type: 'round', diameter: 3 * MM, flat: 0 } }), { kind: 'mesh', parent: parent.id, angle: 0 });
        d.chain.outputId = child.id;
        setTimeout(() => onSelect(child.id));
      } else {
        const wormSpec = (bore: typeof sg.bore) => defaultGear({ ...base, id: newId(), name: 'Vis sans fin', type: 'worm', teeth: 1, faceWidth: Math.ceil(4 * Math.PI * sg.module / MM) * MM, diameterFactor: 10, helixAngle: 1, bore: { ...bore } });
        const wheelSpec = () => defaultGear({ ...base, id: newId(), name: 'Roue de vis', type: 'wormwheel', teeth: 30, faceWidth: 6 * MM, bore: { type: 'round', diameter: 3 * MM, flat: 0 } });
        let child;
        if (sg.type === 'worm') child = push(wheelSpec(), { kind: 'mesh', parent: sg.id, angle: 0 });
        else if (sg.type === 'wormwheel') child = push(wormSpec({ type: 'round', diameter: 3 * MM, flat: 0 }), { kind: 'mesh', parent: sg.id, angle: 0 });
        else {
          parent = push(wormSpec(sg.bore), { kind: 'coaxial', parent: sg.id });
          child = push(wheelSpec(), { kind: 'mesh', parent: parent.id, angle: 0 });
          // la roue est dans un plan vertical : on monte la vis pour que la roue passe au-dessus du flasque
          const pp = computed.assembly.placed[sg.id];
          if (pp && pp.group === 0) {
            const wormMid = pp.z + pp.width + d.assembly.layerGap + parent.faceWidth / 2;
            const need = ((child.teeth + 2.5) * child.module) / 2 + d.assembly.plateGap + 0.5 * MM;
            const g = d.chain.gears.find((x) => x.gear.id === parent.id)!;
            if (need > wormMid) g.axialOffset = Math.ceil((need - wormMid) / MM * 2) / 2 * MM;
          }
        }
        d.chain.outputId = child.id;
        setTimeout(() => onSelect(child.id));
      }
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
        <button onClick={() => add('end')}>+ Roue à l'autre bout de la tige</button>
        <button onClick={() => addAngle('bevel')}>+ Renvoi conique à 90°</button>
        <button onClick={() => addAngle('worm')}>+ Vis sans fin</button>
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
            <NumField label={['bevel', 'worm', 'wormwheel'].includes(sel.gear.type) ? 'Direction du renvoi' : 'Angle de placement'} value={sel.placement.angle} factor={DEG} unit="°" step={5} digits={1} onChange={(v) => setPlacement((p) => ({ ...(p as { kind: 'mesh'; parent: string; angle: number }), angle: v }))} hint="Direction de la roue menante vers le point primitif ; vous pouvez aussi glisser la roue dans la vue" />
          )}
        </div>
      )}
      <SelectField label="Arbre de sortie" value={project.chain.outputId} options={gears.map((g) => ({ value: g.gear.id, label: g.gear.name }))} onChange={(v) => update((d) => void (d.chain.outputId = v))} />
      <p className="muted small">Une roue sur le même arbre est placée dans le plan suivant : c'est ainsi qu'on construit un train composé. Chaque arbre autre que celui du moteur est une tige (section « Montage 3D »). « Roue à l'autre bout de la tige » crée une tige de transmission avec une roue à chaque extrémité. Pour déplacer une roue, sélectionnez-la puis glissez-la : en 2D autour de sa roue menante (toute la tige suit), en 3D aussi le long de sa tige.</p>
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

const ROD_PRESETS = [2, 3, 4, 5, 8];

function AssemblyEditor({ project, computed, update, selectedId }: { project: Project; computed: Computed; update: Updater; selectedId?: string }) {
  const a = project.assembly;
  const asm = computed.assembly;
  const set = (fn: (s: AssemblySpec) => void) => update((d) => fn(d.assembly));
  if (project.mode === 'planetary') {
    return (
      <Section title="Montage 3D">
        {asm.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
      </Section>
    );
  }
  const sel = project.chain.gears.find((g) => g.gear.id === selectedId) ?? project.chain.gears[0];
  const nodeName = (id: string) => computed.train.nodes.find((n) => n.id === id)?.spec.name ?? id;
  return (
    <Section title="Montage 3D (tiges et flasques)">
      <div className="grid2">
        <NumField label={`Position axiale de « ${sel.gear.name} » : décalage`} value={sel.axialOffset ?? 0} factor={MM} unit="mm" step={0.5} digits={2}
          onChange={(v) => update((d) => {
            const g = d.chain.gears.find((x) => x.gear.id === sel.gear.id);
            if (g) g.axialOffset = v || undefined;
          })}
          hint="Ajouté à la position automatique ; les roues qui en dépendent suivent" />
        <Stat label="Face inférieure (z)" value={fmt(toMm(asm.placed[sel.gear.id]?.z ?? 0), 2)} unit="mm" />
      </div>
      <div className="grid2">
        <NumField label="Diamètre des tiges" value={a.rodDiameter} factor={MM} unit="mm" min={1} step={0.5} digits={2} onChange={(v) => set((s) => void (s.rodDiameter = v))} />
        <SelectField<AssemblySpec['rodMode']>
          label="Montage"
          value={a.rodMode}
          options={[
            { value: 'fixed', label: 'Tiges fixes, roues libres' },
            { value: 'rotating', label: 'Tiges tournantes, roues serrées' },
          ]}
          onChange={(v) => set((s) => void (s.rodMode = v))}
        />
      </div>
      <div className="chips">
        {ROD_PRESETS.map((d) => (
          <button key={d} className={Math.abs(a.rodDiameter - d * MM) < 1e-9 ? 'chip active' : 'chip'} onClick={() => set((s) => void (s.rodDiameter = d * MM))}>Ø {d}</button>
        ))}
      </div>
      <div className="grid2">
        <NumField label="Jeu de rotation (diamètre)" value={a.runningClearance} factor={MM} unit="mm" step={0.05} digits={2} min={0} onChange={(v) => set((s) => void (s.runningClearance = v))} hint="Roue libre sur tige fixe, ou tige tournante dans le flasque" />
        <NumField label="Jeu entre plans de roues" value={a.layerGap} factor={MM} unit="mm" step={0.1} digits={2} min={0} onChange={(v) => set((s) => void (s.layerGap = v))} />
        <NumField label="Jeu roues / flasques" value={a.plateGap} factor={MM} unit="mm" step={0.1} digits={2} min={0} onChange={(v) => set((s) => void (s.plateGap = v))} />
        <NumField label="Épaisseur des flasques" value={a.plateThickness} factor={MM} unit="mm" step={0.5} digits={2} min={0.5} onChange={(v) => set((s) => void (s.plateThickness = v))} />
        <NumField label="Marge des flasques" value={a.plateMargin} factor={MM} unit="mm" step={0.5} digits={2} min={0} onChange={(v) => set((s) => void (s.plateMargin = v))} />
        <NumField label="Longueur de l'arbre moteur" value={a.motorShaftLength} factor={MM} unit="mm" step={0.5} digits={2} min={1} onChange={(v) => set((s) => void (s.motorShaftLength = v))} hint="Depuis la face de fixation du moteur (N20 : souvent 10 mm)" />
        <NumField label="Passage de l'arbre moteur" value={a.motorHole} factor={MM} unit="mm" step={0.5} digits={2} min={1} onChange={(v) => set((s) => void (s.motorHole = v))} hint="Trou du flasque inférieur : à mesurer sur votre moteur (bossage du palier)" />
      </div>
      <CheckField label="Alésage des roues imposé par la tige" checked={a.autoBores} onChange={(v) => set((s) => void (s.autoBores = v))} />
      <h3 className="subhead">Tiges libres (colonnes, supports)</h3>
      {(a.freeRods ?? []).map((r, i) => (
        <div key={r.id} className="grid3">
          <TextField label="Nom" value={r.name} onChange={(v) => set((s) => void (s.freeRods![i].name = v))} />
          <NumField label="x" value={r.x} factor={MM} unit="mm" step={0.5} digits={2} onChange={(v) => set((s) => void (s.freeRods![i].x = v))} />
          <NumField label="y" value={r.y} factor={MM} unit="mm" step={0.5} digits={2} onChange={(v) => set((s) => void (s.freeRods![i].y = v))} />
          <button className="small danger" onClick={() => set((s) => void s.freeRods!.splice(i, 1))}>Supprimer</button>
        </div>
      ))}
      <button
        className="small"
        onClick={() =>
          set((s) => {
            // coin du flasque, à l'intérieur de la marge
            const pts = asm.plates[0]?.shape.outer ?? [{ x: 0, y: 0 }];
            const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
            const k = (s.freeRods ?? []).length;
            const inset = s.plateMargin / 2 + s.rodDiameter / 2 + 0.5 * MM;
            const x = k % 2 ? Math.min(...xs) + inset : Math.max(...xs) - inset;
            const y = k % 4 >= 2 ? Math.max(...ys) - inset : Math.min(...ys) + inset;
            s.freeRods = [...(s.freeRods ?? []), { id: newId(), name: `Colonne ${k + 1}`, x: Math.round(x / MM * 2) / 2 * MM, y: Math.round(y / MM * 2) / 2 * MM }];
          })
        }
      >
        + Tige libre
      </button>
      <p className="muted small">Une tige libre traverse les deux flasques sans porter de roue : colonne d'entretoisement ou support. Elle se déplace aussi en la glissant dans la vue 2D. Les flasques s'agrandissent pour l'englober.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Arbre</th>
            <th>Roues (de bas en haut)</th>
            <th>Tige</th>
          </tr>
        </thead>
        <tbody>
          {asm.shafts.map((s) => (
            <tr key={s.id}>
              <td>{s.kind === 'motor' ? 'Moteur' : s.kind === 'free' ? `Tige libre « ${s.name} »` : `Tige de « ${nodeName(s.rootGearId)} »`}{s.group !== 0 ? ' (axe perpendiculaire)' : ''}</td>
              <td>{s.gearIds.map(nodeName).join(', ') || '—'}</td>
              <td>{s.kind === 'motor' ? `arbre Ø ${fmt(toMm(2 * s.radius), 1)} mm` : `Ø ${fmt(toMm(2 * s.radius), 1)} × ${fmt(toMm(s.zTo - s.zFrom), 1)} mm`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid2 stats">
        <Stat label="Hauteur entre flasques" value={fmt(toMm(asm.innerHeight), 2)} unit="mm" />
        {asm.plates[0] && <Stat label="Flasques" value={`${fmt(toMm(asm.plates[0].width), 1)} × ${fmt(toMm(asm.plates[0].height), 1)}`} unit="mm" />}
      </div>
      {asm.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
      <p className="formula">
        Position automatique (face inférieure) : roue moteur à z = jeu au flasque ; une roue qui engrène est dans le plan de sa menante ;
        une roue coaxiale est au-dessus : z = z<sub>parent</sub> + b<sub>parent</sub> + jeu entre plans. Tige = hauteur entre flasques + 2 épaisseurs de flasque.
        Collisions vérifiées entre roues dont les plans se recouvrent, et entre chaque roue et les tiges des autres arbres (jeu 0,2 mm).
      </p>
    </Section>
  );
}
