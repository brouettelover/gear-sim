/**
 * Onglet 1 : définition d'un engrenage et réglages d'impression.
 */
import type { Computed, Project } from '../core/project';
import type { BoreType, GearSpec, GearType } from '../core/types';
import { DEG, MM, fmt, toMm } from '../core/units';
import { inv } from '../core/involute';
import { rodBoreDiameter } from '../core/assembly';
import { leadAngle } from '../core/worm';
import type { Updater } from './App';
import { projectGears } from './App';
import { CheckField, NumField, Section, SelectField, Stat, TextField } from './fields';
import { mutateGear, shapePath } from './svg';
import { useState } from 'react';

const TYPE_LABELS: { value: GearType; label: string }[] = [
  { value: 'spur', label: 'Droit' },
  { value: 'helical', label: 'Hélicoïdal' },
  { value: 'herringbone', label: 'Chevron' },
  { value: 'rack', label: 'Crémaillère' },
  { value: 'internal', label: 'Couronne intérieure' },
  { value: 'bevel', label: 'Conique (renvoi à 90°)' },
  { value: 'worm', label: 'Vis sans fin' },
  { value: 'wormwheel', label: 'Roue de vis sans fin' },
];

const BORE_LABELS: { value: BoreType; label: string }[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'round', label: 'Rond' },
  { value: 'd', label: 'En D (méplat)' },
  { value: 'hex', label: 'Hexagonal' },
];

