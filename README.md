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
   (not per diner); the dish name is free text with a **dropdown of existing
   dishes** (picking one clones its ingredients). One-click **"Copy last week"**.
3. **Five fixed ingredient categories** everywhere (menu, stock, shopping):
   groceries (מכולת), vegetables (ירקות), fruits (פירות), meat (בשר),
   dry ingredients (יבשים).
4. **Units** — every quantity picks a unit from a fixed list: ק"ג / גרם /
   יחידות / ליטר / מ"ל (kg / g / unit / l / ml). Math converts within a family
   (kg↔g, l↔ml); mass, volume and count never mix.
5. **Allergies** — per house, a list with counts (e.g. `גלוטן ×2`). Shown
   prominently on the menu screen and printed on the shopping list.
   Informational only in v1 (no enforcement).
6. **Stock (מלאי)** — per house, what's on hand per ingredient (with its unit),
   grouped by the five categories. The cook updates it manually.
7. **Weekly plan (צפי שבועי)** — every ingredient needed across the week vs
   current stock, with the shortfall to buy (`פריט | נדרש | במלאי | חסר`).
   Aggregated by **name + unit family**; shortfall rows are highlighted. Filter
   **whole week / from today**, with a "days remaining" indicator. Reuses the
   shopping-list aggregation (raw need, no buffer).
8. **Inventory-first shopping list** — projection only: `sum(week's ingredient
   totals)` → **+20% buffer** → **− matching stock** → net to buy (never
   negative), matched by **name + unit family**. Grouped by the five categories.
   **Printable** and **WhatsApp export**.
9. **Serve a day (בוצע)** — marking a day served deducts that day's dish totals
   (**no** buffer) from the pantry. **Idempotent**: a day can be deducted only
   once.
10. **Budget** — a **monthly** budget per house (entered manually), log actual
    spend, and see **תקציב / בפועל / מול תקציב** in ₪, plus an **admin view
    across all houses**. No pricing/estimates.

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
                             aggregate → buffer → deduct matching stock → group by 5 categories
dayConsumption(week, day)    a single day's dish totals (NO buffer)
applyConsumption()           deducts served quantities from the pantry (the "בוצע" action)
summariseBudget()            monthly budget vs actual spend → תקציב / בפועל / מול תקציב
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
