/**
 * Génération du contour 2D des engrenages (plan apparent).
 *
 * Roue extérieure : le contour est obtenu en simulant le taillage par un outil
 * crémaillère (ISO 53) qui roule sans glisser sur le cercle primitif :
 *  - le flanc droit de l'outil engendre la développante exacte (formule analytique),
 *  - l'arrondi de tête de l'outil (rayon ρ) engendre le congé de pied (trochoïde),
 *  - le dégagement (sous-taillage) apparaît naturellement si z est trop faible.
 *
 * Pour chaque rayon R, on cherche le demi-angle du creux : c'est le maximum, sur
 * tous les points de l'outil et toutes ses positions, de l'angle balayé à ce rayon.
 * Un point (u, v) de l'outil (u le long de la crémaillère, v vers l'extérieur depuis
 * sa ligne de référence) occupe, dans le repère de la roue tournée de φ :
 *    p = Rot(φ) · (u + r·φ,  r + x·m + v)
 * À |p| = R : u + r·φ = ±√(R² − Y²) avec Y = r + x·m + v, ce qui donne φ puis l'angle.
 */
import { halfToothAngle, inv, type GearGeometry } from './involute';
import type { BoreSpec, Point, Shape } from './types';

/** Points du flanc droit de l'outil crémaillère (fond plat, arrondi, flanc rectiligne). */
function cutterPoints(g: GearGeometry): { u: number; v: number }[] {
  const a = g.alphaT;
  const ha0 = g.toolAddendum;
  const rho = g.rho;
  // demi-épaisseur de la dent d'outil au niveau de la ligne de référence : π·m/4 + amincissement/2
  const halfThick = g.pt / 4 + g.thinning / 2;
  const vc = -ha0 + rho;
  const uc = halfThick + vc * Math.tan(a) - rho / Math.cos(a);
  const pts: { u: number; v: number }[] = [];
  const ucl = Math.max(0, uc);
  // fond plat de l'outil (forme le cercle de pied)
  for (let i = 0; i <= 8; i++) pts.push({ u: (ucl * i) / 8, v: -ha0 });
  // arrondi de tête : de −90° (bas) à −α (tangence avec le flanc)
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + ((Math.PI / 2 - a) * i) / n;
    pts.push({ u: uc + rho * Math.cos(t), v: vc + rho * Math.sin(t) });
  }
  // flanc rectiligne (utile pour le sous-taillage par le flanc)
  const vt = vc - rho * Math.sin(a);
  const vTop = g.mn * 1.2;
  for (let i = 1; i <= 40; i++) {
    const v = vt + ((vTop - vt) * i) / 40;
    pts.push({ u: halfThick + v * Math.tan(a), v });
  }
  return pts;
}

/**
 * Renvoie la fonction R ↦ demi-angle du creux (rad) d'une roue extérieure,
 * mesuré depuis l'axe du creux.
 */
export function externalHalfSpace(g: GearGeometry): (R: number) => number {
  const pts = cutterPoints(g);
  const r = g.r;
  const shift = g.x * g.mn;
  const pitchAngle = (2 * Math.PI) / g.z;
  const a = g.alphaT;
  // hauteur (repère outil) du point de tangence arrondi/flanc : en dessous, le flanc n'existe pas
  const vt = -g.toolAddendum + g.rho - g.rho * Math.sin(a);
  const halfPitchAngle = Math.PI / g.z;

  return (R: number) => {
    let best = -Infinity;
    for (const p of pts) {
      const Y = r + shift + p.v;
      if (R < Y - 1e-12) continue;
      const X0 = Math.sqrt(Math.max(0, R * R - Y * Y));
      for (const X of [X0, -X0]) {
        const phi = (X - p.u) / r;
        const theta = phi + Math.atan2(Y, X);
        let d = Math.PI / 2 - theta;
        // ramène dans le creux de référence (tous les creux sont identiques)
        d -= Math.round(d / pitchAngle) * pitchAngle;
        if (d > best) best = d;
      }
    }
    // développante analytique exacte, si le point générateur est sur la partie rectiligne du flanc
    if (R >= g.rb) {
      const L = Math.sqrt(R * R - g.rb * g.rb);
      const vGen = (L - r * Math.sin(a)) * Math.sin(a) - shift;
      if (vGen >= vt - 1e-12) {
        const d = halfPitchAngle - halfToothAngle(R, g);
        if (d > best) best = d;
      }
    }
    // sous le cercle de pied (ne devrait pas arriver) : pas de creux
    return Number.isFinite(best) ? Math.min(best, halfPitchAngle) : 0;
  };
}

