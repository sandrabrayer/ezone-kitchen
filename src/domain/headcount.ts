import type { DayKey, Headcount } from './types'

/** The effective patient/staff counts for a single day, after overrides. */
export interface EffectiveHeadcount {
  patients: number
  staff: number
  total: number
}

/**
 * Resolve the effective headcount for one day: a per-day override field wins
 * over the base value; an unset override field falls back to the base. Both
 * patients and staff are counted as people who eat.
 */
export function effectiveForDay(hc: Headcount, day: DayKey): EffectiveHeadcount {
  const override = hc.overrides[day] ?? {}
  const patients = clampCount(override.patients ?? hc.basePatients)
  const staff = clampCount(override.staff ?? hc.baseStaff)
  return { patients, staff, total: patients + staff }
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

export function emptyHeadcount(): Headcount {
  return { basePatients: 0, baseStaff: 0, overrides: {} }
}
