# Changelog

All notable changes to ezone-kitchen are documented here. This project keeps a
changelog entry per commit, per the project non-negotiables. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); the project is
pre-release so versions are `0.x`.

## [Unreleased]

### Fixed — slow updates that looked broken: overview ₪0 + daily-occupancy lag (optimistic UI)

Two "did it even work?" moments on slow Apps Script round-trips, fixed with an
optimistic-UI pattern: **the UI updates from local state instantly and never
shows ₪0 as a stand-in for "loading."**

**A. "כל הבתים" overview no longer flashes ₪0.00.**
- **Loading ≠ zero.** A new `loadingState()` (spinner + "טוען…" + skeleton lines)
  renders until the initial load resolves (`state.dataLoaded`), and the overview
  shows per-row **skeletons** while it has nothing real yet — never a zeroed table.
- **Optimistic + refreshable.** The overview renders from a **local compute**
  (`KD.houseMonthRaw` over already-loaded state) the moment data exists — real
  numbers, instantly, reflecting this session's edits. A new **↻ רענן** button and
  **auto-refresh on tab entry / month change** pull fresh figures from a light
  **batched `loadOverview` endpoint** (`apps-script/Code.gs`) that reads only the
  four small tabs it needs (houses / monthlyBudgets / purchases / headcount) — far
  cheaper than the full `load`. A stale-token guard drops out-of-order responses;
  on failure it **falls back to the local compute** rather than blanking.
- **No stale-over-fresh.** A house with a pending (debounced) save keeps its
  **optimistic local row** on refresh (`hasPendingSave`), so a just-edited number
  never briefly reverts to the server's old value.
- **Month-key consistency.** A single shared `KD.normMonth()` normaliser is used by
  the overview, the תקציב tab and the backend endpoint, and `houseMonthRaw`
  tolerates a stored budget key that isn't exactly normalised — the fix for a
  subtle key mismatch silently showing ₪0. `actualSpendForMonth` normalises its
  month arg too.

**B. Daily overrides (חריגות יומיות) reflect instantly.**
- Typing a day's מטופלים/צוות now repaints that row's **סה"כ אפקטיבי immediately**
  from a local compute (`updateOverrideRow` → `KD.effectiveForDay`), with the
  debounced background save + focus retention from the previous change. No reload,
  no waiting on the network for the number to move.

- **Apps Script**: adds one **new read action** `loadOverview` — a **redeploy is
  required**, handled by **clasp CI on merge** (the workflow fires on merges that
  touch `apps-script/**`; the `/exec` URL is unchanged).
- **Security**: the batched-endpoint response is **sanitised at the trust boundary**
  (every numeric field coerced; `name`/`id` stay `esc()`-escaped on render), so a
  bad backend value can neither poison the math nor render as markup;
  `houseMonthRaw` skips prototype-polluting budget keys; the overview endpoint is a
  read behind the same server-injected shared secret. The optimistic DOM updates
  render numeric/`esc()`-escaped content only.
- **Tests**: `test/overview.test.js` — `normMonth` (Date / YYYY-MM / full ISO /
  junk), overview↔budget key agreement, `houseMonthRaw` shape + month-key
  tolerance + 0-not-undefined + proto-key safety, and `summariseBudget` over the row
  (real over-budget, not a zero stand-in). `test/frontend-shape.test.js` — the
  optimistic overview wiring (batched fetch + local fallback, skeletons, boot
  loading state, refresh button, auto-refresh) and the instant daily-override
  repaint. Browser smoke: the overview shows real ₪ for a seeded month (never
  ₪0.00), stays real through a refresh (מרענן… indicator), and a daily override
  paints סה"כ אפקטיבי instantly.

### Fixed — תפוסה edits now update dependent views live (no page reload)

**Symptom:** after editing the תפוסה base inputs (מטופלים בסיס / אנשי צוות בסיס),
the daily-override effective totals on the same tab did not refresh until a full
page reload; only the "סה"כ בסיס" figure and the meal-occupancy line updated live.

**Root cause:** the base-input handlers did a targeted `updateBaseTotal` (to keep
the field focused while typing) but never re-rendered the rest of the תפוסה tab.
Dependent tabs (כמויות בסיס / צפי / קניות) already render from current state when
switched to — the factor/par math is pure with no load-time cache — so those were
correct on switch; the gap was purely the in-tab daily table.

