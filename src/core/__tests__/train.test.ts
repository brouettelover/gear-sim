import { describe, expect, it } from 'vitest';
import { analyzeChain, analyzePlanetary, gearLoads, planetaryRatios, poses, type ChainSpec } from '../train';
import { DEFAULT_MATERIALS } from '../materials';
import { lewisBending, lewisFormFactor } from '../strength';
import { MM } from '../units';
import { IDEAL_PRINT, spec } from './testUtils';

const chain = (c: ChainSpec) => analyzeChain(c, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);

describe('train simple', () => {
  const t = chain({
    gears: [
      { gear: spec({ id: 'a', teeth: 12, profileShift: 0.3 }), placement: { kind: 'root' } },
      { gear: spec({ id: 'b', teeth: 30 }), placement: { kind: 'mesh', parent: 'a', angle: 0 } },
      { gear: spec({ id: 'c', teeth: 18 }), placement: { kind: 'mesh', parent: 'b', angle: Math.PI / 2 } },
    ],
    outputId: 'c',
  });
  it('rapport = z_sortie / z_moteur, la roue intermédiaire ne change que le sens', () => {
    expect(t.ratio).toBeCloseTo(18 / 12, 12);
    expect(t.nodes.find((n) => n.id === 'b')!.ratio).toBeCloseTo(-12 / 30, 12);
  });
  it('rendement = η² pour deux engrènements', () => expect(t.efficiency).toBeCloseTo(0.81, 12));
  it('entraxe calculé automatiquement (avec déport)', () => {
    const b = t.nodes.find((n) => n.id === 'b')!;
    expect(b.x / MM).toBeGreaterThan(21);
    expect(b.y).toBeCloseTo(0, 12);
    expect(t.meshes[0].geo.centerDistance).toBeCloseTo(b.x, 12);
  });
  it('phasage : aux deux engrènements, une dent fait face à un creux au point primitif', () => {
    for (const th of [0, 0.37, 1.9]) {
      const ps = new Map(poses(t, th).map((p) => [p.nodeId, p]));
      for (const m of t.meshes) {
        const A = t.nodes.find((n) => n.id === m.a)!;
        const B = t.nodes.find((n) => n.id === m.b)!;
        // angle de la dent de a la plus proche de γ, rapporté au pas
        const da = ((ps.get(A.id)!.angle - m.gamma) / (2 * Math.PI / A.geo.z)) % 1;
        const db = ((ps.get(B.id)!.angle - (m.gamma + Math.PI)) / (2 * Math.PI / B.geo.z)) % 1;
        // arcs au primitif opposés (roulement sans glissement), à un demi-pas près
        const arcA = da * A.geo.pt;
        const arcB = db * B.geo.pt;
        const s = ((arcA + arcB) / A.geo.pt - 0.5) % 1;
        expect(Math.min(Math.abs(s), Math.abs(Math.abs(s) - 1))).toBeLessThan(1e-9);
      }
    }
  });
});

describe('train composé', () => {
  const t = chain({
    gears: [
      { gear: spec({ id: 'm', teeth: 10, profileShift: 0.5 }), placement: { kind: 'root' } },
      { gear: spec({ id: 'b1', teeth: 40 }), placement: { kind: 'mesh', parent: 'm', angle: 0 } },
      { gear: spec({ id: 'p2', teeth: 10, profileShift: 0.5 }), placement: { kind: 'coaxial', parent: 'b1' } },
      { gear: spec({ id: 'b2', teeth: 40 }), placement: { kind: 'mesh', parent: 'p2', angle: Math.PI / 2 } },
    ],
    outputId: 'b2',
  });
  it('rapport = produit des rapports d\'étage (4 × 4 = 16), même sens', () => expect(t.ratio).toBeCloseTo(16, 12));
  it('les roues coaxiales sont dans des plans différents (pas de collision signalée)', () => {
    expect(t.warnings.filter((w) => w.message.startsWith('Collision'))).toHaveLength(0);
    expect(t.nodes.find((n) => n.id === 'p2')!.layer).toBe(1);
  });
  it('signale une collision entre roues d\'un même plan', () => {
    const c = chain({
      gears: [
        { gear: spec({ id: 'a', teeth: 20 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'b', teeth: 20 }), placement: { kind: 'mesh', parent: 'a', angle: 0 } },
        { gear: spec({ id: 'c', teeth: 20 }), placement: { kind: 'mesh', parent: 'b', angle: Math.PI + 0.3 } },
      ],
      outputId: 'c',
    });
    expect(c.warnings.some((w) => w.message.startsWith('Collision'))).toBe(true);
  });
  it('effort tangentiel : Ft = T_arbre / r, avec le rendement en amont', () => {
    const loads = new Map(gearLoads(t, 0.01, 100, 0.9).map((l) => [l.nodeId, l]));
    expect(loads.get('m')!.ft).toBeCloseTo(0.01 / 0.005, 9);
    // 2e étage : couple × 4 × 0,9 sur un pignon de rayon 5 mm
    expect(loads.get('b2')!.ft).toBeCloseTo((0.01 * 4 * 0.9) / 0.005, 9);
  });
});

