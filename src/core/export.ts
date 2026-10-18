/**
 * Export des pièces : STL (extrusion, avec torsion pour les hélicoïdaux et chevrons),
 * SVG et DXF du profil 2D. Les fichiers sont produits en millimètres.
 *
 * Torsion d'une denture hélicoïdale : à la hauteur h, la section tourne de
 *   Δθ(h) = h·tan β / r      (r rayon primitif, β angle d'hélice au primitif)
 * Chevron : torsion croissante jusqu'à mi-hauteur puis décroissante.
 */
import earcut from 'earcut';
import type { GearGeometry } from './involute';
import type { GearSpec, Point, Shape } from './types';

const MM_PER_M = 1000;

/** Angle de torsion à la hauteur h (m) pour une pièce de hauteur b. */
export function twistAt(spec: GearSpec, geo: GearGeometry, h: number): number {
  if (geo.kind !== 'external' || spec.helixAngle === 0) return 0;
  const k = Math.tan(spec.helixAngle) / geo.r;
  if (spec.type === 'helical') return h * k;
  if (spec.type === 'herringbone') {
    const half = spec.faceWidth / 2;
    return (h <= half ? h : 2 * half - h) * k;
  }
  return 0;
}

export interface Mesh3D {
  /** sommets (x, y, z) à plat, en mm */
  positions: Float32Array;
  /** indices des triangles */
  indices: Uint32Array;
}

/** Maillage fermé de la pièce extrudée (en mm). */
export function extrudeShape(shape: Shape, spec: GearSpec, geo: GearGeometry): Mesh3D {
  const b = spec.faceWidth;
  const helix = geo.kind === 'external' && spec.helixAngle !== 0 && (spec.type === 'helical' || spec.type === 'herringbone');
  // nombre de tranches : une tous les ~2° de torsion (au moins 8) ; 1 pour une denture droite
  let slices = 1;
  if (helix) {
    const total = Math.abs(twistAt(spec, geo, spec.type === 'herringbone' ? b / 2 : b));
    slices = Math.max(8, Math.ceil(total / ((2 * Math.PI) / 180)));
    if (spec.type === 'herringbone' && slices % 2) slices++;
  }
  const rings = [shape.outer, ...shape.holes];
  const ringSizes = rings.map((r) => r.length);
  const perLayer = ringSizes.reduce((a, n) => a + n, 0);
  const flat = rings.flat();
  const pos = new Float32Array(perLayer * (slices + 1) * 3);
  for (let s = 0; s <= slices; s++) {
    const h = (b * s) / slices;
    const a = twistAt(spec, geo, h);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let i = 0; i < perLayer; i++) {
      const p = flat[i];
      const o = (s * perLayer + i) * 3;
      pos[o] = (p.x * c - p.y * sn) * MM_PER_M;
      pos[o + 1] = (p.x * sn + p.y * c) * MM_PER_M;
      pos[o + 2] = h * MM_PER_M;
    }
  }
  const idx: number[] = [];
  // parois latérales : quadrilatères entre deux tranches, normales vers l'extérieur
  // (contour anti-horaire et trous horaires → même règle d'orientation pour tous les anneaux)
  let start = 0;
  for (const n of ringSizes) {
    for (let s = 0; s < slices; s++) {
      const lo = s * perLayer + start;
      const hi = (s + 1) * perLayer + start;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        idx.push(lo + i, lo + j, hi + j, lo + i, hi + j, hi + i);
      }
    }
    start += n;
  }
  // faces inférieure et supérieure : triangulation du profil avec trous (earcut)
  const coords: number[] = [];
  for (const p of flat) coords.push(p.x, p.y);
  const holeIdx: number[] = [];
  let acc = ringSizes[0];
  for (let k = 1; k < ringSizes.length; k++) {
    holeIdx.push(acc);
    acc += ringSizes[k];
  }
  const tris = earcut(coords, holeIdx);
  // earcut ne garantit pas l'orientation : on la corrige d'après l'aire signée
  const oriented: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const [i0, i1, i2] = [tris[t], tris[t + 1], tris[t + 2]];
    const ax = flat[i1].x - flat[i0].x, ay = flat[i1].y - flat[i0].y;
    const bx = flat[i2].x - flat[i0].x, by = flat[i2].y - flat[i0].y;
    if (ax * by - ay * bx >= 0) oriented.push(i0, i1, i2);
    else oriented.push(i0, i2, i1);
  }
  const top = slices * perLayer;
  for (let t = 0; t < oriented.length; t += 3) {
    // dessous : normale vers −z (ordre inversé) ; dessus : normale vers +z
    idx.push(oriented[t], oriented[t + 2], oriented[t + 1]);
    idx.push(top + oriented[t], top + oriented[t + 1], top + oriented[t + 2]);
  }
  return { positions: pos, indices: new Uint32Array(idx) };
}

/** STL binaire (little-endian) à partir d'un maillage en mm. */
export function meshToStl(mesh: Mesh3D, name = 'gear'): ArrayBuffer {
  const n = mesh.indices.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const header = `gear-sim ${name}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  const P = mesh.positions;
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = mesh.indices[3 * t] * 3, b = mesh.indices[3 * t + 1] * 3, c = mesh.indices[3 * t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** Volume (mm³) d'un maillage fermé (théorème de la divergence), utile pour vérifier l'orientation. */
export function meshVolume(mesh: Mesh3D): number {
  const P = mesh.positions;
  let v = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3, b = mesh.indices[t + 1] * 3, c = mesh.indices[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
      - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
      + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

const mm = (v: number) => +(v * MM_PER_M).toFixed(4);

function pathData(ring: Point[]): string {
  return 'M ' + ring.map((p) => `${mm(p.x)} ${mm(-p.y)}`).join(' L ') + ' Z';
}

/** SVG du profil (mm, axe y vers le haut converti en axe SVG vers le bas). */
export function shapeToSvg(shape: Shape, title = 'engrenage'): string {
  const all = [shape.outer, ...shape.holes].flat();
  const xs = all.map((p) => mm(p.x));
  const ys = all.map((p) => mm(-p.y));
  const minX = Math.min(...xs) - 1, minY = Math.min(...ys) - 1;
  const w = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
  const d = [shape.outer, ...shape.holes].map(pathData).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(3)}mm" height="${h.toFixed(3)}mm" viewBox="${minX.toFixed(3)} ${minY.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}">
  <title>${title.replace(/[<&>]/g, '')}</title>
  <path d="${d}" fill="none" stroke="black" stroke-width="0.05" fill-rule="evenodd"/>
</svg>
`;
}

/** DXF R12 (polylignes fermées, mm). */
export function shapeToDxf(shape: Shape): string {
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const ring of [shape.outer, ...shape.holes]) {
    out.push('0', 'POLYLINE', '8', '0', '66', '1', '70', '1');
    for (const p of ring) out.push('0', 'VERTEX', '8', '0', '10', String(mm(p.x)), '20', String(mm(p.y)), '30', '0');
    out.push('0', 'SEQEND', '8', '0');
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}
