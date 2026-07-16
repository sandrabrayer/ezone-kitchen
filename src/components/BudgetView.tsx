import { useMemo, useState } from 'react'
import { CATEGORY_LABELS_HE } from '../domain/categories'
import { actualSpendForWeek, estimateCost, summariseBudget } from '../domain/budget'
import { newId } from '../domain/id'
import { buildShoppingList } from '../domain/shoppingList'
import type { PriceEntry } from '../domain/types'
import { emptyWeekMenu, toISODate } from '../domain/weeks'
import { useApp } from '../state/AppContext'
import { formatCurrency } from '../lib/format'

export function BudgetView() {
  const { activeHouse, currentWeekOf, updateActiveHouse } = useApp()
  const [spendAmount, setSpendAmount] = useState('')
  const [spendNote, setSpendNote] = useState('')

  const computed = useMemo(() => {
    if (!activeHouse) return null
    const week = activeHouse.weeks[currentWeekOf] ?? emptyWeekMenu(currentWeekOf)
    const list = buildShoppingList(week, activeHouse.headcount, activeHouse.stock)
    const estimate = estimateCost(list.lines, activeHouse.prices)
    const actual = actualSpendForWeek(activeHouse.spendLog, currentWeekOf)
    const summary = summariseBudget(activeHouse.weeklyBudget, estimate.estimatedTotal, actual)
    return { estimate, summary }
  }, [activeHouse, currentWeekOf])

  if (!activeHouse || !computed) return null
  const { estimate, summary } = computed

  const weekSpend = activeHouse.spendLog.filter((s) => s.weekOf === currentWeekOf)

  const addSpend = () => {
    const amount = parseFloat(spendAmount)
    if (!Number.isFinite(amount) || amount <= 0) return
    updateActiveHouse((h) => ({
      ...h,
      spendLog: [
        ...h.spendLog,
        { id: newId('spend'), weekOf: currentWeekOf, amount, note: spendNote.trim() || undefined, date: toISODate(new Date()) },
      ],
    }))
    setSpendAmount('')
    setSpendNote('')
  }

  const upsertPrice = (entry: PriceEntry) =>
    updateActiveHouse((h) => {
      const idx = h.prices.findIndex(
        (p) => p.name.trim().toLowerCase() === entry.name.trim().toLowerCase() && p.category === entry.category,
      )
      const prices = [...h.prices]
      if (idx >= 0) prices[idx] = entry
      else prices.push(entry)
      return { ...h, prices }
    })

  return (
    <section>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ marginBottom: 0 }}>תקציב — {activeHouse.name}</h2>
          <label className="muted">
            תקציב שבועי:{' '}
            <input
              type="number"
              min={0}
              value={activeHouse.weeklyBudget || ''}
              onChange={(e) =>
                updateActiveHouse((h) => ({ ...h, weeklyBudget: Math.max(0, parseFloat(e.target.value) || 0) }))
              }
              style={{ width: 110 }}
            />
          </label>
        </div>
        <p className="muted">שבוע {currentWeekOf}</p>

        <div className="stat-grid">
          <div className="stat">
            <div className="label">תקציב</div>
            <div className="value num">{formatCurrency(summary.weeklyBudget)}</div>
          </div>
          <div className="stat">
            <div className="label">הערכה (מהתפריט)</div>
            <div className="value num">{formatCurrency(summary.estimated)}</div>
          </div>
          <div className="stat">
            <div className="label">בפועל</div>
            <div className="value num">{formatCurrency(summary.actual)}</div>
          </div>
          <div className="stat">
            <div className="label">מול תקציב</div>
            <div className={`value num ${summary.overBudget ? 'over' : 'under'}`}>
              {summary.varianceVsBudget > 0 ? '+' : ''}
              {formatCurrency(summary.varianceVsBudget)}
            </div>
          </div>
        </div>
        {estimate.missingPrices.length > 0 && (
          <p className="muted" style={{ marginTop: '0.6rem' }}>
            ⚠️ חסרים מחירים ל: {[...new Set(estimate.missingPrices)].join(', ')}
          </p>
        )}
      </div>

      <div className="card">
        <h3>רישום הוצאה בפועל</h3>
        <div className="row">
          <input
            type="number"
            min={0}
            placeholder="סכום ₪"
            value={spendAmount}
            onChange={(e) => setSpendAmount(e.target.value)}
            style={{ width: 120 }}
          />
          <input placeholder="הערה (לא חובה)" value={spendNote} onChange={(e) => setSpendNote(e.target.value)} />
          <button className="primary" onClick={addSpend}>
            הוסף
          </button>
        </div>
        {weekSpend.length > 0 && (
          <table style={{ marginTop: '0.6rem' }}>
            <thead>
              <tr>
                <th>תאריך</th>
                <th>סכום</th>
                <th>הערה</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {weekSpend.map((s) => (
                <tr key={s.id}>
                  <td className="muted">{s.date}</td>
                  <td className="num">{formatCurrency(s.amount)}</td>
                  <td>{s.note ?? ''}</td>
                  <td>
                    <button
                      className="danger"
                      onClick={() =>
                        updateActiveHouse((h) => ({ ...h, spendLog: h.spendLog.filter((x) => x.id !== s.id) }))
                      }
                    >
                      מחק
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>מחירים (₪ לק"ג)</h3>
        <p className="muted">משמש לחישוב ההערכה. מוצג תאריך עדכון אחרון.</p>
        <table>
          <thead>
            <tr>
              <th>מרכיב</th>
              <th>קטגוריה</th>
              <th>₪ / ק"ג</th>
              <th>עודכן</th>
            </tr>
          </thead>
          <tbody>
            {activeHouse.prices.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  אין מחירים. הוסיפו מחיר למרכיב שמופיע בתפריט.
                </td>
              </tr>
            )}
            {activeHouse.prices.map((p) => (
              <tr key={`${p.category}-${p.name}`}>
                <td>{p.name}</td>
                <td>{CATEGORY_LABELS_HE[p.category]}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={p.pricePerKg}
                    onChange={(e) =>
                      upsertPrice({ ...p, pricePerKg: Math.max(0, parseFloat(e.target.value) || 0), updatedAt: toISODate(new Date()) })
                    }
                    style={{ width: 90 }}
                  />
                </td>
                <td className="muted">{p.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddPriceRow onAdd={upsertPrice} />
      </div>
    </section>
  )
}

function AddPriceRow({ onAdd }: { onAdd: (entry: PriceEntry) => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')

  return (
    <div className="row" style={{ marginTop: '0.6rem' }}>
      <input placeholder="שם מרכיב" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        type="number"
        min={0}
        placeholder={'₪ לק"ג'}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        style={{ width: 100 }}
      />
      <button
        className="ghost"
        onClick={() => {
          const value = parseFloat(price)
          if (!name.trim() || !Number.isFinite(value)) return
          onAdd({ name: name.trim(), category: 'groceries', pricePerKg: value, updatedAt: toISODate(new Date()) })
          setName('')
          setPrice('')
        }}
      >
        ＋ הוסף מחיר
      </button>
    </div>
  )
}
