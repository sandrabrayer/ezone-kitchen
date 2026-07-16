import { describe, expect, it } from 'vitest'
import { aggregateWeek, ingredientKey } from '../aggregate'
import { dish, headcount, weekWithLunch } from './fixtures'

describe('aggregateWeek', () => {
  it('scales each ingredient by the day headcount and sums across the week', () => {
    // 0.1 kg rice/person on Sunday and Monday; 10 people each day.
    const rice = dish('Rice bowl', [
      { name: 'Rice', category: 'dry', qtyKgPerPerson: 0.1 },
    ])
    const week = weekWithLunch({ sunday: [rice], monday: [rice] })

    const result = aggregateWeek(week, headcount(8, 2)) // 10 people/day
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Rice')
    // 0.1 * 10 * 2 days = 2 kg
    expect(result[0].qtyKg).toBeCloseTo(2, 6)
  })

  it('merges the same ingredient across dishes and categories are kept distinct', () => {
    const a = dish('Salad', [
      { name: 'Tomato', category: 'vegetables', qtyKgPerPerson: 0.05 },
    ])
    const b = dish('Shakshuka', [
      { name: 'tomato', category: 'vegetables', qtyKgPerPerson: 0.15 }, // same, diff case
      { name: 'Tomato', category: 'groceries', qtyKgPerPerson: 0.02 }, // diff category -> separate
    ])
    const week = weekWithLunch({ sunday: [a, b] })

    const result = aggregateWeek(week, headcount(10, 0)) // 10 people
    const veg = result.find((r) => ingredientKey(r.name, r.category) === ingredientKey('Tomato', 'vegetables'))
    const groc = result.find((r) => r.category === 'groceries')
    expect(veg?.qtyKg).toBeCloseTo((0.05 + 0.15) * 10, 6) // 2 kg
    expect(groc?.qtyKg).toBeCloseTo(0.02 * 10, 6) // 0.2 kg
  })

  it('applies per-day overrides (guests/trips)', () => {
    const soup = dish('Soup', [
      { name: 'Carrot', category: 'vegetables', qtyKgPerPerson: 0.1 },
    ])
    const week = weekWithLunch({ sunday: [soup] })
    // base 10, but Sunday override to 20 total (15 patients + 5 staff)
    const hc = headcount(8, 2, { sunday: { patients: 15, staff: 5 } })
    const result = aggregateWeek(week, hc)
    expect(result[0].qtyKg).toBeCloseTo(0.1 * 20, 6) // 2 kg, not 1
  })

  it('contributes nothing when a day has zero people', () => {
    const soup = dish('Soup', [
      { name: 'Carrot', category: 'vegetables', qtyKgPerPerson: 0.1 },
    ])
    const week = weekWithLunch({ sunday: [soup] })
    const result = aggregateWeek(week, headcount(0, 0))
    expect(result).toHaveLength(0)
  })

  it('is ordered by fixed category order then name', () => {
    const d = dish('Mix', [
      { name: 'Zucchini', category: 'vegetables', qtyKgPerPerson: 0.1 },
      { name: 'Apple', category: 'fruits', qtyKgPerPerson: 0.1 },
      { name: 'Flour', category: 'dry', qtyKgPerPerson: 0.1 },
      { name: 'Sugar', category: 'groceries', qtyKgPerPerson: 0.1 },
    ])
    const week = weekWithLunch({ sunday: [d] })
    const result = aggregateWeek(week, headcount(5, 0))
    expect(result.map((r) => r.category)).toEqual([
      'groceries',
      'vegetables',
      'fruits',
      'dry',
    ])
  })
})
