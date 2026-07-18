# ezone kitchen 🍳

Plan and budget weekly menus for **ezone** care-home kitchens. Each _house_
plans meals across a weekly calendar, tracks headcount and allergies, keeps a
manual stock count, and turns the week's plan into a **net (inventory-first)
shopping list** and a **monthly budget vs. actual**.

The app is Hebrew-first and right-to-left, matching the people who use it
(kitchen staff and administrators). It is built to the **E-Zone ecosystem
standard**: a vanilla-JS frontend (no build step), a Node/Express static server,
and a **Google Apps Script + Google Sheets** backend — the same shape as
`ezone-managers` / `ezone-staffing`. The app is **open** (no user login).

---

## Architecture

```
Browser (vanilla JS, RTL)
   │  ONE URL, NO login — house switcher + every tab, open to everyone
   ▼
Node / Express server  (server.js)   ← hosted on Railway
   │  • serves the static frontend + the shared domain module
   │  • /api/sheets proxies POSTs to Apps Script (no user auth)
   │  • injects a server-only shared secret so only THIS server can write
   ▼
Google Apps Script  (apps-script/Code.gs, POST-only)
   ▼
Google Sheet — one tab per entity
```

The Apps Script `/exec` URL and the shared secret live **only in Railway
environment variables** — never in the repo, never sent to the browser. The
browser talks only to this server; the server talks to Apps Script. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Data is **shared across users and devices** (one person updates stock on a
phone; another sees every house on a laptop) because the source of truth is the
Google Sheet, not the browser.

---

## Access model

**One app, one URL, no login for anyone.** Opening the app shows it directly: a
house switcher across the five houses and **every tab open to every visitor** —
menu, headcount, allergies, stock, shopping list, budget, and the all-houses
view. Nothing is behind a login.

The **only** secret is `APPS_SCRIPT_SECRET`, a server→Apps Script shared secret
injected when proxying. It is **not a user login**: it just proves a write came
from this server, so a stranger who discovers the `/exec` URL cannot write to the
Sheet directly.

---

## Features

1. **Occupancy (תפוסה)** — the first tab: manual base patients + staff, with a
   **live "base total"** (patients + staff) and optional **per-day overrides**
   for guests / trips. Occupancy is informational (it does **not** scale menu
   quantities — see below).
2. **Weekly menu** — per house, 7 days × 3 meals (breakfast / lunch / dinner).
   Meals are **collapsible** (accordion) with a dish-name summary line, so a
   day card stays compact. Each dish is a **name + ingredients**
   `[{ name, category, qty, unit }]`, where `qty` is the **total for the dish**
   (not per diner). Ingredient rows are **name | qty | unit | delete** — the name
   is a **catalog combobox** (see below) and the category comes from the catalog.
   One-click **"Copy last week"**.
3. **Shared item catalog** — a global list of `{ name, unit, category, min }`,
   **pre-seeded** with a full default item list per category (89 items) and
   default **par levels (מלאי מינימום)** sized for a 25-person house, plus any
   names discovered in stock + menus. **Every** name field is a searchable
   **dropdown that still accepts free text**; new names are auto-added. In מלאי,
   each category's **"הוסף פריט"** combobox lists that category's seeded items and
   **pre-fills the par level** when one is added (editable — seeds are defaults,
   not locked). The seed lives in the shared domain module, so it needs no
   backend redeploy.
4. **Five fixed ingredient categories** everywhere (מכולת / ירקות / פירות / בשר /
   יבשים) and a fixed **unit** list ק"ג / גרם / יחידות / ליטר / מ"ל. Math converts
   within a family (kg↔g, l↔ml); mass, volume and count never mix.
5. **Allergies** — per house, a list with counts (e.g. `גלוטן ×2`), shown on the
   menu and printed on the shopping list. Informational only.
6. **Stock (מלאי)** — per house, what's on hand per item (with its unit) and a
   **minimum-stock (par) level**; items **below minimum are highlighted red**.
   A **"ספירת מלאי"** count mode edits every quantity in one dated pass and saves
   a **snapshot** (restorable); the header shows the last count date.
7. **Weekly plan (צפי שבועי)** — every item needed across the week vs current
   stock, with the shortfall to buy (`פריט | נדרש | מינימום | במלאי | חסר`).
   Filter **whole week / from today** with a "days remaining" indicator; "חסר"
   reflects both the menu need and the top-up to minimum.
8. **Inventory-first shopping list** — projection only: for each item buy the
   **larger** of the menu shortfall (`week totals +20% − stock`) and the **top-up
   to its minimum** (never the sum), matched by **name + unit family**. Grouped by
   the five categories. **Printable** and **WhatsApp export**.
