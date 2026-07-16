# Architecture

## Layers

```
components/  ─ React UI (RTL, Hebrew). Presentational + local edit state.
state/       ─ AppContext: the single React store; persists via a StorageAdapter.
lib/         ─ formatting + export helpers (currency, kg, WhatsApp, print).
domain/      ─ pure business logic. NO React, NO storage, NO DOM. Unit tested.
storage/     ─ StorageAdapter interface; LocalStorageAdapter is the v1 impl.
```

The dependency rule points inward: `components → state → domain`, and
`state → storage`. **`domain/` depends on nothing** — that is what makes the
calculations trivially testable and portable to a server.

## Why the domain layer is isolated

Every non-negotiable calculation (the 20% buffer, week aggregation, stock
subtraction, budget math) is a small pure function in `src/domain/`. They take
plain data and return plain data. The UI and storage are replaceable around
them. The test suite exercises these functions directly, with no DOM or React.

## Storage abstraction — the path to a backend

The whole app reads and writes state **only** through `StorageAdapter`:

```ts
interface StorageAdapter {
  load(): Promise<AppState | null>
  save(state: AppState): Promise<void>
}
```

v1 ships `LocalStorageAdapter` (browser localStorage). To make data shared
across devices and give "admin view all houses" real teeth, add an
`ApiStorageAdapter` that talks to a REST/DB backend and inject it into
`<AppProvider adapter={...}>`. **No domain type changes are required** — the
`AppState` shape is the contract, and it was designed up front to stay stable
(e.g. headcount overrides are a partial map, allergies/stock/prices are simple
arrays keyed by name+category).

Recommended next step for multi-user:

1. Stand up a small API (Express/Fastify) on the existing `server.mjs` process,
   under an `/api/*` prefix (Railway config stays the same).
2. Move persistence to Postgres; keep the same entity shapes.
3. Add auth + real `cook` / `admin` roles (the `role` field already exists).
4. Swap `LocalStorageAdapter` → `ApiStorageAdapter`.

## Headcount module & future dashboard sync

`Headcount` is `{ basePatients, baseStaff, overrides }` where `overrides` is a
partial per-day map. A future dashboard sync can populate the base numbers or
per-day overrides through the same fields — no schema change — which satisfies
the "design so a dashboard sync can be added later" requirement.

## Rendering & i18n

The UI is right-to-left and Hebrew-first (`dir="rtl"` on `body`). Category and
day/meal labels are keyed by stable English ids with Hebrew display strings, so
a second language can be added by extending the label maps.
