import { describe, expect, it } from 'vitest';
import { gearGeometry, gearWarnings, inv, invInverse, meshGeometry } from '../involute';
import { DEG, MM } from '../units';
import { IDEAL_PRINT, spec } from './testUtils';

const mm = (v: number) => v / MM;

describe('fonction développante', () => {
  it('inv(20°) = 0,014904 (valeur tabulée)', () => {
    expect(inv(20 * DEG)).toBeCloseTo(0.0149044, 6);
  });
  it('invInverse est la réciproque de inv', () => {
    for (const a of [1, 5, 14.5, 20, 25, 30, 40]) {
      expect(invInverse(inv(a * DEG)) / DEG).toBeCloseTo(a, 8);
    }
  });
});

describe('diamètres d\'une roue droite (z = 20, m = 1, α = 20°)', () => {
  const g = gearGeometry(spec(), IDEAL_PRINT);
  it('diamètre primitif d = z·m = 20 mm', () => expect(mm(2 * g.r)).toBeCloseTo(20, 9));
  it('diamètre de tête da = d + 2m = 22 mm', () => expect(mm(2 * g.ra)).toBeCloseTo(22, 9));
  it('diamètre de pied df = d − 2,5m = 17,5 mm', () => expect(mm(2 * g.rf)).toBeCloseTo(17.5, 9));
  it('diamètre de base db = d·cos α = 18,7939 mm', () => expect(mm(2 * g.rb)).toBeCloseTo(18.79385, 4));
  it('épaisseur au primitif s = π·m/2', () => expect(mm(g.s)).toBeCloseTo(Math.PI / 2, 9));
  it('pas de base pb = π·m·cos α = 2,9521 mm', () => expect(mm(g.pb)).toBeCloseTo(2.95213, 4));
  it('arrondi d\'outil ρ = 0,38·m (ISO 53)', () => expect(mm(g.rho)).toBeCloseTo(0.38, 2));
  it('z min sans dégagement ≈ 17,1', () => expect(g.zMin).toBeCloseTo(17.1, 1));
});

describe('déport de profil', () => {
  it('x = +0,5 : da = d + 2m(1 + x), s = m(π/2 + 2x·tan α)', () => {
    const g = gearGeometry(spec({ teeth: 10, profileShift: 0.5 }), IDEAL_PRINT);
    expect(mm(2 * g.ra)).toBeCloseTo(13, 9);
    expect(mm(2 * g.rf)).toBeCloseTo(8.5, 9);
    expect(mm(g.s)).toBeCloseTo(Math.PI / 2 + Math.tan(20 * DEG), 9);
  });
  it('le jeu au flanc amincit chaque dent de la moitié du jeu', () => {
    const g = gearGeometry(spec(), { ...IDEAL_PRINT, backlash: 0.2 * MM });
    expect(mm(g.s)).toBeCloseTo(Math.PI / 2 - 0.1, 9);
  });
});

describe('denture hélicoïdale (mn = 2, z = 20, β = 15°)', () => {
  const g = gearGeometry(spec({ type: 'helical', module: 2 * MM, helixAngle: 15 * DEG }), IDEAL_PRINT);
  it('module apparent mt = mn / cos β = 2,0706', () => expect(mm(g.mt)).toBeCloseTo(2.07055, 4));
  it('diamètre primitif = 41,411 mm', () => expect(mm(2 * g.r)).toBeCloseTo(41.4110, 3));
  it('angle de pression apparent αt = 20,647°', () => expect(g.alphaT / DEG).toBeCloseTo(20.6469, 3));
  it('diamètre de tête = d + 2·mn', () => expect(mm(2 * g.ra)).toBeCloseTo(45.411, 3));
});