9. **Serve a day (בוצע)** — marking a day served deducts that day's dish totals
   (**no** buffer) from the pantry. **Idempotent**: a day is deducted only once.
10. **Budget (תקציב)** — a **monthly** budget kept **per month** (entered manually
    with thousands separators), an **approved overrun (חריגה מאושרת)** with a note,
    and tiles **תקציב / חריגה מאושרת / בפועל / מול תקציב** in ₪ where
    `מול תקציב = (budget + approved overrun) − actual`. Plus an **admin view across
    all houses**. No pricing/estimates.

Out of scope for v1 (by design): a full recipe bank, suppliers, kosher tagging
(all menus are kosher), dashboard sync, and any per-ingredient pricing.

---

## The shopping-list math (single source of truth)

Every non-negotiable calculation lives in one UMD module,
[`lib/kitchen-domain.js`](lib/kitchen-domain.js) — pure functions, no DOM, no
network. The **same file** runs in the browser (`<script src>`) and in the Node
tests (`require`):

```
aggregateWeek(week, days?)   Σ ingredient TOTALS over the days (default: whole week)
applyBuffer()                × 1.20   (the fixed 20% rule — one function, one place)
subtractStock()              max(0, need − onHand)   (never negative)
buildShoppingList(week, stock, bufferRate?, days?)
                             per item: max(menu shortfall, top-up to minimum); group by 5 cats
isBelowMin(item)             is a pantry item under its minimum (par) level?
dayConsumption(week, day)    a single day's dish totals (NO buffer)
applyConsumption()           deducts served quantities from the pantry (the "בוצע" action)
makeStockCount / stockFromCount   dated pantry snapshot ⇄ restore
mergeCatalog / catalogLookup      shared item catalog (dedup by name)
summariseBudget(budget, actual, overrun)   → תקציב / חריגה מאושרת / בפועל / מול תקציב
parseMoney / groupThousands  budget entry with thousands separators, stored numeric
```

Menu quantities are **dish totals**, so headcount does not scale them —
`aggregateWeek` takes no headcount. The weekly-plan "from today" filter passes a
`days` subset to the same `aggregateWeek`/`buildShoppingList` (no duplicated
aggregation).

Quantities are carried in each unit family's **base unit** (kg / l / count);
`convertUnit()` handles kg↔g and l↔ml. Headcount is occupancy only and does not
enter these formulas: `baseTotal()` = patients + staff, and `effectiveForDay()`
reports per-day occupancy (after overrides) for display.

The shopping list is a **pure projection** — it never mutates stock. Stock is
only reduced when a day is explicitly marked served, and that deduction is
**idempotent** (guarded by a per-day marker), so it can't run twice.

---

## Getting started (local)

Requires **Node ≥ 18**.

```bash
npm install
cp .env.example .env      # fill in APPS_SCRIPT_URL, APPS_SCRIPT_SECRET
npm test                  # domain math + server proxy
npm start                 # http://localhost:3000
```

Without a configured `.env` the server fails closed (it refuses to start
without its backend config) — that is intentional. For the backend, follow
[`docs/APPS-SCRIPT-SETUP.md`](docs/APPS-SCRIPT-SETUP.md) to create the Sheet and
deploy the Apps Script, then set the two variables.

### Environment variables

| Variable             | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `APPS_SCRIPT_URL`    | The Apps Script Web App `/exec` URL. Server-side only.         |
| `APPS_SCRIPT_SECRET` | Shared secret matching the Apps Script `SHARED_SECRET` prop. Server→Apps Script only — **not** a user login. |

There are no auth/login env vars — the app is open.

---

## Project structure

```
ezone-kitchen/
├── server.js               # Express: static + /api/sheets proxy (no user auth)
├── Procfile, railway.json  # Railway deploy config
├── .env.example            # required env vars (no real values)
├── lib/
│   └── kitchen-domain.js   # ⭐ shared pure domain logic (browser + tests)
├── public/                 # the vanilla frontend (no build step)
│   ├── index.html          # RTL shell (no login — open app)
│   ├── styles.css
│   ├── favicon.svg
│   └── app.js              # views, state, API client, debounced saves
├── apps-script/
│   └── Code.gs             # Google Apps Script backend (POST-only)
├── test/                   # node --test: buffer, aggregate, stock, budget, server
└── docs/                   # ARCHITECTURE, DATA-MODEL, DEPLOYMENT, APPS-SCRIPT-SETUP
```

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, auth, and data flow.
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — the Sheet tabs and the entities.
- [`docs/APPS-SCRIPT-SETUP.md`](docs/APPS-SCRIPT-SETUP.md) — step-by-step backend
  setup and the **redeploy-the-existing-deployment** rule.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Railway hosting + branch mapping.
- [`CHANGELOG.md`](CHANGELOG.md) — kept up to date per commit.
