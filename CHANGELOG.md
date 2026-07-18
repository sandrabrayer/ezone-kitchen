# Changelog

All notable changes to ezone-kitchen are documented here. This project keeps a
changelog entry per commit, per the project non-negotiables. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); the project is
pre-release so versions are `0.x`.

## [Unreleased]

> **Apps Script redeploy required.** This release adds columns/tabs to the Sheet
> backend (`stock.min`, and the new `catalog`, `stockCounts`, `monthlyBudgets`
> tabs). After pulling, **publish a NEW VERSION of the EXISTING Apps Script
> deployment** (pencil icon — never a new deployment, or the `/exec` URL
> changes). New tabs/columns are created automatically on first write.

### Fixed — menu ingredient row cleanup (removed the orphan "מכו…" category box)

- **`public/app.js`**: the menu ingredient row is now **name | qty | unit |
  delete** only. The truncated per-row category `<select>` (`.ing-cat`, which
  showed "מכו…") is gone; an ingredient's category is now derived from the shared
  **catalog** by name (default `groceries`). Removed the `ingCat` handler.
- **`public/styles.css`**: dropped the dead `.ing-cat` rule; the name field moved
  into the `.ing-meta` grid. A static test (`test/frontend-shape.test.js`) guards
  against the orphan box (and the `לסועד` label) ever returning.

### Added — shared item catalog with dropdowns everywhere

- **`lib/kitchen-domain.js`**: `mergeCatalog` (dedup by normalised name,
  first-seen wins, unit/category whitelisted) and `catalogLookup`.
- **`public/app.js`**: a global `catalogNames` datalist backs **every** item /
  ingredient name field (menu + pantry) as a searchable combobox that still
  accepts free text; new names are auto-added on blur and persisted. The catalog
  is seeded/self-healed on load from existing stock items + menu ingredients.
- **`apps-script/Code.gs`**: new **global** `catalog` tab (`name | unit |
  category`) + `saveCatalog` (whole-tab replace); returned by `load`.
- **Tests**: `test/catalog.test.js` (dedup, lookup, whitelist, idempotence).

### Added — stock count mode (ספירת מלאי) with dated snapshots

- **`lib/kitchen-domain.js`**: `makeStockCount(date, stock)` and
  `stockFromCount(count)` (pure snapshot / restore round-trip).
- **`public/app.js`**: a **"ספירת מלאי"** button opens a one-pass count over all
  categories with a **date picker** (default today); **"שמור ספירה"** overwrites
  current stock **and** stores a dated snapshot. The מלאי header shows **"ספירה
  אחרונה: <date>"**, and a history list can **restore** any past count. Shopping
  list & צפי recompute immediately from the new numbers.
- **`apps-script/Code.gs`**: new `stockCounts` tab (`id | houseId | date |
  itemsJson`), upserted by (house, date); `saveStockCount`; returned by `load`.
- **Tests**: `test/stock-count.test.js` (snapshot capture, restore round-trip,
  legacy normalisation, shopping-math equivalence after restore).

### Added — minimum stock (par levels)

- **`lib/kitchen-domain.js`**: `readStockItem` carries a `min` (par) level;
  `isBelowMin`; `buildShoppingList` now buys the **max** of the menu shortfall
  and the top-up to minimum (never the sum), over the **union** of menu items and
  pantry items that have a minimum — so par-only items still surface. Stock/min
  match by name + unit family (kg↔g, l↔ml).
- **`public/app.js`**: a **"מלאי מינימום"** field per pantry item; rows **below
  minimum are highlighted red** (live). The צפי table gains a **מינימום** column
  and its "חסר" reflects the top-up.
- **`apps-script/Code.gs`**: `stock` tab gains a trailing `min` column.
- **Tests**: `test/min-stock.test.js` (below-min flag, max-of-shortfall-and-topup,
  par-only surfacing, cross-unit top-up).

### Fixed / Changed — monthly budget per month + approved overrun (חריגה מאושרת)

- **Fixed** the desync where the input read `20,000` but the tile still showed
  `₪10,000`: editing now **updates the tiles live** (no re-render, keeps focus)
  and persists. Amounts are typed with **thousands separators** (`20,000`) and
  stored numeric.
