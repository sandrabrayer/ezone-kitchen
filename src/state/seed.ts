import { newId } from '../domain/id'
import type { AppState, House } from '../domain/types'
import { emptyWeekMenu, weekStart } from '../domain/weeks'

export const SCHEMA_VERSION = 1

/** Build a starter dataset so the app is useful on first load. */
export function seedState(today: Date = new Date()): AppState {
  const week = weekStart(today)

  const houseA = makeHouse('בית ראשון', week, {
    basePatients: 12,
    baseStaff: 4,
    allergies: [
      { id: newId('alg'), name: 'גלוטן', count: 2 },
      { id: newId('alg'), name: 'לקטוז', count: 1 },
    ],
  })

  // Give house A a sample menu so the shopping list is non-empty on first run.
  houseA.weeks[week].days.sunday.lunch = [
    {
      id: newId('dish'),
      name: 'אורז עם עוף',
      ingredients: [
        { id: newId('ing'), name: 'אורז', category: 'dry', qtyKgPerPerson: 0.1 },
        { id: newId('ing'), name: 'עוף', category: 'meat', qtyKgPerPerson: 0.15 },
        { id: newId('ing'), name: 'בצל', category: 'vegetables', qtyKgPerPerson: 0.03 },
      ],
    },
  ]
  houseA.weeks[week].days.monday.lunch = [
    {
      id: newId('dish'),
      name: 'מרק ירקות',
      ingredients: [
        { id: newId('ing'), name: 'גזר', category: 'vegetables', qtyKgPerPerson: 0.08 },
        { id: newId('ing'), name: 'תפוח אדמה', category: 'vegetables', qtyKgPerPerson: 0.1 },
      ],
    },
  ]
  houseA.stock = [
    { id: newId('stk'), name: 'אורז', category: 'dry', qtyKg: 2 },
    { id: newId('stk'), name: 'בצל', category: 'vegetables', qtyKg: 1 },
  ]
  houseA.prices = [
    { name: 'אורז', category: 'dry', pricePerKg: 6, updatedAt: isoDate(today) },
    { name: 'עוף', category: 'meat', pricePerKg: 28, updatedAt: isoDate(today) },
    { name: 'גזר', category: 'vegetables', pricePerKg: 4, updatedAt: isoDate(today) },
  ]

  const houseB = makeHouse('בית שני', week, {
    basePatients: 8,
    baseStaff: 3,
    allergies: [{ id: newId('alg'), name: 'אגוזים', count: 1 }],
  })

  return {
    schemaVersion: SCHEMA_VERSION,
    houses: [houseA, houseB],
    activeHouseId: houseA.id,
    role: 'cook',
  }
}

function makeHouse(
  name: string,
  week: string,
  opts: {
    basePatients: number
    baseStaff: number
    allergies: House['allergies']
  },
): House {
  return {
    id: newId('house'),
    name,
    headcount: {
      basePatients: opts.basePatients,
      baseStaff: opts.baseStaff,
      overrides: {},
    },
    allergies: opts.allergies,
    stock: [],
    weeks: { [week]: emptyWeekMenu(week) },
    weeklyBudget: 2000,
    prices: [],
    spendLog: [],
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
