# Architecture

ezone-kitchen follows the **E-Zone ecosystem standard** (same shape as
`ezone-managers` / `ezone-staffing`): vanilla-JS frontend, Node/Express host
with HMAC session auth, Google Apps Script + Google Sheets backend. **No build
step.**

## Data flow

```
Browser (public/)                     Node/Express (server.js)          Google
──────────────────                    ────────────────────────         ────────
login: POST /api/login {pin}  ──────▶ checkPin (timing-safe)
                              ◀──────  { token }  (HMAC session)
                                       │
data: POST /api/sheets        ──────▶ requireAuth (verify Bearer token)
      { action, ... } + Bearer         │  inject server-only shared secret
                                       └────────▶ POST Apps Script /exec ──▶ doPost
                                                   (verify SHARED_SECRET)     │
                              ◀──────────────────  JSON  ◀───────────────────  Sheet tabs
```

Key property: the Apps Script `/exec` URL and all secrets are **server-side
only**. The browser never sees them; it only ever holds a short-lived HMAC
session token. This is why data can be shared across users/devices while the
frontend stays a dumb static bundle.

## Layers

```
public/app.js       vanilla views + state + API client + debounced saves
public/index.html   RTL shell, login overlay
lib/kitchen-domain.js  pure domain logic — UMD, shared by browser AND tests
lib/auth.js         HMAC session auth — SERVER ONLY, never served over HTTP
server.js           Express: static, /api/login, /api/sheets proxy, fail-closed
apps-script/Code.gs Sheets CRUD, POST-only, shared-secret gated, LockService
```

The dependency rule: `app.js → kitchen-domain.js`. The domain module depends on
nothing (no DOM, no network), which is what makes the 20% buffer, aggregation,
stock subtraction and budget math trivially testable and identical in both
runtimes.

## Auth (HMAC session, ecosystem standard)

- `POST /api/login` with a PIN (timing-safe compare, per-IP rate limited)
  returns a token `"<base64url(payload)>.<hmacSha256Hex>"` over the payload
  `"kitchen:<role>:<houseId>:<expiresAtMs>"`, keyed by `SESSION_SECRET`. The PIN
  decides the role: `ADMIN_PIN` → `admin` (no house); a `COOK_PINS` entry →
  `cook` bound to that entry's house.
- The token is sent as `Authorization: Bearer <token>` on `/api/sheets` and
  verified server-side (`lib/auth.js`), which returns the `{ role, houseId }`
  claims the proxy enforces against.
- The `kitchen:` payload prefix means a token minted by another E-Zone app is
  invalid here (and vice-versa) even if the same secret were reused.
- `lib/auth.js` is **never** statically served; only `lib/kitchen-domain.js` is
  exposed, via an explicit route.
- A second secret, `APPS_SCRIPT_SECRET`, authenticates this server to the Apps
  Script (defence in depth: knowing the `/exec` URL is not enough to write).

### Roles (PIN-gated, server-enforced)

The role is **not** a client toggle — it is a signed claim in the token, decided
by which PIN was entered, so a cook cannot self-promote by editing localStorage:

- **admin** (`ADMIN_PIN`): all houses, plus the budget admin (all-houses) view.
- **cook** (a `COOK_PINS` entry): their **own house only** — menu, headcount,
  stock, shopping list, and that house's budget. No house switcher, no add-house,
  no all-houses view.

`COOK_PINS` is a JSON map of `pin → houseId` (Railway env). Enforcement is
server-side in the `/api/sheets` proxy, not just UI: a cook's request body has
its house reference pinned to the token's `houseId`, and a cook's `load`
response is filtered to that one house — so no other house's data ever reaches
their browser even via a hand-crafted request.

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