- **Changed** budget storage to **per month** — each month keeps its own budget;
  a legacy single budget migrates into the current month on load.
- **Added** an **approved-overrun** amount + note near the budget, a **"חריגה
  מאושרת"** tile, and **מול תקציב = (תקציב + חריגה מאושרת) − בפועל**.
- **`lib/kitchen-domain.js`**: `summariseBudget(budget, actual, overrun)` (overrun
  raises the ceiling; default 0 keeps the 2-arg call working); `parseMoney` /
  `groupThousands`.
- **`apps-script/Code.gs`**: new `monthlyBudgets` tab (`houseId | month | budget |
  overrun | overrunNote`) + `saveBudget`; returned by `load` as `budgets`.
- **Tests**: `test/money-budget.test.js` (parse/format round-trip, overrun math,
  back-compat, invalid clamping).

### Security

New inputs are validated at both ends: money is parsed to a non-negative finite
number (`parseMoney`); stock `min`, count quantities, and budget/overrun coerce to
≥0; units and categories are whitelisted in the client (`safeUnit`, `isCategory`)
and in Apps Script (`unit_`, `category_`); catalog/snapshot writes drop blank
names and store item lists as JSON (no formula/HTML injection — all rendered text
stays `esc()`-escaped). Stock-count restore is confirmed before replacing stock.

### Changed — menu quantities are dish TOTALS, not per diner (drop ×people)

Ingredient quantities now mean the **total for the dish**, so headcount no longer
multiplies them anywhere.

- **`lib/kitchen-domain.js`**: `accumulateDays` no longer reads headcount or
  multiplies by `people(day)` — it sums ingredient totals (converted to the
  family base unit). `aggregateWeek(week, days?)` and `dayConsumption(week, day)`
  drop the headcount parameter; `buildShoppingList(week, stock, bufferRate?,
  days?)` drops headcount and gains an optional `days` subset. The ingredient
  field is now `qty` (total); legacy `qtyPerPerson` / `qtyKgPerPerson` are read as
  totals. `cloneDish` emits `qty`.
- **`public/app.js`**: removed the **"לסועד"** (per-diner) label from ingredient
  rows; ingredient state/reads/writes use `qty`; all `buildShoppingList` /
  `dayConsumption` calls drop the headcount argument. Headcount is still shown as
  occupancy but never scales food.
- **Tests**: `test/aggregate.test.js`, `test/shopping-list.test.js`,
  `test/consumption.test.js` updated to totals with explicit **no-people-multiplier**
  assertions.

### Changed — tab order: תפוסה first, then תפריט

- **`public/app.js`**: the tab bar now leads with **תפוסה** (occupancy), then
  **תפריט**, then מלאי / צפי / קניות / תקציב / כל הבתים.

### Added — "צפי שבועי" (weekly plan) view

A short-term planning table: every ingredient needed across the week vs current
stock, with the shortfall to buy.

- **`public/app.js`**: new `plan` tab / `renderPlan` — columns **פריט | נדרש |
  במלאי | חסר (לקנייה)**, aggregated by name + unit family (kg↔g, l↔ml). `חסר =
  max(0, needed − stock)`; shortfall rows highlighted. A **whole-week / from-today**
  filter (`planScope`) and a **"נותרו X ימים"** indicator. It **reuses**
  `buildShoppingList` (passing a `days` subset) — no duplicated aggregation — and
  shows the raw weekly need (no buffer).
- **`public/styles.css`**: shortfall-row highlight; ingredient-row grid updated
  after removing the per-diner label.
- **Tests**: `test/weekly-plan.test.js` (aggregation, from-today filter,
  shortfall clamp, cross-unit match, no-people-multiplier) plus `days`-subset
  cases in `test/aggregate.test.js` / `test/shopping-list.test.js`.

### Fixed — "סה"כ בסיס" (base total) was stuck at 0

The base-occupancy figure on the תפוסה screen never reflected the numbers typed
into מטופלים/צוות — it only updated on a full re-render (e.g. a tab switch).

