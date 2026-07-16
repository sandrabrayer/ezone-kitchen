import { describe, expect, it } from 'vitest'
import { buildShoppingList, subtractStock } from '../shoppingList'
import type { StockItem } from '../types'
import { dish, headcount, weekWithLunch } from './fixtures'

describe('subtractStock (never negative)', () => {
  it('subtracts stock from the buffered need', () => {
    expect(subtractStock(12, 5)).toBe(7)
  })

  it('never returns a negative number when stock exceeds need', () => {
    expect(subtractStock(3, 10)).toBe(0)
  })

  it('treats negative stock as zero', () => {
    expect(subtractStock(4, -100)).toBe(4)
  })
})

describe('buildShoppingList pipeline', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyKgPerPerson: 0.1 }])
  const week = weekWithLunch({ sunday: [rice] })

  it('aggregates × headcount, adds 20% buffer, subtracts stock', () => {
    // 0.1 * 10 people = 1 kg required; +20% = 1.2 kg buffered
    const stock: StockItem[] = [{ id: 's1', name: 'Rice', category: 'dry', qtyKg: 0.5 }]
    const list = buildShoppingList(week, headcount(10, 0), stock)

    expect(list.bufferRate).toBe(0.2)
    const line = list.lines[0]
    expect(line.requiredKg).toBeCloseTo(1, 6)
    expect(line.bufferedKg).toBeCloseTo(1.2, 6)
    expect(line.stockKg).toBeCloseTo(0.5, 6)
    expect(line.toBuyKg).toBeCloseTo(0.7, 6) // 1.2 - 0.5
  })

  it('clamps toBuy to zero when stock covers the buffered need', () => {
    const stock: StockItem[] = [{ id: 's1', name: 'Rice', category: 'dry', qtyKg: 5 }]
    const list = buildShoppingList(week, headcount(10, 0), stock)
    expect(list.lines[0].toBuyKg).toBe(0)
  })

  it('groups lines under the five fixed categories', () => {
    const list = buildShoppingList(week, headcount(10, 0), [])
    expect(Object.keys(list.byCategory)).toEqual([
      'groceries',
      'vegetables',
      'fruits',
      'meat',
      'dry',
    ])
    expect(list.byCategory.dry).toHaveLength(1)
    expect(list.byCategory.meat).toHaveLength(0)
  })

  it('sums stock across duplicate stock rows for the same ingredient', () => {
    const stock: StockItem[] = [
      { id: 's1', name: 'Rice', category: 'dry', qtyKg: 0.3 },
      { id: 's2', name: 'rice', category: 'dry', qtyKg: 0.2 },
    ]
    const list = buildShoppingList(week, headcount(10, 0), stock)
    expect(list.lines[0].stockKg).toBeCloseTo(0.5, 6)
    expect(list.lines[0].toBuyKg).toBeCloseTo(0.7, 6)
  })
})
