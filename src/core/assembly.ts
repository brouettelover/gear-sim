/**
 * Montage en 3D d'un train simple / composé sur des tiges.
 *
 * Repère : z = axe des arbres, z = 0 sur la face intérieure du flasque inférieur (côté roues).
 * Le moteur est fixé sous le flasque inférieur, son arbre le traverse.
 *
 *  - Arbre : ensemble de roues coaxiales (même vitesse). L'arbre de la roue racine est l'arbre
 *    du moteur ; chacun des autres est une tige qui traverse les deux flasques.
 *  - Position axiale automatique (face inférieure de chaque roue) :
 *      roue racine : z = jeu au flasque ;
 *      roue qui engrène : même z que sa roue menante (les dentures se font face) ;
 *      roue coaxiale : z = z_parent + b_parent + jeu entre plans.
 *    Un décalage axial saisi par roue s'ajoute, et se propage aux roues qui en dépendent.
 *  - Tiges fixes : les roues tournent librement sur la tige (alésage = tige + jeu de rotation) ;
 *    les roues d'un même arbre doivent alors tourner ensemble, elles sont imprimées d'un seul
 *    tenant avec une entretoise entre elles.
 *    Tiges tournantes : la tige tourne dans les flasques, les roues y sont serrées (alésage = tige).
 *
 * Vérifications : prise axiale des engrènements, chevauchements sur un même arbre, collisions
 * entre roues d'arbres différents dont les plans se recouvrent, roues qui touchent une tige,
 * longueur utile de l'arbre moteur.
 */
import { extrudePrism, mergeMeshes, placeMesh, ringShape, type Mesh3D } from './export';
import { solidMesh } from './gearkinds';
import { gearGeometry, meshGeometry } from './involute';
import type { ChainSpec, TrainAnalysis, TrainNode } from './train';
import type { GearSpec, Point, PrintSettings, Shape, Warning } from './types';
import { MM, fmt, toMm } from './units';

export type RodMode = 'fixed' | 'rotating';

export interface AssemblySpec {
  /** diamètre des tiges (m), ex. 3 mm (tige acier, vis M3, clou…) */
  rodDiameter: number;
  rodMode: RodMode;
  /** jeu diamétral d'une roue libre sur une tige fixe, ou d'une tige tournante dans un flasque (m) */
  runningClearance: number;
  /** imposer l'alésage des roues montées sur tige */
  autoBores: boolean;
  /** jeu axial entre deux plans de roues (m) */
  layerGap: number;
  /** jeu axial entre les roues et les flasques (m) */
  plateGap: number;
  plateThickness: number;
  /** marge du flasque autour des roues (m) */
  plateMargin: number;
  /** longueur de l'arbre moteur depuis sa face de fixation (m) */
  motorShaftLength: number;
  /** diamètre du passage de l'arbre moteur dans le flasque inférieur (m) */
  motorHole: number;
  /** tiges libres, sans roue (colonnes entre flasques, supports), parallèles à l'arbre moteur */
  freeRods?: FreeRod[];
}

export interface FreeRod {
  id: string;
  name: string;
  /** position (m) dans le plan des flasques */
  x: number;
  y: number;
}

export type V3 = [number, number, number];

/** Repère d'un groupe d'axes parallèles : monde = o + x·u + y·v + z·w (m). */
export interface Frame {
  o: V3;
  u: V3;
  v: V3;
  w: V3;
}

export const WORLD: Frame = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] };
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Point du repère f de coordonnées (x, y, z). */
export const toWorld = (f: Frame, x: number, y: number, z: number): V3 => add(add(add(f.o, mul(f.u, x)), mul(f.v, y)), mul(f.w, z));

export const DEFAULT_ASSEMBLY: AssemblySpec = {
  rodDiameter: 3 * MM,
  rodMode: 'fixed',
  runningClearance: 0.2 * MM,
  autoBores: true,
  layerGap: 0.6 * MM,
  plateGap: 0.5 * MM,
  plateThickness: 3 * MM,
  plateMargin: 3 * MM,
  motorShaftLength: 10 * MM,
  motorHole: 4 * MM,
};

export interface Shaft {
  id: string;
  /** première roue de l'arbre (celle qui le définit) */
  rootGearId: string;
  x: number;
  y: number;
  gearIds: string[];
  /** rod : tige d'une roue ; free : tige libre sans roue */
  kind: 'motor' | 'rod' | 'free';
  /** groupe d'axes (0 : parallèles à l'arbre moteur, traversent les flasques) ; x, y, z dans son repère */
  group: number;
  name?: string;
  /** étendue axiale de la tige ou de l'arbre moteur (m) */
  zFrom: number;
  zTo: number;
  radius: number;
}

