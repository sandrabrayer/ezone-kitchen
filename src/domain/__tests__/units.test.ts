import { describe, expect, it } from 'vitest'
import { gramsToKg, kgToGrams, roundKg, toKg } from '../units'

describe('units', () => {
  it('converts grams to kg and back', () => {
    expect(gramsToKg(500)).toBe(0.5)
    expect(gramsToKg(1000)).toBe(1)
    expect(kgToGrams(2)).toBe(2000)
  })

  it('normalises input by unit', () => {
    expect(toKg(2, 'kg')).toBe(2)
    expect(toKg(250, 'g')).toBe(0.25)
  })

  it('clamps invalid input to 0', () => {
    expect(toKg(-1, 'kg')).toBe(0)
    expect(toKg(Number.NaN, 'g')).toBe(0)
  })

  it('rounds without float noise', () => {
    expect(roundKg(0.1 + 0.2)).toBe(0.3)
    expect(roundKg(1.23456, 2)).toBe(1.23)
  })
})
