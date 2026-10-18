import type { Shape } from '../core/types';
import type { Project } from '../core/project';
import type { GearSpec } from '../core/types';

/** Chemin SVG d'une forme (coordonnées en mm, repère mathématique). */
export function shapePath(shape: Shape): string {
  const ring = (pts: { x: number; y: number }[]) =>
    'M' + pts.map((p) => `${(p.x * 1000).toFixed(4)},${(p.y * 1000).toFixed(4)}`).join('L') + 'Z';
  return [shape.outer, ...shape.holes].map(ring).join('');
}

/** Applique une modification à la roue d'identifiant donné, où qu'elle soit dans le projet. */
export function mutateGear(d: Project, id: string, fn: (g: GearSpec) => void) {
  const pl = d.planetary;
  for (const g of [pl.sun, pl.planet, pl.ring]) if (g.id === id) fn(g);
  for (const t of d.chain.gears) if (t.gear.id === id) fn(t.gear);
}

export const LEVEL_COLORS = {
  ok: { fill: 'var(--ok-fill)', stroke: 'var(--ok)' },
  marginal: { fill: 'var(--warn-fill)', stroke: 'var(--warn)' },
  danger: { fill: 'var(--danger-fill)', stroke: 'var(--danger)' },
} as const;