**Fix:** new `scheduleHeadcountRerender()` — a **debounced (~300ms)** full
re-render of the תפוסה tab, wired to every base + daily-override input
(`baseP`/`baseS`/`ovP`/`ovS`). The read-only meal-occupancy line still updates
**immediately** on each keystroke (`updateBaseTotal`); the debounced pass refreshes
the daily effective totals and placeholders once typing pauses, then **restores
focus + caret** to the edited field so typing is uninterrupted. It only fires
while the user stays on תפוסה (switching tabs already re-renders from state). No
module-level caches exist to invalidate (audited).

- **Security**: the focus-restore selector is built only from app-controlled
  `data-act`/`data-day`/`data-id` (day keys + generated UUIDs), never free text;
  no new `innerHTML`/eval surface.
- **Tests**: `test/meal-model.test.js` regression — a headcount change immediately
  yields new `effectivePeople` + scaled pars with no cache drift (pure-function
  guarantee). `test/frontend-shape.test.js` — the debounced re-render is wired to
  all four inputs, debounced ~300ms, and restores focus. Browser smoke asserts the
  meal line updates live on edit, the daily effective total re-renders to the new
  value while still on תפוסה, and a dependent tab (baseline) reflects the new
  headcount on switch — all without a reload.

### Changed — reduced-occupancy weekend window (Friday morning → Sunday morning)

Clarification to the weekend factor: fewer people are in the house for the whole
window from **Friday morning until Sunday morning**, so the **‎-25%** now applies
to **every** Friday meal (בוקר/צהריים/ערב) **and every** Saturday meal
(בוקר/צהריים/ערב) — not only the planned weekend meals. Sunday breakfast onward is
back to the full count.

- `weekFactor` is rebuilt from an explicit per-`(day, meal)` model
  (`mealFactor`): a cooked meal counts 1.0, a self-serve evening 0.5 × (evening/
  full), and **Friday + Saturday multiply every meal by 0.75**. Friday dinner is a
  planned/cooked meal, so it now counts as a **full meal reduced 25%** (not a
  self-serve evening); Saturday's self-serve evening combines **both** its 0.5
  weight **and** the 0.75 weekend rate. Averaged over all 21 meal slots, the
  effective factor rises slightly (e.g. 20+5 → ~0.7752 vs ~0.7552), so pars,
  baseline, צפי and shopping projections recompute accordingly.
- **תפריט**: the diner reference next to each Friday/Saturday meal header now shows
  the **reduced** count — `Math.round(0.75 × the meal's normal count)` — via the new
  `mealDiners(hc, day, meal)`; weekdays are unchanged. Self-serve classification and
  the reduced counts both come from the domain (`isSelfServeMeal`, `mealDiners`).
- **כמויות בסיס** header text: "מחושב לפי X סועדים אפקטיביים (ערבים עצמאיים,
  **שישי בבוקר עד ראשון בבוקר** ‎-25%)". Same wording in the WhatsApp share.
- New pure domain helpers/exports: `WEEKEND_DAYS`, `isWeekendDay`,
  `isSelfServeMeal`, `mealDiners`, `mealFactor`.
- **Tests**: `test/meal-model.test.js` — `weekFactor` covers all Fri+Sat meals with
  Sun–Thu full; `mealFactor` per-meal (Sunday full, Fri/Sat all meals ‎-25%, Sat
  evening = 0.5 × 0.75); `mealDiners` reduced weekend references (Fri breakfast &
  Fri cooked dinner = round(0.75×full), Sat self-serve dinner = round(0.75×evening));
  effectivePeople/par expectations updated for the new factor. Browser smoke checks
  Sunday breakfast = full, Friday breakfast & dinner = round(0.75×full).

### Changed — realistic prices, meal model, weekend factor, par rescale & baking allocation

A single pass rebasing the kitchen's quantity/cost math on how the houses
actually eat. All of it lives in the shared domain module (`lib/kitchen-domain.js`)
and the frontend (`public/app.js`); the Apps Script backend stores raw data only,
so **no Apps Script redeploy is needed** (clasp CI has nothing to build for this
change — `apps-script/**` is untouched).