describe('rapport de conduite', () => {
  it('20/20 dents, m = 1, x = 0 : εα = 1,557', () => {
    const a = gearGeometry(spec(), IDEAL_PRINT);
    const m = meshGeometry(a, a);
    expect(mm(m.centerDistance)).toBeCloseTo(20, 9);
    expect(m.contactRatio).toBeCloseTo(1.557, 3);
  });
  it('pignon 20 dents / crémaillère : εα = 1,769', () => {
    const a = gearGeometry(spec(), IDEAL_PRINT);
    const r = gearGeometry(spec({ type: 'rack', teeth: 10 }), IDEAL_PRINT);
    expect(meshGeometry(a, r).contactRatio).toBeCloseTo(1.769, 3);
  });
  it('pignon 20 / couronne 60 : εα ≈ 1,95, entraxe 20 mm', () => {
    const a = gearGeometry(spec(), IDEAL_PRINT);
    const r = gearGeometry(spec({ type: 'internal', teeth: 60 }), IDEAL_PRINT);
    const m = meshGeometry(a, r);
    expect(mm(m.centerDistance)).toBeCloseTo(20, 9);
    expect(m.contactRatio).toBeCloseTo(1.95, 2);
  });
  it('rapport de conduite croissant avec le nombre de dents', () => {
    const e = [12, 20, 40, 80].map((z) => {
      const g = gearGeometry(spec({ teeth: z, profileShift: z < 17 ? 0.3 : 0 }), IDEAL_PRINT);
      return meshGeometry(g, g).contactRatio;
    });
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeGreaterThan(e[i - 1]);
  });
  it('recouvrement hélicoïdal εβ = b·sin β / (π·mn)', () => {
    const a = gearGeometry(spec({ type: 'helical', helixAngle: 20 * DEG, faceWidth: 10 * MM }), IDEAL_PRINT);
    const b = gearGeometry(spec({ type: 'helical', helixAngle: -20 * DEG, faceWidth: 10 * MM }), IDEAL_PRINT);
    const m = meshGeometry(a, b);
    expect(m.overlapRatio).toBeCloseTo((10 * Math.sin(20 * DEG)) / Math.PI, 9);
    expect(m.warnings.find((w) => w.severity === 'error')).toBeUndefined();
  });
});

describe('entraxe avec déport (exemple KHK : m = 3, z = 12/24, x = 0,6/0,36)', () => {
  const a = gearGeometry(spec({ module: 3 * MM, teeth: 12, profileShift: 0.6 }), IDEAL_PRINT);
  const b = gearGeometry(spec({ module: 3 * MM, teeth: 24, profileShift: 0.36 }), IDEAL_PRINT);
  const m = meshGeometry(a, b);
  it('angle de pression de fonctionnement αw = 26,0886°', () => expect(m.alphaW / DEG).toBeCloseTo(26.0886, 3));
  it('entraxe a = 56,4987 mm', () => expect(mm(m.centerDistance)).toBeCloseTo(56.4987, 2));
});

describe('dent pointue', () => {
  it('x = 1 sur 8 dents : tête raccourcie au rayon de pointe', () => {
    const s = spec({ teeth: 8, profileShift: 1 });
    const g = gearGeometry(s, IDEAL_PRINT);
    expect(g.tipTruncated).toBe(true);
    expect(g.sa).toBeGreaterThan(0);
    expect(g.ra).toBeLessThan(6 * MM);
    expect(gearWarnings(s, g, IDEAL_PRINT).some((w) => w.message.startsWith('Dent pointue'))).toBe(true);
  });
});

describe('avertissements', () => {
  it('signale le dégagement pour 10 dents sans déport', () => {
    const s = spec({ teeth: 10 });
    const w = gearWarnings(s, gearGeometry(s, IDEAL_PRINT), IDEAL_PRINT);
    expect(w.some((x) => x.message.includes('Dégagement'))).toBe(true);
  });
  it('signale un module trop petit pour la buse (0,6 mm avec buse 0,4)', () => {
    const s = spec({ module: 0.6 * MM });
    const w = gearWarnings(s, gearGeometry(s, IDEAL_PRINT), IDEAL_PRINT);
    expect(w.some((x) => x.message.includes('trop petit pour une buse'))).toBe(true);
  });
  it('signale un rapport de conduite < 1,2 (12/12 dents, α = 30°)', () => {
    const g = gearGeometry(spec({ teeth: 12, pressureAngle: 30 * DEG, profileShift: 0.3 }), IDEAL_PRINT);
    const m = meshGeometry(g, g);
    expect(m.contactRatio).toBeLessThan(1.2);
    expect(m.warnings.some((x) => x.message.includes('Rapport de conduite'))).toBe(true);
  });
  it('signale l\'interférence d\'un pignon de 8 dents sans déport avec une roue de 40', () => {
    const a = gearGeometry(spec({ teeth: 8 }), IDEAL_PRINT);
    const b = gearGeometry(spec({ teeth: 40 }), IDEAL_PRINT);
    expect(meshGeometry(a, b).warnings.some((x) => x.message.includes('Interférence'))).toBe(true);
  });
});
