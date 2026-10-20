/**
 * Géométrie des engrenages à développante de cercle (ISO 21771 / ISO 53).
 *
 * Notations (plan apparent / transverse, indice t ; plan normal, indice n) :
 *   mt = mn / cos β                 module apparent
 *   tan αt = tan αn / cos β         angle de pression apparent
 *   r  = z·mt / 2                   rayon primitif
 *   rb = r·cos αt                   rayon de base
 *   ra = r + (1 + x)·mn             rayon de tête
 *   rf = r − (1 + c* − x)·mn        rayon de pied
 *   inv α = tan α − α               fonction développante
 *   épaisseur au rayon R : s_R = 2R·( s/(2r) + inv αt − inv αR ),  cos αR = rb / R
 */
import type { GearSpec, PrintSettings, Warning } from './types';
import { fmt, toMm } from './units';

/** Fonction développante inv(α) = tan α − α. */
export const inv = (a: number) => Math.tan(a) - a;

/** Inverse de la fonction développante (Newton), pour 0 ≤ y < ~1. */
export function invInverse(y: number): number {
  if (y <= 0) return 0;
  // approximation de départ (Cheng) puis Newton : d(inv α)/dα = tan² α
  let a = Math.cbrt(3 * y) * (1 - 0.2 * Math.cbrt(3 * y) ** 2 / 3);
  if (!(a > 0)) a = 0.1;
  for (let i = 0; i < 40; i++) {
    const t = Math.tan(a);
    const da = (t - a - y) / (t * t);
    a -= da;
    if (a <= 0) a = 1e-6;
    if (Math.abs(da) < 1e-15) break;
  }
  return a;
}

export interface GearGeometry {
  kind: 'external' | 'internal' | 'rack';
  z: number;
  mn: number;
  mt: number;
  alphaN: number;
  alphaT: number;
  beta: number;
  x: number;
  /** rayon primitif (m) ; Infinity pour la crémaillère */
  r: number;
  rb: number;
  /** rayon de tête : extérieur → le plus grand ; couronne intérieure → rayon intérieur des dents */
  ra: number;
  /** rayon de pied : couronne intérieure → rayon extérieur du creux */
  rf: number;
  /** saillie et creux (m) */
  addendum: number;
  dedendum: number;
  /** pas apparent et pas de base apparent (m) */
  pt: number;
  pb: number;
  /** épaisseur apparente de la dent au primitif, amincie du demi-jeu (m) ; couronne : largeur du creux */
  s: number;
  /** épaisseur de la dent en tête (m) */
  sa: number;
  /** amincissement appliqué (m) = jeu / 2 */
  thinning: number;
  /** rayon de l'arrondi de tête de l'outil crémaillère, qui donne le congé de pied (m) */
  rho: number;
  /** saillie de l'outil (= creux de la roue sans déport) (m) */
  toolAddendum: number;
  clearanceCoef: number;
  /** nombre de dents virtuel zv = z / cos³ β (pour Lewis et le dégagement) */
  zv: number;
  /** nombre de dents minimal sans dégagement pour le déport donné */
  zMin: number;
  /** déport minimal sans dégagement pour z donné */
  xMin: number;
  faceWidth: number;
  /** vrai si la tête a été raccourcie parce que la dent devenait pointue */
  tipTruncated: boolean;
}

