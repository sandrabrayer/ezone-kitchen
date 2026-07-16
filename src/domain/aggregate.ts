import type { Category } from './categories'
import { effectiveForDay } from './headcount'
import type { DayKey, Headcount, WeekMenu } from './types'
import { DAYS, MEALS } from './types'
import { roundKg } from './units'

/**
 * A quantity of one ingredient, identified by the (name, category) pair.
 * Two lines with the same trimmed/lower-cased name and the same category are
 * treated as the same ingredient and merged.
 */
export interface AggregatedLine {
  name: string
  category: Category
  qtyKg: number
}

/** Build the stable merge key for an ingredient. */
export function ingredientKey(name: string, category: Category): string {
  return `${category}::${name.trim().toLowerCase()}`
}

/**
 * Aggregate a week's menu into total kilograms per ingredient, scaling each
 * ingredient by the headcount of the day it is served on.
 *
 *   total(ingredient) = Σ over (day, meal, dish)  qtyKgPerPerson × people(day)
 *
 * where people(day) = patients + staff for that day (after overrides).
 *
 * The result is deterministically ordered by category (fixed order) then name.
 */
export function aggregateWeek(
  week: WeekMenu,
  headcount: Headcount,
): AggregatedLine[] {
  const merged = new Map<string, AggregatedLine>()

  for (const day of DAYS) {
    const people = effectiveForDay(headcount, day as DayKey).total
    if (people <= 0) continue
    const dayPlan = week.days[day as DayKey]
    if (!dayPlan) continue

    for (const meal of MEALS) {
      const dishes = dayPlan[meal] ?? []
      for (const dish of dishes) {
        for (const ing of dish.ingredients) {
          const name = ing.name.trim()
          if (!name) continue
          const amount = ing.qtyKgPerPerson * people
          if (!(amount > 0)) continue

          const key = ingredientKey(name, ing.category)
          const existing = merged.get(key)
          if (existing) {
            existing.qtyKg += amount
          } else {
            merged.set(key, { name, category: ing.category, qtyKg: amount })
          }
        }
      }
    }
  }

  return [...merged.values()]
    .map((line) => ({ ...line, qtyKg: roundKg(line.qtyKg) }))
    .sort(byCategoryThenName)
}

const CATEGORY_ORDER: Record<Category, number> = {
  groceries: 0,
  vegetables: 1,
  fruits: 2,
  meat: 3,
  dry: 4,
}

function byCategoryThenName(a: AggregatedLine, b: AggregatedLine): number {
  const c = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
  return c !== 0 ? c : a.name.localeCompare(b.name, 'he')
}
