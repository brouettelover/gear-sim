/**
 * Trains d'engrenages : cinématique, positions, phasage des dents, rendement, inertie.
 *
 * Train simple / composé : arbre de roues enracinées sur l'arbre moteur. Chaque roue est
 *  - engrenée avec une roue "parente", placée à l'entraxe de fonctionnement sous un angle γ
 *    (γ = direction du centre de la roue extérieure vers le point primitif), ou
 *  - coaxiale à sa parente (même arbre, autre plan) : c'est ce qui fait un train composé.
 *   Extérieur : ω_b = −(z_a / z_b)·ω_a      Intérieur : ω_b = +(z_a / z_b)·ω_a
 *   Crémaillère : v = r_a·ω_a
 *
 * Train planétaire : formule de Willis (ω_s − ω_c) = −(z_r / z_s)·(ω_r − ω_c).
 *
 * Rendement : η_engrènement^(nombre d'engrènements entre le moteur et la sortie), constant.
 */
import { gearGeometry, gearWarnings, meshGeometry, type GearGeometry, type MeshGeometry } from './involute';
import { findMaterial, type Material } from './materials';
import { gearShape } from './profile';
import { shapeArea, shapePolarMoment } from './geometry2d';
import type { GearSpec, PrintSettings, Shape, Warning } from './types';
import { fmt } from './units';

export type Placement =
  | { kind: 'root' }
  | { kind: 'mesh'; parent: string; angle: number }
  | { kind: 'coaxial'; parent: string };

export interface TrainGear {
  gear: GearSpec;
  placement: Placement;
}

export interface ChainSpec {
  gears: TrainGear[];
  outputId: string;
}

export type PlanetaryMember = 'sun' | 'ring' | 'carrier';

export interface PlanetarySpec {
  sun: GearSpec;
  planet: GearSpec;
  ring: GearSpec;
  planets: number;
  input: PlanetaryMember;
  fixed: PlanetaryMember;
}

export interface TrainNode {
  id: string;
  spec: GearSpec;
  geo: GearGeometry;
  shape: Shape;
  /** position du centre au repos (m) ; crémaillère : origine de sa ligne primitive */
  x: number;
  y: number;
  /** plan axial (0 = plan du moteur) : seuls les plans identiques peuvent se heurter */
  layer: number;
  /** ω_roue / ω_moteur (signé) ; crémaillère : vitesse linéaire / ω_moteur (m/rad) */
  ratio: number;
  /** angle de la dent n°0 (ou du creux n°0 pour une couronne) au repos */
  phase: number;
  /** crémaillère : orientation (rad) et décalage initial le long de son axe (m) */
  rackAngle?: number;
  rackShift?: number;
  /** nombre d'engrènements entre le moteur et cette roue */
  meshesFromMotor: number;
  /** la roue transmet le couple du moteur vers la sortie */
  onPath: boolean;
  /** masse (kg) et inertie propre autour de son axe (kg·m²) */
  mass: number;
  inertia: number;
  /** nombre d'exemplaires (satellites) */
  count: number;
  warnings: Warning[];
  parentId?: string;
  material: Material;
}

export interface TrainMesh {
  /** a : roue extérieure (pignon) ; b : roue, couronne ou crémaillère */
  a: string;
  b: string;
  /** roue la plus proche du moteur (qui entraîne) */
  driver: string;
  geo: MeshGeometry;
  /** direction du centre de a vers le point primitif (rad), au repos */
  gamma: number;
  loaded: boolean;
}

export interface TrainAnalysis {
  mode: 'chain' | 'planetary';
  nodes: TrainNode[];
  meshes: TrainMesh[];
  motorId: string;
  outputId: string;
  /** rapport de réduction signé N = ω_moteur / ω_sortie */
  ratio: number;
  /** pour une crémaillère en sortie : vitesse linéaire par rad/s moteur (m) */
  linearOutput: boolean;
  efficiency: number;
  /** inertie des engrenages ramenée à l'arbre moteur (kg·m²) */
  gearInertia: number;
  warnings: Warning[];
  /** planétaire : rapports des membres */
  planetary?: { sun: number; ring: number; carrier: number; planet: number; spec: PlanetarySpec };
}

