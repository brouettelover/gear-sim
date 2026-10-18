import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSEMBLY, analyzeAssembly, applyRodBores, toWorld, type V3 } from '../assembly';
import { bevelGeometry, bevelHeelOutline, bevelPair } from '../bevel';
import { meshVolume } from '../export';
import { gearSolid, solidMesh } from '../gearkinds';
import { DEFAULT_MATERIALS } from '../materials';
import { analyzeChain, gearLoads, type ChainSpec } from '../train';
import { MM } from '../units';
import { leadAngle, wormEfficiency, wormPair } from '../worm';
import { IDEAL_PRINT, spec } from './testUtils';

const build = (c: ChainSpec) => {
  const rods = applyRodBores(c, DEFAULT_ASSEMBLY);
  const train = analyzeChain(rods.chain, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
  return { train, asm: analyzeAssembly(train, rods.chain, DEFAULT_ASSEMBLY, IDEAL_PRINT, rods.ids) };
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(...a);
const errors = (w: { severity: string; message: string }[]) => w.filter((x) => x.severity === 'error').map((x) => x.message);

describe('coniques', () => {
  const a = spec({ id: 'a', type: 'bevel', teeth: 20, faceWidth: 5 * MM });
  const b = spec({ id: 'b', type: 'bevel', teeth: 40, faceWidth: 5 * MM });
  it('angles primitifs : tan δ1 = z1/z2, δ1 + δ2 = 90°, génératrice commune', () => {
    const p = bevelPair(a, b, IDEAL_PRINT);
    expect(Math.tan(p.a.delta)).toBeCloseTo(0.5, 12);
    expect(p.a.delta + p.b.delta).toBeCloseTo(Math.PI / 2, 12);
    expect(p.a.coneDistance).toBeCloseTo(p.b.coneDistance, 12);
  });
  it('roue virtuelle de Tredgold : zv = z / cos δ', () => {
    const g = bevelGeometry(spec({ type: 'bevel', teeth: 20 }), 20, IDEAL_PRINT);
    expect(g.delta).toBeCloseTo(Math.PI / 4, 12);
    expect(g.virtual.z).toBeCloseTo(20 * Math.SQRT2, 9);
  });
  it('contour du talon : z dents, rayon extérieur = r + ha·cos δ', () => {
    const g = bevelGeometry(a, 40, IDEAL_PRINT);
    const pts = bevelHeelOutline(g);
    const rmax = Math.max(...pts.map((q) => Math.hypot(q.x, q.y)));
    expect(rmax).toBeCloseTo(g.ra, 9);
    expect(g.ra).toBeCloseTo(10 * MM + 1 * MM * Math.cos(g.delta), 9);
  });
  it('maillage fermé et orienté', () => {
    const s = gearSolid({ ...a, bore: { type: 'round', diameter: 3 * MM, flat: 0 } }, b, IDEAL_PRINT);
    expect(meshVolume(solidMesh(s))).toBeGreaterThan(0);
  });
  const { train, asm } = build({
    gears: [
      { gear: a, placement: { kind: 'root' } },
      { gear: b, placement: { kind: 'mesh', parent: 'a', angle: 0 } },
    ],
    outputId: 'b',
  });
  it('renvoi d\'angle : rapport z2/z1, nouvel axe perpendiculaire', () => {
    expect(Math.abs(train.ratio)).toBeCloseTo(2, 12);
    expect(errors(train.warnings)).toEqual([]);
    const F = asm.groups[asm.placed.b.group];
    expect(asm.placed.b.group).toBe(1);
    expect(dot(F.w, [0, 0, 1])).toBeCloseTo(0, 12);
  });
  it('les sommets des deux cônes sont confondus', () => {
    const na = train.nodes[0], nb = train.nodes[1];
    const apexA = toWorld(asm.groups[0], na.x, na.y, asm.placed.a.z + na.solid.apex!);
    const apexB = toWorld(asm.groups[1], 0, 0, nb.solid.apex!);
    expect(len(sub(apexA, apexB))).toBeLessThan(1e-12);
  });
});

describe('vis sans fin', () => {
  const worm = spec({ id: 'w', name: 'vis', type: 'worm', teeth: 1, faceWidth: 16 * MM, diameterFactor: 10, helixAngle: 1 });
  const wheel = spec({ id: 'g', name: 'roue', type: 'wormwheel', teeth: 30, faceWidth: 6 * MM });
  it('angle du filet tan γ = z1/q, entraxe a = (q + z2)·m/2', () => {
    const p = wormPair(worm, wheel, IDEAL_PRINT);
    expect(Math.tan(leadAngle(worm))).toBeCloseTo(0.1, 12);
    expect(p.worm.r).toBeCloseTo(5 * MM, 12);
    expect(p.centerDistance).toBeCloseTo(20 * MM, 12);
    expect(p.ratio).toBe(30);
  });
  it('rendement : tan γ / tan(γ + φ\'), irréversible pour un filet', () => {
    const e = wormEfficiency(Math.atan(0.1), (20 * Math.PI) / 180, 0.2);
    const phi = Math.atan(0.2 / Math.cos((20 * Math.PI) / 180));
    expect(e.forward).toBeCloseTo(0.1 / Math.tan(Math.atan(0.1) + phi), 12);
    expect(e.selfLocking).toBe(true);
    expect(wormEfficiency(Math.atan(4 / 8), (20 * Math.PI) / 180, 0.2).selfLocking).toBe(false);
  });
  const { train, asm } = build({
    gears: [
      { gear: worm, placement: { kind: 'root' } },
      { gear: wheel, placement: { kind: 'mesh', parent: 'w', angle: 0 } },
    ],
    outputId: 'g',
  });
  it('train : rapport 30, rendement de la vis, irréversible', () => {
    expect(Math.abs(train.ratio)).toBeCloseTo(30, 9);
    expect(train.efficiency).toBeCloseTo(wormPair(worm, wheel, IDEAL_PRINT).efficiency.forward, 12);
    expect(train.backEfficiency).toBeLessThan(0);
  });
  it('axes croisés à 90° à l\'entraxe a', () => {
    const F = asm.groups[asm.placed.g.group];
    expect(dot(F.w, [0, 0, 1])).toBeCloseTo(0, 12);
    const center = toWorld(F, 0, 0, asm.placed.g.width / 2);
    // distance du centre de la roue à l'axe de la vis (axe z passant par l'origine)
    expect(Math.hypot(center[0], center[1])).toBeCloseTo(20 * MM, 12);
    expect(center[2]).toBeCloseTo(asm.placed.w.z + 8 * MM, 12);
  });
  it('efforts : Ft roue = T_roue / r_roue (effort axial de la vis)', () => {
    const loads = new Map(gearLoads(train, 0.01, 100, 0.9).map((l) => [l.nodeId, l]));
    const ng = train.nodes[1];
    expect(loads.get('g')!.ft).toBeCloseTo((0.01 * 30 * train.efficiency) / ng.geo.r, 9);
    expect(loads.get('w')!.ft).toBeCloseTo(0.01 / (5 * MM), 9);
  });
  it('une roue droite ne peut pas engrener avec une vis', () => {
    const t = build({ gears: [{ gear: worm, placement: { kind: 'root' } }, { gear: spec({ id: 's' }), placement: { kind: 'mesh', parent: 'w', angle: 0 } }], outputId: 's' }).train;
    expect(errors(t.warnings).length).toBeGreaterThan(0);
  });
  it('maillage de la vis : volume proche du cylindre primitif', () => {
    const v = meshVolume(solidMesh(gearSolid(worm, wheel, IDEAL_PRINT))) * 1e-9;
    const cyl = Math.PI * (5 * MM) ** 2 * 16 * MM;
    expect(v).toBeGreaterThan(cyl * 0.7);
    expect(v).toBeLessThan(cyl * 1.3);
  });
});

describe('tiges libres', () => {
  it('une tige libre traverse les deux flasques et les agrandit', () => {
    const chain: ChainSpec = { gears: [{ gear: spec({ id: 'a' }), placement: { kind: 'root' } }], outputId: 'a' };
    const rods = applyRodBores(chain, DEFAULT_ASSEMBLY);
    const train = analyzeChain(rods.chain, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
    const a = { ...DEFAULT_ASSEMBLY, freeRods: [{ id: 'f', name: 'Colonne', x: 40 * MM, y: 0 }] };
    const asm = analyzeAssembly(train, rods.chain, a, IDEAL_PRINT, rods.ids);
    const s = asm.shafts.find((x) => x.id === 'f')!;
    expect(s.kind).toBe('free');
    expect(s.zTo - s.zFrom).toBeCloseTo(asm.innerHeight + 2 * a.plateThickness, 12);
    for (const p of asm.plates) {
      expect(Math.max(...p.shape.outer.map((q) => q.x))).toBeGreaterThan(40 * MM);
      expect(p.shape.holes.length).toBeGreaterThanOrEqual(1);
    }
  });
});