**1. Seed price corrections (verified vs market, July 2026).** `SEED_CATALOG`:
חזה עוף 32→**38**, שניצל 35→**45**, בשר טחון 55→**60** ₪/ק"ג. The combined
`עוף שלם/פרגיות` meat item is **split** into two priced items — `עוף שלם` 22 and
`פרגיות` 40 ₪/ק"ג. Migration: an existing stock row or par/price override stored
under the old combined name folds onto **עוף שלם** (`NAME_ALIASES` +
`correctStock` for stock; new `migrateParOverrideKeys` for overrides, run on load
and persisted once). A cook's **saved price override is never overwritten** — seed
prices are only defaults; `effectivePrice` still prefers the override.

**2. Meal model (cooked vs self-serve).** Cooked/planned meals run at the full
count (מטופלים + כל הצוות): בוקר + צהריים ראשון–שישי, ארוחת ערב שישי, צהריים שבת.
Self-serve evenings (ערב ראשון–חמישי + ערב שבת) run at **מטופלים + 2 מדריכים** and
eat from the base pantry. New pure helpers: `mealHeadcount` (`{full, evening}`),
`EVENING_STAFF` (2). The **תפריט** tab now collapses every ערב slot except Friday
to a "ערב עצמאי — מכוסה ממלאי הבסיס" note (Friday dinner and Saturday lunch stay
planned), and every meal header shows a diner **reference** ("בוקר: X סועדים" /
"ערב: Y סועדים", Y = patients+2) that never changes the cook's quantities. The
**תפוסה** tab keeps both base inputs and adds a read-only
"בוקר/צהריים: X | ערב עצמאי: Y" line (live on edit).

**3. Effective weekly factor (automatic math only).** A self-serve evening is
weighted **0.5** of a cooked meal; Friday + Saturday quantities are reduced **25%**.
`dailyFactor(hc)` = (2×full + 0.5×evening) / (3×full) as a fraction of the full
count; `weekFactor(hc)` = (5×dailyFactor + 2×dailyFactor×0.75) / 7;
`effectivePeople(hc)` = weekFactor × baseTotal — the diner-equivalent every weekly
quantity scales by. The **כמויות בסיס** header now reads "מחושב לפי X סועדים
אפקטיביים (ערבים עצמאיים, שישי-שבת ‎-25%)".

**4. מלאי מינימום rescale.** Effective par = `seedMin × (weekFactor × baseTotal ÷
25)`, with the same per-unit rounding (יחידות whole, ק"ג/ליטר 0.5, גרם/מ"ל 50).
Every people-scaled read — `effectiveCatalogStock`, `withEffectiveMins`,
`effectiveParFor`, `baselineForHouse` — now takes `effectivePeople(hc)` instead of
the raw head count, so קניות / צפי / השלמה and the count-screen "מינימום: X"
recompute live on a תפוסה change. Manual par overrides are still absolute and
never rescaled. Evening-staple seed pars (לחם, גבינות, ביצים, ירקות, ממרחים) are
bumped **+20%** so self-serve evenings are covered.

**5. Baking allocation.** Baking-staple seed pars (קמח, סוכר, ביצים, שוקולד ציפים,
אבקת אפייה, שמרים, קקאו, וניל) are bumped **+25%**. The baseline surfaces a
separate estimated **"אפייה"** line = the incremental cost of that bump
(bumpedCost × 0.25/1.25 over default rows). (ביצים takes both bumps,
multiplicatively.)

