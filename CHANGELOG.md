# Changelog

All notable changes to ezone-kitchen are documented here. This project keeps a
changelog entry per commit, per the project non-negotiables. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/); the project is
pre-release so versions are `0.x`.

## [Unreleased]

### Added — v1 scaffold

- **Project scaffold**: React + Vite + TypeScript, Hebrew-first / RTL UI.
- **Domain layer** (`src/domain/`) — pure, framework-free, unit-tested:
  - Five fixed ingredient categories (groceries, vegetables, fruits, meat, dry).
  - Kilogram-only units with grams-in / kg-stored normalisation.
  - `applyBuffer()` — the single, tested 20% purchasing-buffer function.
  - `aggregateWeek()` — sums a week's ingredients × per-day headcount.
  - `subtractStock()` / `buildShoppingList()` — net shopping list, never negative,
    grouped by the five categories.
  - `estimateCost()` / `actualSpendForWeek()` / `summariseBudget()` — budget math
    with price-per-kg and estimate-vs-actual, flagging missing prices.
  - Per-day headcount overrides; "copy last week" menu operation.
- **Tests** (`vitest`, 26 tests): the 20% rule, aggregation, stock subtraction,
  and budget math.
- **Storage abstraction**: `StorageAdapter` interface + `LocalStorageAdapter`,
  so a backend can replace persistence with no schema/UI changes.
- **UI**: weekly menu (7×3 with dishes/ingredients + copy-last-week), headcount
  (base + per-day overrides), allergies, stock (category tabs), shopping list
  (printable + WhatsApp export), budget (spend log, prices, estimate vs actual),
  and an admin all-houses overview.
- **Production server**: zero-dependency `server.mjs` static server with SPA
  fallback and path-traversal protection; `railway.json` build/deploy config.
- **Docs**: README, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`,
  `docs/DEPLOYMENT.md`.

### Known open questions

- **Railway branch/environment mapping** is not yet wired because
  `EZONE-ECOSYSTEM-STATUS.md` was not available in this session. Defaults and
  the decision points are documented in `docs/DEPLOYMENT.md` for confirmation.
- **Persistence is per-browser (localStorage)** in v1; "admin view all houses"
  is therefore single-device until the server adapter is added.