function nodeBase(spec: GearSpec, print: PrintSettings, materials: Material[]) {
  const geo = gearGeometry(spec, print);
  const shape = gearShape(geo, spec.bore, print.boreTolerance, spec.rimWidth);
  const material = findMaterial(materials, spec.materialId);
  const rho = material.density * print.fillFactor;
  const mass = rho * spec.faceWidth * shapeArea(shape);
  const inertia = geo.kind === 'rack' ? 0 : rho * spec.faceWidth * shapePolarMoment(shape);
  return { geo, shape, material, mass, inertia, warnings: gearWarnings(spec, geo, print) };
}

const wrap = (a: number, period: number) => a - Math.floor(a / period) * period;

/** Analyse d'un train simple ou composé. */
export function analyzeChain(chain: ChainSpec, print: PrintSettings, materials: Material[], meshEfficiency: number): TrainAnalysis {
  const warnings: Warning[] = [];
  const nodes = new Map<string, TrainNode>();
  const meshes: TrainMesh[] = [];
  const byId = new Map(chain.gears.map((g) => [g.gear.id, g]));
  const root = chain.gears.find((g) => g.placement.kind === 'root') ?? chain.gears[0];
  if (!root) {
    return { mode: 'chain', nodes: [], meshes: [], motorId: '', outputId: '', ratio: 1, linearOutput: false, efficiency: 1, gearInertia: 0, warnings: [{ severity: 'error', message: 'Le train est vide.' }] };
  }

  // parcours en largeur depuis la roue moteur
  const children = new Map<string, TrainGear[]>();
  for (const g of chain.gears) {
    if (g.placement.kind === 'root') continue;
    const p = g.placement.parent;
    if (!byId.has(p)) {
      warnings.push({ severity: 'error', message: `« ${g.gear.name} » est rattachée à une roue inexistante.` });
      continue;
    }
    children.set(p, [...(children.get(p) ?? []), g]);
  }
  const rb = nodeBase(root.gear, print, materials);
  if (rb.geo.kind !== 'external') warnings.push({ severity: 'error', message: 'La roue sur l\'arbre moteur doit être une roue extérieure.' });
  nodes.set(root.gear.id, {
    id: root.gear.id, spec: root.gear, ...rb, x: 0, y: 0, layer: 0, ratio: 1, phase: 0,
    meshesFromMotor: 0, onPath: false, count: 1,
  });
  const queue = [root.gear.id];
  while (queue.length) {
    const pid = queue.shift()!;
    const p = nodes.get(pid)!;
    for (const c of children.get(pid) ?? []) {
      if (nodes.has(c.gear.id)) continue;
      const base = nodeBase(c.gear, print, materials);
      const pl = c.placement as Exclude<Placement, { kind: 'root' }>;
      let node: TrainNode;
      if (pl.kind === 'coaxial') {
        if (p.geo.kind === 'rack') {
          warnings.push({ severity: 'error', message: `« ${c.gear.name} » ne peut pas être coaxiale à une crémaillère.` });
          continue;
        }
        node = { id: c.gear.id, spec: c.gear, ...base, x: p.x, y: p.y, layer: p.layer + 1, ratio: p.ratio, phase: p.phase, meshesFromMotor: p.meshesFromMotor, onPath: false, count: 1, parentId: pid };
      } else {
        const g = pl.angle;
        const ux = Math.cos(g);
        const uy = Math.sin(g);
        const kp = p.geo.kind;
        const kc = base.geo.kind;
        if (kp === 'rack') {
          warnings.push({ severity: 'error', message: `« ${c.gear.name} » : une crémaillère ne peut entraîner qu'en bout de chaîne.` });
          continue;
        }
        if (kp === 'internal' && kc !== 'external') {
          warnings.push({ severity: 'error', message: `« ${c.gear.name} » : une couronne n'engrène qu'avec une roue extérieure.` });
          continue;
        }
        if (kp === 'internal') {
          // pignon intérieur à la couronne parente : γ part du centre de la couronne
          const mg = meshGeometry(base.geo, p.geo);
          const a = mg.centerDistance;
          const za = base.geo.z;
          const zb = p.geo.z;
          const phase = g + (zb / za) * (p.phase - g);
          node = { id: c.gear.id, spec: c.gear, ...base, x: p.x + a * ux, y: p.y + a * uy, layer: p.layer, ratio: (p.ratio * zb) / za, phase: wrap(phase, (2 * Math.PI) / za), meshesFromMotor: p.meshesFromMotor + 1, onPath: false, count: 1, parentId: pid };
          meshes.push({ a: c.gear.id, b: pid, driver: pid, geo: mg, gamma: g, loaded: false });
        } else {
          const mg = meshGeometry(p.geo, base.geo);
          const a = mg.centerDistance;
          const za = p.geo.z;
          if (kc === 'external') {
            const zb = base.geo.z;
            const phase = g + Math.PI + Math.PI / zb - (za / zb) * (p.phase - g);
            node = { id: c.gear.id, spec: c.gear, ...base, x: p.x + a * ux, y: p.y + a * uy, layer: p.layer, ratio: (-p.ratio * za) / zb, phase: wrap(phase, (2 * Math.PI) / zb), meshesFromMotor: p.meshesFromMotor + 1, onPath: false, count: 1, parentId: pid };
          } else if (kc === 'internal') {
            const zb = base.geo.z;
            const phase = g + (za / zb) * (p.phase - g);
            node = { id: c.gear.id, spec: c.gear, ...base, x: p.x - a * ux, y: p.y - a * uy, layer: p.layer, ratio: (p.ratio * za) / zb, phase: wrap(phase, (2 * Math.PI) / zb), meshesFromMotor: p.meshesFromMotor + 1, onPath: false, count: 1, parentId: pid };
          } else {
            // crémaillère : ligne primitive tangente, dents tournées vers le pignon
            const delta = wrap(p.phase - g + Math.PI / za, (2 * Math.PI) / za) - Math.PI / za;
            // dent n°0 de la crémaillère décalée d'un demi-pas (creux face à la dent du pignon),
            // puis crémaillère centrée sur le pignon
            const shift = wrap(p.geo.r * delta + base.geo.pt / 2, base.geo.pt) - Math.floor(base.geo.z / 2) * base.geo.pt;
            node = {
              id: c.gear.id, spec: c.gear, ...base, x: p.x + a * ux, y: p.y + a * uy, layer: p.layer,
              ratio: p.ratio * p.geo.r, phase: 0, rackAngle: g + Math.PI / 2, rackShift: shift,
              meshesFromMotor: p.meshesFromMotor + 1, onPath: false, count: 1, parentId: pid,
            };
          }
          meshes.push({ a: pid, b: c.gear.id, driver: pid, geo: mg, gamma: g, loaded: false });
        }
      }
      nodes.set(c.gear.id, node);
      queue.push(c.gear.id);
    }
  }
  for (const g of chain.gears) {
    if (!nodes.has(g.gear.id) && !warnings.length) warnings.push({ severity: 'error', message: `« ${g.gear.name} » n'est pas reliée au moteur.` });
  }

  // chemin moteur → sortie
  const out = nodes.get(chain.outputId) ?? [...nodes.values()][nodes.size - 1];
  for (let n: TrainNode | undefined = out; n; n = n.parentId ? nodes.get(n.parentId) : undefined) n.onPath = true;
  for (const m of meshes) m.loaded = nodes.get(m.a)!.onPath && nodes.get(m.b)!.onPath;

  // collisions entre roues d'un même plan qui n'engrènent pas
  const list = [...nodes.values()];
  const meshed = new Set(meshes.map((m) => [m.a, m.b].sort().join('|')));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i];
      const B = list[j];
      if (A.layer !== B.layer || meshed.has([A.id, B.id].sort().join('|'))) continue;
      if (A.geo.kind !== 'external' || B.geo.kind !== 'external') continue;
      const d = Math.hypot(A.x - B.x, A.y - B.y);
      if (d < A.geo.ra + B.geo.ra) {
        warnings.push({ severity: 'error', message: `Collision entre « ${A.spec.name} » et « ${B.spec.name} » (même plan). Changez l'angle de placement ou passez une roue sur un autre arbre.` });
      }
    }
  }

  const efficiency = meshEfficiency ** out.meshesFromMotor;
  let gearInertia = 0;
  for (const n of nodes.values()) {
    if (n.geo.kind === 'rack') gearInertia += n.mass * n.ratio ** 2;
    else gearInertia += n.inertia * n.ratio ** 2;
  }
  return {
    mode: 'chain', nodes: list, meshes, motorId: root.gear.id, outputId: out.id,
    ratio: 1 / out.ratio, linearOutput: out.geo.kind === 'rack',
    efficiency, gearInertia, warnings,
  };
}

