import type { GearSpec, PrintSettings } from '../types';
import { DEG, MM } from '../units';

/** Réglages "théoriques" : sans jeu, jeu radial standard. */
export const IDEAL_PRINT: PrintSettings = {
  backlash: 0,
  clearanceCoef: 0.25,
  boreTolerance: 0,
  nozzle: 0.4 * MM,
  fillFactor: 1,
};

export function spec(over: Partial<GearSpec> = {}): GearSpec {
  return {
    id: 'g',
    name: 'g',
    type: 'spur',
    module: 1 * MM,
    teeth: 20,
    pressureAngle: 20 * DEG,
    faceWidth: 5 * MM,
    profileShift: 0,
    helixAngle: 0,
    bore: { type: 'none', diameter: 0, flat: 0 },
    rimWidth: 3 * MM,
    materialId: 'PLA',
    ...over,
  };
}
