# Changelog

All notable changes to ezone-kitchen are documented here. This project keeps a
changelog entry per commit, per the project non-negotiables. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); the project is
pre-release so versions are `0.x`.

## [Unreleased]

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