/** Vitesses des membres d'un train planétaire pour ω_entrée = 1 (Willis). */
export function planetaryRatios(zs: number, zp: number, zr: number, input: PlanetaryMember, fixed: PlanetaryMember) {
  // inconnues ωs, ωr, ωc avec ωs·zs + ωr·zr = ωc·(zs + zr)
  const w: Record<PlanetaryMember, number> = { sun: 0, ring: 0, carrier: 0 };
  w[input] = 1;
  w[fixed] = 0;
  const out = (['sun', 'ring', 'carrier'] as PlanetaryMember[]).find((m) => m !== input && m !== fixed)!;
  if (out === 'sun') w.sun = (w.carrier * (zs + zr) - w.ring * zr) / zs;
  else if (out === 'ring') w.ring = (w.carrier * (zs + zr) - w.sun * zs) / zr;
  else w.carrier = (w.sun * zs + w.ring * zr) / (zs + zr);
  // satellite (vitesse absolue) : ωp − ωc = −(zs/zp)(ωs − ωc)
  const planet = w.carrier - (zs / zp) * (w.sun - w.carrier);
  return { ...w, planet, output: out };
}

/** Analyse d'un train planétaire (satellites équirépartis, sans déport). */
export function analyzePlanetary(ps: PlanetarySpec, print: PrintSettings, materials: Material[], meshEfficiency: number): TrainAnalysis {
  const warnings: Warning[] = [];
  const s = nodeBase(ps.sun, print, materials);
  const p = nodeBase(ps.planet, print, materials);
  const r = nodeBase({ ...ps.ring, type: 'internal' }, print, materials);
  const zs = s.geo.z, zp = p.geo.z, zr = r.geo.z;
  if (ps.input === ps.fixed) warnings.push({ severity: 'error', message: 'L\'entrée et le membre fixe doivent être différents.' });
  if (zr !== zs + 2 * zp) warnings.push({ severity: 'error', message: `Condition de coaxialité non respectée : z couronne doit valoir z soleil + 2·z satellite = ${zs + 2 * zp}.` });
  if ((zs + zr) % ps.planets !== 0) warnings.push({ severity: 'error', message: `Montage impossible avec ${ps.planets} satellites équirépartis : (z soleil + z couronne) = ${zs + zr} doit être divisible par ${ps.planets}.` });
  const msp = meshGeometry(s.geo, p.geo);
  const mpr = meshGeometry(p.geo, r.geo);
  const a = msp.centerDistance;
  // voisinage des satellites
  if (ps.planets > 1 && 2 * a * Math.sin(Math.PI / ps.planets) < 2 * p.geo.ra + print.nozzle) {
    warnings.push({ severity: 'error', message: 'Les satellites se touchent : réduisez leur nombre ou leur taille.' });
  }
  const w = planetaryRatios(zs, zp, zr, ps.input, ps.fixed);
  const outRatio = w[w.output as PlanetaryMember];
  const sunNode: TrainNode = { id: ps.sun.id, spec: ps.sun, ...s, x: 0, y: 0, layer: 0, ratio: w.sun, phase: 0, meshesFromMotor: ps.input === 'sun' ? 0 : 1, onPath: true, count: 1 };
  const planetPhase = Math.PI + Math.PI / zp - (zs / zp) * 0; // satellite n°0 sur γ = 0
  const planetNode: TrainNode = { id: ps.planet.id, spec: ps.planet, ...p, x: a, y: 0, layer: 0, ratio: w.planet, phase: wrap(planetPhase, (2 * Math.PI) / zp), meshesFromMotor: 1, onPath: true, count: ps.planets };
  const ringPhase = (zp / zr) * planetNode.phase; // γ = 0
  const ringNode: TrainNode = { id: ps.ring.id, spec: { ...ps.ring, type: 'internal' }, ...r, x: 0, y: 0, layer: 0, ratio: w.ring, phase: wrap(ringPhase, (2 * Math.PI) / zr), meshesFromMotor: ps.input === 'ring' ? 0 : 1, onPath: true, count: 1 };
  for (const [member, node] of [['sun', sunNode], ['ring', ringNode]] as const) {
    if (ps.fixed === member) node.onPath = false;
  }
  // inertie ramenée à l'entrée : roues + satellites (rotation propre + orbite) ; porte-satellites négligé
  const gearInertia =
    (ps.fixed === 'sun' ? 0 : s.inertia * w.sun ** 2) +
    (ps.fixed === 'ring' ? 0 : r.inertia * w.ring ** 2) +
    ps.planets * (p.inertia * w.planet ** 2 + p.mass * a * a * w.carrier ** 2);
  return {
    mode: 'planetary',
    nodes: [sunNode, planetNode, ringNode],
    meshes: [
      { a: ps.sun.id, b: ps.planet.id, driver: ps.sun.id, geo: msp, gamma: 0, loaded: true },
      { a: ps.planet.id, b: ps.ring.id, driver: ps.planet.id, geo: mpr, gamma: 0, loaded: true },
    ],
    motorId: ps.input === 'sun' ? ps.sun.id : ps.input === 'ring' ? ps.ring.id : ps.sun.id,
    outputId: w.output === 'sun' ? ps.sun.id : w.output === 'ring' ? ps.ring.id : 'carrier',
    ratio: 1 / outRatio,
    linearOutput: false,
    // simplification : deux engrènements dans le chemin de puissance
    efficiency: meshEfficiency ** 2,
    gearInertia,
    warnings,
    planetary: { sun: w.sun, ring: w.ring, carrier: w.carrier, planet: w.planet, spec: ps },
  };
}

