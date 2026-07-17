# Deployment (Railway)

ezone-kitchen is a plain Node/Express app — no build step. Railway runs
`node server.js`; the server serves `public/` and proxies data calls to the
Apps Script backend.

- `Procfile` → `web: node server.js`
- `railway.json` → NIXPACKS, start `node server.js`, health check `GET /healthz`

## Branch mapping (from EZONE-ECOSYSTEM-STATUS.md)

The ecosystem status doc (now available via the `ezone-managers` repo) records
that the mature apps deploy from **`main`**:

| App        | Repo             | Railway deploys branch |
| ---------- | ---------------- | ---------------------- |
| Managers   | ezone-managers   | `main`                 |
| Staffing   | ezone-staffing   | `main`                 |
| Logistics  | …-ezone-logistics| `main`                 |

**Recommendation for kitchen:** deploy from **`main`** to match the mature apps.
This PR targets `main`, so once merged, `main` is the deploy branch.

> ⚠️ Straight from the ecosystem doc: *"Verify the Railway-connected branch in
> the Railway dashboard before any work — it is NOT stored in the repo and has
> been silently switched before."* And: *"always verify PR base = the deployed
> branch."* Confirm in the Railway dashboard that this service is connected to
> `main` before relying on auto-deploy.

## First deploy

1. Create a Railway project and connect it to `sandrabrayer/ezone-kitchen`,
   branch `main`.
2. Set the environment variables (Railway → Variables):

   | Variable             | Value                                              |
   | -------------------- | -------------------------------------------------- |
   | `APPS_SCRIPT_URL`    | the Apps Script `/exec` URL                        |
   | `APPS_SCRIPT_SECRET` | same as the Apps Script `SHARED_SECRET` property (server→Apps Script only, not a user login) |

   The server **fails closed**: it refuses to start if `APPS_SCRIPT_URL` or
   `APPS_SCRIPT_SECRET` is missing. That is intentional. **There is no user
   login** — the app is open: opening the URL shows the house switcher and every
   tab. There are no auth env vars to set.
3. Deploy. Railway health-checks `GET /healthz`.
4. Do the Google side once: [`APPS-SCRIPT-SETUP.md`](APPS-SCRIPT-SETUP.md).

> ⚠️ Also from the ecosystem doc: *"Railway variable changes apply only to
> deployments started after saving."* Redeploy after changing a variable.

## Notes

- Secrets live only in Railway variables — never in the repo (`.env` is
  git-ignored; `.env.example` holds placeholders only).
- The Apps Script `/exec` URL and `APPS_SCRIPT_SECRET` never reach the browser;
  the server injects the secret when proxying.