/** Calcule la géométrie d'un engrenage à partir de sa définition et des réglages d'impression. */
export function gearGeometry(spec: GearSpec, print: PrintSettings): GearGeometry {
  const kind = spec.type === 'rack' ? 'rack' : spec.type === 'internal' ? 'internal' : 'external';
  // la crémaillère et la couronne sont traitées à denture droite (simplification)
  const beta = spec.type === 'helical' || spec.type === 'herringbone' ? spec.helixAngle : 0;
  const z = spec.teeth;
  const mn = spec.module;
  const cb = Math.cos(beta);
  const mt = mn / cb;
  const alphaN = spec.pressureAngle;
  const alphaT = Math.atan(Math.tan(alphaN) / cb);
  // pas de déport sur la couronne intérieure (simplification)
  const x = kind === 'internal' ? 0 : spec.profileShift;
  const c = print.clearanceCoef;
  const thinning = Math.max(0, print.backlash) / 2;
  const pt = Math.PI * mt;
  const pb = pt * Math.cos(alphaT);
  // arrondi de tête de l'outil : le plus grand qui tienne dans le jeu radial (0,38·m pour c* = 0,25)
  const rho = (c * mn) / (1 - Math.sin(alphaN));
  const toolAddendum = (1 + c) * mn;
  const zv = z / cb ** 3;
  const sin2 = Math.sin(alphaT) ** 2;
  const zMin = (2 * (1 - x) * cb) / sin2;
  const xMin = 1 - (z * sin2) / (2 * cb);

  if (kind === 'rack') {
    const s = pt / 2 - thinning;
    const sa = s - 2 * mn * Math.tan(alphaT);
    return {
      kind, z, mn, mt, alphaN, alphaT, beta, x,
      r: Infinity, rb: Infinity, ra: Infinity, rf: Infinity,
      addendum: mn, dedendum: toolAddendum,
      pt, pb, s, sa, thinning, rho, toolAddendum, clearanceCoef: c,
      zv: Infinity, zMin: 0, xMin: -Infinity, faceWidth: spec.faceWidth, tipTruncated: false,
    };
  }

  const r = (z * mt) / 2;
  const rb = r * Math.cos(alphaT);

  if (kind === 'internal') {
    // couronne : "s" désigne la largeur du creux au primitif, élargie du demi-jeu
    const s = pt / 2 + thinning;
    // la tête (rayon intérieur) ne peut pas descendre sous le cercle de base
    const ra = Math.max(r - mn, rb * 1.0005);
    const rf = r + toolAddendum;
    // épaisseur de la dent de couronne en tête = pas angulaire − largeur du creux en tête
    const aa = Math.acos(rb / ra);
    const spaceAtTip = 2 * ra * (s / (2 * r) + inv(alphaT) - inv(aa));
    const sa = (2 * Math.PI * ra) / z - spaceAtTip;
    return {
      kind, z, mn, mt, alphaN, alphaT, beta, x,
      r, rb, ra, rf, addendum: r - ra, dedendum: rf - r,
      pt, pb, s, sa, thinning, rho, toolAddendum, clearanceCoef: c,
      zv, zMin: 0, xMin: -Infinity, faceWidth: spec.faceWidth, tipTruncated: false,
    };
  }

  const s = mt * (Math.PI / 2 + 2 * x * Math.tan(alphaN)) - thinning;
  let ra = r + (1 + x) * mn;
  const rf = r - (1 + c - x) * mn;
  let sa = thicknessAt(ra, r, rb, s, alphaT);
  // dent pointue : la tête est ramenée au rayon où l'épaisseur s'annule (petit méplat conservé)
  let tipTruncated = false;
  if (sa < 0.02 * mn) {
    const aP = invInverse(s / (2 * r) + inv(alphaT));
    const rPointed = rb / Math.cos(aP);
    ra = Math.max(rb, rPointed - 0.02 * mn);
    sa = thicknessAt(ra, r, rb, s, alphaT);
    tipTruncated = true;
  }
  return {
    kind, z, mn, mt, alphaN, alphaT, beta, x, tipTruncated,
    r, rb, ra, rf, addendum: ra - r, dedendum: r - rf,
    pt, pb, s, sa, thinning, rho, toolAddendum, clearanceCoef: c,
    zv, zMin, xMin, faceWidth: spec.faceWidth,
  };
}

/** Épaisseur de dent (arc) au rayon R ≥ rb d'une roue extérieure. */
export function thicknessAt(R: number, r: number, rb: number, s: number, alphaT: number): number {
  const aR = Math.acos(Math.min(1, rb / R));
  return 2 * R * (s / (2 * r) + inv(alphaT) - inv(aR));
}

/** Demi-angle de dent au rayon R (rad) d'une roue extérieure. */
export function halfToothAngle(R: number, g: GearGeometry): number {
  const aR = Math.acos(Math.min(1, g.rb / R));
  return g.s / (2 * g.r) + inv(g.alphaT) - inv(aR);
}

export type MeshKind = 'external' | 'internal' | 'rack';

export interface MeshGeometry {
  kind: MeshKind;
  /** entraxe de fonctionnement (m) ; crémaillère : distance centre ↔ ligne primitive */
  centerDistance: number;
  /** angle de pression de fonctionnement apparent (rad) */
  alphaW: number;
  /** rapport de conduite apparent εα */
  contactRatio: number;
  /** rapport de recouvrement εβ (hélicoïdal) */
  overlapRatio: number;
  /** rapport de conduite total εγ = εα + εβ */
  totalRatio: number;
  /** longueur de conduite (m) */
  pathLength: number;
  warnings: Warning[];
}