- **`lib/kitchen-domain.js`**: new pure `baseTotal(hc)` = base patients + base
  staff (clamped, floored, override-independent) — the single source of truth for
  the figure. Exported.
- **`public/app.js`**: the pill renders `baseTotal(hc)` and now updates **live** —
  `updateBaseTotal()` writes the new total into `#baseTotal` on every keystroke
  without a full re-render (so the input keeps focus).
- **Tests**: `test/base-total.test.js` (sum, override-independence, invalid/negative
  → 0, fractional flooring).

### Added — unit dropdown (ק"ג / גרם / יחידות / ליטר / מ"ל) everywhere quantities appear

Replaced the kg-only (kg/g toggle that always stored kg) with a real unit choice
on **menu ingredient rows** and **pantry (מלאי) items**.

- **`lib/kitchen-domain.js`**: a closed `UNITS` set with three families — mass
  (`kg` base · `g`), volume (`l` base · `ml`), count (`unit`). New `UNIT_LABELS_HE`,
  `isUnit`/`safeUnit`, `unitFamily`, `baseUnitOf`, `convertUnit` (within-family
  only; refuses to cross families), `toBaseValue`. Legacy `toKg`/`gramsToKg` kept.
- **Data shape**: ingredients are now `{ …, qtyPerPerson, unit }` and stock items
  `{ …, qty, unit }`. Both readers fall back to the legacy `qtyKgPerPerson` /
  `qtyKg` (kilograms) so existing records keep working.
- **`public/app.js`**: `<select>` of the five units on every ingredient and stock
  row; changing the unit converts the value within a family (kg↔g, l↔ml) and keeps
  the number across families. `fmtQty(qty, unit)` renders the localized unit label.
- **`apps-script/Code.gs`**: `stock` gains a `unit` column; `unit_()` whitelists
  values (unknown → kg). Units flow through `saveStock`/`load`.
- **Tests**: unit conversion + family rules in `test/units.test.js`; unit-aware
  aggregation in `test/aggregate.test.js`.

### Changed — compact, collapsible day view + dish dropdown

Weekly-menu day cards were too long.

- **`public/app.js`**: each meal (בוקר/צהריים/ערב) is a controlled **accordion** —
  collapsed by default with a **dish-name summary line** and a dish count; open
  state is transient UI state so edits don't collapse it. Dish names get a
  **datalist of existing dishes**, and each meal has a **"מנה קיימת…" dropdown**
  that adds a dish cloned from a matching existing one (`findDishTemplate` +
  `KitchenDomain.cloneDish`). `existingDishNames()` gathers distinct names across
  the house's weeks.
- **`public/styles.css`**: accordion header/summary/body, dish picker, and the
  day-head action row.

### Changed — inventory-first logic: shopping list is a projection; deduction is an explicit, idempotent action

Stock is **not** touched on menu save. The shopping list only forecasts the
shortfall; the pantry is reduced only when a day is explicitly marked served.

- **`lib/kitchen-domain.js`**: `buildShoppingList` matches stock by **name + unit
  family** (`stockMatchKey`, converting kg↔g / l↔ml) and outputs the shortfall
  (`toBuyQty = max(0, buffered − matching stock)`) — it never mutates stock. New
  `dayConsumption(week, hc, day)` (actual need for one day, **no** 20% buffer) and
  `applyConsumption(stock, lines)` (pure — deducts served amounts, floored at 0,
  reports shortfalls). `isDayExecuted(markers, weekOf, day)` guards idempotency.
  Output line fields renamed kg→generic: `requiredQty`/`bufferedQty`/`stockQty`/
  `toBuyQty` + `unit`.
- **`public/app.js`**: a **"בוצע"** button per day deducts that day's consumption
  from stock, records a `consumption` marker, and disables (shows "✓ בוצע"). The
  guard + persisted marker make it runnable **once per day** across reloads/devices.
- **`apps-script/Code.gs`**: new `consumption` tab + `saveConsumption` action;
  markers returned by `load`.
- **Tests**: cross-unit deduction, shortfall clamping, and the once-only guard in
  `test/consumption.test.js`; cross-unit shortfall in `test/shopping-list.test.js`.

### Changed — budget is now MONTHLY, in ₪, with pricing removed

