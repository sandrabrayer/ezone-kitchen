# Deployment (Railway)

## What ships today

The app builds to static assets (`dist/`) and is served in production by a
tiny, zero-dependency Node server, [`server.mjs`](../server.mjs):

- serves `dist/` and falls back to `index.html` for client routes (SPA),
- listens on `$PORT` (Railway injects this),
- sets `X-Content-Type-Options: nosniff` and blocks path traversal.

`railway.json` configures the build and start commands:

```json
{
  "build":  { "builder": "NIXPACKS", "buildCommand": "npm ci && npm run build" },
  "deploy": { "startCommand": "npm run start", "restartPolicyType": "ON_FAILURE" }
}
```

### Deploy checklist

1. Create a Railway project and link this repo.
2. Railway auto-detects Node; `npm ci && npm run build` produces `dist/`.
3. `npm run start` runs `server.mjs`, binding `$PORT`.
4. No environment variables are required for v1 (persistence is in-browser).

## ⚠️ Open question — branch / environment mapping

The project's non-negotiables require using the **correct Railway branch per
`EZONE-ECOSYSTEM-STATUS.md`**. That document was **not available** in the
session that scaffolded this app, so the branch↔environment mapping is **not
hard-wired anywhere**. Nothing here guesses it.

**Assumed defaults (please confirm and correct):**

| Environment | Branch                                   | Notes                         |
| ----------- | ---------------------------------------- | ----------------------------- |
| Production  | `main`                                   | Deploy on merge to `main`.    |
| Preview     | `claude/ezone-kitchen-scaffold-65odua`   | This feature branch / its PR. |

To finalise:

1. Add `EZONE-ECOSYSTEM-STATUS.md` to the repo (or share its branch/Railway
   conventions).
2. Point each Railway service/environment at the branch it specifies.
3. Update this table and the `CHANGELOG.md` "open questions" note.

## Future: backend on the same service

When a backend is added (see `docs/ARCHITECTURE.md`), it lives in the same
`server.mjs` process under `/api/*`, and Postgres is attached as a Railway
plugin exposing `DATABASE_URL`. The build/start commands and this deployment
shape do **not** need to change.
