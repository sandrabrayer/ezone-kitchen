import { describe, expect, it } from 'vitest'
import { applyBuffer, BUFFER_RATE } from '../buffer'

describe('applyBuffer (the 20% rule)', () => {
  it('adds exactly 20% by default', () => {
    expect(applyBuffer(10)).toBeCloseTo(12, 10)
    expect(applyBuffer(1)).toBeCloseTo(1.2, 10)
    expect(applyBuffer(2.5)).toBeCloseTo(3, 10)
  })

  it('uses the documented default rate constant', () => {
    expect(BUFFER_RATE).toBe(0.2)
    expect(applyBuffer(100)).toBeCloseTo(100 * (1 + BUFFER_RATE), 10)
  })

  it('honours a custom rate', () => {
    expect(applyBuffer(10, 0)).toBeCloseTo(10, 10)
    expect(applyBuffer(10, 0.5)).toBeCloseTo(15, 10)
  })

  it('returns 0 for zero, negative, or non-finite input', () => {
    expect(applyBuffer(0)).toBe(0)
    expect(applyBuffer(-5)).toBe(0)
    expect(applyBuffer(Number.NaN)).toBe(0)
    expect(applyBuffer(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
