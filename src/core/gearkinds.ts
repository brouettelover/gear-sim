/**
 * Géométrie de chaque type de roue, y compris celles qui dépendent de leur partenaire :
 * roue conique (angle primitif fixé par le rapport) et roue de vis sans fin (hélice = filet de la vis).
 *
 * `geo` sert aux calculs communs (encombrement, Lewis, efforts) :
 *  - conique : roue virtuelle de Tredgold pour Y et le dégagement, mais rayon primitif moyen
 *    rm = r·(1 − b/2R) pour les efforts et module moyen pour la contrainte ;
 *    rayons de tête et de pied projetés au talon pour l'encombrement ;
 *  - vis et roue : roues hélicoïdales équivalentes (voir worm.ts).
 */
import { bevelApex, bevelGeometry, bevelHeelOutline, bevelHeight, type BevelGeometry } from './bevel';
import { extrudeShape, extrudePrism, extrudeTapered, mergeMeshes, placeMesh, ringShape, type Mesh3D } from './export';
import { gearGeometry, type GearGeometry } from './involute';
import { boreOutline, gearShape } from './profile';
import type { GearSpec, PrintSettings, Shape } from './types';
import { wheelCutSpec, wormCutSpec } from './worm';

export interface GearSolid {
  geo: GearGeometry;
  shape: Shape;
  /** hauteur axiale de la pièce (m) */
  height: number;
  /** définition équivalente (hélicoïdale pour la vis et sa roue) */
  cut: GearSpec;
  bevel?: BevelGeometry;
  /** conique : distance de la face arrière au sommet du cône (m) */
  apex?: number;
}

export const isBevel = (s: GearSpec) => s.type === 'bevel';
export const isWormSet = (s: GearSpec) => s.type === 'worm' || s.type === 'wormwheel';

/**
 * @param mate roue partenaire (conique ou vis), si elle existe
 */
export function gearSolid(spec: GearSpec, mate: GearSpec | undefined, print: PrintSettings): GearSolid {
  if (spec.type === 'bevel') {
    const bg = bevelGeometry(spec, mate?.type === 'bevel' ? mate.teeth : spec.teeth, print);
    const v = bg.virtual;
    const k = 1 - (0.5 * spec.faceWidth) / bg.coneDistance;
    const cd = Math.cos(bg.delta);
    const geo: GearGeometry = {
      ...v,
      z: spec.teeth,
      mn: v.mn * k,
      mt: v.mt * k,
      r: bg.r * k,
      rb: bg.r * k * Math.cos(v.alphaT),
      ra: bg.r + (v.ra - v.r) * cd,
      rf: bg.r + (v.rf - v.r) * cd,
      zv: v.z,
    };
    const b = boreOutline(spec.bore, print.boreTolerance);
    const shape: Shape = { outer: bevelHeelOutline(bg), holes: b ? [b] : [] };
    return { geo, shape, height: bevelHeight(bg, spec), cut: spec, bevel: bg, apex: bevelApex(bg, spec) };
  }
  const cut = spec.type === 'worm' ? wormCutSpec(spec) : spec.type === 'wormwheel' ? wheelCutSpec(spec, mate?.type === 'worm' ? mate : undefined) : spec;
  const geo = gearGeometry(cut, print);
  const shape = gearShape(geo, spec.bore, print.boreTolerance, spec.rimWidth);
  return { geo, shape, height: spec.faceWidth, cut };
}

/** Maillage 3D (mm) de la roue, face arrière en z = 0. */
export function solidMesh(s: GearSolid): Mesh3D {
  if (!s.bevel) return extrudeShape(s.shape, s.cut, s.geo);
  const bg = s.bevel;
  const back = s.cut.rimWidth;
  // dos : disque au rayon de pied du talon ; denture : tronc de cône dirigé vers le sommet
  const hub: Shape = { outer: ringShape(s.geo.rf * 0.995, 0, 96).outer, holes: s.shape.holes };
  const teeth = extrudeTapered(s.shape, s.cut.faceWidth * Math.cos(bg.delta), 1 - s.cut.faceWidth / bg.coneDistance);
  const parts: Mesh3D[] = [placeMesh(teeth, 0, 0, 0, back * 1000)];
  if (back > 0) parts.unshift(extrudePrism(hub, back));
  return mergeMeshes(parts);
}
