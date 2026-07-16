import type { Category } from './categories'

/** Days of the week. The Israeli week starts on Sunday. */
export const DAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const
export type DayKey = (typeof DAYS)[number]

export const DAY_LABELS_HE: Record<DayKey, string> = {
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
}

/** The three planned meals per day. */
export const MEALS = ['breakfast', 'lunch', 'dinner'] as const
export type Meal = (typeof MEALS)[number]

export const MEAL_LABELS_HE: Record<Meal, string> = {
  breakfast: 'בוקר',
  lunch: 'צהריים',
  dinner: 'ערב',
}

/**
 * A single ingredient line inside a dish.
 *
 * `qtyKgPerPerson` is stored in KILOGRAMS and is expressed PER PERSON — the
 * shopping-list aggregation multiplies it by the day's headcount. The UI may
 * accept grams as input, but everything is normalised to kg on the way in
 * (see domain/units.ts). There are no free-text units anywhere.
 */
export interface Ingredient {
  id: string
  name: string
  category: Category
  qtyKgPerPerson: number
}

/** A dish is just a free-text name plus its ingredient list. No recipe bank. */
export interface Dish {
  id: string
  name: string
  ingredients: Ingredient[]
}

/** All dishes planned for one meal slot (a meal may have several dishes). */
export type MealPlan = Dish[]

/** One day's three meal slots. */
export type DayPlan = Record<Meal, MealPlan>

/**
 * A full week's menu for a single house, keyed by the ISO date (YYYY-MM-DD)
 * of the week's Sunday.
 */
export interface WeekMenu {
  weekOf: string
  days: Record<DayKey, DayPlan>
}

/**
 * Manual headcount for a house: a base number of patients and staff, plus
 * optional per-day overrides for guests / trips. The override is a partial —
 * an unset field falls back to the base — which keeps the shape stable for a
 * future dashboard sync (a sync can populate `base*` or `overrides` without
 * any schema change).
 */
export interface Headcount {
  basePatients: number
  baseStaff: number
  overrides: Partial<Record<DayKey, { patients?: number; staff?: number }>>
}

/** An allergy tracked for a house, with how many people it affects. */
export interface Allergy {
  id: string
  name: string
  count: number
}

/** What is currently on hand for one ingredient, in kilograms. */
export interface StockItem {
  id: string
  name: string
  category: Category
  qtyKg: number
}

/** A known price per kilogram for an ingredient, with the last-updated date. */
export interface PriceEntry {
  name: string
  category: Category
  pricePerKg: number
  updatedAt: string // ISO date
}

/** A logged actual spend for a given week. */
export interface SpendEntry {
  id: string
  weekOf: string
  amount: number
  note?: string
  date: string // ISO date
}

/** A house is the top-level tenant: everything is scoped to a house. */
export interface House {
  id: string
  name: string
  headcount: Headcount
  allergies: Allergy[]
  stock: StockItem[]
  /** Weekly menus keyed by `weekOf` (the Sunday ISO date). */
  weeks: Record<string, WeekMenu>
  weeklyBudget: number
  prices: PriceEntry[]
  spendLog: SpendEntry[]
}

export type Role = 'cook' | 'admin'

/** The complete persisted application state. */
export interface AppState {
  schemaVersion: number
  houses: House[]
  activeHouseId: string | null
  role: Role
}
