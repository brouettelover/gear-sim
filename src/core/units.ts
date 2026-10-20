/**
 * Conversions d'unités.
 * Tout le calcul interne est en SI (m, rad, N·m, rad/s, kg, Pa, s).
 * L'affichage utilise mm, degrés, N·mm et tr/min.
 */

export const MM = 1e-3; // 1 mm en m
export const DEG = Math.PI / 180; // 1° en rad
export const RPM = (2 * Math.PI) / 60; // 1 tr/min en rad/s
export const NMM = 1e-3; // 1 N·mm en N·m
export const MPA = 1e6; // 1 MPa en Pa
export const G = 9.80665; // pesanteur (m/s²)

export const toMm = (m: number) => m / MM;
export const fromMm = (mm: number) => mm * MM;
export const toDeg = (rad: number) => rad / DEG;
export const fromDeg = (deg: number) => deg * DEG;
export const toRpm = (radPerS: number) => radPerS / RPM;
export const fromRpm = (rpm: number) => rpm * RPM;
export const toNmm = (nm: number) => nm / NMM;
export const fromNmm = (nmm: number) => nmm * NMM;

/** Formate un nombre à la française (virgule décimale). */
export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '−∞' : '—';
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
