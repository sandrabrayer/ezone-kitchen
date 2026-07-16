/**
 * The five fixed ingredient categories used everywhere in the app
 * (weekly menu, stock tab, and shopping list). This list is intentionally
 * closed — there is no "add category" flow in v1.
 */
export const CATEGORIES = [
  'groceries',
  'vegetables',
  'fruits',
  'meat',
  'dry',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Hebrew labels shown in the UI, keyed by the stable English category id. */
export const CATEGORY_LABELS_HE: Record<Category, string> = {
  groceries: 'מכולת',
  vegetables: 'ירקות',
  fruits: 'פירות',
  meat: 'בשר',
  dry: 'יבשים',
}

/** English labels, handy for docs, exports, and debugging. */
export const CATEGORY_LABELS_EN: Record<Category, string> = {
  groceries: 'Groceries',
  vegetables: 'Vegetables',
  fruits: 'Fruits',
  meat: 'Meat',
  dry: 'Dry ingredients',
}

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value)
}
