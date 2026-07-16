# Data model

The source of truth is a **Google Sheet with one tab per entity**. The Apps
Script (`apps-script/Code.gs`) reads/writes these tabs; `load` assembles them
into the nested `AppState` the frontend uses.

## Sheet tabs

| Tab                | Columns (header row, in order)                      | Notes |
| ------------------ | --------------------------------------------------- | ----- |
| `houses`           | `id`, `name`                                        | One row per house. |
| `budget`           | `houseId`, `weeklyBudget`                           | Weekly target per house. |
| `headcount`        | `houseId`, `basePatients`, `baseStaff`, `overridesJson` | One row per house; overrides stored as JSON. |
| `allergies`        | `id`, `houseId`, `name`, `count`                    | Many rows per house. |
| `stock`            | `id`, `houseId`, `name`, `category`, `qtyKg`        | Many rows per house. Kilograms. |
| `ingredientPrices` | `houseId`, `name`, `category`, `pricePerKg`, `updatedAt` | Price per kg + last-updated date. |
| `menus`            | `houseId`, `weekOf`, `daysJson`                     | One row per (house, week); the week's nested days are JSON. |
| `purchases`        | `id`, `houseId`, `weekOf`, `amount`, `note`, `date` | Actual logged spend. |

Tabs are created automatically with their header row on first write
(`sheet_()` in `Code.gs`). Add columns by **appending** — the code maps by
header name, but keeping existing columns in place avoids surprises.

## Assembled `AppState` (what `load` returns / the client holds)

```
House {
  id, name,
  weeklyBudget,                              // from `budget`
  headcount { basePatients, baseStaff, overrides },  // overrides = { [day]: {patients?, staff?} }
  allergies [ { id, name, count } ],
  stock     [ { id, name, category, qtyKg } ],
  prices    [ { name, category, pricePerKg, updatedAt } ],
  purchases [ { id, weekOf, amount, note, date } ],
  weeks     { [weekOf]: { weekOf, days } }   // days = { [day]: { breakfast:[Dish], lunch:[Dish], dinner:[Dish] } }
}
Dish       { id, name, ingredients: [ Ingredient ] }
Ingredient { id, name, category, qtyKgPerPerson }   // per-person, kilograms
```

`activeHouseId` and `role` are **client-side only** (localStorage) — they are UI
state, not shared data.

## Categories & units

- `Category` is a closed set: `groceries | vegetables | fruits | meat | dry`
  (Hebrew labels מכולת / ירקות / פירות / בשר / יבשים).
- Everything is stored in **kilograms**. The UI accepts grams and converts on
  input (`toKg`). There are no free-text units.

## Merge key

Ingredients / stock / prices are matched on **(category, lower-cased trimmed
name)** — `ingredientKey()` in `lib/kitchen-domain.js`. `"Rice"` and `"rice"` in
the same category merge; the same name in two categories stays separate.

## Calculation flow

```
weeks[weekOf] + headcount
        │  aggregateWeek()   → Σ qtyKgPerPerson × people(day)   (per ingredient)
        ▼
        │  applyBuffer(0.20)      → bufferedKg
        │  subtractStock(stock)   → toBuyKg = max(0, buffered − onHand)
        ▼
ShoppingList (grouped by the 5 categories)
        │  estimateCost(prices)   → Σ toBuyKg × pricePerKg
        ▼
+ actualSpendForWeek(purchases) → summariseBudget()   (estimate vs actual vs budget)
```

## Future dashboard sync

Headcount is `{ basePatients, baseStaff, overrides }`, where `overrides` is a
partial per-day map. A future dashboard sync can populate the base numbers or
per-day overrides through the same fields — no schema change — satisfying the
"design so a dashboard sync can be added later" requirement.