/** Échantillonnage radial, resserré près du pied (où se trouve le congé). */
function radialSamples(r0: number, r1: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // moitié linéaire, moitié en (1 − cos) : densité accrue côté r0
    const f = 0.5 * t + 0.5 * (1 - Math.cos((t * Math.PI) / 2));
    out.push(r0 + (r1 - r0) * f);
  }
  return out;
}

const polar = (R: number, th: number): Point => ({ x: R * Math.cos(th), y: R * Math.sin(th) });

/**
 * Contour d'une roue extérieure, dent n°0 centrée sur l'angle 0, parcours anti-horaire.
 * @param flankSamples nombre de points par flanc
 */
export function externalOutline(g: GearGeometry, flankSamples = 40): Point[] {
  const halfSpace = externalHalfSpace(g);
  const hp = Math.PI / g.z;
  const radii = radialSamples(g.rf, g.ra, flankSamples);
  // demi-angle de dent = demi-pas − demi-creux
  const half = radii.map((R) => Math.max(0, hp - halfSpace(R)));
  const pts: Point[] = [];
  const tipN = 6;
  const rootN = 6;
  for (let k = 0; k < g.z; k++) {
    const c = k * 2 * hp;
    // flanc droit (côté horaire), du pied vers la tête
    for (let i = 0; i < radii.length; i++) pts.push(polar(radii[i], c - half[i]));
    // arc de tête
    const ht = half[half.length - 1];
    for (let i = 1; i < tipN; i++) pts.push(polar(g.ra, c - ht + (2 * ht * i) / tipN));
    // flanc gauche, de la tête vers le pied
    for (let i = radii.length - 1; i >= 0; i--) pts.push(polar(radii[i], c + half[i]));
    // arc de pied jusqu'à la dent suivante
    const h0 = half[0];
    const a0 = c + h0;
    const a1 = c + 2 * hp - h0;
    for (let i = 1; i < rootN; i++) pts.push(polar(g.rf, a0 + ((a1 - a0) * i) / rootN));
  }
  return dedupe(pts);
}

/**
 * Contour des dents d'une couronne intérieure (trou dans la jante), creux n°0 centré
 * sur l'angle 0. Le creux de la couronne a la forme d'une dent de roue extérieure.
 * Simplification : pas de congé de pied, profil limité au cercle de base.
 */
export function internalToothBoundary(g: GearGeometry, flankSamples = 30): Point[] {
  const hp = Math.PI / g.z;
  const radii = radialSamples(g.ra, g.rf, flankSamples);
  const halfSpaceAt = (R: number) => {
    const aR = Math.acos(Math.min(1, g.rb / R));
    return Math.min(hp, Math.max(0, g.s / (2 * g.r) + inv(g.alphaT) - inv(aR)));
  };
  const half = radii.map(halfSpaceAt);
  const pts: Point[] = [];
  for (let k = 0; k < g.z; k++) {
    const c = k * 2 * hp;
    // flanc du creux (côté horaire), de la tête (rayon intérieur) vers le pied
    for (let i = 0; i < radii.length; i++) pts.push(polar(radii[i], c - half[i]));
    const hf = half[half.length - 1];
    for (let i = 1; i < 5; i++) pts.push(polar(g.rf, c - hf + (2 * hf * i) / 5));
    for (let i = radii.length - 1; i >= 0; i--) pts.push(polar(radii[i], c + half[i]));
    // sommet de la dent de couronne (arc au rayon de tête)
    const h0 = half[0];
    const a0 = c + h0;
    const a1 = c + 2 * hp - h0;
    for (let i = 1; i < 5; i++) pts.push(polar(g.ra, a0 + ((a1 - a0) * i) / 5));
  }
  return dedupe(pts);
}

/**
 * Contour d'une crémaillère : ligne primitive sur y = 0, dents vers +y, dent n°0 centrée
 * en x = 0, n dents au pas p. Le dos de la crémaillère est à y = −(creux + dos).
 * Le pied est arrondi par un congé de rayon ρ tangent au flanc et au fond.
 */
