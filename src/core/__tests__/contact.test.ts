import { describe, expect, it } from 'vitest';
import { contactOverlay } from '../contact';
import { halfToothAngle } from '../involute';
import { DEFAULT_MATERIALS } from '../materials';
import { analyzeChain, poses } from '../train';
import { IDEAL_PRINT, spec } from './testUtils';

/** Écart (m) entre un point et le flanc le plus proche d'une roue extérieure. */
function flankDistance(geo: ReturnType<typeof analyzeChain>['nodes'][number]['geo'], cx: number, cy: number, tooth0: number, q: { x: number; y: number }) {
  const R = Math.hypot(q.x - cx, q.y - cy);
  const ang = Math.atan2(q.y - cy, q.x - cx) - tooth0;
  const p = (2 * Math.PI) / geo.z;
  const rel = ang - Math.round(ang / p) * p; // angle par rapport à l'axe de la dent la plus proche
  return Math.abs(Math.abs(rel) - halfToothAngle(R, geo)) * R;
}

describe('points de contact (20/30 dents)', () => {
  const t = analyzeChain({
    gears: [
      { gear: spec({ id: 'a', teeth: 20 }), placement: { kind: 'root' } },
      { gear: spec({ id: 'b', teeth: 30 }), placement: { kind: 'mesh', parent: 'a', angle: 0.7 } },
    ],
    outputId: 'b',
  }, IDEAL_PRINT, DEFAULT_MATERIALS, 1);
  const [A, B] = t.nodes;
  const m = t.meshes[0];
  it('sont sur les flancs des deux roues (phasage cohérent) ; 1 ou 2 couples en prise', () => {
    let total = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * ((2 * Math.PI) / 20) * 3;
      const ps = poses(t, th);
      const pa = ps.find((p) => p.nodeId === 'a')!;
      const pb = ps.find((p) => p.nodeId === 'b')!;
      const o = contactOverlay(A.geo, pa, pa.angle, B.geo, pb, m.geo, m.gamma, i % 2 ? 1 : -1);
      expect(o.points.length).toBeGreaterThanOrEqual(1);
      expect(o.points.length).toBeLessThanOrEqual(2);
      total += o.points.length;
      for (const q of o.points) {
        expect(flankDistance(A.geo, pa.x, pa.y, pa.angle, q)).toBeLessThan(1e-7);
        expect(flankDistance(B.geo, pb.x, pb.y, pb.angle, q)).toBeLessThan(1e-7);
      }
    }
    // nombre moyen de couples en prise = rapport de conduite
    expect(total / N).toBeCloseTo(m.geo.contactRatio, 1);
  });
});

describe('points de contact : couronne et crémaillère', () => {
  it('pignon 18 dans une couronne de 54 : contacts sur les flancs du creux de la couronne', () => {
    const t = analyzeChain({
      gears: [
        { gear: spec({ id: 'p', teeth: 18 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'r', type: 'internal', teeth: 54 }), placement: { kind: 'mesh', parent: 'p', angle: 0.4 } },
      ],
      outputId: 'r',
    }, IDEAL_PRINT, DEFAULT_MATERIALS, 1);
    const [P, Rg] = t.nodes;
    const m = t.meshes[0];
    for (let i = 0; i < 60; i++) {
      const ps = poses(t, i * 0.013);
      const pp = ps.find((p) => p.nodeId === 'p')!;
      const pr = ps.find((p) => p.nodeId === 'r')!;
      const o = contactOverlay(P.geo, pp, pp.angle, Rg.geo, pr, m.geo, m.gamma, i % 2 ? 1 : -1);
      expect(o.points.length).toBeGreaterThanOrEqual(1);
      for (const q of o.points) {
        const R = Math.hypot(q.x - pr.x, q.y - pr.y);
        const ang = Math.atan2(q.y - pr.y, q.x - pr.x) - pr.angle;
        const pitch = (2 * Math.PI) / Rg.geo.z;
        const rel = ang - Math.round(ang / pitch) * pitch;
        // demi-largeur du creux de couronne au rayon R
        const half = halfToothAngle(R, Rg.geo);
        expect(Math.abs(Math.abs(rel) - half) * R).toBeLessThan(1e-7);
      }
    }
  });

  it('pignon 20 / crémaillère : contacts sur les flancs rectilignes de la crémaillère', () => {
    const t = analyzeChain({
      gears: [
        { gear: spec({ id: 'p', teeth: 20 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'r', type: 'rack', teeth: 10 }), placement: { kind: 'mesh', parent: 'p', angle: -Math.PI / 2 } },
      ],
      outputId: 'r',
    }, IDEAL_PRINT, DEFAULT_MATERIALS, 1);
    const [P, Rk] = t.nodes;
    const m = t.meshes[0];
    for (let i = 0; i < 60; i++) {
      const ps = poses(t, i * 0.011);
      const pp = ps.find((p) => p.nodeId === 'p')!;
      const pr = ps.find((p) => p.nodeId === 'r')!;
      const o = contactOverlay(P.geo, pp, pp.angle, Rk.geo, { x: Rk.x, y: Rk.y }, m.geo, m.gamma, i % 2 ? 1 : -1);
      expect(o.points.length).toBeGreaterThanOrEqual(1);
      for (const q of o.points) {
        // coordonnées dans le repère de la crémaillère (x le long, y vers le pignon)
        const c = Math.cos(-pr.angle), s = Math.sin(-pr.angle);
        const dx = q.x - pr.x, dy = q.y - pr.y;
        const u = dx * c - dy * s;
        const v = dx * s + dy * c;
        const p = Rk.geo.pt;
        const rel = u - Math.round(u / p) * p; // par rapport à l'axe de la dent la plus proche
        const flankU = Rk.geo.s / 2 - v * Math.tan(Rk.geo.alphaT);
        expect(Math.abs(Math.abs(rel) - flankU)).toBeLessThan(1e-7);
      }
    }
  });
});