**6. Budget baseline.** The baseline uses the corrected prices × rescaled pars
(incl. the baking bump). Its summary now shows four figures —
**סה"כ מזון: ₪X | אפייה: ₪A | חד"פ (15%): ₪Y | סה"כ תקציב מומלץ: ₪Z**
(`budgetRecommendation`, `DISPOSABLES_RATE` 0.15; A is a breakdown inside X,
Z = X + Y). **«אמץ כתקציב»** now copies **Z** (food + חד"פ) into the monthly
budget, and the תקציב tab's "בסיס מחושב" shows Z.

- **Security**: `migrateParOverrideKeys` drops `__proto__`/`constructor`/`prototype`
  keys (prototype-pollution safe); the new baseline-summary and תפוסה live updates
  render numeric-only content, and all menu interpolation stays `esc()`-escaped.
- **Tests** (`node --test`, 208 pass): `test/meal-model.test.js` — meal counts
  (evening = patients+2), dailyFactor/weekFactor/effectivePeople, par rescale +
  rounding + override precedence, the +20%/+25% seed bumps, baseline food/baking/
  disposables/recommended lines, and a saved price override surviving the seed
  correction. `test/corrections.test.js` — the עוף שלם/פרגיות split migration
  (catalog, stock merge/rename, override-key migration with canonical-wins).
  Existing seed/count/regression tests updated for the new counts (90 seed items,
  9 meat) and bumped pars. Browser smoke (`scripts/smoke-browser.cjs`, 48
  assertions) drives the effective-par rescale, the תפוסה meal line, the self-serve
  menu notes, the four-part baseline summary, and «אמץ כתקציב» copying Z.

### Docs / CI — clasp CI rollout marked COMPLETE (verified 22/07/2026)

- clasp CI rollout marked COMPLETE (verified 22/07/2026). `EZONE-ECOSYSTEM-STATUS.md` updated to the July 22 version — new "Apps Script deployment" section (automatic via GitHub Actions, clasp 3.3.0, hardened; trigger = merge to the deployed branch `main` touching `apps-script/**`; redeploys the EXISTING deployment so the `/exec` URL is unchanged; per-repo secrets `CLASPRC_JSON` + `DEPLOYMENT_ID`; token-refresh = `clasp login` → update `CLASPRC_JSON` in all six repos with the same value), a per-app deployed-branch table verified 22/07/2026, and ezone-kitchen + ezone-coordinators added to the app table. All manual copy-paste redeploy instructions marked OBSOLETE (superseded by clasp CI; emergency fallback only), in the doc and `DEPLOY.md`.
- CI: bumped `actions/checkout` and `actions/setup-node` to **v5** in the Deploy Apps Script workflow, clearing the Node 20 deprecation warning (both v5 run on Node 24; clasp `node-version` pin stays `22`).

### Fixed — min top-up (צפי / קניות) missed catalog items not yet in stock

**Symptom:** in צפי → "השלמה למלאי מינימום" only items that already existed as
stock rows appeared (e.g. ~4); catalog items with a par level but not yet
stocked (implicit qty 0) were missing. The shopping list (קניות) had the same
gap.

**Root cause:** the frontend's `effectiveStock` built the shortfall stock by
mapping over the house's stock array only (`withEffectiveMins(house.stock, …)`),
so a catalog item with no stock row never reached `buildShoppingList` /
`weeklyPlan` for the par top-up.

**Fix:** new pure domain helper **`effectiveCatalogStock(catalog, stock,
baseTotal, overrides)`** builds shortfall rows over the FULL catalog ∪ stock —
every catalog item (quantity from a matching stock row, else **0**) plus any
free-text pantry item, each carrying its EFFECTIVE (scaled/override) par. The
frontend's `effectiveStock` now uses it, so both קניות and צפי top up every
catalog item with a par, treating missing stock as 0. `withEffectiveMins`
(the per-row מלאי min) is unchanged. No Apps Script / schema change.

- **Tests**: `test/plan-topup.test.js` — regression: empty stock + seeded
  catalog → the plan top-up (and קניות) contain **every** item with effective
  min > 0 (89/89); unstocked items surface with `חסר = effective min`; items
  stocked at/above par stay hidden; free-text items preserved; overrides win.
- **Browser smoke**: on an empty-menu week with only a couple of stock items, the
  "השלמה למלאי מינימום" section now lists the full catalog (89 rows) including
  items not in stock (אורז, סוכר).

### Added — reset par/price overrides to the seed default

Cooks can now undo manual par/price overrides:

- **Per-row reset** in «כמויות בסיס»: an **↺ «אפס לברירת מחדל»** icon button on every
  row that has a manual override removes it (qty **and** price) and returns the
  row to the scaled seed default; the row loses its **ידני** highlight. The button
  only appears on manual rows (and toggles live as a cell is edited).
- **Bulk reset**: an **«אפס הכל לברירת מחדל»** button at the top clears every
  par/price override for the house, behind a `confirm()` dialog. Disabled when
  there are no overrides.
- **Stock tab**: a stock row whose minimum is a manual override shows the same
  **↺** reset next to its computed מינימום (clears the min override only, keeping
  any price override).
- Resets are **house-scoped** and persist via the existing `saveParOverrides`
  action — **no Apps Script redeploy needed** (no schema change).
- New pure domain helper **`clearParOverride(overrides, key, field?)`** (removes a
  whole entry, or just `min`/`price`; never mutates the input map). Fixed a CSS
  bug where `button { display: inline-flex }` defeated the `hidden` attribute
  (added `[hidden] { display: none !important }`).
- Tests: `test/reset-overrides.test.js` (reset single, reset field-only, reset
  all → all-default baseline, house-scoped/no-mutation, prototype-pollution
  guard); `frontend-shape` guards; `scripts/smoke-browser.cjs` extended to 40
  assertions (per-row reset → back to scaled default + highlight cleared, stock
  min reset, bulk reset with confirm).

### Added — par levels as the budget baseline: scaling, prices, a prominent tab, qty picker

Par (מלאי מינימום) levels are now the house's monthly **budget baseline**: scaled
to occupancy, priced, and surfaced in their own tab.

**Scaled par levels (domain).** Seed pars are a REFERENCE for 25 people/week
(`KD.BASE_PEOPLE`). A house's effective par = `seedMin × (baseTotal ÷ 25)`,
rounded per unit (`roundParQty`): יחידות → whole, ק"ג/ליטר → 0.5, גרם/מ"ל → 50.
A cook may OVERRIDE any item's par; the override is absolute and **never
rescaled** (`effectivePar`, override wins). All shortfall math (קניות, צפי) now
runs against the effective par via `withEffectiveMins`, and recomputes
automatically when תפוסה changes (it is derived live, not stored).

**Seed market prices (domain).** Every one of the 89 `SEED_CATALOG` items carries
an estimated ₪ unit price in the item's own unit (e.g. גבינה צהובה 45 ₪/ק"ג →
0.045 ₪/gram). Prices flow through `mergeCatalog` / `correctCatalog` (filled from
seed like `min`), are used ONLY for the baseline estimate (no per-purchase price
tracking), and are editable per house.