export function rackOutline(g: GearGeometry, back: number): Point[] {
  const a = g.alphaT;
  const p = g.pt;
  const ha = g.addendum;
  const hf = g.dedendum;
  const halfThick = g.s / 2; // demi-épaisseur à la ligne primitive (amincie du demi-jeu)
  const rho = g.rho;
  const xStart = -p / 2;
  const xEnd = xStart + g.z * p;
  const yBack = -hf - back;
  const m = 8;
  // bord supérieur décrit de gauche à droite
  const top: Point[] = [{ x: xStart, y: -hf }];
  for (let k = 0; k < g.z; k++) {
    const c = k * p;
    const xl = (y: number) => c - halfThick + y * Math.tan(a); // flanc gauche
    const xr = (y: number) => c + halfThick - y * Math.tan(a); // flanc droit
    const yc = -hf + rho;
    // congé gauche : centre côté creux, de −90° (fond) à −α (tangence avec le flanc)
    const xcL = xl(yc) - rho / Math.cos(a);
    for (let i = 0; i <= m; i++) {
      const th = -Math.PI / 2 + ((Math.PI / 2 - a) * i) / m;
      top.push({ x: xcL + rho * Math.cos(th), y: yc + rho * Math.sin(th) });
    }
    top.push({ x: xl(ha), y: ha });
    top.push({ x: xr(ha), y: ha });
    // congé droit : de −(180° − α) (tangence) à −90° (fond)
    const xcR = xr(yc) + rho / Math.cos(a);
    for (let i = 0; i <= m; i++) {
      const th = -(Math.PI - a) + ((Math.PI / 2 - a) * i) / m;
      top.push({ x: xcR + rho * Math.cos(th), y: yc + rho * Math.sin(th) });
    }
  }
  top.push({ x: xEnd, y: -hf });
  // contour anti-horaire : dos gauche → dos droit → bord supérieur de droite à gauche
  return dedupe([{ x: xStart, y: yBack }, { x: xEnd, y: yBack }, ...top.reverse()]);
}

/** Contour de l'alésage (sens horaire), compensation de tolérance incluse. */
export function boreOutline(bore: BoreSpec, tolerance: number, segments = 64): Point[] | null {
  if (bore.type === 'none' || bore.diameter <= 0) return null;
  // la compensation s'ajoute au diamètre (et aux cotes sur plats)
  const R = (bore.diameter + tolerance) / 2;
  const pts: Point[] = [];
  if (bore.type === 'hex') {
    // diamètre = cote sur plats ; sommets à R / cos 30°
    const Rv = R / Math.cos(Math.PI / 6);
    for (let i = 0; i < 6; i++) pts.push(polar(Rv, -(i * Math.PI) / 3));
    return pts;
  }
  if (bore.type === 'd') {
    // méplat horizontal en haut : le côté opposé est à y = −R, le méplat à y = flat + tol − R
    const yFlat = bore.flat + tolerance - R;
    const t0 = Math.asin(Math.max(-1, Math.min(1, yFlat / R)));
    // arc horaire du coin haut-droit (t0) au coin haut-gauche (−π − t0) en passant par le bas ;
    // le méplat referme le contour
    const start = t0;
    const end = -Math.PI - t0;
    for (let i = 0; i <= segments; i++) pts.push(polar(R, start + ((end - start) * i) / segments));
    return dedupe(pts);
  }
  for (let i = 0; i < segments; i++) pts.push(polar(R, -(i * 2 * Math.PI) / segments));
  return pts;
}

/** Forme complète d'un engrenage (contour + trous), dans son repère local. */
export function gearShape(
  g: GearGeometry,
  bore: BoreSpec,
  boreTolerance: number,
  rimWidth: number,
  quality = 40,
): Shape {
  if (g.kind === 'rack') {
    return { outer: rackOutline(g, rimWidth), holes: [] };
  }
  if (g.kind === 'internal') {
    const outerR = g.rf + rimWidth;
    const outer: Point[] = [];
    const n = Math.max(96, g.z * 4);
    for (let i = 0; i < n; i++) outer.push(polar(outerR, (i * 2 * Math.PI) / n));
    // le contour des dents est anti-horaire ; un trou doit être horaire
    const hole = internalToothBoundary(g, Math.round(quality * 0.75)).reverse();
    return { outer, holes: [hole] };
  }
  const outer = externalOutline(g, quality);
  const b = boreOutline(bore, boreTolerance);
  return { outer, holes: b ? [b] : [] };
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) out.push(p);
  }
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) <= 1e-9) out.pop();
  }
  return out;
}
