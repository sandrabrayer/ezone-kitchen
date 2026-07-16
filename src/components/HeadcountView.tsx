import { newId } from '../domain/id'
import { effectiveForDay } from '../domain/headcount'
import type { DayKey, House } from '../domain/types'
import { DAY_LABELS_HE, DAYS } from '../domain/types'
import { useApp } from '../state/AppContext'

export function HeadcountView() {
  const { activeHouse, updateActiveHouse } = useApp()
  if (!activeHouse) return null
  const hc = activeHouse.headcount

  const setBase = (patch: Partial<Pick<House['headcount'], 'basePatients' | 'baseStaff'>>) =>
    updateActiveHouse((h) => ({ ...h, headcount: { ...h.headcount, ...patch } }))

  const setOverride = (day: DayKey, patch: { patients?: number; staff?: number }) =>
    updateActiveHouse((h) => {
      const overrides = { ...h.headcount.overrides }
      const merged = { ...overrides[day], ...patch }
      // Drop empty override objects so effective falls back to base.
      if (merged.patients === undefined && merged.staff === undefined) {
        delete overrides[day]
      } else {
        overrides[day] = merged
      }
      return { ...h, headcount: { ...h.headcount, overrides } }
    })

  const clearOverride = (day: DayKey) =>
    updateActiveHouse((h) => {
      const overrides = { ...h.headcount.overrides }
      delete overrides[day]
      return { ...h, headcount: { ...h.headcount, overrides } }
    })

  return (
    <section>
      <div className="card">
        <h2>תפוסת בית — {activeHouse.name}</h2>
        <p className="muted">
          מספר בסיס של מטופלים ואנשי צוות. ניתן לעדכן בכל עת ולהגדיר חריגה יומית (אורחים / טיולים).
        </p>
        <div className="row">
          <label>
            מטופלים (בסיס):{' '}
            <input
              type="number"
              min={0}
              value={hc.basePatients || ''}
              onChange={(e) => setBase({ basePatients: Math.max(0, parseInt(e.target.value) || 0) })}
              style={{ width: 80 }}
            />
          </label>
          <label>
            אנשי צוות (בסיס):{' '}
            <input
              type="number"
              min={0}
              value={hc.baseStaff || ''}
              onChange={(e) => setBase({ baseStaff: Math.max(0, parseInt(e.target.value) || 0) })}
              style={{ width: 80 }}
            />
          </label>
          <span className="pill">סה"כ בסיס: {hc.basePatients + hc.baseStaff}</span>
        </div>
      </div>

      <div className="card">
        <h3>חריגות יומיות</h3>
        <p className="muted">השאירו ריק כדי להשתמש בערך הבסיס. מלאו ערך כדי לעקוף ליום מסוים.</p>
        <table>
          <thead>
            <tr>
              <th>יום</th>
              <th>מטופלים</th>
              <th>צוות</th>
              <th>סה"כ אפקטיבי</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => {
              const ov = hc.overrides[day as DayKey] ?? {}
              const eff = effectiveForDay(hc, day as DayKey)
              const hasOverride = ov.patients !== undefined || ov.staff !== undefined
              return (
                <tr key={day}>
                  <td>{DAY_LABELS_HE[day as DayKey]}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      placeholder={String(hc.basePatients)}
                      value={ov.patients ?? ''}
                      onChange={(e) =>
                        setOverride(day as DayKey, {
                          patients: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                      style={{ width: 70 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      placeholder={String(hc.baseStaff)}
                      value={ov.staff ?? ''}
                      onChange={(e) =>
                        setOverride(day as DayKey, {
                          staff: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                      style={{ width: 70 }}
                    />
                  </td>
                  <td className="num">
                    <strong>{eff.total}</strong>
                    {hasOverride && <span className="tag" style={{ marginInlineStart: 6 }}>חריגה</span>}
                  </td>
                  <td>
                    {hasOverride && (
                      <button className="danger" onClick={() => clearOverride(day as DayKey)}>
                        נקה
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AllergiesCard />
    </section>
  )
}

function AllergiesCard() {
  const { activeHouse, updateActiveHouse } = useApp()
  if (!activeHouse) return null

  const add = () =>
    updateActiveHouse((h) => ({
      ...h,
      allergies: [...h.allergies, { id: newId('alg'), name: '', count: 1 }],
    }))

  return (
    <div className="card">
      <h3>אלרגיות</h3>
      <p className="muted">מוצג בראש מסך התפריט ומודפס על רשימת הקניות. אין אכיפה בגרסה זו — מידע בלבד.</p>
      {activeHouse.allergies.length === 0 && <p className="muted">אין אלרגיות מוגדרות.</p>}
      {activeHouse.allergies.map((a) => (
        <div className="row" key={a.id} style={{ marginBottom: '0.4rem' }}>
          <input
            value={a.name}
            placeholder="אלרגיה (למשל גלוטן)"
            onChange={(e) =>
              updateActiveHouse((h) => ({
                ...h,
                allergies: h.allergies.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)),
              }))
            }
          />
          <label className="muted">
            כמות:{' '}
            <input
              type="number"
              min={0}
              value={a.count}
              onChange={(e) =>
                updateActiveHouse((h) => ({
                  ...h,
                  allergies: h.allergies.map((x) =>
                    x.id === a.id ? { ...x, count: Math.max(0, parseInt(e.target.value) || 0) } : x,
                  ),
                }))
              }
              style={{ width: 64 }}
            />
          </label>
          <button
            className="danger"
            onClick={() =>
              updateActiveHouse((h) => ({ ...h, allergies: h.allergies.filter((x) => x.id !== a.id) }))
            }
          >
            מחק
          </button>
        </div>
      ))}
      <button className="ghost" onClick={add}>
        ＋ הוסף אלרגיה
      </button>
    </div>
  )
}