**New top-level tab «כמויות בסיס».** A prominent monthly-baseline view (not hidden
inside מלאי):
- Header *"הכמות הבסיסית לבית לחודש — קובעת את התקציב"*, sub *"מחושב עבור X אנשים
  (ייחוס: 25)"*.
- Table by category: פריט | יחידה | כמות לשבוע | כמות לחודש (×4) | מחיר משוער |
  עלות חודשית | מקור (ברירת מחדל / ידני).
- Qty + price editable inline; edits save as per-item **overrides** (highlighted
  ידני) via `baselineForHouse`.
- Bottom summary *"סה"כ עלות חודשית משוערת: ₪X"* — the budget baseline. Printable
  and shareable (WhatsApp).

**Budget tab.** Shows *"בסיס מחושב: ₪X"* beside the manual monthly budget with an
**«אמץ כתקציב»** button that copies the baseline into the month's budget.

**Count screen.** Each item shows its effective minimum in muted text
(*"מינימום: 12"*). The מלאי min column is now the **computed** effective par
(read-only; edited in כמויות בסיס), and the below-min highlight follows it.

**Mobile qty picker.** Tapping a quantity field (count + stock) opens a sheet of
common values per unit (יחידות 0–30 then 40…200; ק"ג/ליטר 0–10 step 0.5 then
12…30; גרם 0…5000; מ"ל 0…2000). Free typing is still allowed (`inputmode="decimal"`
+ "הקלד ידנית").

**Backend (`apps-script/Code.gs`) — ⚠️ APPS SCRIPT REDEPLOY REQUIRED.** New
**`parOverrides`** tab (`houseId | overridesJson`) and a **`saveParOverrides`**
action; `load` returns the per-house override map. Seed **prices** need no schema
change (domain-sourced, like par defaults). Because a tab is added, **publish a
NEW VERSION of the EXISTING deployment** (never a new one). See
`docs/APPS-SCRIPT-SETUP.md`.

