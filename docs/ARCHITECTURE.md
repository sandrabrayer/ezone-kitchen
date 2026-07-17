# Architecture

ezone-kitchen follows the **E-Zone ecosystem standard** (same shape as
`ezone-managers` / `ezone-staffing`): vanilla-JS frontend, Node/Express host,
Google Apps Script + Google Sheets backend. **No build step.** The app is
**open** — no user login.

## Data flow

```
Browser (public/)                     Node/Express (server.js)          Google
──────────────────                    ────────────────────────         ────────
POST /api/sheets              ──────▶ (no user auth)
     { action, ... }                   │  inject server-only shared secret
                                       └────────▶ POST Apps Script /exec ──▶ doPost
                                                   (verify SHARED_SECRET)     │
                              ◀──────────────────  JSON  ◀───────────────────  Sheet tabs
```

Key property: the Apps Script `/exec` URL and the shared secret are **server-side
only**. The browser never sees them. This is why data can be shared across
users/devices while the frontend stays a dumb static bundle.

## Layers

```
public/app.js       vanilla views + state + API client + debounced saves
public/index.html   RTL shell (no login — open app)
lib/kitchen-domain.js  pure domain logic — UMD, shared by browser AND tests
server.js           Express: static + /api/sheets proxy (no user auth), fail-closed on backend config
apps-script/Code.gs Sheets CRUD, POST-only, shared-secret gated, LockService
```

The dependency rule: `app.js → kitchen-domain.js`. The domain module depends on
nothing (no DOM, no network), which is what makes the 20% buffer, aggregation,
stock subtraction and budget math trivially testable and identical in both
runtimes.

## Access & the shared secret

**One app, one URL, no login.** Opening the app shows the house switcher and
every tab (menu, headcount, allergies, stock, shopping list, budget, all-houses)
to every visitor. There are no roles, tokens, or login screen, and no auth env
vars.

The **only** secret is `APPS_SCRIPT_SECRET`, a server→Apps Script shared secret
injected by the `/api/sheets` proxy (after the client body, so a client can
never override it). It is **not a user login** — it proves a write came from
this server, so a stranger who discovers the `/exec` URL cannot write to the
Sheet directly. It stays server-side only; the browser never sees it.

`server.js` fails closed on startup if the backend config (`APPS_SCRIPT_URL`,
`APPS_SCRIPT_SECRET`) is missing in production. Only `lib/kitchen-domain.js` is
served from `lib/` (via an explicit route); there is no static mount on `lib/`.

## Persistence & concurrency

The frontend talks to a small persistence API (see `persist.*` in `app.js`),
one **action per entity** so a write only ever touches one tab for one house:
`saveHouse`, `saveHeadcount`, `saveAllergies`, `saveStock`, `savePrices`,
`savePurchases`, `saveMenu`. Saves are **debounced** (700 ms) so rapid typing
coalesces into one request. On the Apps Script side every write is wrapped in
`LockService`, so concurrent cooks/admins can't corrupt a tab. Scoping writes
per (house, entity) keeps last-writer-wins collisions small; finer-grained
row/cell writes are a possible future optimization.

## Frontend rendering

Plain functions render each view to HTML; a delegated `input`/`change`/`click`
handler mutates state and schedules the matching save. Text edits update state
without re-rendering (so focus is never lost); structural changes (add/remove,
tab/week/house switch) re-render the view. All user-supplied strings are
HTML-escaped on the way into the DOM.
