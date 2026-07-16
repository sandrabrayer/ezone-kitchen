import { CATEGORY_LABELS_HE, type Category } from '../domain/categories'
import type { ShoppingList } from '../domain/shoppingList'
import { CATEGORIES } from '../domain/categories'
import type { Allergy } from '../domain/types'

/** Israeli new shekel formatting. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

/** Show a kg value with up to 3 decimals and a unit. */
export function formatKg(kg: number): string {
  const n = Math.round((kg + Number.EPSILON) * 1000) / 1000
  return `${n} ק"ג`
}

function allergyLine(allergies: Allergy[]): string {
  if (allergies.length === 0) return ''
  const parts = allergies.map((a) => `${a.name} ×${a.count}`)
  return `⚠️ אלרגיות: ${parts.join(', ')}`
}

/**
 * Render the shopping list as plain text for WhatsApp / printing. Includes the
 * house name, the week, allergies (per spec), and the net-to-buy amounts
 * grouped by the five categories. Only non-zero rows are listed.
 */
export function shoppingListToText(
  list: ShoppingList,
  opts: { houseName: string; weekOf: string; allergies: Allergy[] },
): string {
  const lines: string[] = []
  lines.push(`🛒 רשימת קניות – ${opts.houseName}`)
  lines.push(`שבוע ${opts.weekOf}`)
  const allergy = allergyLine(opts.allergies)
  if (allergy) lines.push(allergy)
  lines.push('')

  let anything = false
  for (const category of CATEGORIES as readonly Category[]) {
    const rows = list.byCategory[category].filter((r) => r.toBuyKg > 0)
    if (rows.length === 0) continue
    anything = true
    lines.push(`*${CATEGORY_LABELS_HE[category]}*`)
    for (const row of rows) {
      lines.push(`• ${row.name}: ${formatKg(row.toBuyKg)}`)
    }
    lines.push('')
  }
  if (!anything) lines.push('אין מה לקנות – המלאי מכסה את הצרכים 🎉')

  return lines.join('\n').trim()
}

/** Build a wa.me deep link that opens WhatsApp with the list pre-filled. */
export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
