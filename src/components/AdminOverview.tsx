import { actualSpendForWeek, estimateCost, summariseBudget } from '../domain/budget'
import { buildShoppingList } from '../domain/shoppingList'
import { emptyWeekMenu } from '../domain/weeks'
import { useApp } from '../state/AppContext'
import { formatCurrency } from '../lib/format'

export function AdminOverview() {
  const { state, currentWeekOf, setActiveHouse } = useApp()

  const rows = state.houses.map((house) => {
    const week = house.weeks[currentWeekOf] ?? emptyWeekMenu(currentWeekOf)
    const list = buildShoppingList(week, house.headcount, house.stock)
    const estimate = estimateCost(list.lines, house.prices)
    const actual = actualSpendForWeek(house.spendLog, currentWeekOf)
    const summary = summariseBudget(house.weeklyBudget, estimate.estimatedTotal, actual)
    const people = house.headcount.basePatients + house.headcount.baseStaff
    return { house, summary, people }
  })

  const totals = rows.reduce(
    (acc, r) => ({
      budget: acc.budget + r.summary.weeklyBudget,
      estimated: acc.estimated + r.summary.estimated,
      actual: acc.actual + r.summary.actual,
    }),
    { budget: 0, estimated: 0, actual: 0 },
  )

  return (
    <section>
      <div className="card">
        <h2>מבט מנהל — כל הבתים</h2>
        <p className="muted">שבוע {currentWeekOf}</p>
        <table>
          <thead>
            <tr>
              <th>בית</th>
              <th>סועדים (בסיס)</th>
              <th>תקציב</th>
              <th>הערכה</th>
              <th>בפועל</th>
              <th>מול תקציב</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ house, summary, people }) => (
              <tr key={house.id}>
                <td>
                  <strong>{house.name}</strong>
                </td>
                <td className="num">{people}</td>
                <td className="num">{formatCurrency(summary.weeklyBudget)}</td>
                <td className="num muted">{formatCurrency(summary.estimated)}</td>
                <td className="num">{formatCurrency(summary.actual)}</td>
                <td className={`num ${summary.overBudget ? 'over' : 'under'}`}>
                  {summary.varianceVsBudget > 0 ? '+' : ''}
                  {formatCurrency(summary.varianceVsBudget)}
                </td>
                <td>
                  <button className="ghost" onClick={() => setActiveHouse(house.id)}>
                    פתח
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>סה"כ</strong>
              </td>
              <td></td>
              <td className="num">
                <strong>{formatCurrency(totals.budget)}</strong>
              </td>
              <td className="num">
                <strong>{formatCurrency(totals.estimated)}</strong>
              </td>
              <td className="num">
                <strong>{formatCurrency(totals.actual)}</strong>
              </td>
              <td className={`num ${totals.actual > totals.budget ? 'over' : 'under'}`}>
                <strong>
                  {totals.actual - totals.budget > 0 ? '+' : ''}
                  {formatCurrency(totals.actual - totals.budget)}
                </strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