**Tests / tooling.** `test/baseline.test.js` (rounding, scaling, override
precedence, seed prices, monthly cost, baseline total, effective-par shortfall);
`frontend-shape` guards for the new tab / adopt / picker / effective-par wiring;
`scripts/smoke-browser.cjs` extended to 34 assertions (baseline scaling, override
persistence, adopt-as-budget, count reference, qty picker). Docs:
`docs/DATA-MODEL.md`.

### Fixed — seed catalog corrections (units, typo, duplicate eggs) + migration

Corrected wrong defaults in `SEED_CATALOG` and added an idempotent load-time
migration that heals already-stored data:

- **Units / pars fixed:** גבינה לבנה → **יחידות** (גביעים, min 6); גבינה צהובה →
  **גרם** (min 3000); חמאה → **יחידות** (min 8); שמנת מתוקה / שמנת חמוצה are
  **יחידות** (גביעים). (ביצים stays יחידות 120; עגבניות stays ק״ג in **ירקות**.)
- **Typo / duplicate cleanup:** `בצים` → `ביצים` and `עכבניות` → `עגבניות` are
  now aliases folded into their canonical item. Eggs are **ביצים only**.
- **Audit:** reviewed the full 89-item seed — no other typos or wrong categories
  found (רסק עגבניות / עגבניות משומרות are legitimately separate יבשים items).
- **Migration (`lib/kitchen-domain.js`, applied in `public/app.js` `loadState`):**
  - `correctCatalog(catalog)` — renames aliases, forces the canonical
    unit/category/par for the fixed items, de-duplicates. Because the merge is
    "backend-first-wins", this override is what makes an *already-stored* catalog
    pick up the corrections; the corrected catalog is persisted once (name **or**
    unit/category change now triggers the write) then converges.
  - `correctStock(stock)` — folds an alias-named pantry row into its canonical
    item, **summing quantities** (בצים 30 + ביצים 10 → ביצים 40); a lone בצים row
    is renamed. Migrated houses are persisted so the fix is durable.
  - Tests: `test/corrections.test.js`; `test/seed-catalog.test.js` gains the
    corrected-unit spot checks.
- No Apps Script **redeploy** needed — the Sheet schema is unchanged; corrected
  catalog/stock rows are written via the existing `saveCatalog` / `saveStock`.

### Changed — stock count simplified ("count what you have")

