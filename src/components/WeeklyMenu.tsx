import { useEffect } from 'react'
import { newId } from '../domain/id'
import type { Category } from '../domain/categories'
import { effectiveForDay } from '../domain/headcount'
import type { DayKey, House, Meal, WeekMenu } from '../domain/types'
import { DAY_LABELS_HE, DAYS, MEAL_LABELS_HE, MEALS } from '../domain/types'
import { shiftWeek } from '../domain/weeks'
import { useApp } from '../state/AppContext'
import { AllergyBanner, CategorySelect, KgInput } from './common'

export function WeeklyMenu() {
  const { activeHouse, currentWeekOf, shiftCurrentWeek, ensureWeek, updateActiveHouse, copyLastWeek } =
    useApp()

  // Make sure the current week exists for this house.
  useEffect(() => {
    ensureWeek(currentWeekOf)
  }, [ensureWeek, currentWeekOf, activeHouse?.id])

  if (!activeHouse) return null
  const week = activeHouse.weeks[currentWeekOf]

  const hasLastWeek = Boolean(activeHouse.weeks[shiftWeek(currentWeekOf, -1)])

  function mutateWeek(fn: (w: WeekMenu) => WeekMenu) {
    updateActiveHouse((h: House) => {
      const current = h.weeks[currentWeekOf]
      if (!current) return h
      return { ...h, weeks: { ...h.weeks, [currentWeekOf]: fn(current) } }
    })
  }

  function updateMeal(day: DayKey, meal: Meal, fn: (dishes: WeekMenu['days'][DayKey][Meal]) => WeekMenu['days'][DayKey][Meal]) {
    mutateWeek((w) => ({
      ...w,
      days: { ...w.days, [day]: { ...w.days[day], [meal]: fn(w.days[day][meal]) } },
    }))
  }

  const addDish = (day: DayKey, meal: Meal) =>
    updateMeal(day, meal, (dishes) => [...dishes, { id: newId('dish'), name: '', ingredients: [] }])

  return (
    <section>
      <AllergyBanner allergies={activeHouse.allergies} />

      <div className="card row no-print" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <button onClick={() => shiftCurrentWeek(-1)}>← שבוע קודם</button>
          <strong>שבוע {currentWeekOf}</strong>
          <button onClick={() => shiftCurrentWeek(1)}>שבוע הבא →</button>
        </div>
        <button
          className="primary"
          disabled={!hasLastWeek}
          title={hasLastWeek ? 'העתק את תפריט השבוע הקודם' : 'אין תפריט לשבוע הקודם'}
          onClick={copyLastWeek}
        >
          ⧉ העתק שבוע קודם
        </button>
      </div>

      {!week ? (
        <div className="card">טוען…</div>
      ) : (
        <div className="week-grid">
          {DAYS.map((day) => {
            const people = effectiveForDay(activeHouse.headcount, day as DayKey).total
            return (
              <div className="day-col" key={day}>
                <div className="day-head">
                  <span>{DAY_LABELS_HE[day as DayKey]}</span>
                  <span className="pill" title="סועדים ביום זה">
                    👥 {people}
                  </span>
                </div>
                {MEALS.map((meal) => (
                  <div className="meal-block" key={meal}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="meal-label">{MEAL_LABELS_HE[meal as Meal]}</span>
                      <button className="ghost" onClick={() => addDish(day as DayKey, meal as Meal)}>
                        ＋ מנה
                      </button>
                    </div>
                    {week.days[day as DayKey][meal as Meal].map((dish) => (
                      <DishCard
                        key={dish.id}
                        dish={dish}
                        onChangeName={(name) =>
                          updateMeal(day as DayKey, meal as Meal, (ds) =>
                            ds.map((d) => (d.id === dish.id ? { ...d, name } : d)),
                          )
                        }
                        onRemove={() =>
                          updateMeal(day as DayKey, meal as Meal, (ds) => ds.filter((d) => d.id !== dish.id))
                        }
                        onAddIng={() =>
                          updateMeal(day as DayKey, meal as Meal, (ds) =>
                            ds.map((d) =>
                              d.id === dish.id
                                ? {
                                    ...d,
                                    ingredients: [
                                      ...d.ingredients,
                                      { id: newId('ing'), name: '', category: 'groceries', qtyKgPerPerson: 0 },
                                    ],
                                  }
                                : d,
                            ),
                          )
                        }
                        onChangeIng={(ingId, patch) =>
                          updateMeal(day as DayKey, meal as Meal, (ds) =>
                            ds.map((d) =>
                              d.id === dish.id
                                ? {
                                    ...d,
                                    ingredients: d.ingredients.map((i) =>
                                      i.id === ingId ? { ...i, ...patch } : i,
                                    ),
                                  }
                                : d,
                            ),
                          )
                        }
                        onRemoveIng={(ingId) =>
                          updateMeal(day as DayKey, meal as Meal, (ds) =>
                            ds.map((d) =>
                              d.id === dish.id
                                ? { ...d, ingredients: d.ingredients.filter((i) => i.id !== ingId) }
                                : d,
                            ),
                          )
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

interface DishCardProps {
  dish: { id: string; name: string; ingredients: Array<{ id: string; name: string; category: Category; qtyKgPerPerson: number }> }
  onChangeName: (name: string) => void
  onRemove: () => void
  onAddIng: () => void
  onChangeIng: (ingId: string, patch: Partial<{ name: string; category: Category; qtyKgPerPerson: number }>) => void
  onRemoveIng: (ingId: string) => void
}

function DishCard({ dish, onChangeName, onRemove, onAddIng, onChangeIng, onRemoveIng }: DishCardProps) {
  return (
    <div className="dish">
      <div className="dish-title">
        <input
          value={dish.name}
          placeholder="שם המנה"
          onChange={(e) => onChangeName(e.target.value)}
        />
        <button className="danger" title="מחק מנה" onClick={onRemove}>
          ✕
        </button>
      </div>

      {dish.ingredients.map((ing) => (
        <div className="ing" key={ing.id}>
          <input
            value={ing.name}
            placeholder="מרכיב"
            onChange={(e) => onChangeIng(ing.id, { name: e.target.value })}
          />
          <CategorySelect value={ing.category} onChange={(c) => onChangeIng(ing.id, { category: c })} />
          <KgInput
            valueKg={ing.qtyKgPerPerson}
            onChangeKg={(kg) => onChangeIng(ing.id, { qtyKgPerPerson: kg })}
          />
          <span className="muted" style={{ fontSize: '0.72rem' }}>
            לסועד
          </span>
          <button className="danger" title="מחק מרכיב" onClick={() => onRemoveIng(ing.id)}>
            ✕
          </button>
        </div>
      ))}

      <button className="ghost" style={{ fontSize: '0.8rem' }} onClick={onAddIng}>
        ＋ מרכיב
      </button>
    </div>
  )
}
