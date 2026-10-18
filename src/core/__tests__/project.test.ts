import { describe, expect, it } from 'vitest';
import { computeProject, defaultProject, parseProject, serializeProject } from '../project';

describe('projet par défaut', () => {
  const p = defaultProject();
  const c = computeProject(p);
  it('se calcule sans erreur bloquante', () => {
    expect(c.warnings.filter((w) => w.severity === 'error')).toHaveLength(0);
    expect(c.train.ratio).toBeCloseTo(-3, 12); // un engrènement extérieur inverse le sens
    expect(c.steady.stalled).toBe(false);
    expect(c.strength).toHaveLength(2);
    expect(c.strength.every((s) => s.operating.safety > 1)).toBe(true);
  });
  it('le couple de sortie est celui du poids soulevé (0,5 kg sur Ø20 mm)', () => {
    expect(c.steady.outTorque).toBeCloseTo(0.5 * 9.80665 * 0.01, 9);
  });
  it('se sérialise et se relit à l\'identique', () => {
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it('mode planétaire par défaut valide (18/18/54, rapport 4)', () => {
    const c2 = computeProject({ ...p, mode: 'planetary' });
    expect(c2.warnings.filter((w) => w.severity === 'error')).toHaveLength(0);
    expect(c2.train.ratio).toBeCloseTo(4, 12);
  });
  it('rejette un fichier quelconque', () => {
    expect(() => parseProject('{"a":1}')).toThrow();
  });
});
