/**
 * Unit handling. The app stores everything in KILOGRAMS. The UI may let a
 * user type a value in grams for convenience, but it is normalised to kg on
 * the way in. There are no free-text units.
 */

export type InputUnit = 'kg' | 'g'

export function gramsToKg(grams: number): number {
  return grams / 1000
}

export function kgToGrams(kg: number): number {
  return kg * 1000
}

/** Normalise a numeric input in the given unit to kilograms. */
export function toKg(value: number, unit: InputUnit): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return unit === 'g' ? gramsToKg(value) : value
}

/** Round a kilogram value for display without accumulating float noise. */
export function roundKg(kg: number, decimals = 3): number {
  const f = 10 ** decimals
  return Math.round((kg + Number.EPSILON) * f) / f
}