interface Props {
  project: Project;
  computed: Computed;
  update: Updater;
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function GearEditor({ project, computed, update, selectedId, onSelect }: Props) {
  const gears = projectGears(project);
  const gear = gears.find((g) => g.id === selectedId) ?? gears[0];
  const node = computed.train.nodes.find((n) => n.id === gear?.id);
  if (!gear || !node) return <p>Aucune roue.</p>;
  const g = node.geo;
  const planetary = project.mode === 'planetary';
  const isRing = planetary && gear.id === project.planetary.ring.id;
  const set = (fn: (s: GearSpec) => void) =>
    update((d) => {
      mutateGear(d, gear.id, fn);
      // en planétaire, module et angle de pression sont communs aux trois roues
      if (d.mode === 'planetary') {
        const src = [d.planetary.sun, d.planetary.planet, d.planetary.ring].find((x) => x.id === gear.id)!;
        for (const o of [d.planetary.sun, d.planetary.planet, d.planetary.ring]) {
          o.module = src.module;
          o.pressureAngle = src.pressureAngle;
        }
      }
    });
  const helix = gear.type === 'helical' || gear.type === 'herringbone';
  const worm = gear.type === 'worm';
  const meshes = computed.train.meshes.filter((m) => m.a === gear.id || m.b === gear.id);
  const typeOptions = planetary ? TYPE_LABELS.filter((t) => (isRing ? t.value === 'internal' : t.value === 'spur')) : TYPE_LABELS;

  return (
    <div>
      <Section title="Roue à éditer">
        <div className="chips">
          {gears.map((x) => (
            <button key={x.id} className={x.id === gear.id ? 'chip active' : 'chip'} onClick={() => onSelect(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Définition">
        <div className="grid2">
          <TextField label="Nom" value={gear.name} onChange={(v) => set((s) => void (s.name = v))} />
          <SelectField label="Type" value={gear.type} options={typeOptions} onChange={(v) => set((s) => void (s.type = v))} />
          <NumField label={worm || gear.type === 'wormwheel' ? 'Module axial' : gear.type === 'bevel' ? 'Module (au talon)' : 'Module'} value={gear.module} factor={MM} unit="mm" min={0.1} step={0.1} onChange={(v) => set((s) => void (s.module = v))} hint="Module normal mn = pas / π" />
          <NumField label={g.kind === 'rack' ? 'Nombre de dents (longueur)' : worm ? 'Nombre de filets' : 'Nombre de dents'} value={gear.teeth} integer min={worm ? 1 : 3} max={worm ? 4 : 400} onChange={(v) => set((s) => void (s.teeth = v))} />
          <NumField label="Angle de pression" value={gear.pressureAngle} factor={DEG} unit="°" min={10} max={35} step={0.5} onChange={(v) => set((s) => void (s.pressureAngle = v))} />
          <NumField label={worm ? 'Longueur de la vis' : 'Largeur'} value={gear.faceWidth} factor={MM} unit="mm" min={0.5} onChange={(v) => set((s) => void (s.faceWidth = v))} hint={gear.type === 'bevel' ? 'Longueur de denture le long du cône (≤ R/3)' : undefined} />
          {worm && (
            <>
              <NumField label="Coefficient diamétral q" value={gear.diameterFactor ?? 10} digits={2} min={4} max={30} step={1} onChange={(v) => set((s) => void (s.diameterFactor = v))} hint="Diamètre primitif de la vis = q × module ; q petit : filet plus incliné, meilleur rendement" />
              <SelectField label="Sens du filet" value={gear.helixAngle < 0 ? 'left' : 'right'} options={[{ value: 'right', label: 'À droite' }, { value: 'left', label: 'À gauche' }]} onChange={(v) => set((s) => void (s.helixAngle = v === 'left' ? -1 : 1))} />
            </>
          )}
          {gear.type === 'bevel' && (
            <NumField label="Épaisseur du dos" value={gear.rimWidth} factor={MM} unit="mm" min={0} onChange={(v) => set((s) => void (s.rimWidth = v))} hint="Disque plein sous la denture, côté opposé au sommet du cône" />
          )}
          {g.kind === 'external' && !worm && gear.type !== 'wormwheel' && (
            <NumField label="Déport de profil x" value={gear.profileShift} digits={3} min={-1} max={1.5} step={0.05} onChange={(v) => set((s) => void (s.profileShift = v))} hint="Décalage de l'outil en multiples du module ; > 0 renforce les petits pignons" />
          )}
          {helix && (
            <NumField label="Angle d'hélice (± sens)" value={gear.helixAngle} factor={DEG} unit="°" min={-60} max={60} step={1} onChange={(v) => set((s) => void (s.helixAngle = v))} hint="Positif : hélice à droite ; la roue conjuguée doit avoir l'angle opposé" />
          )}
          {g.kind !== 'external' && (
            <NumField label={g.kind === 'rack' ? 'Hauteur de dos' : 'Épaisseur de jante'} value={gear.rimWidth} factor={MM} unit="mm" min={0.5} onChange={(v) => set((s) => void (s.rimWidth = v))} />
          )}
          <SelectField label="Matériau" value={gear.materialId} options={project.materials.map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => set((s) => void (s.materialId = v))} />
        </div>
        {g.kind === 'external' && g.x < g.xMin && (
          <button className="small" onClick={() => set((s) => void (s.profileShift = Math.ceil(g.xMin * 100) / 100))}>
            Appliquer le déport minimal sans dégagement (x = {fmt(Math.ceil(g.xMin * 100) / 100)})
          </button>
        )}
        {isRing && (
          <button className="small" onClick={() => set((s) => void (s.teeth = project.planetary.sun.teeth + 2 * project.planetary.planet.teeth))}>
            z couronne = z soleil + 2·z satellite ({project.planetary.sun.teeth + 2 * project.planetary.planet.teeth})
          </button>
        )}
      </Section>

      {g.kind === 'external' && computed.assembly.rodGearIds.includes(gear.id) && (
        <Section title="Alésage">
          <p className="muted small">
            Imposé par le montage sur tige : rond Ø {fmt(toMm(rodBoreDiameter(project.assembly)), 2)} mm
            {project.assembly.rodMode === 'fixed' ? ' (tige + jeu de rotation, la roue tourne sur la tige)' : ' (serré sur la tige tournante)'}, plus la compensation d'impression.
            Réglage dans l'onglet Train, section « Montage 3D ».
          </p>
        </Section>
      )}
      {g.kind === 'external' && !computed.assembly.rodGearIds.includes(gear.id) && (
        <Section title="Alésage">
          <div className="grid2">
            <SelectField label="Forme" value={gear.bore.type} options={BORE_LABELS} onChange={(v) => set((s) => void (s.bore.type = v))} />
            {gear.bore.type !== 'none' && (
              <NumField label={gear.bore.type === 'hex' ? 'Cote sur plats' : 'Diamètre'} value={gear.bore.diameter} factor={MM} unit="mm" min={0.5} onChange={(v) => set((s) => void (s.bore.diameter = v))} />
            )}
            {gear.bore.type === 'd' && (
              <NumField label="Cote au méplat" value={gear.bore.flat} factor={MM} unit="mm" min={0.2} onChange={(v) => set((s) => void (s.bore.flat = v))} hint="Distance du méplat au côté opposé (2,5 mm pour l'arbre Ø3 des N20)" />
            )}
          </div>
          <button className="small" onClick={() => set((s) => void (s.bore = { type: 'd', diameter: 3 * MM, flat: 2.5 * MM }))}>
            Arbre N20 (Ø3 en D, méplat 2,5)
          </button>
        </Section>
      )}

      <PrintSettingsEditor project={project} update={update} />

      <Section title="Géométrie calculée">
        <div className="grid2 stats">
          {g.kind !== 'rack' && (
            <>
              <Stat label="Diamètre primitif d" value={fmt(toMm(2 * g.r), 3)} unit="mm" />
              <Stat label={g.kind === 'internal' ? 'Diamètre de tête (intérieur)' : 'Diamètre de tête da'} value={fmt(toMm(2 * g.ra), 3)} unit="mm" />
              <Stat label="Diamètre de pied df" value={fmt(toMm(2 * g.rf), 3)} unit="mm" />
              <Stat label="Diamètre de base db" value={fmt(toMm(2 * g.rb), 3)} unit="mm" />
            </>
          )}
          <Stat label="Pas apparent" value={fmt(toMm(g.pt), 3)} unit="mm" />
          <Stat label={g.kind === 'internal' ? 'Largeur du creux au primitif' : 'Épaisseur au primitif'} value={fmt(toMm(g.s), 3)} unit="mm" />
          {g.kind !== 'rack' && <Stat label="Épaisseur en tête" value={fmt(toMm(g.sa), 3)} unit="mm" tone={g.sa < print(project) ? 'marginal' : undefined} />}
          <Stat label="Rayon de congé d'outil ρ" value={fmt(toMm(g.rho), 3)} unit="mm" />
          {helix && <Stat label="Module apparent mt" value={fmt(toMm(g.mt), 4)} unit="mm" />}
          {helix && <Stat label="Angle de pression apparent" value={fmt(g.alphaT / DEG, 3)} unit="°" />}
          {g.kind === 'external' && <Stat label="z mini sans dégagement" value={fmt(g.zMin, 1)} />}
          {g.kind === 'external' && <Stat label="Déport mini sans dégagement" value={fmt(g.xMin, 3)} />}
          {node.solid.bevel && (
            <>
              <Stat label="Angle primitif δ" value={fmt(node.solid.bevel.delta / DEG, 2)} unit="°" />
              <Stat label="Génératrice R" value={fmt(toMm(node.solid.bevel.coneDistance), 2)} unit="mm" />
              <Stat label="Largeur / R" value={fmt(node.solid.bevel.widthRatio, 2)} tone={node.solid.bevel.widthRatio > 1 / 3 ? 'marginal' : 'ok'} />
              <Stat label="Dents virtuelles zv = z / cos δ" value={fmt(node.solid.bevel.virtual.z, 1)} />
            </>
          )}
          {worm && <Stat label="Angle du filet γ = atan(z/q)" value={fmt(leadAngle(gear) / DEG, 2)} unit="°" />}
          <Stat label="Masse (remplissage effectif)" value={fmt(node.mass * 1000, 2)} unit="g" />
          <Stat label="Inertie propre" value={fmt(node.inertia * 1e7, 3)} unit="g·cm²" />
        </div>
        {meshes.map((m) => {
          const other = computed.train.nodes.find((n) => n.id === (m.a === gear.id ? m.b : m.a))!;
          return (
            <div key={m.a + m.b} className="grid2 stats mesh-stats">
              {m.type === 'bevel' ? (
                <Stat label={`Avec ${other.spec.name} : axes concourants`} value="90" unit="°" />
              ) : (
                <Stat label={`Avec ${other.spec.name} : entraxe`} value={fmt(toMm(m.geo.centerDistance), 3)} unit="mm" />
              )}
              {m.type === 'worm' && (
                <Stat label="Rendement (vis menante / roue menante)" value={`${fmt(m.efficiency * 100, 0)} % / ${m.backEfficiency > 0 ? `${fmt(m.backEfficiency * 100, 0)} %` : 'irréversible'}`} />
              )}
              <Stat label="Rapport de conduite εα" value={fmt(m.geo.contactRatio, 3)} tone={m.geo.contactRatio < 1.2 ? 'danger' : m.geo.contactRatio < 1.4 ? 'marginal' : 'ok'} />
              {m.geo.overlapRatio > 0 && <Stat label="Recouvrement εβ" value={fmt(m.geo.overlapRatio, 3)} />}
              {m.type === 'parallel' && <Stat label="Angle de pression de fonctionnement" value={fmt(m.geo.alphaW / DEG, 3)} unit="°" />}
            </div>
          );
        })}
      </Section>

      <Section title="Profil">
        <GearPreview path={shapePath(node.shape)} r={g.r} rb={g.rb} ra={g.ra} rf={g.rf} rack={g.kind === 'rack'} />
      </Section>

      <Section title="Formules">
        <p className="formula">
          d = z·mt, mt = mn / cos β, db = d·cos αt, da = d + 2mn(1 + x), df = d − 2mn(1 + c* − x).
          Épaisseur au rayon R : s<sub>R</sub> = 2R·(s/d + inv αt − inv α<sub>R</sub>), inv α = tan α − α (inv 20° = {fmt(inv(20 * DEG), 6)}).
          Le profil est tracé en simulant le taillage par une crémaillère ISO 53 : la développante est exacte,
          le congé de pied est la trace de l'arrondi de l'outil (ρ = c*·m / (1 − sin α)), et le dégagement apparaît si z est trop faible.
          Le jeu au flanc amincit chaque dent de la moitié du jeu.
        </p>
        {gear.type === 'bevel' && (
          <p className="formula">
            Conique droit, axes à 90° : tan δ₁ = z₁/z₂, génératrice R = d/(2 sin δ), saillie et creux au talon, dents réduites
            linéairement vers le sommet du cône (largeur conseillée ≤ R/3). Profil au talon : roue droite virtuelle de Tredgold
            (zv = z/cos δ, rayon r/cos δ) développée sur le cône complémentaire ; Lewis et conduite sont calculés sur cette roue virtuelle,
            l'effort au rayon moyen r·(1 − b/2R). Vue de dessus : talon projeté.
          </p>
        )}
        {(worm || gear.type === 'wormwheel') && (
          <p className="formula">
            Vis : diamètre d₁ = q·m, angle du filet tan γ = z₁/q ; roue : d₂ = z₂·m, entraxe a = (d₁ + d₂)/2, rapport z₂/z₁.
            La vis est modélisée comme une roue hélicoïdale à z₁ dents d'angle 90° − γ (flancs en développante, type ZI), la roue comme
            une roue hélicoïdale d'angle γ de même sens, sans gorge. Rendement (frottement μ = 0,2) : η = tan γ / tan(γ + φ'),
            φ' = atan(μ/cos α) ; en sens inverse η' = tan(γ − φ')/tan γ, irréversible si γ ≤ φ'.
          </p>
        )}
      </Section>
    </div>
  );
}

const print = (p: Project) => p.print.nozzle;

function PrintSettingsEditor({ project, update }: { project: Project; update: Updater }) {
  const p = project.print;
  return (
    <Section title="Réglages d'impression (tout le projet)">
      <div className="grid2">
        <NumField label="Jeu au flanc (par engrènement)" value={p.backlash} factor={MM} unit="mm" min={0} step={0.05} onChange={(v) => update((d) => void (d.print.backlash = v))} hint="Chaque roue est amincie de la moitié du jeu sur le primitif" />
        <NumField label="Jeu radial c*" value={p.clearanceCoef} digits={3} min={0.1} max={0.6} step={0.05} onChange={(v) => update((d) => void (d.print.clearanceCoef = v))} hint="Jeu en fond de dent = c*·m (0,25 standard) ; augmente aussi le congé de pied" />
        <NumField label="Compensation des alésages (diamètre)" value={p.boreTolerance} factor={MM} unit="mm" step={0.05} onChange={(v) => update((d) => void (d.print.boreTolerance = v))} />
        <NumField label="Diamètre de buse" value={p.nozzle} factor={MM} unit="mm" min={0.1} step={0.1} onChange={(v) => update((d) => void (d.print.nozzle = v))} />
        <NumField label="Densité effective (remplissage)" value={p.fillFactor * 100} factor={1} unit="%" min={10} max={100} onChange={(v) => update((d) => void (d.print.fillFactor = v / 100))} hint="Pour la masse et l'inertie des roues" />
      </div>
    </Section>
  );
}

/** Aperçu d'une roue seule avec ses cercles caractéristiques. */
function GearPreview({ path, r, rb, ra, rf, rack }: { path: string; r: number; rb: number; ra: number; rf: number; rack: boolean }) {
  const [circles, setCircles] = useState(true);
  if (rack) {
    return (
      <svg className="preview" viewBox="-20 -12 60 20">
        <g transform="scale(1,-1)">
          <path d={path} className="gear-shape" fillRule="evenodd" />
          <line x1={-100} x2={100} y1={0} y2={0} className="pitch" />
        </g>
      </svg>
    );
  }
  const R = Math.max(ra, rf) * 1000 * 1.08;
  return (
    <div>
      <CheckField label="Afficher les cercles primitif, de base, de tête et de pied" checked={circles} onChange={setCircles} />
      <svg className="preview" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}>
        <g transform="scale(1,-1)">
          <path d={path} className="gear-shape" fillRule="evenodd" />
          {circles && (
            <>
              <circle r={r * 1000} className="pitch" />
              <circle r={rb * 1000} className="base" />
              <circle r={ra * 1000} className="tipc" />
              <circle r={rf * 1000} className="rootc" />
            </>
          )}
        </g>
      </svg>
      {circles && (
        <div className="legend">
          <span className="lg pitch">primitif</span> <span className="lg base">base</span> <span className="lg tipc">tête</span> <span className="lg rootc">pied</span>
        </div>
      )}
    </div>
  );
}
