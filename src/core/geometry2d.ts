/**
 * Outils de géométrie plane : aire, moment polaire, boîte englobante, rotation.
 */
import type { Point, Shape } from './types';

/** Aire signée d'un polygone (> 0 si anti-horaire). */
export function signedArea(p: Point[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y;
  return a / 2;
}

/**
 * Moment quadratique polaire signé ∫(x² + y²) dA d'un polygone par rapport à l'origine.
 * Formule exacte pour un polygone : (1/12)·Σ cᵢ·(xᵢ² + xᵢxⱼ + xⱼ² + yᵢ² + yᵢyⱼ + yⱼ²),
 * avec cᵢ = xᵢyⱼ − xⱼyᵢ.
 */
export function signedPolarMoment(p: Point[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const c = a.x * b.y - b.x * a.y;
    s += c * (a.x * a.x + a.x * b.x + b.x * b.x + a.y * a.y + a.y * b.y + b.y * b.y);
  }
  return s / 12;
}

/** Aire nette d'une forme (contour − trous). */
export function shapeArea(s: Shape): number {
  return Math.abs(signedArea(s.outer)) - s.holes.reduce((t, h) => t + Math.abs(signedArea(h)), 0);
}

/** Moment polaire net ∫r² dA d'une forme par rapport à l'origine (m⁴). */
export function shapePolarMoment(s: Shape): number {
  return Math.abs(signedPolarMoment(s.outer)) - s.holes.reduce((t, h) => t + Math.abs(signedPolarMoment(h)), 0);
}

export function bounds(pts: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function rotate(p: Point, a: number): Point {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function transform(pts: Point[], angle: number, dx: number, dy: number): Point[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pts.map((p) => ({ x: p.x * c - p.y * s + dx, y: p.x * s + p.y * c + dy }));
}