export interface Placed {
  id: string;
  shaftId?: string;
  /** groupe d'axes et face inférieure (m) dans son repère */
  group: number;
  z: number;
  /** hauteur axiale de la pièce (m) */
  width: number;
}

export interface Plate {
  name: string;
  shape: Shape;
  /** face inférieure (m) */
  z: number;
  thickness: number;
  width: number;
  height: number;
}

/** Pièce imprimée : une roue, ou plusieurs roues d'une même tige fusionnées. */
export interface Part {
  id: string;
  name: string;
  nodeIds: string[];
  /** entretoises entre roues fusionnées : rayon extérieur, rayon d'alésage, z bas, hauteur */
  collars: { r: number; bore: number; z: number; h: number }[];
  /** z de la face inférieure de la pièce */
  z: number;
}

export interface Assembly {
  placed: Record<string, Placed>;
  /** repère de chaque groupe d'axes (0 = monde) */
  groups: Frame[];
  shafts: Shaft[];
  plates: Plate[];
  parts: Part[];
  /** recouvrement axial de chaque engrènement, clé `${a}|${b}` (m) */
  meshOverlap: Record<string, number>;
  /** hauteur intérieure entre flasques (m) */
  innerHeight: number;
  /** roues dont l'alésage est imposé par la tige */
  rodGearIds: string[];
  warnings: Warning[];
  notes: string[];
}

/** Arbre (identifiant de la première roue) de chaque roue d'un train simple / composé. */
export function shaftOf(chain: ChainSpec): Map<string, string> {
  const byId = new Map(chain.gears.map((g) => [g.gear.id, g]));
  const out = new Map<string, string>();
  const find = (id: string, depth = 0): string => {
    const g = byId.get(id);
    if (!g || g.placement.kind !== 'coaxial' || depth > chain.gears.length) return id;
    return find(g.placement.parent, depth + 1);
  };
  for (const g of chain.gears) out.set(g.gear.id, find(g.gear.id));
  return out;
}

const isRotating = (s: GearSpec) => s.type !== 'rack' && s.type !== 'internal';

/** Alésage imposé par la tige (diamètre nominal, avant la compensation d'impression). */
export function rodBoreDiameter(a: AssemblySpec) {
  return a.rodDiameter + (a.rodMode === 'fixed' ? a.runningClearance : 0);
}

/** Copie du train dont les roues montées sur tige reçoivent l'alésage de la tige. */
export function applyRodBores(chain: ChainSpec, a: AssemblySpec): { chain: ChainSpec; ids: string[] } {
  if (!a.autoBores) return { chain, ids: [] };
  const shafts = shaftOf(chain);
  const root = chain.gears.find((g) => g.placement.kind === 'root') ?? chain.gears[0];
  const motorShaft = root ? shafts.get(root.gear.id) : undefined;
  const ids: string[] = [];
  const gears = chain.gears.map((g) => {
    if (shafts.get(g.gear.id) === motorShaft || !isRotating(g.gear)) return g;
    ids.push(g.gear.id);
    return { ...g, gear: { ...g.gear, bore: { type: 'round' as const, diameter: rodBoreDiameter(a), flat: 0 } } };
  });
  return { chain: { ...chain, gears }, ids };
}

/** Rayon extérieur d'encombrement d'une roue (m). */
const outerRadius = (n: TrainNode) => (n.geo.kind === 'internal' ? n.geo.rf + n.spec.rimWidth : n.geo.ra);

/** Coins de la crémaillère au repos (repère monde). */
function rackCorners(n: TrainNode): Point[] {
  const L = n.geo.z * n.geo.pt;
  const c = Math.cos(n.rackAngle!), s = Math.sin(n.rackAngle!);
  const ox = n.x + n.rackShift! * c, oy = n.y + n.rackShift! * s;
  const lo = -n.geo.pt / 2, hi = lo + L;
  return [[lo, n.geo.addendum], [hi, n.geo.addendum], [hi, -n.geo.dedendum - n.spec.rimWidth], [lo, -n.geo.dedendum - n.spec.rimWidth]].map(([u, v]) => ({
    x: ox + u * c - v * s,
    y: oy + u * s + v * c,
  }));
}