/**
 * Engrènement entre a (toujours une roue extérieure) et b.
 *   Extérieur : inv αw = inv αt + 2·tan αn·(x1 + x2)/(z1 + z2) ; a = (r1 + r2)·cos αt / cos αw
 *               εα = [√(ra1² − rb1²) + √(ra2² − rb2²) − a·sin αw] / pb
 *   Intérieur : a = r2 − r1 ;  εα = [√(ra1² − rb1²) − √(ra2² − rb2²) + a·sin α] / pb
 *   Crémaillère : εα = [√(ra² − rb²) − r·sin α + (ha − x·m)/sin α] / pb
 */
export function meshGeometry(a: GearGeometry, b: GearGeometry): MeshGeometry {
  const warnings: Warning[] = [];
  if (Math.abs(a.mn - b.mn) > 1e-9) {
    warnings.push({ severity: 'error', message: `Modules différents (${fmt(toMm(a.mn), 3)} et ${fmt(toMm(b.mn), 3)} mm) : ces roues ne peuvent pas engrener.` });
  }
  if (Math.abs(a.alphaN - b.alphaN) > 1e-9) {
    warnings.push({ severity: 'error', message: 'Angles de pression différents : ces roues ne peuvent pas engrener.' });
  }
  const helical = Math.abs(a.beta) > 1e-9 || Math.abs(b.beta) > 1e-9;
  if (b.kind === 'external' && helical && Math.abs(a.beta + b.beta) > 1e-6) {
    warnings.push({ severity: 'error', message: 'Engrènement hélicoïdal extérieur : les angles d\'hélice doivent être égaux et de sens opposés.' });
  }
  if (b.kind !== 'external' && helical) {
    warnings.push({ severity: 'warning', message: 'La couronne et la crémaillère sont modélisées en denture droite : utilisez un pignon droit avec elles.' });
  }
  const pb = a.pb;
  const la = Math.sqrt(Math.max(0, a.ra * a.ra - a.rb * a.rb));
  let centerDistance: number;
  let alphaW: number;
  let pathLength: number;

  if (b.kind === 'external') {
    const invW = inv(a.alphaT) + (2 * Math.tan(a.alphaN) * (a.x + b.x)) / (a.z + b.z);
    alphaW = invInverse(invW);
    centerDistance = ((a.r + b.r) * Math.cos(a.alphaT)) / Math.cos(alphaW);
    const lb = Math.sqrt(Math.max(0, b.ra * b.ra - b.rb * b.rb));
    const lineOfAction = centerDistance * Math.sin(alphaW);
    pathLength = la + lb - lineOfAction;
    // interférence de fonctionnement : la tête de l'une dépasse le point de tangence T sur la base de l'autre
    if (la > lineOfAction + 1e-12 || lb > lineOfAction + 1e-12) {
      warnings.push({ severity: 'error', message: 'Interférence : une tête de dent travaille sous le cercle de base de l\'autre roue. Augmentez le nombre de dents ou le déport du pignon.' });
    }
    // jeu en pied effectif (le déport sans raccourcissement de tête peut le réduire)
    const tipClear = Math.min(centerDistance - a.ra - b.rf, centerDistance - b.ra - a.rf);
    if (tipClear < 0.05 * a.mn) {
      warnings.push({ severity: 'warning', message: `Jeu en pied insuffisant (${fmt(toMm(tipClear), 3)} mm) : la tête touche le fond de l'autre roue. Réduisez le déport total ou raccourcissez les têtes.` });
    }
  } else if (b.kind === 'internal') {
    alphaW = a.alphaT;
    centerDistance = b.r - a.r;
    const lb = Math.sqrt(Math.max(0, b.ra * b.ra - b.rb * b.rb));
    pathLength = la - lb + centerDistance * Math.sin(alphaW);
    if (b.z - a.z < 12) {
      warnings.push({ severity: 'warning', message: `Écart de dents couronne − pignon = ${b.z - a.z} < 12 : risque d'interférence de tête (trochoïdale).` });
    }
    if (a.z >= b.z) {
      warnings.push({ severity: 'error', message: 'La couronne doit avoir plus de dents que le pignon.' });
    }
  } else {
    alphaW = a.alphaT;
    centerDistance = a.r + a.x * a.mn;
    const rackPart = (b.addendum - a.x * a.mn) / Math.sin(alphaW);
    pathLength = la - a.r * Math.sin(alphaW) + rackPart;
    if (rackPart > a.r * Math.sin(alphaW) + 1e-12) {
      warnings.push({ severity: 'error', message: 'Interférence pignon–crémaillère : augmentez le nombre de dents ou le déport du pignon.' });
    }
  }

  const contactRatio = pathLength / pb;
  const bw = Math.min(a.faceWidth, b.faceWidth);
  const beta = Math.abs(a.beta);
  const overlapRatio = beta > 0 ? (bw * Math.sin(beta)) / (Math.PI * a.mn) : 0;
  if (contactRatio < 1) {
    warnings.push({ severity: 'error', message: `Rapport de conduite εα = ${fmt(contactRatio)} < 1 : la continuité de l'engrènement n'est pas assurée.` });
  } else if (contactRatio < 1.2) {
    warnings.push({ severity: 'warning', message: `Rapport de conduite εα = ${fmt(contactRatio)} < 1,2 : fonctionnement saccadé probable, surtout avec le jeu d'impression.` });
  }
  return {
    kind: b.kind,
    centerDistance,
    alphaW,
    contactRatio,
    overlapRatio,
    totalRatio: contactRatio + overlapRatio,
    pathLength,
    warnings,
  };
}

