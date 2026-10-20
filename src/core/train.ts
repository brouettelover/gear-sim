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
import { bevelPair } from './bevel';
import { gearSolid, type GearSolid } from './gearkinds';
import { gearWarnings, meshGeometry, type GearGeometry, type MeshGeometry } from './involute';
import { twistAt } from './export';
import { wormPair } from './worm';
import { findMaterial, type Material } from './materials';
import { shapeArea, shapePolarMoment } from './geometry2d';
import type { GearSpec, PrintSettings, Shape, Warning } from './types';
import { fmt } from './units';

export type Placement =
  | { kind: 'root' }
  /** posée librement (glisser-déposer) : n'engrène avec rien, ne tourne pas ; position dans le plan du moteur (m) */
  | { kind: 'free'; x: number; y: number }
  | { kind: 'mesh'; parent: string; angle: number }
  | { kind: 'coaxial'; parent: string };

export interface TrainGear {
  gear: GearSpec;
  placement: Placement;
  /** décalage axial (m) ajouté à la position automatique, voir assembly.ts */
  axialOffset?: number;
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
  /** rendement cumulé du moteur jusqu'à cet arbre, et dans le sens inverse (charge menante ; ≤ 0 : irréversible) */
  eff: number;
  backEff: number;
  /**
   * groupe d'axes parallèles : 0 = axes parallèles à l'arbre moteur ; un renvoi conique ou une vis
   * sans fin ouvre un nouveau groupe (x, y sont alors dans le repère de ce groupe, voir assembly.ts)
   */
  group: number;
  /** racine d'un groupe : renvoi qui la relie à sa roue parente, angle de placement dans le groupe parent */
  link?: { kind: 'bevel' | 'worm'; parent: string; angle: number; centerDistance: number };
  /** hauteur axiale de la pièce (m) */
  height: number;
  solid: GearSolid;
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
  /** parallèle (droit, hélicoïdal, couronne, crémaillère), conique ou vis sans fin */
  type: 'parallel' | 'bevel' | 'worm';
  /** false : roues hors prise (plans décalés) ; la roue menée ne tourne pas */
  engaged?: boolean;
  /** rendement de cet engrènement, dans le sens moteur → sortie et dans le sens inverse */
  efficiency: number;
  backEfficiency: number;
}

export interface TrainAnalysis {
  mode: 'chain' | 'planetary';
  nodes: TrainNode[];
  meshes: TrainMesh[];
  motorId: string;
  outputId: string;
  /** rapport de réduction signé N = ω_moteur / ω_sortie (infini si la sortie n'est pas entraînée) */
  ratio: number;
  /** la sortie n'est pas reliée au moteur par des engrènements en prise */
  disconnected?: boolean;
  /** pour une crémaillère en sortie : vitesse linéaire par rad/s moteur (m) */
  linearOutput: boolean;
  efficiency: number;
  /** rendement quand la charge entraîne le moteur (≤ 0 : train irréversible) */
  backEfficiency: number;
  /** inertie des engrenages ramenée à l'arbre moteur (kg·m²) */
  gearInertia: number;
  warnings: Warning[];
  /** planétaire : rapports des membres */
  planetary?: { sun: number; ring: number; carrier: number; planet: number; spec: PlanetarySpec };
}

function nodeBase(spec: GearSpec, print: PrintSettings, materials: Material[], mate?: GearSpec) {
  const solid = gearSolid(spec, mate, print);
  const { geo, shape } = solid;
  const material = findMaterial(materials, spec.materialId);
  const rho = material.density * print.fillFactor;
  // conique : section du talon sur toute la hauteur (approximation par excès)
  const mass = rho * solid.height * shapeArea(shape);
  const inertia = geo.kind === 'rack' ? 0 : rho * solid.height * shapePolarMoment(shape);
  const warnings = spec.type === 'worm' ? [] : gearWarnings(solid.cut, geo, print);
  return { geo, shape, material, mass, inertia, warnings, solid, height: solid.height, group: 0, eff: 1, backEff: 1 };
}

/** Écart angulaire ramené dans ]−p/2, p/2]. */
const wrapSym = (a: number, p: number) => a - Math.round(a / p) * p;

