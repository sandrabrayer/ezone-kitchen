/**
 * The purchasing buffer. When turning the planned menu into a shopping list
 * we deliberately over-buy by a fixed percentage to cover spillage, waste and
 * estimation error.
 *
 * This is intentionally a single, tiny, well-tested function so the buffer
 * rule lives in exactly one place.
 */

/** The fixed v1 buffer: 20%. */
export const BUFFER_RATE = 0.2

/**
 * Apply the purchasing buffer to a quantity.
 *
 * @param qty  a non-negative quantity (kg)
 * @param rate the buffer rate as a fraction (default {@link BUFFER_RATE})
 * @returns the quantity increased by `rate` (e.g. 10 -> 12 at 20%)
 */
export function applyBuffer(qty: number, rate: number = BUFFER_RATE): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0
  return qty * (1 + rate)
}
