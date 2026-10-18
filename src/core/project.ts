/**
 * Projet : tout ce qui est sauvegardé (JSON / localStorage), valeurs par défaut,
 * et calcul complet (géométrie → train → moteur → régime permanent → résistance).
 */
import { DEFAULT_MATERIALS, type Material } from './materials';
import { MOTOR_PRESETS, motorModel, type MotorModel, type MotorSpec } from './motor';
import { steadyState, type Drivetrain, type LoadSpec, type SteadyState, type VoltageProfile } from './simulation';
import { lewisBending, safetyLevel, type BendingResult, type SafetyLevel } from './strength';
import { analyzeChain, analyzePlanetary, gearLoads, type ChainSpec, type PlanetarySpec, type TrainAnalysis, type TrainNode } from './train';
import type { GearSpec, PrintSettings, Warning } from './types';
import { DEG, MM, fmt } from './units';

export interface SimSettings {
  profile: VoltageProfile;
  /** durée simulée (s) */
  duration: number;
}

export interface Project {
  version: 1;
  name: string;
  mode: 'chain' | 'planetary';
  chain: ChainSpec;
  planetary: PlanetarySpec;
  print: PrintSettings;
  /** rendement par engrènement (0–1) */
  meshEfficiency: number;
  materials: Material[];
  motor: MotorSpec;
  load: LoadSpec;
  sim: SimSettings;
}

let counter = 0;
export const newId = () => `g${Date.now().toString(36)}${(counter++).toString(36)}`;

export function defaultGear(over: Partial<GearSpec> = {}): GearSpec {
  return {
    id: newId(),
    name: 'Roue',
    type: 'spur',
    module: 1 * MM,
    teeth: 20,
    pressureAngle: 20 * DEG,
    faceWidth: 6 * MM,
    profileShift: 0,
    helixAngle: 0,
    bore: { type: 'round', diameter: 3 * MM, flat: 2.5 * MM },
    rimWidth: 3 * MM,
    materialId: 'PETG',
    ...over,
  };
}

export const DEFAULT_PRINT: PrintSettings = {
  backlash: 0.15 * MM,
  clearanceCoef: 0.25,
  boreTolerance: 0.1 * MM,
  nozzle: 0.4 * MM,
  fillFactor: 0.85,
};

export function defaultProject(): Project {
  const pinion = defaultGear({ name: 'Pignon moteur', teeth: 14, profileShift: 0.2, bore: { type: 'd', diameter: 3 * MM, flat: 2.5 * MM } });
  const wheel = defaultGear({ name: 'Roue de sortie', teeth: 42, bore: { type: 'round', diameter: 5 * MM, flat: 0 } });
  const sun = defaultGear({ name: 'Soleil', teeth: 18, bore: { type: 'd', diameter: 3 * MM, flat: 2.5 * MM } });
  const planet = defaultGear({ name: 'Satellite', teeth: 18, bore: { type: 'round', diameter: 3 * MM, flat: 0 } });
  const ring = defaultGear({ name: 'Couronne', type: 'internal', teeth: 54, bore: { type: 'none', diameter: 0, flat: 0 }, rimWidth: 3 * MM });
  return {
    version: 1,
    name: 'Mon réducteur',
    mode: 'chain',
    chain: {
      gears: [
        { gear: pinion, placement: { kind: 'root' } },
        { gear: wheel, placement: { kind: 'mesh', parent: pinion.id, angle: 0 } },
      ],
      outputId: wheel.id,
    },
    planetary: { sun, planet, ring, planets: 3, input: 'sun', fixed: 'ring' },
    print: { ...DEFAULT_PRINT },
    meshEfficiency: 0.92,
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    motor: { ...MOTOR_PRESETS[1] },
    load: { constantTorque: 0, viscous: 0, inertia: 0, mass: 0.5, drumRadius: 10 * MM },
    sim: { profile: { kind: 'step', voltage: 6, delay: 0 }, duration: 0.3 },
  };
}

/** Validation légère d'un projet importé : complète les champs manquants avec les valeurs par défaut. */
export function parseProject(json: string): Project {
  const raw = JSON.parse(json);
  if (!raw || typeof raw !== 'object' || raw.version !== 1) throw new Error('Fichier de projet non reconnu (version attendue : 1).');
  const d = defaultProject();
  const p: Project = {
    ...d,
    ...raw,
    print: { ...d.print, ...raw.print },
    load: { ...d.load, ...raw.load },
    sim: { ...d.sim, ...raw.sim },
    motor: { ...d.motor, ...raw.motor },
    materials: Array.isArray(raw.materials) && raw.materials.length ? raw.materials : d.materials,
  };
  if (!Array.isArray(p.chain?.gears) || !p.chain.gears.length) throw new Error('Le projet ne contient aucun engrenage.');
  return p;
}

export const serializeProject = (p: Project) => JSON.stringify(p, null, 2);

export interface GearStrength {
  node: TrainNode;
  operating: BendingResult;
  stall: BendingResult;
  level: SafetyLevel;
  stallLevel: SafetyLevel;
}

export interface Computed {
  train: TrainAnalysis;
  motor: MotorModel;
  drivetrain: Drivetrain;
  steady: SteadyState;
  strength: GearStrength[];
  warnings: Warning[];
  reminders: string[];
}