- **Removed the "חדש" badge** from ספירת מלאי — it confused cooks. The count is
  simply: go over every catalog item and record what you have (0 for what you
  don't). Intro reworded accordingly.
- **Saving a count now writes EVERY item into stock, including 0-qty rows**
  (`applyStockCount` no longer drops not-in-stock zeros) — the count is the full
  pantry list, empty items included, so par-based shortfalls surface for all of
  them. Tests updated (`test/stock-count.test.js`).
- **Three-step flow hint** (`ספירת מלאי` → `מלאי מינימום` → `רשימת קניות`, with
  a one-line "מה יש / מה צריך / מה חסר" gloss) shown atop the מלאי, ספירה and
  קניות tabs so the pantry workflow is self-explanatory.

### Changed — צפי (weekly plan) reworked to be self-explanatory

- Title **"צפי שבועי — השוואת תפריט מול מלאי"**; subtitle explains it compares the
  week's required ingredients against current stock.
- Menu table trimmed to the four agreed columns: **פריט | נדרש לשבוע | קיים במלאי
  | חסר** (the raw menu shortfall, no buffer).
- An **empty week** shows a friendly *"עדיין לא הוזן תפריט לשבוע זה"* message
  instead of an empty table.
- Items **not in the menu but below their par** move to a separate
  **"השלמה למלאי מינימום"** section, so cooks see *why* each such item is on the
  shopping list. New pure `weeklyPlan(week, stock, days)` (menu / parTopUp split
  + `menuEmpty`), unit-tested in `test/corrections.test.js`.

### Tooling

- `scripts/smoke-browser.cjs` extended: eggs-merge migration, no-badge count,
  0-qty items kept after a count, unit correction (גבינה צהובה → גרם), and the
  reworked plan tab (title, par section, empty-menu message) — 22 assertions.

### Added — stock count over the full catalog + per-week shopping extras (domain)

New pure, unit-tested functions in `lib/kitchen-domain.js`:

- **`stockCountRows(catalog, stock)`** — the rows a stock count shows: every
  catalog item (seeded + user) grouped by category, PLUS any pantry item whose
  name is not in the catalog, each carrying its unit, default par (מלאי מינימום)
  and CURRENT stock quantity (0 when not stocked yet). Matched to stock by
  normalised name; category-ordered then Hebrew name.
- **`applyStockCount(catalog, stock, values)`** — applies a count. An item
  already in stock is set to its counted qty (INCLUDING 0 — it stays at 0); an
  item not in stock counted `> 0` is ADDED (with the catalog's unit / category /
  default par); an item not in stock left at 0 is omitted. Pure — returns a NEW
  stock array; the result is the full pantry summary.
- **`readShoppingExtra(e)`** — normalises a manual shopping-list item to
  `{ id, name, qty, unit, category }` (negative/unknown values coerced to safe
  defaults; legacy `value` read as `qty`).

- **Tests**: `test/stock-count.test.js` gains full-catalog-listing,
  add-on-count, keep-existing-at-0, free-text-preservation and
  no-input-mutation cases; new `test/shopping-extras.test.js`.

### Changed — cooks' מלאי / ספירת מלאי / קניות UX

**מלאי (stock tab).**

- **Fixed — empty seeded name boxes:** a seeded stock row now always renders its
  name INSIDE the input. Every row's name field is a **category-scoped catalog
  combobox** (`<input list="catCombo_<category>">` — searchable, still accepts
  free text) with its `value` populated, replacing the single global datalist.
- Selecting a catalog item **auto-fills** its unit, category and default
  **מלאי מינימום** (a par level the cook already set is preserved; the row also
  follows the item to its category tab).
- The empty **quantity** box now shows a visible **"0"** placeholder so cooks
  read it as כמות במלאי awaiting a count.
- The bottom **הוסף** row is now **free-text only** for items not in the catalog
  (placeholder “פריט חדש שלא ברשימה…”); adding it still registers the new name in
  the shared catalog (permanent list).

**ספירת מלאי (stock count).**

- The count now lists the **FULL catalog** grouped by category (every seeded +
  user item), each with its unit and a qty input defaulting to the current stock
  qty (0 when not stocked yet), plus any free-text pantry item so nothing is lost.
- Saving writes **all** counted items into stock — an item counted `> 0` that was
  not in stock gets added (with its default par) — and stores the dated snapshot.
  Items left at 0 remain/become 0. The count IS the full pantry summary.

**קניות (shopping list).**

- New **“פריטים נוספים”** section: the cook adds free items (name via catalog
  combobox or free text, quantity, unit) to the current week's list. Items are
  **removable**, **persist per week** (backend), and are included in the printed /
  WhatsApp list. The existing shortfall + par top-up logic is unchanged.

**Backend (`apps-script/Code.gs`) — ⚠️ APPS SCRIPT REDEPLOY REQUIRED.**

- New **`shoppingExtras`** tab (`id | houseId | weekOf | name | qty | unit |
  category`) and a **`saveShoppingExtras`** action (replaces the rows for a
  house+week so removals persist); `load` returns extras grouped per week. Because
  this adds a tab/column, **publish a NEW VERSION of the EXISTING Apps Script
  deployment** (pencil icon — never a new deployment, or the `/exec` URL changes).
  See `docs/APPS-SCRIPT-SETUP.md`.

**Tests / tooling.**

- `test/frontend-shape.test.js` locks in the new stock combobox, the "0"
  placeholder, the free-text add row, the full-catalog count wiring, and the
  shopping-extras wiring (incl. the new `Code.gs` tab + action).
- `scripts/smoke-browser.cjs` — a browser end-to-end smoke test (NOT run by CI;
  needs Chromium) covering the full compare flow from the task's step 7:
  name-in-input, "0" placeholder, min=15 + qty=3 → 12 to buy, menu-beyond-stock
  max logic, count-adds-new-item, extra persists per week across reload.
- Docs: `docs/DATA-MODEL.md` documents the `shoppingExtras` tab and shape.

### Fixed — seeded catalog not appearing (datalists showed only user items)

In production the מלאי add-combobox and the name datalists showed only items the
cook had created — none of the 89 `SEED_CATALOG` defaults appeared, even after the
earlier `saveCatalog` backend error was resolved.

**Root cause:** `loadState` merged the seed catalog **after** a per-house
normalisation loop. Corrupt/partial stored data — e.g. a menu whose meal wasn't
an array, so `dishes.map(...)` threw — aborted that loop **before** the seed
merge ran. `state.catalog` was left at the user-only value assigned earlier, the
load error was swallowed, and the app rendered with only the cook's items. (A
stale `/lib/kitchen-domain.js` lacking `SEED_CATALOG` would fail the same way.)

