# Data model

All types live in [`src/domain/types.ts`](../src/domain/types.ts). Everything is
scoped to a **House**. Quantities are stored in **kilograms**.

## Entities

### AppState
```
schemaVersion  number
houses         House[]
activeHouseId  string | null
role           'cook' | 'admin'
```

### House
```
id           string
name         string
headcount    Headcount
allergies    Allergy[]
stock        StockItem[]
weeks        Record<weekOf, WeekMenu>     // weekOf = the week's Sunday, YYYY-MM-DD
weeklyBudget number                       // target, ILS
prices       PriceEntry[]
spendLog     SpendEntry[]
```

### Headcount
```
basePatients number
baseStaff    number
overrides    Partial<Record<DayKey, { patients?: number; staff?: number }>>
```
Effective people for a day = `(override.patients ?? basePatients) +
(override.staff ?? baseStaff)`. An unset override field falls back to base; an
empty override object is dropped. This shape is intentionally stable so a
dashboard sync can fill base or overrides later without migration.

### WeekMenu
```
weekOf string
days   Record<DayKey, Record<Meal, Dish[]>>
```
`DayKey` = sunday…saturday (Israeli week starts Sunday). `Meal` = breakfast |
lunch | dinner. A meal slot holds any number of dishes.

### Dish / Ingredient
```
Dish        { id, name, ingredients: Ingredient[] }
Ingredient  { id, name, category, qtyKgPerPerson }
```
No recipe bank: a dish is a free-text name plus its ingredient lines.
`qtyKgPerPerson` is **per person** — the shopping list multiplies it by the
day's headcount.

### StockItem / PriceEntry / SpendEntry / Allergy
```
StockItem   { id, name, category, qtyKg }
PriceEntry  { name, category, pricePerKg, updatedAt }   // last-updated shown in UI
SpendEntry  { id, weekOf, amount, note?, date }
Allergy     { id, name, count }
```

### Category (fixed, closed set)
`groceries | vegetables | fruits | meat | dry` — Hebrew labels: מכולת, ירקות,
פירות, בשר, יבשים.

## Merge key

Ingredients, stock and prices are matched on **(category, lower-cased trimmed
name)** — see `ingredientKey()` in `aggregate.ts`. So `"Rice"` and `"rice"` in
the same category merge, but the same name in two categories stays separate.

## Calculation flow

```
WeekMenu + Headcount
        │  aggregateWeek()   → Σ qtyKgPerPerson × people(day)   (per ingredient)
        ▼
AggregatedLine[]
        │  applyBuffer(0.20)      → bufferedKg
        │  subtractStock(stock)   → toBuyKg = max(0, buffered − onHand)
        ▼
ShoppingList (grouped by the 5 categories)
        │  estimateCost(prices)   → Σ toBuyKg × pricePerKg
        ▼
BudgetEstimate + actualSpendForWeek() → summariseBudget()
```

## Versioning

`AppState.schemaVersion` (currently `1`) exists so a future migration can be
applied on load in the storage adapter without guessing the shape.