describe('pignon–crémaillère', () => {
  const t = chain({
    gears: [
      { gear: spec({ id: 'p', teeth: 20 }), placement: { kind: 'root' } },
      { gear: spec({ id: 'r', type: 'rack', teeth: 12 }), placement: { kind: 'mesh', parent: 'p', angle: -Math.PI / 2 } },
    ],
    outputId: 'r',
  });
  it('sortie linéaire : v = r·ω', () => {
    expect(t.linearOutput).toBe(true);
    expect(1 / t.ratio).toBeCloseTo(10 * MM, 12);
  });
});

describe('train planétaire (soleil 12, satellites 18, couronne 48)', () => {
  it('couronne fixe, entrée soleil : N = 1 + zr/zs = 5', () => {
    const w = planetaryRatios(12, 18, 48, 'sun', 'ring');
    expect(1 / w.carrier).toBeCloseTo(5, 12);
  });
  it('porte-satellites fixe : N = −zr/zs = −4', () => {
    const w = planetaryRatios(12, 18, 48, 'sun', 'carrier');
    expect(1 / w.ring).toBeCloseTo(-4, 12);
  });
  it('soleil fixe, entrée couronne : N = 1 + zs/zr = 1,25', () => {
    const w = planetaryRatios(12, 18, 48, 'ring', 'sun');
    expect(1 / w.carrier).toBeCloseTo(1.25, 12);
  });
  it('vérifie les conditions de montage', () => {
    const ok = analyzePlanetary({ sun: spec({ id: 's', teeth: 12 }), planet: spec({ id: 'p', teeth: 18 }), ring: spec({ id: 'r', teeth: 48, type: 'internal' }), planets: 3, input: 'sun', fixed: 'ring' }, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
    expect(ok.warnings.filter((w) => w.severity === 'error')).toHaveLength(0);
    expect(ok.ratio).toBeCloseTo(5, 12);
    const bad = analyzePlanetary({ sun: spec({ id: 's', teeth: 13 }), planet: spec({ id: 'p', teeth: 18 }), ring: spec({ id: 'r', teeth: 48, type: 'internal' }), planets: 3, input: 'sun', fixed: 'ring' }, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
    expect(bad.warnings.some((w) => w.message.includes('coaxialité'))).toBe(true);
  });
});

describe('Lewis', () => {
  it('facteur de forme tabulé (Shigley) : Y(20) = 0,322, Y(17) = 0,303', () => {
    expect(lewisFormFactor(20)).toBeCloseTo(0.322, 9);
    expect(lewisFormFactor(17)).toBeCloseTo(0.303, 9);
    expect(lewisFormFactor(25)).toBeCloseTo((0.337 + 0.346) / 2, 9);
  });
  it('σ = Kv·Ft/(b·m·Y) : 10 N sur une roue de 20 dents, m = 1, b = 5 mm, à l\'arrêt', () => {
    const t = chain({ gears: [{ gear: spec({ id: 'a' }), placement: { kind: 'root' } }], outputId: 'a' });
    const r = lewisBending(t.nodes[0].geo, 10, 0, 5 * MM, 20e6);
    expect(r.stress).toBeCloseTo(10 / (5e-3 * 1e-3 * 0.322), 3);
    expect(r.safety).toBeCloseTo(20e6 / r.stress, 9);
  });
  it('facteur dynamique Kv = (3,05 + V)/3,05', () => {
    const t = chain({ gears: [{ gear: spec({ id: 'a' }), placement: { kind: 'root' } }], outputId: 'a' });
    expect(lewisBending(t.nodes[0].geo, 10, 3.05, 5 * MM, 20e6).kv).toBeCloseTo(2, 12);
  });
});

describe('inertie', () => {
  it('roue pleine : J ≈ ½·m·r² avec r proche du primitif', () => {
    const t = chain({ gears: [{ gear: spec({ id: 'a', teeth: 40 }), placement: { kind: 'root' } }], outputId: 'a' });
    const n = t.nodes[0];
    const approx = 0.5 * n.mass * n.geo.r ** 2;
    expect(n.inertia / approx).toBeGreaterThan(0.85);
    expect(n.inertia / approx).toBeLessThan(1.1);
    // PLA 1240 kg/m³, b = 5 mm : masse proche de celle du disque primitif (à 2 % près)
    expect(n.mass / (1240 * 5e-3 * Math.PI * 0.02 ** 2)).toBeCloseTo(1, 1);
  });
});
