# Architecture

ezone-kitchen follows the **E-Zone ecosystem standard** (same shape as
`ezone-managers` / `ezone-staffing`): vanilla-JS frontend, Node/Express host
with HMAC session auth, Google Apps Script + Google Sheets backend. **No build
step.**

## Data flow

```
Browser (public/)                     Node/Express (server.js)          Google
──────────────────                    ────────────────────────         ────────
cook: POST /h/<id>/api/sheets ──────▶ pin house from the URL path (no login)
      { action, ... }                  │
admin login: POST /api/login  ──────▶ checkCode (timing-safe)
                              ◀──────  { token }  (HMAC session)
admin data: POST /api/sheets  ──────▶ requireAdmin (verify Bearer token)
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
public/index.html   RTL shell, admin login overlay
lib/kitchen-domain.js  pure domain logic — UMD, shared by browser AND tests
lib/auth.js         HMAC session auth (admin token) — SERVER ONLY, never served over HTTP
server.js           Express: static, /api/login, /h/<id>/api/sheets (cook) + /api/sheets (admin) proxy, fail-closed
apps-script/Code.gs Sheets CRUD, POST-only, shared-secret gated, LockService
```

The dependency rule: `app.js → kitchen-domain.js`. The domain module depends on
nothing (no DOM, no network), which is what makes the 20% buffer, aggregation,
stock subtraction and budget math trivially testable and identical in both
runtimes.

## Auth & access

Two surfaces, two mechanisms:

### Cooks — the URL is the access (no login)

Each house has a dedicated URL, `/h/<houseId>` (e.g. `/h/ramot-hashavim`).
Opening it goes straight into that one house in **cook scope** — locked to it
(no house switcher, no add-house, no all-houses view). There is no cook login and
no per-house secret: the URL itself is the capability, handed to that house's
cook.

The house is pinned **server-side from the URL path**, the way a cook session
token used to carry it. The cook API is `POST /h/<houseId>/api/sheets` (no
token), and the proxy enforces "own house only":

- a cook's request body has its house reference pinned to the URL's `houseId`
  (`scopeBodyForCook`), so a hand-crafted body naming another house is rewritten
  to their own; and
- a cook's `load` response is filtered to that one house (`filterLoadForCook`),
  failing closed to an empty list on any unexpected shape.

So **no other house's data is reachable from a house URL** — reading or writing.

### Admin — HMAC session (ecosystem standard)

The root URL `/` and the budget admin (all-houses) view stay behind a login.
`POST /api/login` with the **`ADMIN_PIN` word code** (case-insensitive,
whitespace-trimmed, timing-safe compare, per-IP rate limited) returns a token
`"<base64url(payload)>.<hmacSha256Hex>"` over the payload
`"kitchen:admin:<empty houseId>:<expiresAtMs>"`, keyed by `SESSION_SECRET`. The
code is a word (letters), so `ezone`, `EZONE`, and `" Ezone "` all match a stored
`EZONE`.

- The token is sent as `Authorization: Bearer <token>` on the all-houses
  `/api/sheets` endpoint and verified server-side (`lib/auth.js` →
  `requireAdmin`, which requires `role === 'admin'`).
- The `kitchen:` payload prefix means a token minted by another E-Zone app is
  invalid here (and vice-versa) even if the same secret were reused.
- `lib/auth.js` is **never** statically served; only `lib/kitchen-domain.js` is
  exposed, via an explicit route.
- A second secret, `APPS_SCRIPT_SECRET`, authenticates this server to the Apps
  Script (defence in depth: knowing the `/exec` URL is not enough to write).

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
