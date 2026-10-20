import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIALS } from '../materials';
import { computeProject, defaultProject } from '../project';
import { analyzeChain, descendantsOf, poses, snapPlacement, type ChainSpec } from '../train';
import { MM } from '../units';
import { IDEAL_PRINT, spec } from './testUtils';

const chain = (extra: ChainSpec['gears'] = []): ChainSpec => ({
  gears: [
    { gear: spec({ id: 'a', teeth: 20 }), placement: { kind: 'root' } },
    { gear: spec({ id: 'b', teeth: 20 }), placement: { kind: 'mesh', parent: 'a', angle: 0 } },
    ...extra,
  ],
  outputId: 'b',
});

describe('roues posées librement', () => {
  it('une roue posée à l\'écart et ce qu\'elle porte ne tournent pas', () => {
    const t = analyzeChain(chain([
      { gear: spec({ id: 'f', teeth: 30 }), placement: { kind: 'free', x: 60 * MM, y: 0 } },
      { gear: spec({ id: 'g', teeth: 10 }), placement: { kind: 'mesh', parent: 'f', angle: 0 } },
    ]), IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
    const byId = new Map(t.nodes.map((n) => [n.id, n]));
    expect(byId.get('f')!.ratio).toBe(0);
    expect(Math.abs(byId.get('g')!.ratio)).toBe(0);
    expect(byId.get('f')!.x).toBeCloseTo(60 * MM, 12);
    const a1 = poses(t, 0).find((p) => p.nodeId === 'g')!.angle;
    const a2 = poses(t, 5).find((p) => p.nodeId === 'g')!.angle;
    expect(a2).toBeCloseTo(a1, 12);
    expect(t.disconnected).toBeFalsy();
  });
  it('sortie posée à l\'écart : sortie non entraînée, rapport infini', () => {
    const c = chain();
    c.gears[1].placement = { kind: 'free', x: 50 * MM, y: 0 };
    const t = analyzeChain(c, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
    expect(t.disconnected).toBe(true);
    expect(t.ratio).toBe(Infinity);
    expect(t.warnings.some((w) => w.severity === 'error')).toBe(true);
  });
  it('plans décalés : la roue menée s\'arrête, le moteur tourne à vide', () => {
    const p = defaultProject();
    p.chain.gears[1].axialOffset = 20 * MM;
    const c = computeProject(p);
    const out = c.train.nodes.find((n) => n.id === p.chain.outputId)!;
    expect(Math.abs(out.ratio)).toBe(0);
    expect(c.train.disconnected).toBe(true);
    expect(c.steady.stalled).toBe(false);
    expect(Number.isFinite(c.steady.omegaMotor)).toBe(true);
    for (const s of c.strength) expect(Number.isFinite(s.operating.safety) || s.operating.safety === Infinity).toBe(true);
  });
  it('glisser-déposer : accroche à l\'entraxe, sinon pose libre ; pas de boucle sur ses propres roues', () => {
    const c = chain();
    const t = analyzeChain(c, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
    const b = t.nodes.find((n) => n.id === 'b')!;
    // entraxe 20 mm (m = 1, 20 + 20 dents) : lâchée à 0,8 mm près en haut de « a »
    const snap = snapPlacement(t, c, b, 0.3 * MM, 20.8 * MM, 1.5 * MM);
    expect(snap.kind).toBe('mesh');
    if (snap.kind === 'mesh') {
      expect(snap.parent).toBe('a');
      expect(snap.angle).toBeCloseTo(Math.PI / 2 - Math.round((0.3 / 20.8) * (180 / Math.PI)) * (Math.PI / 180), 9);
    }
    expect(snapPlacement(t, c, b, 40 * MM, 40 * MM, 1.5 * MM)).toEqual({ kind: 'free', x: 40 * MM, y: 40 * MM });
    expect([...descendantsOf(chain([{ gear: spec({ id: 'c' }), placement: { kind: 'coaxial', parent: 'b' } }]), 'b')].sort()).toEqual(['b', 'c']);
  });
});