const wrap = (a: number, period: number) => a - Math.floor(a / period) * period;

/** Analyse d'un train simple ou composé. */
export function analyzeChain(
  chain: ChainSpec, print: PrintSettings, materials: Material[], meshEfficiency: number,
  /** roues menées dont l'engrènement avec leur menante est hors prise (plans décalés, voir assembly.ts) */
  disengaged: ReadonlySet<string> = new Set(),
): TrainAnalysis {
  const warnings: Warning[] = [];
  const nodes = new Map<string, TrainNode>();
  const meshes: TrainMesh[] = [];
  const byId = new Map(chain.gears.map((g) => [g.gear.id, g]));
  const root = chain.gears.find((g) => g.placement.kind === 'root') ?? chain.gears[0];
  if (!root) {
    return { mode: 'chain', nodes: [], meshes: [], motorId: '', outputId: '', ratio: 1, linearOutput: false, efficiency: 1, backEfficiency: 1, gearInertia: 0, warnings: [{ severity: 'error', message: 'Le train est vide.' }] };
  }

  // parcours en largeur depuis la roue moteur
  const children = new Map<string, TrainGear[]>();
  for (const g of chain.gears) {
    if (g.placement.kind === 'root' || g.placement.kind === 'free') continue;
    const p = g.placement.parent;
    if (!byId.has(p)) {
      warnings.push({ severity: 'error', message: `« ${g.gear.name} » est rattachée à une roue inexistante.` });
      continue;
    }
    children.set(p, [...(children.get(p) ?? []), g]);
  }
  // partenaire des roues dont la géométrie dépend de l'autre roue (coniques, vis et roue)
  const special = (a: GearSpec, b: GearSpec) =>
    (a.type === 'bevel' && b.type === 'bevel') || (a.type === 'worm' && b.type === 'wormwheel') || (a.type === 'wormwheel' && b.type === 'worm');
  const mates = new Map<string, GearSpec>();
  for (const g of chain.gears) {
    if (g.placement.kind !== 'mesh') continue;
    const pg = byId.get(g.placement.parent)?.gear;
    if (!pg || !special(pg, g.gear)) continue;
    if (!mates.has(g.gear.id)) mates.set(g.gear.id, pg);
    if (!mates.has(pg.id)) mates.set(pg.id, g.gear);
  }
  let groups = 0;
  const rb = nodeBase(root.gear, print, materials, mates.get(root.gear.id));
  if (rb.geo.kind !== 'external') warnings.push({ severity: 'error', message: 'La roue sur l\'arbre moteur doit être une roue extérieure.' });
  nodes.set(root.gear.id, {
    id: root.gear.id, spec: root.gear, ...rb, x: 0, y: 0, layer: 0, ratio: 1, phase: 0,
    meshesFromMotor: 0, onPath: false, count: 1,
  });
  const queue = [root.gear.id];
  // roues posées librement : immobiles, chacune racine de ses roues coaxiales et menées
  for (const g of chain.gears) {
    if (g.placement.kind !== 'free' || g === root) continue;
    const b = nodeBase(g.gear, print, materials, mates.get(g.gear.id));
    nodes.set(g.gear.id, { id: g.gear.id, spec: g.gear, ...b, x: g.placement.x, y: g.placement.y, layer: 0, ratio: 0, phase: 0, meshesFromMotor: 0, onPath: false, count: 1, ...(b.geo.kind === 'rack' ? { rackAngle: 0, rackShift: -Math.floor(b.geo.z / 2) * b.geo.pt } : {}) });
    warnings.push({ severity: 'warning', message: `« ${g.gear.name} » n'engrène avec aucune roue : elle ne tourne pas. Glissez-la contre une roue pour l'accrocher.` });
    queue.push(g.gear.id);
  }
  while (queue.length) {
    const pid = queue.shift()!;
    const p = nodes.get(pid)!;
    for (const c of children.get(pid) ?? []) {
      if (nodes.has(c.gear.id)) continue;
      const base = nodeBase(c.gear, print, materials, mates.get(c.gear.id));
      const pl = c.placement as Exclude<Placement, { kind: 'root' } | { kind: 'free' }>;
      let node: TrainNode;
      if (pl.kind === 'coaxial') {
        if (p.geo.kind === 'rack') {
          warnings.push({ severity: 'error', message: `« ${c.gear.name} » ne peut pas être coaxiale à une crémaillère.` });
          continue;
        }
        node = { id: c.gear.id, spec: c.gear, ...base, x: p.x, y: p.y, layer: p.layer + 1, ratio: p.ratio, phase: p.phase, meshesFromMotor: p.meshesFromMotor, onPath: false, count: 1, parentId: pid };
      } else if (special(p.spec, c.gear) || ['bevel', 'worm', 'wormwheel'].includes(p.spec.type) || ['bevel', 'worm', 'wormwheel'].includes(c.gear.type)) {
        // renvoi d'angle : la roue fille ouvre un nouveau groupe d'axes (repère calculé par assembly.ts)
        if (!special(p.spec, c.gear)) {
          warnings.push({ severity: 'error', message: `« ${c.gear.name} » : une roue conique n'engrène qu'avec une roue conique, une vis sans fin qu'avec sa roue.` });
          continue;
        }
        const phi = pl.angle;
        const common = { id: c.gear.id, spec: c.gear, ...base, x: 0, y: 0, layer: 0, meshesFromMotor: p.meshesFromMotor + 1, onPath: false, count: 1, parentId: pid, group: ++groups };
        if (c.gear.type === 'bevel') {
          const pair = bevelPair(p.spec, c.gear, print);
          const zp = p.spec.teeth, zc = c.gear.teeth;
          // contact : angle φ dans le repère du parent, angle π dans celui de la fille (voir assembly.ts)
          const phase = Math.PI + Math.PI / zc - (zp / zc) * (p.phase - phi);
          node = { ...common, ratio: (-p.ratio * zp) / zc, phase: wrap(phase, (2 * Math.PI) / zc), link: { kind: 'bevel', parent: pid, angle: phi, centerDistance: 0 } };
          for (const w of pair.warnings) warnings.push({ ...w, message: `${p.spec.name} / ${c.gear.name} : ${w.message}` });
          meshes.push({ a: pid, b: c.gear.id, driver: pid, geo: pair.mesh, gamma: phi, loaded: false, type: 'bevel', efficiency: meshEfficiency, backEfficiency: meshEfficiency });
        } else {
          const wormIsParent = p.spec.type === 'worm';
          const worm = wormIsParent ? p.spec : c.gear;
          const wheel = wormIsParent ? c.gear : p.spec;
          const pair = wormPair(worm, wheel, print);
          const hand = worm.helixAngle < 0 ? -1 : 1;
          const z1 = worm.teeth, z2 = wheel.teeth;
          const W = wormIsParent ? p : base;
          const G = wormIsParent ? base : p;
          const bW = W.solid.height, bG = G.solid.height;
          const kappa = Math.tan(W.solid.cut.helixAngle) / W.geo.r;
          const px = Math.PI * worm.module;
          const twG = twistAt(G.solid.cut, G.geo, bG / 2);
          let phase: number, ratio: number;
          if (wormIsParent) {
            // ω_roue·z2 = −h·ω_vis·z1 ; la roue présente une dent face à un creux du filet
            ratio = (-hand * p.ratio * z1) / z2;
            const sG = wrapSym((phi - p.phase) / kappa + px / 2 - bW / 2, px);
            phase = wrap(sG / G.geo.r - twG, (2 * Math.PI) / z2);
          } else {
            ratio = (-hand * p.ratio * z2) / z1;
            const sG = G.geo.r * wrapSym(p.phase + twG - phi, (2 * Math.PI) / z2);
            phase = wrap(-kappa * (bW / 2 + sG - px / 2), (2 * Math.PI) / z1);
          }
          node = { ...common, ratio, phase, link: { kind: 'worm', parent: pid, angle: phi, centerDistance: pair.centerDistance } };
          for (const w of pair.warnings) warnings.push({ ...w, message: `${worm.name} / ${wheel.name} : ${w.message}` });
          const fwd = wormIsParent ? pair.efficiency.forward : pair.efficiency.backward;
          const back = wormIsParent ? pair.efficiency.backward : pair.efficiency.forward;
          if (!wormIsParent && fwd <= 0) {
            warnings.push({ severity: 'error', message: `« ${wheel.name} » ne peut pas entraîner la vis « ${worm.name} » : le filet est irréversible (γ = ${fmt((pair.gamma * 180) / Math.PI, 1)}° ≤ angle de frottement).` });
          }
          meshes.push({ a: pid, b: c.gear.id, driver: pid, geo: { kind: 'external', centerDistance: pair.centerDistance, alphaW: worm.pressureAngle, contactRatio: pair.contactRatio, overlapRatio: 0, totalRatio: pair.contactRatio, pathLength: pair.contactRatio * pair.wheel.pb, warnings: [] }, gamma: phi, loaded: false, type: 'worm', efficiency: Math.max(fwd, 0), backEfficiency: back });
        }
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
          meshes.push({ a: c.gear.id, b: pid, driver: pid, geo: mg, gamma: g, loaded: false, type: 'parallel', efficiency: meshEfficiency, backEfficiency: meshEfficiency });
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
          meshes.push({ a: pid, b: c.gear.id, driver: pid, geo: mg, gamma: g, loaded: false, type: 'parallel', efficiency: meshEfficiency, backEfficiency: meshEfficiency });
        }
      }
      if (!node.link) node.group = p.group;
      // engrènement hors prise : la roue menée (et tout ce qu'elle porte) reste immobile
      if (pl.kind === 'mesh' && disengaged.has(c.gear.id)) {
        node.ratio = 0;
        const mm = meshes.find((x) => (x.a === pid && x.b === c.gear.id) || (x.b === pid && x.a === c.gear.id));
        if (mm) mm.engaged = false;
      }
      // rendement cumulé : celui de l'arbre parent × celui de l'engrènement (roue coaxiale : identique)
      const m = meshes.find((x) => (x.a === pid && x.b === c.gear.id) || (x.b === pid && x.a === c.gear.id));
      node.eff = p.eff * (pl.kind === 'mesh' && m ? m.efficiency : 1);
      node.backEff = p.backEff * (pl.kind === 'mesh' && m ? m.backEfficiency : 1);
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
  const disconnected = out.ratio === 0 && out.id !== root.gear.id;
  if (disconnected) {
    warnings.push({ severity: 'error', message: `La sortie « ${out.spec.name} » n'est pas entraînée : un engrènement du chemin n'est pas en prise (roue posée à l'écart ou plans décalés).` });
  }
  for (const m of meshes) m.loaded = !disconnected && m.engaged !== false && nodes.get(m.a)!.onPath && nodes.get(m.b)!.onPath;

  // les collisions dépendent des positions axiales : elles sont vérifiées par analyzeAssembly
  const list = [...nodes.values()];

  const efficiency = out.eff;
  const backEfficiency = out.backEff;
  let gearInertia = 0;
  for (const n of nodes.values()) {
    if (n.geo.kind === 'rack') gearInertia += n.mass * n.ratio ** 2;
    else gearInertia += n.inertia * n.ratio ** 2;
  }
  return {
    mode: 'chain', nodes: list, meshes, motorId: root.gear.id, outputId: out.id,
    ratio: disconnected ? Infinity : 1 / out.ratio, disconnected, linearOutput: out.geo.kind === 'rack',
    efficiency, backEfficiency, gearInertia, warnings,
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
      { a: ps.sun.id, b: ps.planet.id, driver: ps.sun.id, geo: msp, gamma: 0, loaded: true, type: 'parallel', efficiency: meshEfficiency, backEfficiency: meshEfficiency },
      { a: ps.planet.id, b: ps.ring.id, driver: ps.planet.id, geo: mpr, gamma: 0, loaded: true, type: 'parallel', efficiency: meshEfficiency, backEfficiency: meshEfficiency },
    ],
    motorId: ps.input === 'sun' ? ps.sun.id : ps.input === 'ring' ? ps.ring.id : ps.sun.id,
    outputId: w.output === 'sun' ? ps.sun.id : w.output === 'ring' ? ps.ring.id : 'carrier',
    ratio: 1 / outRatio,
    linearOutput: false,
    // simplification : deux engrènements dans le chemin de puissance
    efficiency: meshEfficiency ** 2,
    backEfficiency: meshEfficiency ** 2,
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
export function gearLoads(
  t: TrainAnalysis, motorTorque: number, omegaMotor: number, _meshEfficiency: number,
  /** largeur réellement en prise par engrènement (clé `${a}|${b}`), voir assembly.ts */
  overlap: Record<string, number> = {},
): GearLoad[] {
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
    const width = Math.min(d.spec.faceWidth, other.spec.faceWidth, overlap[`${m.a}|${m.b}`] ?? Infinity);
    // effort de contact : celui de la roue menante, Ft = T_arbre / r avec T_arbre = T_m·|ω_m/ω|·η (cumulé)
    const shaftT = d.ratio !== 0 ? (T / Math.abs(d.ratio)) * d.eff : 0;
    const ft = shaftT / d.geo.r;
    const v = Math.abs(d.ratio) * W * d.geo.r;
    put(d.id, ft, v, width);
    if (m.type === 'worm' && other.ratio !== 0) {
      // vis sans fin : l'effort tangentiel de la roue est l'effort axial de la vis (et réciproquement)
      const tOther = (T / Math.abs(other.ratio)) * other.eff;
      put(other.id, tOther / other.geo.r, Math.abs(other.ratio) * W * other.geo.r, width);
    } else {
      put(other.id, ft, v, width);
    }
  }
  return [...loads.values()];
}

/** Libellé du sens de rotation par rapport au moteur. */
export const directionLabel = (ratio: number) => (Math.abs(ratio) < 1e-12 ? 'fixe' : ratio > 0 ? 'même sens que le moteur' : 'sens inverse du moteur');

export const describeRatio = (n: number) => (Number.isFinite(n) ? `${fmt(Math.abs(n), 3)} : 1` : 'sortie non entraînée');

/** La roue `id` et toutes celles qu'elle porte (coaxiales et menées, récursivement). */
export function descendantsOf(chain: ChainSpec, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of chain.gears) {
      if ('parent' in g.placement && out.has(g.placement.parent) && !out.has(g.gear.id)) {
        out.add(g.gear.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Glisser-déposer : placement de la roue `self` (et de tout ce qu'elle porte) lâchée au point (x, y) du plan moteur.
 * Si son centre tombe à l'entraxe de fonctionnement d'une roue du même plan (à `tol` près), elle s'y accroche
 * (engrènement) ; sinon elle est posée librement et ne tourne pas.
 */
export function snapPlacement(t: TrainAnalysis, chain: ChainSpec, self: { id?: string; geo: GearGeometry; spec: GearSpec }, x: number, y: number, tol: number): Placement {
  const own = self.id ? descendantsOf(chain, self.id) : new Set<string>();
  const angleSpecial = (n: { spec: GearSpec }) => ['bevel', 'worm', 'wormwheel'].includes(n.spec.type);
  let best: { err: number; placement: Placement } | undefined;
  if (!angleSpecial(self)) {
    for (const p of t.nodes) {
      if (own.has(p.id) || p.group !== 0 || angleSpecial(p) || p.geo.kind === 'rack') continue;
      if (Math.abs(p.geo.mn - self.geo.mn) > 1e-9 || Math.abs(p.spec.pressureAngle - self.spec.pressureAngle) > 1e-9) continue;
      const kc = self.geo.kind;
      if (p.geo.kind === 'internal' && kc !== 'external') continue;
      if (kc === 'internal' && p.geo.kind !== 'external') continue;
      // hélicoïdales : sens d'hélice opposés pour deux roues extérieures
      const a = p.geo.kind === 'internal' ? meshGeometry(self.geo, p.geo).centerDistance : meshGeometry(p.geo, self.geo).centerDistance;
      const dx = x - p.x, dy = y - p.y;
      const err = Math.abs(Math.hypot(dx, dy) - a);
      if (err > tol || (best && err >= best.err)) continue;
      const angle = kc === 'internal' ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx);
      best = { err, placement: { kind: 'mesh', parent: p.id, angle: Math.round(angle / (Math.PI / 180)) * (Math.PI / 180) + 0 } };
    }
  }
  return best?.placement ?? { kind: 'free', x, y };
}
