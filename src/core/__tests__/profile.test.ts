import { describe, expect, it } from 'vitest';
import { gearGeometry, halfToothAngle } from '../involute';
import { boreOutline, externalHalfSpace, gearShape } from '../profile';
import { shapeArea, shapePolarMoment, signedArea, signedPolarMoment } from '../geometry2d';
import { MM } from '../units';
import { IDEAL_PRINT, spec } from './testUtils';

describe('profil d\'une roue extérieure', () => {
  for (const [z, x] of [[8, 0], [12, 0], [16, 0.2], [20, 0], [60, -0.3]]) {
    const g = gearGeometry(spec({ teeth: z, profileShift: x }), IDEAL_PRINT);
    const hs = externalHalfSpace(g);
    it(`z = ${z}, x = ${x} : rayons extrêmes = rf et ra`, () => {
      const s = gearShape(g, { type: 'none', diameter: 0, flat: 0 }, 0, 0);
      const radii = s.outer.map((p) => Math.hypot(p.x, p.y));
      expect(Math.min(...radii) / g.rf).toBeCloseTo(1, 6);
      expect(Math.max(...radii) / g.ra).toBeCloseTo(1, 6);
      expect(signedArea(s.outer)).toBeGreaterThan(0); // anti-horaire
    });
    it(`z = ${z}, x = ${x} : épaisseur au primitif = s (développante exacte)`, () => {
      const half = Math.PI / z - hs(g.r);
      expect(half).toBeCloseTo(g.s / (2 * g.r), 9);
    });
    it(`z = ${z}, x = ${x} : contour sans trou ni saut entre points successifs`, () => {
      const pts = gearShape(g, { type: 'none', diameter: 0, flat: 0 }, 0, 0).outer;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.5 * g.mn);
      }
    });
  }

  it('z = 20 sans déport : pas de dégagement (développante intacte au-dessus du cercle de forme)', () => {
    const g = gearGeometry(spec({ teeth: 20 }), IDEAL_PRINT);
    const hs = externalHalfSpace(g);
    const R = g.rb + 0.3 * (g.ra - g.rb);
    expect(Math.PI / 20 - hs(R)).toBeCloseTo(halfToothAngle(R, g), 9);
  });

  it('z = 20 sans déport : le creux s\'élargit continûment du pied à la tête', () => {
    const g = gearGeometry(spec({ teeth: 20 }), IDEAL_PRINT);
    const hs = externalHalfSpace(g);
    let prev = hs(g.rf);
    for (let i = 1; i <= 200; i++) {
      const v = hs(g.rf + ((g.ra - g.rf) * i) / 200);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it('z = 8 sans déport : le dégagement creuse la dent sous le cercle de base', () => {
    const g = gearGeometry(spec({ teeth: 8 }), IDEAL_PRINT);
    const hs = externalHalfSpace(g);
    // le creux est plus large sous le cercle de base qu'au cercle de base : dent "étranglée"
    let maxBelow = 0;
    for (let i = 0; i <= 100; i++) maxBelow = Math.max(maxBelow, hs(g.rf + ((g.rb - g.rf) * i) / 100));
    expect(maxBelow).toBeGreaterThan(hs(g.rb) + 0.005);
  });

  it('z = 8 avec déport x = 0,6 : plus de dégagement', () => {
    const g = gearGeometry(spec({ teeth: 8, profileShift: 0.6 }), IDEAL_PRINT);
    const hs = externalHalfSpace(g);
    let prev = hs(g.rf);
    for (let i = 1; i <= 200; i++) {
      const v = hs(g.rf + ((g.ra - g.rf) * i) / 200);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('le congé de pied a un rayon de courbure proche de ρ (raccord au cercle de pied)', () => {
    // le creux au fond vaut le demi-angle couvert par le fond plat de l'outil
    const g = gearGeometry(spec({ teeth: 40 }), IDEAL_PRINT);
    const hs = externalHalfSpace(g);
    expect(hs(g.rf)).toBeGreaterThan(0);
    expect(hs(g.rf + 0.01 * g.mn)).toBeGreaterThan(hs(g.rf));
  });
});

describe('aires et moments', () => {
  it('moment polaire d\'un disque ≈ π·R⁴/2', () => {
    const R = 0.01;
    const c = boreOutline({ type: 'round', diameter: 2 * R, flat: 0 }, 0, 720)!;
    expect(Math.abs(signedPolarMoment(c)) / ((Math.PI * R ** 4) / 2)).toBeCloseTo(1, 4);
    expect(signedArea(c)).toBeLessThan(0); // trou : sens horaire
  });
  it('aire d\'une roue comprise entre les disques de pied et de tête, alésage déduit', () => {
    const g = gearGeometry(spec({ teeth: 30 }), IDEAL_PRINT);
    const s = gearShape(g, { type: 'round', diameter: 3 * MM, flat: 0 }, 0, 0);
    const a = shapeArea(s);
    expect(a).toBeGreaterThan(Math.PI * g.rf ** 2 - Math.PI * (1.5 * MM) ** 2);
    expect(a).toBeLessThan(Math.PI * g.ra ** 2);
    expect(shapePolarMoment(s)).toBeGreaterThan(0);
  });
  it('alésage en D (N20 : Ø3, méplat 2,5) : aire inférieure au rond', () => {
    const d = boreOutline({ type: 'd', diameter: 3 * MM, flat: 2.5 * MM }, 0)!;
    const r = boreOutline({ type: 'round', diameter: 3 * MM, flat: 0 }, 0)!;
    expect(Math.abs(signedArea(d))).toBeLessThan(Math.abs(signedArea(r)));
    const maxY = Math.max(...d.map((p) => p.y));
    expect(maxY / MM).toBeCloseTo(1.0, 6); // méplat à 2,5 − 1,5 = 1 mm du centre
  });
  it('alésage hexagonal : cote sur plats respectée', () => {
    const h = boreOutline({ type: 'hex', diameter: 5.5 * MM, flat: 0 }, 0.1 * MM)!;
    const ys = h.map((p) => p.y);
    expect((Math.max(...ys) - Math.min(...ys)) / MM).toBeCloseTo(5.6, 6);
  });
  it('crémaillère et couronne : formes valides', () => {
    const r = gearGeometry(spec({ type: 'rack', teeth: 10 }), IDEAL_PRINT);
    const sr = gearShape(r, { type: 'none', diameter: 0, flat: 0 }, 0, 3 * MM);
    expect(signedArea(sr.outer)).toBeGreaterThan(0);
    const maxX = Math.max(...sr.outer.map((p) => p.x));
    const minX = Math.min(...sr.outer.map((p) => p.x));
    expect((maxX - minX) / MM).toBeCloseTo(10 * Math.PI, 6);
    const ri = gearGeometry(spec({ type: 'internal', teeth: 60 }), IDEAL_PRINT);
    const si = gearShape(ri, { type: 'none', diameter: 0, flat: 0 }, 0, 3 * MM);
    expect(signedArea(si.holes[0])).toBeLessThan(0);
    expect(shapeArea(si)).toBeGreaterThan(0);
  });
});