/** Distance d'un point à un quadrilatère convexe (0 à l'intérieur), quel que soit son sens de parcours. */
function distToQuad(p: Point, q: Point[]): number {
  let pos = 0, neg = 0;
  let best = Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const cr = ex * (p.y - a.y) - ey * (p.x - a.x);
    if (cr >= 0) pos++;
    if (cr <= 0) neg++;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey));
  }
  return pos === q.length || neg === q.length ? 0 : best;
}

/**
 * Distance radiale "libre" entre l'encombrement d'une roue et un cercle (centre c, rayon r) :
 * < 0 si le cercle empiète sur la denture.
 */
function clearanceToCircle(n: TrainNode, c: Point, r: number): number {
  if (n.geo.kind === 'rack') return distToQuad(c, rackCorners(n)) - r;
  const d = Math.hypot(c.x - n.x, c.y - n.y);
  if (n.geo.kind === 'internal') {
    // anneau entre le cercle de tête (intérieur) et la jante
    const inner = n.geo.ra - (d + r);
    const outer = d - r - outerRadius(n);
    return Math.max(inner, outer);
  }
  return d - r - n.geo.ra;
}

const circle = (cx: number, cy: number, r: number, n: number, cw: boolean): Point[] => {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((cw ? -1 : 1) * i * 2 * Math.PI) / n;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
};

