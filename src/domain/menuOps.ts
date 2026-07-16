import { newId } from './id'
import type { Dish, WeekMenu } from './types'
import { DAYS, MEALS } from './types'
import { emptyWeekMenu } from './weeks'

function cloneDish(dish: Dish): Dish {
  return {
    id: newId('dish'),
    name: dish.name,
    ingredients: dish.ingredients.map((ing) => ({ ...ing, id: newId('ing') })),
  }
}

/**
 * Copy a source week's dishes into a target week ("Copy last week"). Every
 * dish and ingredient gets a fresh id so the two weeks can be edited
 * independently.
 */
export function copyWeekInto(source: WeekMenu, targetWeekOf: string): WeekMenu {
  const target = emptyWeekMenu(targetWeekOf)
  for (const day of DAYS) {
    for (const meal of MEALS) {
      target.days[day][meal] = (source.days[day]?.[meal] ?? []).map(cloneDish)
    }
  }
  return target
}
