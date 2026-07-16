import type { AggregatedLine } from './aggregate'
import { aggregateWeek, ingredientKey } from './aggregate'
import { applyBuffer, BUFFER_RATE } from './buffer'
import type { Category } from './categories'
import { CATEGORIES } from './categories'
import type { Headcount, StockItem, WeekMenu } from './types'
import { roundKg } from './units'

/** One computed row of the shopping list. */
export interface ShoppingLine {
  name: string
  category: Category
  /** Raw need from the menu × headcount, before buffer (kg). */
  requiredKg: number
  /** Need after the purchasing buffer (kg). */
  bufferedKg: number
  /** What the house already has on hand (kg). */
  stockKg: number
  /** Net amount to actually buy: max(0, buffered − stock) (kg). */
  toBuyKg: number
}

/** The shopping list grouped by the five fixed categories. */
export interface ShoppingList {
  bufferRate: number
  lines: ShoppingLine[]
  byCategory: Record<Category, ShoppingLine[]>
}

/** Index stock items by (name, category) into total kg on hand. */
function indexStock(stock: StockItem[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of stock) {
    const name = item.name.trim()
    if (!name) continue
    const key = ingredientKey(name, item.category)
    map.set(key, (map.get(key) ?? 0) + Math.max(0, item.qtyKg))
  }
  return map
}

/** Subtract on-hand stock from a buffered quantity. Never returns negative. */
export function subtractStock(bufferedKg: number, stockKg: number): number {
  const net = bufferedKg - Math.max(0, stockKg)
  return net > 0 ? net : 0
}

/**
 * Compose the full shopping-list pipeline:
 *   1. aggregate the week's ingredients × headcount        (aggregateWeek)
 *   2. add the 20% purchasing buffer                       (applyBuffer)
 *   3. subtract current stock, never going below zero      (subtractStock)
 *   4. group the result by the five fixed category tabs
 */
export function buildShoppingList(
  week: WeekMenu,
  headcount: Headcount,
  stock: StockItem[],
  bufferRate: number = BUFFER_RATE,
): ShoppingList {
  const aggregated: AggregatedLine[] = aggregateWeek(week, headcount)
  const stockIndex = indexStock(stock)

  const lines: ShoppingLine[] = aggregated.map((line) => {
    const bufferedKg = roundKg(applyBuffer(line.qtyKg, bufferRate))
    const stockKg = roundKg(stockIndex.get(ingredientKey(line.name, line.category)) ?? 0)
    const toBuyKg = roundKg(subtractStock(bufferedKg, stockKg))
    return {
      name: line.name,
      category: line.category,
      requiredKg: line.qtyKg,
      bufferedKg,
      stockKg,
      toBuyKg,
    }
  })

  const byCategory = groupByCategory(lines)
  return { bufferRate, lines, byCategory }
}

function groupByCategory(lines: ShoppingLine[]): Record<Category, ShoppingLine[]> {
  const grouped = Object.fromEntries(
    CATEGORIES.map((c) => [c, [] as ShoppingLine[]]),
  ) as Record<Category, ShoppingLine[]>
  for (const line of lines) grouped[line.category].push(line)
  return grouped
}
