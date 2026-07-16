import { useState } from 'react'
import { CATEGORIES, CATEGORY_LABELS_HE, type Category } from '../domain/categories'
import { newId } from '../domain/id'
import { useApp } from '../state/AppContext'
import { CategorySelect, KgInput } from './common'

export function StockView() {
  const { activeHouse, updateActiveHouse } = useApp()
  const [active, setActive] = useState<Category>('groceries')
  if (!activeHouse) return null

  const items = activeHouse.stock.filter((s) => s.category === active)

  const add = () =>
    updateActiveHouse((h) => ({
      ...h,
      stock: [...h.stock, { id: newId('stk'), name: '', category: active, qtyKg: 0 }],
    }))

  return (
    <section>
      <div className="card">
        <h2>מלאי — {activeHouse.name}</h2>
        <p className="muted">מה קיים במחסן כרגע (בק"ג). הטבח מעדכן ידנית. נחסר מרשימת הקניות.</p>

        <div className="tabs">
          {CATEGORIES.map((c) => (
            <button key={c} aria-current={active === c} onClick={() => setActive(c)}>
              {CATEGORY_LABELS_HE[c]}
            </button>
          ))}
        </div>

        <table>
          <thead>
            <tr>
              <th>מרכיב</th>
              <th>קטגוריה</th>
              <th>כמות במלאי</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  אין פריטים בקטגוריה זו.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <input
                    value={item.name}
                    placeholder="שם מרכיב"
                    onChange={(e) =>
                      updateActiveHouse((h) => ({
                        ...h,
                        stock: h.stock.map((s) => (s.id === item.id ? { ...s, name: e.target.value } : s)),
                      }))
                    }
                  />
                </td>
                <td>
                  <CategorySelect
                    value={item.category}
                    onChange={(c) =>
                      updateActiveHouse((h) => ({
                        ...h,
                        stock: h.stock.map((s) => (s.id === item.id ? { ...s, category: c } : s)),
                      }))
                    }
                  />
                </td>
                <td>
                  <KgInput
                    valueKg={item.qtyKg}
                    onChangeKg={(kg) =>
                      updateActiveHouse((h) => ({
                        ...h,
                        stock: h.stock.map((s) => (s.id === item.id ? { ...s, qtyKg: kg } : s)),
                      }))
                    }
                  />
                </td>
                <td>
                  <button
                    className="danger"
                    onClick={() =>
                      updateActiveHouse((h) => ({ ...h, stock: h.stock.filter((s) => s.id !== item.id) }))
                    }
                  >
                    מחק
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button className="ghost" onClick={add}>
          ＋ הוסף פריט ל{CATEGORY_LABELS_HE[active]}
        </button>
      </div>
    </section>
  )
}
