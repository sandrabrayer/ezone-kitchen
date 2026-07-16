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

- `POST /api/login` with the shared `APP_PIN` (timing-safe compare, per-IP rate
  limited) returns a token `"<expiresAtMs>.<hmacSha256Hex>"` over the payload
  `"kitchen:<expiresAtMs>"`, keyed by `SESSION_SECRET`.
- The token is sent as `Authorization: Bearer <token>` on `/api/sheets` and
  verified server-side (`lib/auth.js`).
- The `kitchen:` payload prefix means a token minted by another E-Zone app is
  invalid here (and vice-versa) even if the same secret were reused.
- `lib/auth.js` is **never** statically served; only `lib/kitchen-domain.js` is
  exposed, via an explicit route.
- A second secret, `APPS_SCRIPT_SECRET`, authenticates this server to the Apps
  Script (defence in depth: knowing the `/exec` URL is not enough to write).

### Roles

The `cook` / `admin` toggle is a client-side view convenience in v1 (admins get
the all-houses tab). It is **not** a security boundary — everyone shares one
`APP_PIN`. Real per-role auth (separate PINs or accounts + a role claim in the
token) is the natural next step and fits this structure without data changes.

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
