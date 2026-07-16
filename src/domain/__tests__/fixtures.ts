import type { Dish, Headcount, WeekMenu } from '../types'
import { emptyWeekMenu } from '../weeks'

let counter = 0
const id = (p: string) => `${p}_${counter++}`

export function dish(
  name: string,
  ingredients: Array<{ name: string; category: Dish['ingredients'][number]['category']; qtyKgPerPerson: number }>,
): Dish {
  return {
    id: id('dish'),
    name,
    ingredients: ingredients.map((i) => ({ ...i, id: id('ing') })),
  }
}

export function headcount(patients: number, staff: number, overrides: Headcount['overrides'] = {}): Headcount {
  return { basePatients: patients, baseStaff: staff, overrides }
}

/** A week with the same set of dishes placed on lunch of the given days. */
export function weekWithLunch(dishesByDay: Partial<Record<keyof WeekMenu['days'], Dish[]>>): WeekMenu {
  const week = emptyWeekMenu('2026-07-12') // a Sunday
  for (const [day, dishes] of Object.entries(dishesByDay)) {
    week.days[day as keyof WeekMenu['days']].lunch = dishes ?? []
  }
  return week
}
