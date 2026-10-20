/**
 * Ligne d'action et points de contact instantanés d'un engrènement (pour l'affichage).
 *
 * Dans le repère local (axe x = direction γ du centre de la roue a vers le point primitif P) :
 *   - la ligne d'action est tangente au cercle de base de a en T1 = rb·e(σ·αw),
 *     de direction d = (sin αw, −σ·cos αw) ;
 *   - σ = +1 : contact sur le flanc horaire des dents de a ; σ = −1 : flanc anti-horaire.
 *     Une roue menante qui tourne dans le sens anti-horaire pousse avec son flanc anti-horaire (σ = −1) ;
 *   - un point à la distance ℓ de T1 est sur la développante dont l'origine sur le cercle de base
 *     est à l'angle θB = θT1 − σ·ℓ/rb ; pour une dent centrée sur ψ, θB = ψ − σ·ψb
 *     (ψb = s/(2r) + inv αt : demi-angle de dent au cercle de base).
 */
import { inv, type GearGeometry, type MeshGeometry } from './involute';
import type { Point } from './types';

export interface ContactOverlay {
  /** extrémités de la ligne d'action tracée */
  from: Point;
  to: Point;
  /** points de contact instantanés */
  points: Point[];
}

/**
 * @param a roue extérieure ; ca son centre ; thetaA angle de sa dent n°0 (monde)
 * @param b autre roue (extérieure, couronne ou crémaillère) ; cb son centre (crémaillère : point de sa ligne primitive)
 * @param gamma direction de ca vers le point primitif
 * @param sigma +1 : contact sur le flanc horaire des dents de a ; −1 : flanc anti-horaire
 */
export function contactOverlay(
  a: GearGeometry, ca: Point, thetaA: number,
  b: GearGeometry, cb: Point,
  mesh: MeshGeometry, gamma: number, sigma: 1 | -1,
): ContactOverlay {
  const aw = mesh.alphaW;
  const cg = Math.cos(gamma);
  const sg = Math.sin(gamma);
  const toWorld = (x: number, y: number): Point => ({ x: ca.x + x * cg - y * sg, y: ca.y + x * sg + y * cg });
  const t1 = { x: a.rb * Math.cos(sigma * aw), y: a.rb * Math.sin(sigma * aw) };
  const d = { x: Math.sin(aw), y: -sigma * Math.cos(aw) };
  // longueur tracée : jusqu'à la tangence sur l'autre base (extérieur) ou au-delà de P
  const lineLen = b.kind === 'external' ? mesh.centerDistance * Math.sin(aw) : a.r * Math.sin(aw) * 2 + a.mn * 2;
  const psiB = a.s / (2 * a.r) + inv(a.alphaT);
  const thT1 = sigma * aw; // angle local de T1
  const pitch = (2 * Math.PI) / a.z;
  const points: Point[] = [];
  for (let k = 0; k < a.z; k++) {
    const psi = thetaA - gamma + k * pitch; // centre de la dent k, angle local
    const thB = psi - sigma * psiB;
    let delta = sigma * (thT1 - thB);
    delta -= Math.floor(delta / (2 * Math.PI)) * 2 * Math.PI;
    const l = a.rb * delta;
    if (l > lineLen) continue;
    const q = { x: t1.x + l * d.x, y: t1.y + l * d.y };
    // le point doit être à l'intérieur de la tête de a…
    if (Math.hypot(q.x, q.y) > a.ra + 1e-9) continue;
    const qw = toWorld(q.x, q.y);
    // … et sur la partie active de b
    if (b.kind === 'external') {
      if (Math.hypot(qw.x - cb.x, qw.y - cb.y) > b.ra + 1e-9) continue;
    } else if (b.kind === 'internal') {
      if (Math.hypot(qw.x - cb.x, qw.y - cb.y) < b.ra - 1e-9) continue;
    } else {
      // crémaillère : au-dessous de sa ligne de tête (côté pignon)
      const h = a.r + a.x * a.mn - q.x; // hauteur au-dessus de sa ligne de référence, vers le pignon
      if (h > b.addendum + 1e-9) continue;
    }
    points.push(qw);
  }
  return { from: toWorld(t1.x, t1.y), to: toWorld(t1.x + lineLen * d.x, t1.y + lineLen * d.y), points };
}
