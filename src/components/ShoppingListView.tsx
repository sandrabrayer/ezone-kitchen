import { useMemo } from 'react'
import { CATEGORIES, CATEGORY_LABELS_HE } from '../domain/categories'
import { buildShoppingList } from '../domain/shoppingList'
import { emptyWeekMenu } from '../domain/weeks'
import { useApp } from '../state/AppContext'
import { formatKg, shoppingListToText, whatsappLink } from '../lib/format'
import { AllergyBanner } from './common'

export function ShoppingListView() {
  const { activeHouse, currentWeekOf } = useApp()

  const list = useMemo(() => {
    if (!activeHouse) return null
    const week = activeHouse.weeks[currentWeekOf] ?? emptyWeekMenu(currentWeekOf)
    return buildShoppingList(week, activeHouse.headcount, activeHouse.stock)
  }, [activeHouse, currentWeekOf])

  if (!activeHouse || !list) return null

  const text = shoppingListToText(list, {
    houseName: activeHouse.name,
    weekOf: currentWeekOf,
    allergies: activeHouse.allergies,
  })

  const bufferPct = Math.round(list.bufferRate * 100)

  return (
    <section>
      <AllergyBanner allergies={activeHouse.allergies} />

      <div className="card row no-print" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 0 }}>רשימת קניות</h2>
          <span className="muted">
            שבוע {currentWeekOf} · כולל תוספת {bufferPct}% · בניכוי מלאי קיים
          </span>
        </div>
        <div className="row">
          <a href={whatsappLink(text)} target="_blank" rel="noreferrer">
            <button className="primary">📱 שלח בוואטסאפ</button>
          </a>
          <button onClick={() => window.print()}>🖨️ הדפס</button>
        </div>
      </div>

      {CATEGORIES.map((category) => {
        const rows = list.byCategory[category].filter((r) => r.toBuyKg > 0)
        if (rows.length === 0) return null
        return (
          <div className="card" key={category}>
            <h3>{CATEGORY_LABELS_HE[category]}</h3>
            <table>
              <thead>
                <tr>
                  <th>מרכיב</th>
                  <th>נדרש (+{bufferPct}%)</th>
                  <th>במלאי</th>
                  <th>לקנות</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.category}-${r.name}`}>
                    <td>{r.name}</td>
                    <td className="num muted">{formatKg(r.bufferedKg)}</td>
                    <td className="num muted">{formatKg(r.stockKg)}</td>
                    <td className="num">
                      <strong>{formatKg(r.toBuyKg)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {list.lines.every((l) => l.toBuyKg === 0) && (
        <div className="card">אין מה לקנות — המלאי מכסה את כל הצרכים 🎉</div>
      )}
    </section>
  )
}
