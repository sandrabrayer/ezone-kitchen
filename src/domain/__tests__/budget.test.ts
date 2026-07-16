import { describe, expect, it } from 'vitest'
import { actualSpendForWeek, estimateCost, summariseBudget } from '../budget'
import type { PriceEntry, SpendEntry } from '../types'
import type { ShoppingLine } from '../shoppingList'

const line = (
  name: string,
  category: ShoppingLine['category'],
  toBuyKg: number,
): ShoppingLine => ({ name, category, requiredKg: toBuyKg, bufferedKg: toBuyKg, stockKg: 0, toBuyKg })

describe('estimateCost', () => {
  const prices: PriceEntry[] = [
    { name: 'Rice', category: 'dry', pricePerKg: 6, updatedAt: '2026-07-01' },
    { name: 'Chicken', category: 'meat', pricePerKg: 25, updatedAt: '2026-07-10' },
  ]

  it('multiplies toBuyKg by price per kg and sums', () => {
    const est = estimateCost([line('Rice', 'dry', 2), line('Chicken', 'meat', 4)], prices)
    expect(est.estimatedTotal).toBeCloseTo(2 * 6 + 4 * 25, 6) // 112
    expect(est.missingPrices).toHaveLength(0)
    expect(est.lines[0].updatedAt).toBe('2026-07-01')
  })

  it('reports ingredients with no known price and counts them as 0', () => {
    const est = estimateCost([line('Rice', 'dry', 2), line('Tomato', 'vegetables', 3)], prices)
    expect(est.estimatedTotal).toBeCloseTo(12, 6) // only the rice
    expect(est.missingPrices).toEqual(['Tomato'])
    const tomato = est.lines.find((l) => l.name === 'Tomato')
    expect(tomato?.pricePerKg).toBeNull()
    expect(tomato?.lineCost).toBe(0)
  })

  it('ignores lines with nothing to buy', () => {
    const est = estimateCost([line('Rice', 'dry', 0)], prices)
    expect(est.lines).toHaveLength(0)
    expect(est.estimatedTotal).toBe(0)
  })
})

describe('actualSpendForWeek', () => {
  const log: SpendEntry[] = [
    { id: '1', weekOf: '2026-07-12', amount: 100, date: '2026-07-13' },
    { id: '2', weekOf: '2026-07-12', amount: 50.5, date: '2026-07-14' },
    { id: '3', weekOf: '2026-07-05', amount: 999, date: '2026-07-06' },
  ]

  it('sums only entries for the requested week', () => {
    expect(actualSpendForWeek(log, '2026-07-12')).toBeCloseTo(150.5, 6)
    expect(actualSpendForWeek(log, '2026-07-05')).toBeCloseTo(999, 6)
    expect(actualSpendForWeek(log, '2026-07-19')).toBe(0)
  })
})

describe('summariseBudget', () => {
  it('computes variance vs estimate and vs budget', () => {
    const s = summariseBudget(1000, 800, 900)
    expect(s.varianceVsEstimate).toBeCloseTo(100, 6) // 900 - 800
    expect(s.varianceVsBudget).toBeCloseTo(-100, 6) // 900 - 1000
    expect(s.overBudget).toBe(false)
  })

  it('flags over budget', () => {
    const s = summariseBudget(1000, 800, 1200)
    expect(s.overBudget).toBe(true)
    expect(s.varianceVsBudget).toBeCloseTo(200, 6)
  })
})
