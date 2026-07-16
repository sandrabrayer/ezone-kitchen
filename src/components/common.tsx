import { useState } from 'react'
import { CATEGORIES, CATEGORY_LABELS_HE, type Category } from '../domain/categories'
import type { Allergy } from '../domain/types'
import { toKg, type InputUnit } from '../domain/units'

/** Prominent allergy banner (spec: shown on the menu screen). */
export function AllergyBanner({ allergies }: { allergies: Allergy[] }) {
  if (allergies.length === 0) return null
  return (
    <div className="allergy-banner" role="note">
      <span>⚠️ אלרגיות:</span>
      {allergies.map((a) => (
        <span key={a.id} className="pill">
          {a.name} ×{a.count}
        </span>
      ))}
    </div>
  )
}

/** Category dropdown limited to the five fixed categories. */
export function CategorySelect({
  value,
  onChange,
}: {
  value: Category
  onChange: (c: Category) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Category)}>
      {CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_LABELS_HE[c]}
        </option>
      ))}
    </select>
  )
}

/**
 * A weight input that lets the user type kg or grams but always reports a
 * value in kilograms via onChangeKg.
 */
export function KgInput({
  valueKg,
  onChangeKg,
  placeholder,
}: {
  valueKg: number
  onChangeKg: (kg: number) => void
  placeholder?: string
}) {
  const [unit, setUnit] = useState<InputUnit>('kg')
  const shown = unit === 'g' ? Math.round(valueKg * 1000) : valueKg

  return (
    <span className="row" style={{ gap: '0.2rem' }}>
      <input
        type="number"
        min={0}
        step={unit === 'g' ? 10 : 0.01}
        value={Number.isFinite(shown) && shown !== 0 ? shown : ''}
        placeholder={placeholder ?? '0'}
        onChange={(e) => {
          const raw = parseFloat(e.target.value)
          onChangeKg(toKg(Number.isFinite(raw) ? raw : 0, unit))
        }}
        style={{ width: unit === 'g' ? 68 : 62 }}
      />
      <select value={unit} onChange={(e) => setUnit(e.target.value as InputUnit)} aria-label="יחידה">
        <option value="kg">ק"ג</option>
        <option value="g">גרם</option>
      </select>
    </span>
  )
}
