# Changelog

All notable changes to ezone-kitchen are documented here. This project keeps a
changelog entry per commit, per the project non-negotiables. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); the project is
pre-release so versions are `0.x`.

## [Unreleased]

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
`caesarea-ofroni` (קיסריה עפרוני), `caesarea-rehab` (קיסריה שיקום),
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