/** Rectangle à coins arrondis, anti-horaire. */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, seg = 8): Point[] {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const pts: Point[] = [];
  const corners: [number, number, number][] = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  for (const [cx, cy, t0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const t = t0 + (i * Math.PI) / 2 / seg;
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
  }
  return pts;
}

const EPS = 1e-7;
const ROD_CLEARANCE = 0.2 * MM;
const RUB_GAP = 0.2 * MM;

/**
 * Montage d'un train : positions axiales, arbres, tiges, flasques, pièces et vérifications.
 * @param chain spécification du train simple / composé (null pour un planétaire)
 */
export function analyzeAssembly(train: TrainAnalysis, chain: ChainSpec | null, a: AssemblySpec, print: PrintSettings, rodGearIds: string[] = []): Assembly {
  const warnings: Warning[] = [];
  const notes: string[] = [];
  const nodes = new Map(train.nodes.map((n) => [n.id, n]));
  const placed: Record<string, Placed> = {};
  const meshOverlap: Record<string, number> = {};

  if (!chain || train.mode === 'planetary') {
    for (const n of train.nodes) placed[n.id] = { id: n.id, group: 0, z: a.plateGap, width: n.height };
    for (const m of train.meshes) meshOverlap[`${m.a}|${m.b}`] = Math.min(nodes.get(m.a)!.spec.faceWidth, nodes.get(m.b)!.spec.faceWidth);
    const h = Math.max(0, ...train.nodes.map((n) => n.height)) + 2 * a.plateGap;
    notes.push('Planétaire : toutes les roues sont dans le même plan ; les axes des satellites (porte-satellites) et les flasques ne sont pas générés.');
    return { placed, groups: [WORLD], shafts: [], plates: [], parts: train.nodes.map((n) => ({ id: n.id, name: n.spec.name, nodeIds: [n.id], collars: [], z: a.plateGap })), meshOverlap, innerHeight: h, rodGearIds: [], warnings, notes };
  }

  // positions axiales dans le repère de chaque groupe, et repères des groupes (ordre du parcours du train)
  const byId = new Map(chain.gears.map((g) => [g.gear.id, g]));
  const shafts = shaftOf(chain);
  const groups: Frame[] = [WORLD];
  const coaxTop = new Map<string, number[]>();
  for (const n of train.nodes) {
    const g = byId.get(n.id);
    const off = g?.axialOffset ?? 0;
    const pl = g?.placement ?? { kind: 'root' as const };
    let z = a.plateGap + off;
    if (n.link) {
      // racine d'un nouveau groupe : repère déduit de la roue parente et du renvoi
      const P = nodes.get(n.link.parent)!;
      const pp = placed[P.id];
      const F = groups[pp.group];
      const base = toWorld(F, P.x, P.y, pp.z);
      const dir = add(mul(F.u, Math.cos(n.link.angle)), mul(F.v, Math.sin(n.link.angle)));
      let frame: Frame;
      if (n.link.kind === 'bevel') {
        // sommets des cônes confondus ; l'axe de la fille passe par le sommet, dans la direction φ
        const apex = add(base, mul(F.w, P.solid.apex ?? 0));
        const w = mul(dir, -1);
        const u = F.w;
        frame = { o: add(apex, mul(dir, n.solid.apex ?? 0)), u, v: cross(w, u), w };
      } else {
        // axes croisés : la fille est à l'entraxe a, son axe est perpendiculaire à celui du parent
        const center = add(add(base, mul(F.w, pp.width / 2)), mul(dir, n.link.centerDistance));
        const w = cross(F.w, dir);
        const u = mul(dir, -1);
        frame = { o: add(center, mul(w, -n.height / 2)), u, v: cross(w, u), w };
      }
      frame.o = add(frame.o, mul(frame.w, off));
      groups[n.group] = frame;
      z = 0;
    } else if (pl.kind !== 'root' && pl.kind !== 'free') {
      const P = nodes.get(pl.parent);
      const pp = P ? placed[P.id] : undefined;
      if (P && pp) {
        if (pl.kind === 'coaxial') {
          // derrière une roue conique (côté opposé au sommet), au-dessus pour les autres
          // plusieurs roues coaxiales sur la même roue : on empile au-dessus de la plus haute
          const above = Math.max(pp.z + pp.width, ...(coaxTop.get(P.id) ?? []));
          z = P.spec.type === 'bevel' ? pp.z - a.layerGap - n.height + off : above + a.layerGap + off;
          if (P.spec.type !== 'bevel') coaxTop.set(P.id, [...(coaxTop.get(P.id) ?? []), z + n.height]);
        } else {
          z = pp.z + off;
        }
      }
    }
    placed[n.id] = { id: n.id, group: n.group, shaftId: isRotating(n.spec) ? shafts.get(n.id) : undefined, z, width: n.height };
  }

  // encombrement de chaque roue : centre (monde) et rayon de la sphère englobante
  const sphere = (n: TrainNode) => {
    const p = placed[n.id];
    const F = groups[p.group] ?? WORLD;
    const r = n.geo.kind === 'rack' ? (n.geo.z * n.geo.pt) / 2 : outerRadius(n);
    return { c: toWorld(F, n.x, n.y, p.z + p.width / 2), r: Math.hypot(r, p.width / 2) };
  };
  let top = 0;
  for (const n of train.nodes) {
    const p = placed[n.id];
    if (p.group === 0) top = Math.max(top, p.z + p.width);
    else {
      const sp = sphere(n);
      top = Math.max(top, sp.c[2] + sp.r);
    }
  }
  const innerHeight = top + a.plateGap;
  const motorTop = a.motorShaftLength - a.plateThickness;

  // arbres
  const shaftList: Shaft[] = [];
  const motorShaftId = shafts.get(train.motorId);
  for (const n of train.nodes) {
    const sid = placed[n.id].shaftId;
    if (!sid) continue;
    let s = shaftList.find((x) => x.id === sid);
    if (!s) {
      const motor = sid === motorShaftId;
      const root = nodes.get(sid) ?? n;
      s = {
        id: sid, rootGearId: root.id, x: root.x, y: root.y, gearIds: [], kind: motor ? 'motor' : 'rod', group: placed[root.id]?.group ?? 0,
        zFrom: -a.plateThickness, zTo: motor ? motorTop : innerHeight + a.plateThickness,
        radius: motor ? (nodes.get(train.motorId)!.spec.bore.diameter || 3 * MM) / 2 : a.rodDiameter / 2,
      };
      shaftList.push(s);
    }
    s.gearIds.push(n.id);
  }
  for (const s of shaftList) {
    s.gearIds.sort((i, j) => placed[i].z - placed[j].z);
    if (s.group !== 0) {
      // axe non parallèle aux flasques : tige limitée aux roues, 3 mm de chaque côté (support à prévoir)
      s.zFrom = Math.min(...s.gearIds.map((id) => placed[id].z)) - 3 * MM;
      s.zTo = Math.max(...s.gearIds.map((id) => placed[id].z + placed[id].width)) + 3 * MM;
    }
  }
  for (const f of a.freeRods ?? []) {
    shaftList.push({ id: f.id, rootGearId: '', name: f.name, x: f.x, y: f.y, gearIds: [], kind: 'free', group: 0, zFrom: -a.plateThickness, zTo: innerHeight + a.plateThickness, radius: a.rodDiameter / 2 });
  }
  const nameOf = (id: string) => nodes.get(id)?.spec.name ?? id;
  const shaftName = (s: Shaft) => (s.kind === 'motor' ? 'l\'arbre moteur' : s.kind === 'free' ? `la tige libre « ${s.name} »` : `la tige de « ${nameOf(s.rootGearId)} »`);

  // engrènements : prise axiale (axes parallèles seulement)
  const meshed = new Set<string>();
  for (const m of train.meshes) {
    meshed.add([m.a, m.b].sort().join('|'));
    const A = placed[m.a], B = placed[m.b];
    if (m.type !== 'parallel') {
      meshOverlap[`${m.a}|${m.b}`] = Math.min(nodes.get(m.a)!.spec.faceWidth, nodes.get(m.b)!.spec.faceWidth);
      continue;
    }
    const ov = Math.min(A.z + A.width, B.z + B.width) - Math.max(A.z, B.z);
    const full = Math.min(A.width, B.width);
    meshOverlap[`${m.a}|${m.b}`] = Math.max(0, ov);
    if (ov <= EPS) warnings.push({ severity: 'error', message: `« ${nameOf(m.a)} » et « ${nameOf(m.b)} » ne sont pas dans le même plan : elles n'engrènent pas. Réglez leur position axiale.` });
    else if (ov < full - EPS) warnings.push({ severity: 'warning', message: `« ${nameOf(m.a)} » / « ${nameOf(m.b)} » : prise axiale partielle (${fmt(toMm(ov), 2)} mm sur ${fmt(toMm(full), 2)} mm), la résistance est calculée sur cette largeur.` });
  }

  // collisions entre roues d'un même groupe d'axes
  const list = train.nodes;
  let crossPairs = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (meshed.has([A.id, B.id].sort().join('|'))) continue;
      const pa = placed[A.id], pb = placed[B.id];
      if (pa.group !== pb.group) {
        // axes non parallèles : test grossier des sphères englobantes
        const sa = sphere(A), sb = sphere(B);
        if (Math.hypot(sa.c[0] - sb.c[0], sa.c[1] - sb.c[1], sa.c[2] - sb.c[2]) < sa.r + sb.r) crossPairs++;
        continue;
      }
      const sep = Math.max(pa.z, pb.z) - Math.min(pa.z + pa.width, pb.z + pb.width); // < 0 : plans qui se recouvrent
      const sameShaft = pa.shaftId && pa.shaftId === pb.shaftId;
      if (sameShaft) {
        if (sep < -EPS) warnings.push({ severity: 'error', message: `« ${A.spec.name} » et « ${B.spec.name} » se chevauchent sur le même arbre. Décalez l'une des deux axialement.` });
        continue;
      }
      // recouvrement radial (encombrements au repos)
      let radial: boolean;
      if (A.geo.kind === 'rack' || B.geo.kind === 'rack') {
        const R = A.geo.kind === 'rack' ? B : A;
        const K = A.geo.kind === 'rack' ? A : B;
        radial = R.geo.kind !== 'rack' && clearanceToCircle(K, { x: R.x, y: R.y }, outerRadius(R)) < 0;
      } else if (A.geo.kind === 'internal' || B.geo.kind === 'internal') {
        const ring = A.geo.kind === 'internal' ? A : B;
        const other = ring === A ? B : A;
        radial = clearanceToCircle(ring, { x: other.x, y: other.y }, outerRadius(other)) < 0;
      } else {
        radial = Math.hypot(A.x - B.x, A.y - B.y) < A.geo.ra + B.geo.ra;
      }
      if (!radial) continue;
      if (sep < -EPS) {
        warnings.push({ severity: 'error', message: `Collision entre « ${A.spec.name} » et « ${B.spec.name} » (leurs plans se recouvrent). Changez l'angle de placement ou décalez une roue axialement.` });
      } else if (sep < RUB_GAP) {
        warnings.push({ severity: 'warning', message: `« ${A.spec.name} » et « ${B.spec.name} » se superposent à ${fmt(toMm(sep), 2)} mm l'une de l'autre : risque de frottement (prévoir ≥ ${fmt(toMm(RUB_GAP), 1)} mm).` });
      }
    }
  }
  if (crossPairs) warnings.push({ severity: 'info', message: `${crossPairs} paire(s) de roues d'axes non parallèles sont proches l'une de l'autre : vérifiez l'absence de contact dans la vue 3D (test simplifié).` });

  // roues qui touchent une tige ou l'arbre moteur d'un autre arbre (même groupe d'axes)
  for (const n of list) {
    const pn = placed[n.id];
    for (const s of shaftList) {
      if (pn.shaftId === s.id || s.group !== pn.group) continue;
      if (Math.min(pn.z + pn.width, s.zTo) - Math.max(pn.z, s.zFrom) <= EPS) continue;
      if (clearanceToCircle(n, { x: s.x, y: s.y }, s.radius + ROD_CLEARANCE) < 0) {
        warnings.push({ severity: 'error', message: `« ${n.spec.name} » touche ${shaftName(s)}. Éloignez les arbres ou passez par un autre placement.` });
      }
    }
  }

  // arbre moteur
  const motorShaft = shaftList.find((s) => s.kind === 'motor');
  if (motorShaft) {
    for (const id of motorShaft.gearIds) {
      const p = placed[id];
      if (p.z >= motorTop - EPS) {
        warnings.push({ severity: 'error', message: `« ${nameOf(id)} » est entièrement au-dessus du bout de l'arbre moteur (${fmt(toMm(motorTop), 1)} mm utiles au-dessus du flasque) : placez-la sur l'arbre d'une autre roue, ou allongez l'arbre moteur.` });
      } else if (p.z + p.width > motorTop + EPS) {
        warnings.push({ severity: 'warning', message: `« ${nameOf(id)} » dépasse le bout de l'arbre moteur (${fmt(toMm(motorTop), 1)} mm utiles au-dessus du flasque) : prise partielle sur l'arbre.` });
      }
    }
  }
  for (const n of list) {
    const p = placed[n.id];
    const low = p.group === 0 ? p.z : sphere(n).c[2] - sphere(n).r;
    if (low < -EPS) warnings.push({ severity: 'error', message: `« ${n.spec.name} » traverse le flasque inférieur (z = ${fmt(toMm(low), 2)} mm)${p.group === 0 ? '' : ' : augmentez le décalage axial de la roue qui porte le renvoi'}.` });
  }

  // flasques : rectangle arrondi englobant roues et tiges (projetées sur le plan des flasques)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r);
    y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
  };
  for (const n of list) {
    if (placed[n.id].group !== 0) {
      const sp = sphere(n);
      grow(sp.c[0], sp.c[1], sp.r);
    } else if (n.geo.kind === 'rack') for (const c of rackCorners(n)) grow(c.x, c.y);
    else grow(n.x, n.y, outerRadius(n));
  }
  for (const f of a.freeRods ?? []) grow(f.x, f.y, a.rodDiameter / 2 + 1 * MM);
  x0 -= a.plateMargin; y0 -= a.plateMargin; x1 += a.plateMargin; y1 += a.plateMargin;
  const outer = roundedRect(x0, y0, x1, y1, Math.max(a.plateMargin, 2 * MM));
  // tiges fixes : serrées dans les flasques ; tiges tournantes : libres dans les flasques ; tiges libres : serrées
  const pressD = a.rodDiameter + print.boreTolerance;
  const rodHoles = shaftList
    .filter((s) => s.group === 0 && s.kind !== 'motor')
    .map((s) => circle(s.x, s.y, (pressD + (s.kind === 'rod' && a.rodMode === 'rotating' ? a.runningClearance : 0)) / 2, 48, true));
  const bottomHoles = [...rodHoles];
  if (motorShaft) bottomHoles.push(circle(motorShaft.x, motorShaft.y, a.motorHole / 2, 48, true));
  const plates: Plate[] = [
    { name: 'Flasque inférieur', shape: { outer, holes: bottomHoles }, z: -a.plateThickness, thickness: a.plateThickness, width: x1 - x0, height: y1 - y0 },
    { name: 'Flasque supérieur', shape: { outer: outer.map((p) => ({ ...p })), holes: rodHoles.map((h) => h.map((p) => ({ ...p }))) }, z: innerHeight, thickness: a.plateThickness, width: x1 - x0, height: y1 - y0 },
  ];

  // pièces : roues d'une même tige fixe fusionnées avec une entretoise
  const parts: Part[] = [];
  const done = new Set<string>();
  const boreR = (rodBoreDiameter(a) + print.boreTolerance) / 2;
  for (const s of shaftList) {
    if (s.kind !== 'rod' || a.rodMode !== 'fixed' || s.gearIds.length < 2) continue;
    const ids = s.gearIds.filter((id) => nodes.get(id)!.geo.kind === 'external');
    if (ids.length < 2) continue;
    const collars: Part['collars'] = [];
    for (let k = 0; k + 1 < ids.length; k++) {
      const lo = placed[ids[k]], hi = placed[ids[k + 1]];
      const h = hi.z - (lo.z + lo.width);
      if (h <= EPS) continue;
      const rf = Math.min(nodes.get(ids[k])!.geo.rf, nodes.get(ids[k + 1])!.geo.rf);
      const r = Math.min(0.85 * rf, boreR + 3 * MM);
      if (r < boreR + 0.8 * MM) {
        warnings.push({ severity: 'warning', message: `Arbre de « ${nameOf(ids[0])} » : pas de place pour une entretoise entre « ${nameOf(ids[k])} » et « ${nameOf(ids[k + 1])} » (pied de dent trop proche de la tige).` });
        continue;
      }
      collars.push({ r, bore: boreR, z: lo.z + lo.width, h });
    }
    parts.push({ id: `shaft-${s.id}`, name: ids.map(nameOf).join(' + '), nodeIds: ids, collars, z: placed[ids[0]].z });
    for (const id of ids) done.add(id);
  }
  for (const n of list) if (!done.has(n.id)) parts.push({ id: n.id, name: n.spec.name, nodeIds: [n.id], collars: [], z: placed[n.id].z });

  if (a.rodMode === 'fixed') notes.push('Tiges fixes : serrées (ou collées) dans les flasques ; les roues tournent librement dessus. Les roues d\'une même tige sont imprimées d\'un seul tenant.');
  else notes.push('Tiges tournantes : libres dans les flasques, roues serrées sur la tige ; prévoir des bagues d\'arrêt ou des entretoises pour tenir les roues en place.');
  if (groups.length > 1) notes.push('Axes perpendiculaires (renvoi conique, vis sans fin) : leurs tiges ne traversent pas les flasques ; prévoir un palier ou une équerre. Elles sont coupées à 3 mm de part et d\'autre des roues.');
  if (list.some((n) => n.geo.kind === 'rack')) notes.push('Le guidage de la crémaillère n\'est pas généré.');
  if (list.some((n) => n.geo.kind === 'internal')) notes.push('La couronne n\'a pas de moyeu : prévoir sa fixation sur son arbre.');

  return { placed, groups, shafts: shaftList, plates, parts, meshOverlap, innerHeight, rodGearIds, warnings, notes };
}

