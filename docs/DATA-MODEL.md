# Data model

The source of truth is a **Google Sheet with one tab per entity**. The Apps
Script (`apps-script/Code.gs`) reads/writes these tabs; `load` assembles them
into the nested `AppState` the frontend uses.

## Sheet tabs

| Tab                | Columns (header row, in order)                      | Notes |
| ------------------ | --------------------------------------------------- | ----- |
| `houses`           | `id`, `name`                                        | One row per house. |
| `budget`           | `houseId`, `monthlyBudget`                          | Legacy single budget; migrated to `monthlyBudgets` on load. |
| `monthlyBudgets`   | `houseId`, `month`, `budget`, `overrun`, `overrunNote` | Per-month budget + approved overrun (חריגה מאושרת). |
| `headcount`        | `houseId`, `basePatients`, `baseStaff`, `overridesJson` | One row per house; overrides stored as JSON. |
| `allergies`        | `id`, `houseId`, `name`, `count`                    | Many rows per house. |
| `stock`            | `id`, `houseId`, `name`, `category`, `qty`, `unit`, `min` | Many rows per house. `qty`/`min` are in `unit`. |
| `catalog`          | `name`, `unit`, `category`                          | **Global** (no houseId) — the shared item catalog. Default par levels (`min`) are **not** stored here; they come from the domain `SEED_CATALOG` and are re-merged on every load. |
| `stockCounts`      | `id`, `houseId`, `date`, `itemsJson`                | A dated pantry snapshot (ספירת מלאי); upserted by (house, date). |
| `menus`            | `houseId`, `weekOf`, `daysJson`                     | One row per (house, week); the week's nested days are JSON. |
| `purchases`        | `id`, `houseId`, `weekOf`, `amount`, `note`, `date` | Actual logged spend (grouped by `date`'s month). |
| `consumption`      | `id`, `houseId`, `weekOf`, `day`, `executedAt`      | A "served" marker per day — makes the stock deduction idempotent. |

Columns are mapped by **position** (`Code.gs` `readRows_`), so in an existing
Sheet the `stock.qty` header cell may still literally read `qtyKg` and
`budget.monthlyBudget` still read `weeklyBudget` — legacy kilogram/weekly values
carry over unchanged. The `stock` tab gained a trailing `min` column (rows without
it read `min = 0`). The old `ingredientPrices` tab is no longer read or written.
**Adding columns/tabs requires an Apps Script redeploy** (new version of the
existing deployment).

Tabs are created automatically with their header row on first write
(`sheet_()` in `Code.gs`). Add columns by **appending** — the code maps by
header name, but keeping existing columns in place avoids surprises.

## Assembled `AppState` (what `load` returns / the client holds)

```
load → {
  houses: [ House ],
  catalog: [ { name, unit, category } ]        // GLOBAL shared item catalog
}
House {
  id, name,
  budgets     { [month]: { budget, overrun, overrunNote } },  // per-month; from `monthlyBudgets`
  monthlyBudget,                             // legacy single budget (migrated on load)
  headcount { basePatients, baseStaff, overrides },  // overrides = { [day]: {patients?, staff?} }
  allergies   [ { id, name, count } ],
  stock       [ { id, name, category, qty, unit, minQty } ],  // minQty = par level
  purchases   [ { id, weekOf, amount, note, date } ],
  consumption [ { id, weekOf, day, executedAt } ],   // served-day markers (idempotency)
  stockCounts [ { id, date, items: [ StockItem ] } ], // dated snapshots
  weeks       { [weekOf]: { weekOf, days } }   // days = { [day]: { breakfast:[Dish], lunch:[Dish], dinner:[Dish] } }
}
Dish       { id, name, ingredients: [ Ingredient ] }
Ingredient { id, name, category, qty, unit }   // qty = TOTAL for the dish, in `unit`
```

`qty` is the total for the dish, **not per diner** — headcount does not scale it.
(Legacy records with `qtyPerPerson` / `qtyKgPerPerson` are read as totals.)

`activeHouseId` is **client-side only** UI state, not shared data. The app is
open (no login/roles).

## Categories & units

- `Category` is a closed set: `groceries | vegetables | fruits | meat | dry`
  (Hebrew labels מכולת / ירקות / פירות / בשר / יבשים).
- `unit` is a closed set with three families: **mass** `kg` (base) · `g`,
  **volume** `l` (base) · `ml`, **count** `unit`. A quantity is stored in the
  unit the user chose; math converts to the family's base unit (`convertUnit`,
  `toBaseValue`). kg↔g and l↔ml convert; families never mix.

## Merge & match keys

- **Aggregation** merges menu ingredients on **(category, name, unit-family)** —
  `"Rice"`/`"rice"` in the same category+family merge; a different category or a
  different family stays separate.
- **Stock deduction** matches on **(name, unit-family)** — `stockMatchKey()` —
  so a pantry item feeds any menu line of the same name (converting kg↔g, l↔ml),
  regardless of category.

## Calculation flow

```
weeks[weekOf]  (headcount is NOT an input — quantities are dish totals)
        │  aggregateWeek(week, days?)  → Σ ingredient TOTALS (base unit)   (per ingredient)
        ▼
        │  applyBuffer(0.20)           → bufferedQty
        │  toBuyQty = max( max(0, buffered − stock),      // menu shortfall
        │                  max(0, minimum − stock) )      // top-up to par level
        ▼
ShoppingList (projection only; UNION of menu items + pantry items with a minimum;
grouped by the 5 categories — never mutates stock)

Weekly plan (צפי שבועי): same aggregateWeek/buildShoppingList, optional `days`
subset for "from today"; row "חסר" = max(raw menu shortfall, top-up to minimum),
no buffer. Pantry items below their minimum are flagged (`isBelowMin`).

Marking a day served ("בוצע"), separately and idempotently:
        dayConsumption(week, day)  → Σ ingredient totals for that day   (NO buffer)
        applyConsumption()         → new stock with served amounts deducted (floored at 0)

Budget (monthly):
        actualSpendForMonth(purchases, YYYY-MM) → summariseBudget(monthlyBudget, actual)
                                                → { budget, actual, remaining, overBudget }
```

## Future dashboard sync

Headcount is `{ basePatients, baseStaff, overrides }`, where `overrides` is a
partial per-day map. A future dashboard sync can populate the base numbers or
per-day overrides through the same fields — no schema change — satisfying the
"design so a dashboard sync can be added later" requirement.
