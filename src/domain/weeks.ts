import type { DayPlan, WeekMenu } from './types'
import { DAYS, MEALS } from './types'

/** Format a Date as a local YYYY-MM-DD string (no timezone shifting). */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** The Sunday that starts the week containing `date`, as a YYYY-MM-DD string. */
export function weekStart(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - d.getDay()) // getDay(): 0 = Sunday
  return toISODate(d)
}

/** The Sunday `weeks` weeks before/after the given weekOf string. */
export function shiftWeek(weekOf: string, weeks: number): string {
  const [y, m, d] = weekOf.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + weeks * 7)
  return toISODate(base)
}

function emptyDayPlan(): DayPlan {
  return Object.fromEntries(MEALS.map((meal) => [meal, []])) as unknown as DayPlan
}

/** A blank week menu for the given week-start date. */
export function emptyWeekMenu(weekOf: string): WeekMenu {
  return {
    weekOf,
    days: Object.fromEntries(
      DAYS.map((day) => [day, emptyDayPlan()]),
    ) as unknown as WeekMenu['days'],
  }
}
