import type { PriceEntry, SpendEntry } from './types'
import { ingredientKey } from './aggregate'
import type { ShoppingLine } from './shoppingList'
import { roundKg } from './units'

/** A per-line cost estimate, including whether we had a price for it. */
export interface EstimatedLine {
  name: string
  category: ShoppingLine['category']
  toBuyKg: number
  pricePerKg: number | null
  updatedAt: string | null
  /** toBuyKg × pricePerKg, or 0 when the price is unknown. */
  lineCost: number
}

export interface BudgetEstimate {
  lines: EstimatedLine[]
  /** Sum of all line costs for which a price was known. */
  estimatedTotal: number
  /** Ingredients that need to be bought but have no price on file. */
  missingPrices: string[]
}

function indexPrices(prices: PriceEntry[]): Map<string, PriceEntry> {
  const map = new Map<string, PriceEntry>()
  for (const p of prices) {
    map.set(ingredientKey(p.name, p.category), p)
  }
  return map
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Estimate the cost of a shopping list from known price-per-kg entries.
 * Lines with no matching price contribute 0 and are reported in
 * `missingPrices` so the UI can flag them.
 */
export function estimateCost(
  lines: ShoppingLine[],
  prices: PriceEntry[],
): BudgetEstimate {
  const priceIndex = indexPrices(prices)
  const missingPrices: string[] = []

  const estimated: EstimatedLine[] = lines
    .filter((l) => l.toBuyKg > 0)
    .map((l) => {
      const price = priceIndex.get(ingredientKey(l.name, l.category)) ?? null
      if (!price) missingPrices.push(l.name)
      const lineCost = price ? round2(l.toBuyKg * price.pricePerKg) : 0
      return {
        name: l.name,
        category: l.category,
        toBuyKg: roundKg(l.toBuyKg),
        pricePerKg: price ? price.pricePerKg : null,
        updatedAt: price ? price.updatedAt : null,
        lineCost,
      }
    })

  const estimatedTotal = round2(
    estimated.reduce((sum, l) => sum + l.lineCost, 0),
  )
  return { lines: estimated, estimatedTotal, missingPrices }
}

/** Sum the logged actual spend for one week. */
export function actualSpendForWeek(
  spendLog: SpendEntry[],
  weekOf: string,
): number {
  return round2(
    spendLog
      .filter((s) => s.weekOf === weekOf)
      .reduce((sum, s) => sum + (Number.isFinite(s.amount) ? s.amount : 0), 0),
  )
}

export interface BudgetSummary {
  weeklyBudget: number
  estimated: number
  actual: number
  /** actual − estimated (positive = spent more than estimated). */
  varianceVsEstimate: number
  /** actual − budget (positive = over budget). */
  varianceVsBudget: number
  overBudget: boolean
}

/** Combine budget target, estimate and logged actuals into one summary. */
export function summariseBudget(
  weeklyBudget: number,
  estimated: number,
  actual: number,
): BudgetSummary {
  const budget = Number.isFinite(weeklyBudget) ? weeklyBudget : 0
  return {
    weeklyBudget: budget,
    estimated: round2(estimated),
    actual: round2(actual),
    varianceVsEstimate: round2(actual - estimated),
    varianceVsBudget: round2(actual - budget),
    overBudget: actual > budget,
  }
}