/** Calcule l'ensemble des résultats d'un projet. */
export function computeProject(p: Project): Computed {
  const train = p.mode === 'planetary'
    ? analyzePlanetary(p.planetary, p.print, p.materials, p.meshEfficiency)
    : analyzeChain(p.chain, p.print, p.materials, p.meshEfficiency);
  const motor = motorModel(p.motor);
  // sortie crémaillère : le "rapport" est ramené à l'arbre du pignon (charge vue par le pignon)
  let ratio = Math.abs(train.ratio);
  if (train.linearOutput) {
    const rack = train.nodes.find((n) => n.id === train.outputId)!;
    const pinion = train.nodes.find((n) => n.id === rack.parentId)!;
    ratio = Math.abs(1 / pinion.ratio);
  }
  const drivetrain: Drivetrain = { ratio: ratio || 1, efficiency: train.efficiency, gearInertia: train.gearInertia };
  const steady = steadyState(motor, drivetrain, p.load);
  const stallT = motor.Kt * (motor.V / motor.R) - motor.Tf;
  const opLoads = new Map(gearLoads(train, steady.motorTorque, steady.omegaMotor, p.meshEfficiency).map((l) => [l.nodeId, l]));
  const stLoads = new Map(gearLoads(train, stallT, 0, p.meshEfficiency).map((l) => [l.nodeId, l]));
  const strength: GearStrength[] = train.nodes.map((node) => {
    const op = opLoads.get(node.id) ?? { ft: 0, v: 0, width: node.spec.faceWidth };
    const st = stLoads.get(node.id) ?? { ft: 0, v: 0, width: node.spec.faceWidth };
    const operating = lewisBending(node.geo, op.ft, op.v, op.width, node.material.allowableBending);
    const stall = lewisBending(node.geo, st.ft, 0, st.width, node.material.allowableBending);
    return { node, operating, stall, level: safetyLevel(operating.safety), stallLevel: safetyLevel(stall.safety) };
  });

  const warnings: Warning[] = [...train.warnings];
  for (const n of train.nodes) for (const w of n.warnings) warnings.push({ ...w, message: `${n.spec.name} : ${w.message}` });
  for (const m of train.meshes) {
    const a = train.nodes.find((n) => n.id === m.a)!.spec.name;
    const b = train.nodes.find((n) => n.id === m.b)!.spec.name;
    for (const w of m.geo.warnings) warnings.push({ ...w, message: `${a} / ${b} : ${w.message}` });
  }
  if (motor.ktKeMismatch > 0.15) {
    warnings.push({ severity: 'info', message: `Fiche moteur peu cohérente : Kt et Ke diffèrent de ${fmt(motor.ktKeMismatch * 100, 0)} % (ils devraient être égaux en SI).` });
  }
  if (steady.stalled) warnings.push({ severity: 'error', message: 'Le moteur cale : la charge dépasse le couple disponible en sortie.' });
  else if (steady.stallMargin < 0.5) warnings.push({ severity: 'warning', message: `Point de fonctionnement à ${fmt((1 - steady.stallMargin) * 100, 0)} % du couple de blocage : le moteur va chauffer.` });
  for (const s of strength) {
    if (s.operating.safety < 1.25) warnings.push({ severity: 'error', message: `${s.node.spec.name} : coefficient de sécurité ${fmt(s.operating.safety, 2)} en fonctionnement, rupture probable.` });
    else if (s.stall.safety < 1) warnings.push({ severity: 'warning', message: `${s.node.spec.name} : casse probable si le moteur est bloqué (n = ${fmt(s.stall.safety, 2)} au blocage). Prévoir une limitation de courant ou un limiteur de couple.` });
  }

  const reminders: string[] = [];
  const hot = train.nodes.filter((n) => n.meshesFromMotor === 0 && n.material.maxServiceTemp < 60);
  if (hot.length) {
    reminders.push(`${hot.map((n) => n.spec.name).join(', ')} en ${hot[0].material.name} sur l'arbre moteur : un moteur qui chauffe (souvent 50–70 °C au carter) fait fluer le PLA. Préférez PETG, ABS/ASA, PA ou POM près du moteur.`);
  }
  reminders.push('Imprimez les roues à plat (axe vertical) : les dents fléchissent alors dans le plan des couches. Imprimées sur la tranche, les dents travaillent en traction entre couches et cassent bien plus tôt.');
  return { train, motor, drivetrain, steady, strength, warnings, reminders };
}

/** Réglages d'impression conseillés pour une roue. */
export function printAdvice(node: TrainNode, print: PrintSettings, safety: number) {
  const lineWidth = 1.125 * print.nozzle;
  const depth = node.geo.addendum + node.geo.dedendum;
  const walls = Math.max(3, Math.ceil(depth / lineWidth) + 1);
  const layer = Math.min(0.2 * MM, Math.max(0.08 * MM, node.geo.mn / 5));
  const infill = safety < 2 ? 100 : safety < 4 ? 60 : 40;
  const orientation = node.geo.kind === 'rack'
    ? 'À plat sur le dos, profil dans le plan du plateau.'
    : node.spec.type === 'herringbone'
      ? 'À plat, axe vertical ; le chevron s\'imprime sans support jusqu\'à β ≈ 45°.'
      : node.spec.type === 'helical'
        ? 'À plat, axe vertical, sans support (surplomb = β).'
        : 'À plat, axe vertical (couches perpendiculaires à l\'axe).';
  return { walls, layer, infill, orientation };
}