const MM_PER_M = 1000;

/** Maillage d'une pièce (mm), face inférieure en z = 0 : roues fusionnées et entretoises. */
export function partMesh(part: Part, train: TrainAnalysis, asm: Assembly): Mesh3D {
  const meshes: Mesh3D[] = [];
  for (const id of part.nodeIds) {
    const n = train.nodes.find((x) => x.id === id)!;
    meshes.push(placeMesh(solidMesh(n.solid), 0, 0, 0, (asm.placed[id].z - part.z) * MM_PER_M));
  }
  for (const c of part.collars) meshes.push(placeMesh(extrudePrism(ringShape(c.r, c.bore), c.h), 0, 0, 0, (c.z - part.z) * MM_PER_M));
  return mergeMeshes(meshes);
}

/** Maillage (mm) exprimé dans le repère f, ramené au repère monde. */
export function frameMesh(m: Mesh3D, f: Frame): Mesh3D {
  if (f === WORLD) return m;
  const P = new Float32Array(m.positions.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
    for (let k = 0; k < 3; k++) P[i + k] = f.o[k] * MM_PER_M + x * f.u[k] + y * f.v[k] + z * f.w[k];
  }
  return { positions: P, indices: m.indices };
}

/** Ensemble monté au repos (mm), pour contrôle dans un logiciel de CAO ou un trancheur. */
export function assemblyMesh(train: TrainAnalysis, asm: Assembly, withPlates = true): Mesh3D {
  const meshes: Mesh3D[] = [];
  for (const part of asm.parts) {
    const n = train.nodes.find((x) => x.id === part.nodeIds[0])!;
    let x = n.x, y = n.y, angle = n.phase;
    if (n.geo.kind === 'rack') {
      x += n.rackShift! * Math.cos(n.rackAngle!);
      y += n.rackShift! * Math.sin(n.rackAngle!);
      angle = n.rackAngle!;
    }
    const F = asm.groups[asm.placed[n.id].group] ?? WORLD;
    meshes.push(frameMesh(placeMesh(partMesh(part, train, asm), angle, x * MM_PER_M, y * MM_PER_M, part.z * MM_PER_M), F));
  }
  for (const s of asm.shafts) {
    const F = asm.groups[s.group] ?? WORLD;
    meshes.push(frameMesh(placeMesh(extrudePrism(ringShape(s.radius), s.zTo - s.zFrom), 0, s.x * MM_PER_M, s.y * MM_PER_M, s.zFrom * MM_PER_M), F));
  }
  if (withPlates) for (const p of asm.plates) meshes.push(placeMesh(extrudePrism(p.shape, p.thickness), 0, 0, 0, p.z * MM_PER_M));
  return mergeMeshes(meshes);
}