/** Avertissements propres à une roue seule (dégagement, pointe, buse…). */
export function gearWarnings(spec: GearSpec, g: GearGeometry, print: PrintSettings): Warning[] {
  const w: Warning[] = [];
  const nozzle = print.nozzle;
  if (spec.teeth < 1 || !Number.isInteger(spec.teeth)) {
    w.push({ severity: 'error', message: 'Le nombre de dents doit être un entier positif.' });
  }
  if (g.kind === 'external' && g.x < g.xMin - 1e-9) {
    w.push({
      severity: 'warning',
      message: `Dégagement (sous-taillage) en pied : z = ${spec.teeth} < z min = ${fmt(g.zMin, 1)} pour x = ${fmt(g.x)}. Déport minimal conseillé x ≥ ${fmt(g.xMin)}. La dent est affaiblie à la base.`,
    });
  }
  if (g.tipTruncated) {
    w.push({ severity: 'error', message: `Dent pointue : la tête a été raccourcie à Ø ${fmt(toMm(2 * g.ra), 2)} mm. Réduisez le déport.` });
  } else if (g.kind !== 'rack' && g.sa < 0.2 * g.mn) {
    w.push({ severity: 'warning', message: `Dent presque pointue : épaisseur en tête ${fmt(toMm(g.sa), 3)} mm (< 0,2·m). Réduisez le déport.` });
  }
  if (g.sa > 0 && g.sa < nozzle && g.kind !== 'rack') {
    w.push({ severity: 'warning', message: `Épaisseur en tête (${fmt(toMm(g.sa), 2)} mm) inférieure au diamètre de buse (${fmt(toMm(nozzle), 2)} mm) : la pointe ne sera pas reproduite fidèlement.` });
  }
  if (g.mn < 2 * nozzle) {
    w.push({ severity: 'warning', message: `Module ${fmt(toMm(g.mn), 2)} mm trop petit pour une buse de ${fmt(toMm(nozzle), 2)} mm (conseillé ≥ ${fmt(toMm(2 * nozzle), 2)} mm).` });
  }
  if (print.backlash <= 0) {
    w.push({ severity: 'warning', message: 'Jeu au flanc nul : les engrenages imprimés risquent de gripper (0,1 à 0,2 mm conseillé).' });
  }
  if (g.kind === 'internal' && g.ra <= g.rb * 1.001) {
    w.push({ severity: 'warning', message: 'Couronne : le rayon de tête a été limité au cercle de base (z trop faible), les têtes de dents sont raccourcies.' });
  }
  if ((spec.type === 'helical' || spec.type === 'herringbone') && Math.abs(spec.helixAngle) > (45 * Math.PI) / 180) {
    w.push({ severity: 'warning', message: 'Angle d\'hélice > 45° : surplombs importants à l\'impression et forte poussée axiale.' });
  }
  if (spec.bore.type !== 'none' && g.kind === 'external') {
    const boreR = (spec.bore.diameter + print.boreTolerance) / 2;
    if (boreR > g.rf - 2 * nozzle - g.mn) {
      w.push({ severity: 'error', message: 'Alésage trop grand : il n\'y a pas assez de matière entre l\'alésage et le pied des dents.' });
    }
  }
  return w;
}