export interface Pose {
  nodeId: string;
  key: string;
  x: number;
  y: number;
  angle: number;
}

/** Position et angle de chaque pièce pour un angle moteur θm (animation). */
export function poses(t: TrainAnalysis, thetaMotor: number): Pose[] {
  const out: Pose[] = [];
  if (t.mode === 'planetary' && t.planetary) {
    const pl = t.planetary;
    const [sun, planet, ring] = t.nodes;
    const thC = pl.carrier * thetaMotor;
    out.push({ nodeId: ring.id, key: ring.id, x: 0, y: 0, angle: ring.phase + pl.ring * thetaMotor });
    out.push({ nodeId: sun.id, key: sun.id, x: 0, y: 0, angle: sun.phase + pl.sun * thetaMotor });
    const a = planet.x;
    const n = pl.spec.planets;
    for (let k = 0; k < n; k++) {
      const gk = (2 * Math.PI * k) / n;
      // phase du satellite k (même formule que pour γ = 0, appliquée à γk)
      const ph = gk + Math.PI + Math.PI / planet.geo.z - (sun.geo.z / planet.geo.z) * (sun.phase - gk);
      const g = gk + thC;
      out.push({ nodeId: planet.id, key: `${planet.id}#${k}`, x: a * Math.cos(g), y: a * Math.sin(g), angle: ph + pl.planet * thetaMotor });
    }
    return out;
  }
  for (const n of [...t.nodes].sort((a, b) => a.layer - b.layer)) {
    if (n.geo.kind === 'rack') {
      // la crémaillère a une longueur finie : pour l'animation, son déplacement est ramené
      // dans un intervalle d'un nombre entier de pas (l'engrènement reste en phase)
      const span = Math.max(1, Math.floor(n.geo.z / 2)) * n.geo.pt;
      const travel = n.ratio * thetaMotor;
      const s = n.rackShift! + travel - Math.floor(travel / span + 0.5) * span;
      const ca = Math.cos(n.rackAngle!);
      const sa = Math.sin(n.rackAngle!);
      out.push({ nodeId: n.id, key: n.id, x: n.x + s * ca, y: n.y + s * sa, angle: n.rackAngle! });
    } else {
      out.push({ nodeId: n.id, key: n.id, x: n.x, y: n.y, angle: n.phase + n.ratio * thetaMotor });
    }
  }
  return out;
}