/**
 * Placement d'une nouvelle roue extérieure qui engrène avec `parentId` :
 * parmi les directions (pas de 5°) laissant au moins 1 mm de jeu avec les autres roues et tiges,
 * celle qui est la plus proche de `preferred`. Si aucune ne convient (typiquement : la tige de la
 * nouvelle roue traverserait une grande roue de l'arbre menant), on augmente son nombre de dents.
 */
export function suggestMeshGear(train: TrainAnalysis, asm: Assembly, parentId: string, child: GearSpec, print: PrintSettings, rodRadius: number, preferred: number): { angle: number; teeth: number } {
  for (let z = child.teeth; z <= Math.max(child.teeth, 150); z++) {
    const r = freeMeshAngle(train, asm, parentId, { ...child, teeth: z }, print, rodRadius, preferred);
    if (r.free) return { angle: r.angle, teeth: z };
  }
  return { angle: freeMeshAngle(train, asm, parentId, child, print, rodRadius, preferred).angle, teeth: child.teeth };
}

/** Meilleur angle pour une roue donnée ; `free` : au moins 1 mm de jeu partout. */
export function freeMeshAngle(train: TrainAnalysis, asm: Assembly, parentId: string, child: GearSpec, print: PrintSettings, rodRadius: number, preferred: number): { angle: number; free: boolean } {
  const parent = train.nodes.find((n) => n.id === parentId);
  if (!parent || parent.geo.kind !== 'external' || !['spur', 'helical', 'herringbone'].includes(child.type) || ['bevel', 'worm', 'wormwheel'].includes(parent.spec.type)) return { angle: preferred, free: true };
  const geo = gearGeometry(child, print);
  const a = meshGeometry(parent.geo, geo).centerDistance;
  const z0 = asm.placed[parentId]?.z ?? 0;
  const z1 = z0 + child.faceWidth;
  const overlaps = (lo: number, hi: number) => Math.min(hi, z1) - Math.max(lo, z0) > EPS;
  const parentShaft = asm.placed[parentId]?.shaftId;
  const n0group = asm.placed[parentId]?.group ?? 0;
  const score = (ang: number) => {
    const c = { x: parent.x + a * Math.cos(ang), y: parent.y + a * Math.sin(ang) };
    let best = Infinity;
    for (const n of train.nodes) {
      if (n.id === parentId || asm.placed[n.id]?.group !== n0group) continue;
      const p = asm.placed[n.id];
      // la nouvelle roue contre les autres roues de son plan
      if (overlaps(p.z, p.z + p.width)) best = Math.min(best, clearanceToCircle(n, c, geo.ra));
      // sa tige (toute la hauteur) contre toutes les roues
      if (n.geo.kind !== 'internal') best = Math.min(best, clearanceToCircle(n, c, rodRadius + ROD_CLEARANCE));
    }
    for (const s of asm.shafts) {
      if (s.id === parentShaft || s.group !== n0group || !overlaps(s.zFrom, s.zTo)) continue;
      best = Math.min(best, Math.hypot(c.x - s.x, c.y - s.y) - geo.ra - s.radius - ROD_CLEARANCE);
    }
    return best;
  };
  let fallback = preferred, fallbackScore = -Infinity, chosen: number | null = null, gap = Infinity;
  for (let k = 0; k < 72; k++) {
    const ang = (k * 5 * Math.PI) / 180;
    const sc = score(ang);
    if (sc > fallbackScore) { fallbackScore = sc; fallback = ang; }
    const d = Math.abs(Math.atan2(Math.sin(ang - preferred), Math.cos(ang - preferred)));
    if (sc >= 1 * MM && d < gap - 1e-9) { gap = d; chosen = ang; }
  }
  return chosen === null ? { angle: fallback, free: false } : { angle: chosen, free: true };
}