- **`lib/kitchen-domain.js`**: removed `estimateCost`/`actualSpendForWeek` and the
  price index. New `monthKey`/`monthOf`/`shiftMonth`/`formatMonthHe`,
  `actualSpendForMonth(purchases, 'YYYY-MM')`, and `summariseBudget(monthlyBudget,
  actual)` → `{ budget, actual, remaining, overBudget }`.
- **`public/app.js`**: the תקציב tab takes a **manual monthly amount** with a
  month selector; shows exactly three tiles — **תקציב / בפועל / מול תקציב** — and
  removes the "הערכה (מהתפריט)" card, the prices card, and all missing-price
  warnings. All money is formatted **₪10,000.00** (`fmtCurrency`, ₪ prefix, 2
  decimals). The all-houses view drops the estimate column and goes monthly.
- **`apps-script/Code.gs`**: `budget` column reused as `monthlyBudget`;
  `savePrices`/`ingredientPrices` removed; `saveHouse` accepts `monthlyBudget`.
- **Tests**: monthly spend + summary in `test/budget.test.js`.

### Security

Inputs are validated at every boundary: units are whitelisted (`safeUnit` in the
client, `unit_()` in Apps Script) so an unexpected unit can never reach the math or
storage; categories are checked with `isCategory`; quantities and budget amounts
are coerced to non-negative finite numbers; all user-entered text stays escaped via
`esc()`; the "בוצע" deduction is confirmed and idempotent so it can't double-spend
stock. No new network surface or secrets.

### Changed — app title renamed איזון · מטבח → איזון · CHEF

Rebranded the app's display title. "CHEF" is Latin inside the RTL header, so the
bidi is handled so it reads **איזון · CHEF** (not CHEF · איזון).

- **`public/index.html`**: the app-bar brand wraps the Latin word in `<bdi>`
  (`איזון · <bdi>CHEF</bdi>`) so it stays isolated LTR in the RTL header; the
  `<title>` and `<meta name="description">` now read `איזון · CHEF` (Hebrew leads,
  so the plain-text title renders right-to-left correctly).