export interface GearLoad {
  nodeId: string;
  /** effort tangentiel au primitif (N) */
  ft: number;
  /** vitesse au primitif (m/s) */
  v: number;
  /** largeur en prise (m) */
  width: number;
}

/**
 * Efforts sur chaque roue pour un couple moteur T_m (N·m, arbre moteur) et une vitesse ω_m.
 * Couple d'un arbre : T = T_m·|ω_m/ω|·η^k (k engrènements en amont).
 */
export function gearLoads(t: TrainAnalysis, motorTorque: number, omegaMotor: number, meshEfficiency: number): GearLoad[] {
  const loads = new Map<string, GearLoad>();
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const put = (id: string, ft: number, v: number, width: number) => {
    const cur = loads.get(id);
    if (!cur || ft > cur.ft) loads.set(id, { nodeId: id, ft, v, width });
  };
  const T = Math.abs(motorTorque);
  const W = Math.abs(omegaMotor);
  if (t.mode === 'planetary' && t.planetary) {
    const pl = t.planetary;
    const [sun, planet, ring] = t.nodes;
    const zs = sun.geo.z;
    const zr = ring.geo.z;
    // couple sur le soleil d'après l'équilibre Ts : Tr : Tc = 1 : zr/zs : −(1 + zr/zs)
    const k = pl.spec.input === 'sun' ? 1 : pl.spec.input === 'ring' ? zs / zr : 1 / (1 + zr / zs);
    const Ts = T * k;
    const ft = Ts / (pl.spec.planets * sun.geo.r);
    const v = Math.abs(pl.sun - pl.carrier) * W * sun.geo.r;
    const width = Math.min(sun.spec.faceWidth, planet.spec.faceWidth, ring.spec.faceWidth);
    for (const n of [sun, planet, ring]) put(n.id, ft, v, width);
    return [...loads.values()];
  }
  for (const n of t.nodes) put(n.id, 0, 0, n.spec.faceWidth);
  for (const m of t.meshes) {
    if (!m.loaded) continue;
    const d = byId.get(m.driver)!;
    const other = byId.get(m.driver === m.a ? m.b : m.a)!;
    const shaftT = d.ratio !== 0 ? (T / Math.abs(d.ratio)) * meshEfficiency ** d.meshesFromMotor : 0;
    const ft = shaftT / d.geo.r;
    const v = Math.abs(d.ratio) * W * d.geo.r;
    const width = Math.min(d.spec.faceWidth, other.spec.faceWidth);
    put(d.id, ft, v, width);
    put(other.id, ft, v, width);
  }
  return [...loads.values()];
}

/** Libellé du sens de rotation par rapport au moteur. */
export const directionLabel = (ratio: number) => (Math.abs(ratio) < 1e-12 ? 'fixe' : ratio > 0 ? 'même sens que le moteur' : 'sens inverse du moteur');

export const describeRatio = (n: number) => `${fmt(Math.abs(n), 3)} : 1`;
