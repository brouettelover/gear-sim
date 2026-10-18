import { describe, expect, it } from 'vitest';
import { gearGeometry } from '../involute';
import { gearShape } from '../profile';
import { shapeArea } from '../geometry2d';
import { extrudeShape, meshToStl, meshVolume, shapeToDxf, shapeToSvg, twistAt } from '../export';
import { DEG, MM } from '../units';
import { IDEAL_PRINT, spec } from './testUtils';

/** Chaque arête orientée doit apparaître exactement une fois dans chaque sens (maillage fermé et cohérent). */
function isWatertight(idx: Uint32Array, positions: Float32Array): boolean {
  // fusionne les sommets confondus (le contour peut répéter des points)
  const key = (i: number) => `${positions[3 * i].toFixed(5)},${positions[3 * i + 1].toFixed(5)},${positions[3 * i + 2].toFixed(5)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(idx[t + e]);
      const b = key(idx[t + ((e + 1) % 3)]);
      edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [k, n] of edges) {
    const [a, b] = k.split('>');
    if (n !== 1 || edges.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

describe('export STL', () => {
  const s = spec({ teeth: 16, profileShift: 0.2, bore: { type: 'd', diameter: 3 * MM, flat: 2.5 * MM } });
  const g = gearGeometry(s, IDEAL_PRINT);
  const shape = gearShape(g, s.bore, 0.1 * MM, 0);

  it('roue droite : volume = aire × largeur, maillage fermé', () => {
    const mesh = extrudeShape(shape, s, g);
    const expected = shapeArea(shape) * s.faceWidth * 1e9; // mm³
    expect(meshVolume(mesh) / expected).toBeCloseTo(1, 6);
    expect(isWatertight(mesh.indices, mesh.positions)).toBe(true);
  });

  it('hélicoïdale : la torsion conserve le volume ; Δθ = b·tan β / r', () => {
    const h = { ...s, type: 'helical' as const, helixAngle: 20 * DEG };
    const gh = gearGeometry(h, IDEAL_PRINT);
    const sh = gearShape(gh, h.bore, 0, 0);
    const mesh = extrudeShape(sh, h, gh);
    expect(meshVolume(mesh) / (shapeArea(sh) * h.faceWidth * 1e9)).toBeCloseTo(1, 3);
    expect(twistAt(h, gh, h.faceWidth)).toBeCloseTo((h.faceWidth * Math.tan(20 * DEG)) / gh.r, 12);
    expect(isWatertight(mesh.indices, mesh.positions)).toBe(true);
  });

  it('chevron : torsion nulle aux deux faces, maximale au milieu', () => {
    const h = { ...s, type: 'herringbone' as const, helixAngle: 25 * DEG };
    const gh = gearGeometry(h, IDEAL_PRINT);
    expect(twistAt(h, gh, 0)).toBe(0);
    expect(twistAt(h, gh, h.faceWidth)).toBeCloseTo(0, 12);
    expect(twistAt(h, gh, h.faceWidth / 2)).toBeGreaterThan(0);
  });

  it('STL binaire : taille = 84 + 50 octets par triangle', () => {
    const mesh = extrudeShape(shape, s, g);
    const buf = meshToStl(mesh);
    expect(buf.byteLength).toBe(84 + 50 * (mesh.indices.length / 3));
    expect(new DataView(buf).getUint32(80, true)).toBe(mesh.indices.length / 3);
  });

  it('couronne et crémaillère : maillages fermés', () => {
    for (const sp of [spec({ type: 'internal', teeth: 48 }), spec({ type: 'rack', teeth: 6 })]) {
      const gg = gearGeometry(sp, IDEAL_PRINT);
      const sh = gearShape(gg, sp.bore, 0, 3 * MM);
      const mesh = extrudeShape(sh, sp, gg);
      expect(meshVolume(mesh) / (shapeArea(sh) * sp.faceWidth * 1e9)).toBeCloseTo(1, 6);
      expect(isWatertight(mesh.indices, mesh.positions)).toBe(true);
    }
  });
});

describe('export 2D', () => {
  const s = spec({ bore: { type: 'round', diameter: 5 * MM, flat: 0 } });
  const g = gearGeometry(s, IDEAL_PRINT);
  const shape = gearShape(g, s.bore, 0, 0);
  it('SVG : un chemin par contour, dimensions en mm', () => {
    const svg = shapeToSvg(shape);
    expect(svg).toContain('mm"');
    expect((svg.match(/M /g) ?? []).length).toBe(2);
  });
  it('DXF : une polyligne fermée par contour', () => {
    const dxf = shapeToDxf(shape);
    expect((dxf.match(/POLYLINE/g) ?? []).length).toBe(2);
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});
