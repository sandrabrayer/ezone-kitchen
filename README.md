# ezone kitchen 🍳

Plan and budget weekly menus for **ezone** care-home kitchens. Each _house_
plans meals across a weekly calendar, tracks headcount and allergies, keeps a
manual stock count, and turns the week's plan into a **net shopping list** and a
**budget estimate vs. actual**.

The app is Hebrew-first and right-to-left, matching the people who use it
(kitchen staff and administrators).

> **v1 scope:** front-end only, data persists in the browser (localStorage).
> The storage layer is abstracted so a shared backend/database can be added
> later **without any schema changes** — see
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Features

1. **Weekly menu** — per house, 7 days × 3 meals (breakfast / lunch / dinner).
   Each dish is just a free-text **name + ingredients** `[{ name, category,
   qty }]`. No recipe bank. One-click **"Copy last week"**.
2. **Five fixed ingredient categories** everywhere (menu, stock, shopping):
   groceries (מכולת), vegetables (ירקות), fruits (פירות), meat (בשר),
   dry ingredients (יבשים).
3. **Kilograms only** — you may type grams, they are stored as kg. No
   free-text units.
4. **Headcount** — manual per house: base patients + staff, editable anytime,
   with optional **per-day overrides** for guests / trips.
5. **Allergies** — per house, a list with counts (e.g. `גלוטן ×2`). Shown
   prominently on the menu screen and printed on the shopping list.
   Informational only in v1 (no enforcement).
6. **Stock** — per house, what's on hand per ingredient (kg), grouped by the
   five categories. The cook updates it manually.
7. **Shopping list** — the core calculation:
   `sum(week's ingredients × headcount)` → **+20% buffer** → **− current
   stock** → net to buy (never negative). Grouped by the five categories.
   **Printable** and **WhatsApp export**.
8. **Budget** — weekly budget per house, log actual spend, **estimate vs.
   actual** from price-per-kg (with last-updated date), plus an **admin view
   across all houses**.

Out of scope for v1 (by design): recipe bank, suppliers, kosher tagging
(all menus are kosher), dashboard sync.

---

## The shopping-list math (single source of truth)

The whole pipeline lives in `src/domain/` as small pure functions, each unit
tested:

```
aggregateWeek()   Σ over (day, meal, dish, ingredient) of qtyKgPerPerson × people(day)
applyBuffer()     × 1.20   (the fixed 20% rule — one function, one place)
subtractStock()   max(0, buffered − onHand)   (never negative)
buildShoppingList()  runs all three, then groups by the five categories
estimateCost()    Σ toBuyKg × pricePerKg   (flags ingredients with no price)
```

`people(day) = patients + staff` for that day, after per-day overrides.

---

## Getting started

Requires **Node ≥ 20**.

```bash
npm install      # install dependencies
npm run dev      # start Vite dev server (http://localhost:5173)
npm test         # run the domain unit tests
npm run typecheck
npm run build    # type-check + build to dist/
npm start        # serve the built dist/ (production, honours $PORT)
```

The app seeds two example houses on first run so the screens are non-empty.
Clear it by removing the `ezone-kitchen:v1` key from browser localStorage.

---

## Project structure

```
ezone-kitchen/
├── index.html              # Vite entry
├── server.mjs              # zero-dependency static server for production (Railway)
├── railway.json            # Railway build/deploy config
├── src/
│   ├── main.tsx            # React entry, mounts <AppProvider>
│   ├── App.tsx             # app shell + tab navigation
│   ├── index.css           # RTL, Hebrew-first styling
│   ├── domain/             # ⭐ pure, framework-free business logic (unit tested)
│   │   ├── categories.ts   #    the five fixed categories
│   │   ├── types.ts        #    the whole data model
│   │   ├── units.ts        #    grams → kg normalisation
│   │   ├── buffer.ts       #    applyBuffer() — the 20% rule
│   │   ├── headcount.ts    #    per-day effective headcount
│   │   ├── aggregate.ts    #    aggregateWeek()
│   │   ├── shoppingList.ts #    buildShoppingList() + subtractStock()
│   │   ├── budget.ts       #    estimateCost() / actual / summary
│   │   ├── menuOps.ts      #    "copy last week"
│   │   ├── weeks.ts        #    week/date helpers
│   │   └── __tests__/      #    vitest specs (buffer, aggregate, stock, budget…)
│   ├── storage/            # StorageAdapter interface + LocalStorageAdapter
│   ├── state/              # AppContext (React store) + seed data
│   ├── lib/                # currency / kg formatting, WhatsApp + print export
│   └── components/         # UI: WeeklyMenu, HeadcountView, StockView,
│                           #     ShoppingListView, BudgetView, AdminOverview…
└── docs/                   # ARCHITECTURE, DATA-MODEL, DEPLOYMENT
```

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layering and the
  storage-swap path to a backend.
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — every entity and how the
  calculations use them.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Railway setup and the
  **open questions** about branch/environment mapping (pending
  `EZONE-ECOSYSTEM-STATUS.md`).
- [`CHANGELOG.md`](CHANGELOG.md) — kept up to date per commit.