- **PWA manifest**: added `public/manifest.webmanifest` (there wasn't one) with
  `name`/`short_name` `איזון · CHEF`, `"dir": "rtl"`, `"lang": "he"`, the app
  theme/background colors, and the existing favicon; linked from `index.html`.

The English project name (`ezone kitchen` in the README/repo) is unchanged — this
is the in-app Hebrew display title only.

### Changed — final palette applied app-wide; `/theme-lab` removed; house rename

Applied the palette chosen in the theme lab, removed the temporary lab, and
renamed one house.

- **Palette** (`public/styles.css` tokens): warm background `#e2dbcc`; meals
  breakfast `#e2a52b` · lunch `#2be286` · dinner `#3f31d6`; categories groceries
  `#edbb26` · vegetables `#2be277` · fruits `#ed8326` · meat `#d63191` · dry
  `#862be2`; per-house ramot-hashavim `#37cabe` · raanana-asher `#497ead` ·
  caesarea-ofroni `#6e519e` · caesarea-rehab `#ad9949` · pardes `#49ad59`. Filled
  chips, soft shadow. **Red `#dc2626` stays reserved** for over-budget/danger and
  is used for no house/meal/category.
- **Per-house page tint** (`houseColor=page`): the **selected** house colors the
  app bar, its active switcher chip, and a subtle page wash. `app.js`
  (`applyHouseTheme`) computes a WCAG-readable ink and the wash per house; a house
  with no mapped color (e.g. a newly added one) falls back to the brand green.
- **emphasis=meal**: the day-card meal stripe is the dominant accent (6px).
- **Removed** the temporary `/theme-lab` page (`public/theme-lab.html`) and its
  `server.js` route.
- **Renamed** the `caesarea-rehab` display name to **קיסריה ריהאב** (was
  קיסריה שיקום) in `lib/kitchen-domain.js` `SEED_HOUSES`, the `apps-script/Code.gs`
  mirror, and `test/seed-houses.test.js`. **House id `caesarea-rehab` unchanged**
  (the live Sheet value was updated separately).

### Added — TEMPORARY `/theme-lab` palette playground (dev-only, will be deleted)

A throwaway design tool to choose the final palette, shipped so it can be viewed
on the live deploy. **Not linked from any menu** (direct URL only), `noindex`
(meta + `X-Robots-Tag`), with a clear banner "מעבדת עיצוב — זמני, יימחק". No app
behaviour changes — it's a self-contained static page plus one `GET /theme-lab`
route in `server.js`.

- **Mocks** (realistic Hebrew data): a weekly-menu day card (one day, 3 meals,
  dishes + category-colored ingredient chips, headcount + "היום" badge); a
  shopping list with all 5 categories (dots, count badges, checked/unchecked
  rows, quantities); a budget row incl. an over-budget (red) case; and a
  house-color strip showing all 5 houses' chips + header side by side.
- **Live controls** (client-only, no persistence): page background (warm white →
  greys → near-black); ~8 muted→neon swatches each for the 3 meals, 5 shopping
  categories, and 5 houses; scheme toggles (emphasis by meal / category / both,
  and where house color applies: header+chips / whole-page tint / off); element
  toggles (filled vs outlined chips, shadow strength). Red is reserved for
  danger/over-budget and excluded from the swatch rows.
- **Readout** box prints all selected hexes + modes as screenshot-ready text.

The follow-up PR will apply the chosen palette app-wide and **delete `/theme-lab`
in the same PR** (`public/theme-lab.html` + the route).

### Changed — more vivid palette (emerald + warm amber accent)

Refreshed the color system so it reads alive rather than muted, without becoming
loud. Contrast stays WCAG-readable (vivid accents, not vivid text).

- **Richer primary green**: replaced the grayed forest green (`#2f7d5b`) with a
  vivid **emerald** built on the ezone ecosystem green (`ezone-managers` uses
  `#10B981`/`#34D399`), deepened to `#0b8457` so white button text stays ≥4.5:1.
- **Warm secondary accent (amber/gold)** for highlights: the **"היום" badge**
  (gold), the **active tab indicator** (gold bar), the **budget ₪ figures**
  (`#b45309`, ~5:1 on white), and the shopping category **count badges**. The
  budget variance figure keeps its red/green over/under semantic.
- **More saturated, clearly distinct category dots** (groceries gold, vegetables
  green, fruits orange, meat red, dry violet) and meal accent stripes
  (breakfast amber, lunch green, dinner indigo).
- **More depth**: a subtle warm background tint and stronger card shadows
  instead of flat gray-white.

### Changed — mobile-first UI redesign (cooks on phones)

Redesigned the interface for its real use: house cooks on **their phones** in a
kitchen (admin also on desktop). Hebrew RTL throughout. Vanilla CSS only — no
framework, no build step.

- **Big touch targets**: buttons and inputs are ≥48px tall with generous
  spacing; the shopping-list rows and tab targets are larger still.
- **Bottom tab bar on phones**: fixed to the bottom with icon-over-label items
  and an obvious active state (green, top indicator). On desktop it becomes a
  pill row under the house switcher.
- **House switcher** is a horizontal, scrollable chip row (the active house is a
  filled green chip) — replaces the old dropdown.
- **Typography**: 17px base on mobile / 18px on desktop, heavier headings,
  tabular-nums for quantities and ₪ so numbers read at a glance; numeric inputs
  render LTR so `0.12` / `1500` don't reorder in RTL.
- **One accent system** refined around the existing brand green, plus per-meal
  accent stripes (breakfast/lunch/dinner) and per-category color dots
  (groceries/vegetables/fruits/meat/dry) for fast scanning.
- **Weekly menu** stacks day cards vertically on phones (multi-column on
  desktop); **today is highlighted** (ring + "היום" badge). Ingredient editing
  is a touch-friendly two-row layout.
- **Shopping list for in-store use**: category sections with color dots and
  counts, **prominent to-buy quantities**, and **tap-to-check-off** rows
  (transient). A dedicated **print stylesheet** renders it black-on-white with
  check squares and no app chrome.
- **Friendly empty states** (icon + Hebrew hint) instead of blank screens.

Verified in a headless browser at 380px (phone) and desktop widths across menu,
shopping, stock, headcount, budget, and the all-houses view.

### Changed — one open app, no login for anyone (auth removed entirely)

Simplified the access model to its final form: **ONE app, ONE URL, NO login.**
Opening the root URL shows the app directly — a house switcher across the five
houses and **every tab open to every visitor** (menu, headcount, allergies,
stock, shopping list, budget, and the all-houses view). Nothing is behind a
login.

Removed entirely: the `/h/<houseId>` URL model, cook scoping/pinning, `ADMIN_PIN`,
`SESSION_SECRET`, `SESSION_DAYS`, HMAC session tokens, the login screen, and all
auth code and tests.

- **`server.js`**: a single open `POST /api/sheets` proxy — no tokens, no roles,
  no `/api/login`, no `/h/:houseId` route. Startup now requires only
  `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET`. The shared secret stays and is
  still injected server-side (after the client body, so a client can't override
  it): it prevents strangers who find the `/exec` URL from writing to the Sheet
  directly — it is **not** a user login.
- **Deleted `lib/auth.js`** and its tests (`auth`, `server-auth`, `cook-scope`,
  `no-auth-guard`, `login-word-codes`, `login-env-sanitize`). Added
  `test/server.test.js`: the open proxy reaches the upstream with no auth, and
  the server injects `APPS_SCRIPT_SECRET` even when the client tries to supply
  its own.
- **Frontend (`public/`)**: removed the login overlay, tokens, roles, and the
  `/h/<houseId>` boot path. The house switcher (chips) and all tabs — including
  the all-houses view — are always shown. `index.html` no longer has a login
  overlay or role chrome.
- **Docs**: README, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`,
  `docs/APPS-SCRIPT-SETUP.md`, and `.env.example` updated — no auth env vars, the
  shared secret documented as server→Apps Script only.

### Changed — cooks use a house URL (no login); COOK_PINS removed

Cooks no longer log in. Each house has a **dedicated URL** `/h/<houseId>`
(`/h/ramot-hashavim`, `/h/raanana-asher`, `/h/caesarea-ofroni`,
`/h/caesarea-rehab`, `/h/pardes`). Opening a house URL goes straight into that
one house in cook scope — locked to it (no house switcher, no add-house, no
all-houses view). The house is pinned **server-side from the URL path**, the way
the cook session token used to carry it, so a house URL can read and write
**only its own** house's data; no other house is reachable from it. The URL is
the access — there is no cook login and no per-house secret.

The root URL `/` and the admin (all-houses) view stay behind the `ADMIN_PIN`
login exactly as before.

- **`server.js`**: cook API is `POST /h/:houseId/api/sheets` (no token) — the
  path pins the house, `scopeBodyForCook`/`filterLoadForCook` enforce own-house
  reads and writes. `POST /api/sheets` (all houses) now requires an **admin**
  token (`requireAdmin`, `role === 'admin'`); `/api/login` accepts only
  `ADMIN_PIN`. `GET /h/<houseId>` serves the SPA (existing fallback).
- **`COOK_PINS` removed.** The env var, its parser, and cook-code matching are
  gone. Startup stays valid when it is absent (it always was optional); the
  fail-closed checks are unchanged (`APPS_SCRIPT_URL/SECRET`, `ADMIN_PIN`,
  `SESSION_SECRET`).
- **Frontend (`public/app.js`)**: detects `/h/<houseId>` → cook mode with no
  login (house from the path, API calls to `/h/<houseId>/api/sheets`, no token,
  no logout button); the root URL is the admin surface behind the login. The
  admin all-houses view now shows each house's URL instead of a `COOK_PINS`
  mapping hint.
- **Tests**: `cook-scope` and `no-auth-guard` rewritten for the path model —
  an unauthenticated house URL gets **only** its own house's data, another
  house's data is not reachable from it, writes are pinned, and `/api/sheets`
  (admin) is still **401** without a token. `server-auth`, `login-word-codes`,
  and `login-env-sanitize` updated: `ADMIN_PIN` is the only login; cooks no
  longer log in.
- **Docs**: README (access-model section + URL table), `docs/ARCHITECTURE.md`,
  `docs/DEPLOYMENT.md`, `docs/APPS-SCRIPT-SETUP.md`, and `.env.example` updated;
  all `COOK_PINS` references removed.

### Changed — login codes are words (case-insensitive), not digit PINs

Login codes are now **words** matched **case-insensitively** with surrounding
whitespace ignored — for `ADMIN_PIN` and `COOK_PINS` alike, so `ramot`, `RAMOT`,
and `" Ramot "` all match a stored `RAMOT`.

- `lib/auth.js`: replaced the exact-match `checkPin` with `checkCode` (normalise
  = trim + lower-case, then constant-time compare) and `normalizeCode`; server
  login and cook-code matching use it.
- `server.js`: the ADMIN-vs-cook collision guard and a new duplicate-code guard
  compare **normalised** codes, so two codes can't differ only by case/spacing.
- Login input (`public/index.html`) is now a Latin text field
  (`inputmode="text"`, `autocapitalize="none"`, `autocorrect/​spellcheck` off,
  `dir="ltr"`) instead of a numeric PIN pad, so Hebrew-keyboard users type the
  Latin code as stored.
- `.env.example` + docs show word codes. Tests:
  `test/login-word-codes.test.js` (case/whitespace variants for admin + cook)
  and the `checkCode` cases in `test/auth.test.js`.

### Security — regression guard: every /api route rejects unauthenticated read AND write

Added `test/no-auth-guard.test.js` locking in that `/api/sheets` returns **401**
for both reads and writes when no valid session token is present (verified
against a mock upstream that would otherwise serve data, so a bypass can't hide
behind a 502). Confirmed via test and a cold-profile headless browser that the
current server enforces auth server-side and the UI shows the login overlay with
no token — i.e. there is no auth bypass in this codebase. (A production report of
a bypass points to a stale deployment of the pre-auth scaffold; the remediation
is to redeploy the current `main`.)

### Changed — display dates in Israeli DD/MM/YYYY format

Dates showed as raw ISO (e.g. `שבוע 2026-07-12`). Added `KitchenDomain.formatDateHe`
(display-only: ISO `YYYY-MM-DD` → `DD/MM/YYYY`, non-ISO/empty passed through
unchanged) and applied it everywhere a date is shown — week header, shopping-list
subtitle, printed/WhatsApp shopping list, and budget entries (purchase dates and
price "updated" dates). ISO strings remain the internal/storage format and the
week keys; this is formatting at render time only. Tested in
`test/format-date.test.js`.

### Added — seed the five production houses (idempotent, on load)

The backend now seeds the five real houses on first load, so they don't have to
be created by hand. Fixed, human-readable ids with Hebrew display names:
`ramot-hashavim` (רמות השבים), `raanana-asher` (רעננה אשר),
`caesarea-ofroni` (קיסריה עפרוני), `caesarea-rehab` (קיסריה ריהאב),
`pardes` (פרדס).

- **Idempotent**: `apps-script/Code.gs` seeds only when the `houses` tab is empty
  (`seedHousesIfEmpty_` in `loadAll_`), inside the existing `LockService` lock —
  so running twice never duplicates and never clobbers a renamed house. Seeding
  reuses the existing `saveHouse_` code path.
- **Single source of truth**: `KitchenDomain.SEED_HOUSES` + the pure
  `housesToSeed(existing)` helper (`lib/kitchen-domain.js`); Code.gs mirrors the
  list and a test asserts the two never drift.
- **Tests**: `test/seed-houses.test.js` — exact ids/names, idempotency (twice →
  five, never ten), fresh-copy safety, and the Code.gs mirror/guard check.

### Fixed — login always returned 401 (env PIN sanitising)

Production `/api/login` 401'd for the correct `ADMIN_PIN` because the Railway env
var carried surrounding quotes / trailing whitespace, while the browser sends a
trimmed PIN; `checkPin`'s exact byte-compare never matched. Sanitise env values
on startup (`cleanEnv`: trim + strip one matching pair of surrounding quotes),
applied to `ADMIN_PIN`, `SESSION_SECRET`, `APPS_SCRIPT_URL/SECRET`, and the
`COOK_PINS` blob / pin keys / house ids. Repro in
`test/login-env-sanitize.test.js`.

### Added — separate cook and admin PINs (PIN-gated, server-enforced roles)

Replaced the single `APP_PIN` (and the client-side `cook`/`admin` view toggle,
which was not a security boundary) with two role-bearing PINs. The role is now a
signed claim in the session token, decided by the PIN, so a cook cannot
self-promote by editing localStorage.

- **`ADMIN_PIN`** → admin: all houses + the budget admin (all-houses) view.
- **`COOK_PINS`** (JSON map `pin → houseId`) → cook: **own house only** — menu,
  headcount, stock, shopping list, and that house's budget. No house switcher,
  no add-house, no all-houses view.
- **Token** now carries `kitchen:<role>:<houseId>:<exp>` (base64url payload +
  HMAC); `verifyToken` returns `{ role, houseId }`. `lib/auth.js`.
- **Server-side enforcement** in the `/api/sheets` proxy, not just UI: a cook's
  request body is pinned to their `houseId` and their `load` response is filtered
  to that one house, so no other house's data reaches their browser.
- **Frontend**: role/house read from the token (removed the role dropdown and
  `ezk_role`); the admin all-houses view shows each house id for `COOK_PINS`
  mapping. Docs and `.env.example` updated.
- **Tests**: updated `auth`/`server-auth` for the new token & login contract;
  added `test/cook-scope.test.js` (mock upstream) proving cook `load` filtering
  and write house-pinning.

### Changed — 0.2.0: rebuilt to the E-Zone ecosystem standard

The initial 0.1 scaffold (React + Vite + TypeScript, localStorage) was replaced
— in the same PR — to match the existing six-app ecosystem exactly. Reference:
`ezone-managers`.

- **Frontend rewritten in vanilla JS** (HTML/CSS/JS, Hebrew RTL) — **no build
  step**. Served statically from `public/`.
- **Backend is Google Apps Script + Google Sheets** (one tab per entity:
  houses, budget, headcount, allergies, stock, ingredientPrices, menus,
  purchases). POST-only routes; writes serialised with `LockService`. Code in
  `apps-script/Code.gs`; setup in `docs/APPS-SCRIPT-SETUP.md`.
- **Node/Express host with HMAC session auth** (`server.js` + `lib/auth.js`),
  same standard as ezone-managers / ezone-staffing: PIN → `kitchen:`-scoped
  HMAC token, per-IP login rate limit, fail-closed startup, `lib/` not served
  except the shared domain module.
- **Config is never in the repo:** the Apps Script `/exec` URL and all secrets
  live only in Railway env vars; the browser never sees them (the server proxies
  and injects a server-only shared secret).
- **Data is shared across users/devices** (source of truth = the Sheet), which
  the previous localStorage design could not provide.

### Preserved

- **All non-negotiable domain logic** (20% buffer, week aggregation, stock
  subtraction, budget math) ported verbatim to `lib/kitchen-domain.js` as a UMD
  module — the same file runs in the browser and under Node tests.
- **All 26 domain tests** ported to `node --test`, plus **HMAC auth and server
  tests** (46 tests total, all green).

### Features (unchanged from the spec)

Per house: weekly menu (7×3, dish = name + ingredients, "copy last week"); five
fixed categories; kilograms-only (grams accepted); manual headcount with per-day
overrides; allergies with counts (on menu + printed on list); manual stock;
shopping list (× headcount → +20% → − stock, never negative, printable +
WhatsApp); budget (target, actual log, estimate vs actual from price/kg, admin
all-houses view).

### Docs

README, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/DEPLOYMENT.md`, and
`docs/APPS-SCRIPT-SETUP.md` all rewritten to the new architecture.
`EZONE-ECOSYSTEM-STATUS.md` (obtained from the `ezone-managers` repo) confirms
the mature apps deploy from `main`; kitchen follows suit and this PR targets
`main`.

### 0.1.0 (superseded, same PR)

Initial scaffold: React + Vite + TypeScript, Hebrew-first/RTL, localStorage with
a StorageAdapter seam, static server. Replaced by 0.2.0 above.