- **`public/app.js`**:
  - The catalog is seeded **immediately, before** any per-house normalisation, so
    the seed survives even if a house has corrupt data — via a guarded
    `seedList()` (`Array.isArray(KD.SEED_CATALOG) ? … : []`) that also tolerates
    an older domain module without the export.
  - Per-house normalisation moved to `normaliseHouse()`, wrapped in try/catch (one
    bad house can't abort the whole load) and hardened with `Array.isArray`
    guards: every stored week is rebuilt into a complete 7-day × 3-meal structure,
    so a missing day or a non-array meal can't throw.
  - New render-time `ensureCatalogSeeded()` (belt-and-suspenders) guarantees the
    seed is in the in-memory catalog before any datalist/combobox draws, even if
    the load path was interrupted.
  - `renderMenu` tolerates an incomplete week (missing day / non-array meal).
  - Persist still fires only when the catalog **name set** changes vs the backend,
    so the fix self-heals idempotently (no repeat writes).
- **Tests**: `test/seed-regression.test.js` — load with `catalog=[user item]` →
  user item **+ all 89 seed** items, user untouched; a **partial failed-save**
  snapshot (junk/blank rows) still ends fully seeded; idempotent after a
  min-less save round-trip. `test/frontend-shape.test.js` guards the ordering
  (seed merged before the house loop), the `seedList` export guard, the
  render-time ensure, and the non-array-meal guard.
- No backend change; **no Apps Script redeploy needed**.


### Added — pre-seeded item catalog with default par levels (25-person house)

The shared catalog now ships with a full default item list per category, each
with a default **מלאי מינימום** (par level) sized for a 25-person house over 7
days. No Apps Script redeploy is needed — the seed lives in the shared domain
module and merges in on load.

- **`lib/kitchen-domain.js`**: `SEED_CATALOG` — 89 items across the five
  categories (groceries 11, dry 39, vegetables 21, fruits 10, meat 8) with
  `name / unit / category / min`. `seedCatalog(catalog)` merges it in.
  `mergeCatalog` now carries a `min` default and, as its **only** exception to
  first-seen-wins, fills a *missing* (zero) default min from a later entry — so
  seed par levels reach items catalogued before par levels existed, without ever
  clobbering a user's non-zero default. Priority on load: **user catalog > seed
  > names discovered in stock/menus**.
- **`public/app.js`**: `loadState` merges `SEED_CATALOG` into the catalog and
  persists **only when the name set changes** (re-derived mins never trigger a
  re-write, so the seed self-heals idempotently). The **מלאי "הוסף פריט"** control
  is now a **category-scoped combobox** (`catalogAddDatalist`) listing that
  category's seeded items (each hinting its default par level); adding an item
  (`addStockItem`) **pre-fills its unit + default מלאי מינימום** from the catalog
  (both editable). Free text still adds a new item and registers it in the
  catalog. Seeds are defaults — cooks edit/delete/add freely.
- **`public/styles.css`**: `.stock-add` combobox row.
- **Tests**: `test/seed-catalog.test.js` (seed validity + category counts + par
  levels, idempotent merge, **no-overwrite of user edits**, missing-min fill);
  `test/frontend-shape.test.js` guards the seed merge + add-combobox wiring.

### Security

The seed is static in-repo data (no external input). All merged names/units/
categories/mins are re-validated through the existing whitelists (`safeUnit`,
`isCategory`, non-negative min); catalog persistence still drops blank names and
all rendered text stays `esc()`-escaped. No new network surface, no secrets, and
no backend schema change.


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
