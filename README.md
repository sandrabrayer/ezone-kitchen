# ezone kitchen 🍳

Plan and budget weekly menus for **ezone** care-home kitchens. Each _house_
plans meals across a weekly calendar, tracks headcount and allergies, keeps a
manual stock count, and turns the week's plan into a **net shopping list** and a
**budget estimate vs. actual**.

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

1. **Weekly menu** — per house, 7 days × 3 meals (breakfast / lunch / dinner).
   Each dish is a free-text **name + ingredients** `[{ name, category, qtyKg }]`.
   No recipe bank. One-click **"Copy last week"**.
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

Every non-negotiable calculation lives in one UMD module,
[`lib/kitchen-domain.js`](lib/kitchen-domain.js) — pure functions, no DOM, no
network. The **same file** runs in the browser (`<script src>`) and in the Node
tests (`require`):

```
aggregateWeek()   Σ over (day, meal, dish, ingredient) qtyKgPerPerson × people(day)
applyBuffer()     × 1.20   (the fixed 20% rule — one function, one place)
subtractStock()   max(0, buffered − onHand)   (never negative)
buildShoppingList()  runs all three, then groups by the five categories
estimateCost()    Σ toBuyKg × pricePerKg   (flags ingredients with no price)
```

`people(day) = patients + staff` for that day, after per-day overrides.

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
