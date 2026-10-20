/**
 * Engrenages coniques droits, axes concourants à Σ = 90°.
 *
 * Grandeurs définies au talon (grand diamètre), module m :
 *   tan δ1 = z1 / z2, δ2 = 90° − δ1        angles primitifs
 *   d = m·z                                diamètre primitif au talon
 *   R = d / (2 sin δ)                      génératrice (distance au sommet), commune aux deux roues
 *   ha = (1 + x)·m, hf = (1 + c* − x)·m    saillie et creux au talon
 *   θa = atan(ha / R), θf = atan(hf / R)   angles de saillie et de creux
 *   da = d + 2·ha·cos δ                    diamètre extérieur
 * Les dents rétrécissent vers le sommet (cône) ; largeur conseillée b ≤ R/3.
 *
 * Approximation de Tredgold : le profil au talon est celui de la roue droite "virtuelle"
 * développée sur le cône complémentaire, de rayon rv = r / cos δ et zv = z / cos δ dents.
 * Rapport de conduite, dégagement et Lewis sont calculés sur cette paire virtuelle.
 */
import { gearGeometry, meshGeometry, type GearGeometry, type MeshGeometry } from './involute';
import { externalHalfSpace } from './profile';
import type { GearSpec, Point, PrintSettings, Warning } from './types';
import { fmt, toMm } from './units';

export interface BevelGeometry {
  z: number;
  m: number;
  /** angle primitif δ (rad) */
  delta: number;
  /** rayon primitif au talon (m) */
  r: number;
  /** génératrice primitive R (m) */
  coneDistance: number;
  addendum: number;
  dedendum: number;
  /** angles de tête et de pied du cône (rad) */
  faceAngle: number;
  rootAngle: number;
  /** rayon extérieur au talon (m) */
  ra: number;
  /** roue droite virtuelle (Tredgold) au talon */
  virtual: GearGeometry;
  /** rapport largeur / génératrice */
  widthRatio: number;
  /** distance axiale du sommet du cône au plan du cercle primitif au talon (m) */
  apexToPitchPlane: number;
}

export interface BevelPair {
  a: BevelGeometry;
  b: BevelGeometry;
  /** rapport de conduite de la paire virtuelle */
  contactRatio: number;
  mesh: MeshGeometry;
  warnings: Warning[];
}

/** Géométrie d'une roue conique de `spec` engrenant avec une roue de `mateTeeth` dents (Σ = 90°). */
export function bevelGeometry(spec: GearSpec, mateTeeth: number, print: PrintSettings): BevelGeometry {
  const z = spec.teeth;
  const m = spec.module;
  const delta = Math.atan2(z, mateTeeth);
  const r = (m * z) / 2;
  const R = r / Math.sin(delta);
  const zv = z / Math.cos(delta);
  // roue virtuelle : droite, même module, zv dents (non entier), même déport
  const virtual = gearGeometry({ ...spec, type: 'spur', helixAngle: 0, teeth: zv }, print);
  const addendum = virtual.addendum;
  const dedendum = virtual.dedendum;
  return {
    z, m, delta, r,
    coneDistance: R,
    addendum, dedendum,
    faceAngle: delta + Math.atan(addendum / R),
    rootAngle: delta - Math.atan(dedendum / R),
    ra: r + addendum * Math.cos(delta),
    virtual,
    widthRatio: spec.faceWidth / R,
    apexToPitchPlane: R * Math.cos(delta),
  };
}

/** Paire conique : géométrie des deux roues, conduite et vérifications. */
export function bevelPair(a: GearSpec, b: GearSpec, print: PrintSettings): BevelPair {
  const ga = bevelGeometry(a, b.teeth, print);
  const gb = bevelGeometry(b, a.teeth, print);
  const mesh = meshGeometry(ga.virtual, gb.virtual);
  const warnings: Warning[] = [...mesh.warnings];
  for (const [spec, g] of [[a, ga], [b, gb]] as const) {
    if (g.widthRatio > 1 / 3 + 1e-9) {
      warnings.push({ severity: 'warning', message: `${spec.name} : largeur ${fmt(toMm(spec.faceWidth), 1)} mm > R/3 = ${fmt(toMm(g.coneDistance / 3), 1)} mm, les dents deviennent trop fines vers le sommet.` });
    }
    if (g.virtual.x < g.virtual.xMin - 1e-9) {
      warnings.push({ severity: 'warning', message: `${spec.name} : dégagement en pied (zv = ${fmt(g.virtual.z, 1)}), augmentez le nombre de dents ou le déport.` });
    }
  }
  if (Math.abs(a.module - b.module) > 1e-12) warnings.push({ severity: 'error', message: 'Coniques : les deux roues doivent avoir le même module.' });
  return { a: ga, b: gb, contactRatio: mesh.contactRatio, mesh, warnings };
}

/**
 * Contour du talon projeté sur le plan du cercle primitif (perpendiculaire à l'axe), dent n°0 sur l'angle 0.
 * Un point de la roue virtuelle (rayon ρ, angle φv) est reporté au rayon r + (ρ − rv)·cos δ et à
 * l'angle φv·zv/z (développement du cône complémentaire).
 */
export function bevelHeelOutline(bg: BevelGeometry, flankSamples = 30): Point[] {
  const g = bg.virtual;
  const halfSpace = externalHalfSpace(g);
  const hpv = Math.PI / g.z;
  const k = g.z / bg.z; // angle réel = angle virtuel × zv / z
  const cd = Math.cos(bg.delta);
  const proj = (rho: number) => bg.r + (rho - g.r) * cd;
  const radii: number[] = [];
  for (let i = 0; i <= flankSamples; i++) {
    const t = i / flankSamples;
    radii.push(g.rf + (g.ra - g.rf) * (0.5 * t + 0.5 * (1 - Math.cos((t * Math.PI) / 2))));
  }
  const half = radii.map((R) => Math.max(0, hpv - halfSpace(R)) * k);
  const hp = Math.PI / bg.z;
  const pts: Point[] = [];
  const at = (R: number, th: number) => pts.push({ x: R * Math.cos(th), y: R * Math.sin(th) });
  for (let t = 0; t < bg.z; t++) {
    const c = t * 2 * hp;
    for (let i = 0; i < radii.length; i++) at(proj(radii[i]), c - half[i]);
    const ht = half[half.length - 1];
    for (let i = 1; i < 6; i++) at(proj(g.ra), c - ht + (2 * ht * i) / 6);
    for (let i = radii.length - 1; i >= 0; i--) at(proj(radii[i]), c + half[i]);
    const a0 = c + half[0], a1 = c + 2 * hp - half[0];
    for (let i = 1; i < 6; i++) at(proj(g.rf), a0 + ((a1 - a0) * i) / 6);
  }
  return pts;
}

/** Hauteur axiale de la roue conique : dos + denture (m). */
export const bevelHeight = (bg: BevelGeometry, spec: GearSpec) => spec.rimWidth + spec.faceWidth * Math.cos(bg.delta);
/** Distance axiale de la face arrière au sommet du cône primitif (m). */
export const bevelApex = (bg: BevelGeometry, spec: GearSpec) => spec.rimWidth + bg.coneDistance * Math.cos(bg.delta);
