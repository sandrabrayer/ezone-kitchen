'use strict';
/*
 * ezone-kitchen server — a single, open app: ONE URL, NO login for anyone.
 * Opening the root URL shows the app directly (house switcher + every tab).
 *
 *   - fail-closed startup: the backend config (APPS_SCRIPT_URL and
 *     APPS_SCRIPT_SECRET) is required in production. There is NO user auth.
 *   - the ONLY secret is APPS_SCRIPT_SECRET, a server→Apps Script shared secret.
 *     It is NOT a user login: it proves a write came from THIS server, so a
 *     stranger who discovers the /exec URL cannot write to the Sheet directly.
 *     It lives server-side only and is injected when proxying — never sent to
 *     the browser.
 *   - lib/ is NOT statically mounted; only kitchen-domain.js is exposed.
 *
 * The Google Apps Script /exec URL and the shared secret live ONLY in Railway
 * environment variables — never in the repo, never sent to the browser. The
 * browser talks only to this server; this server proxies to Apps Script.
 * Apps Script routes are POST-only, so /api/sheets forwards POST bodies.
 */
const express = require('express');
const path = require('path');

// Sanitise a value coming from an env var. Hosting dashboards (Railway, etc.)
// commonly introduce a trailing newline/space or wrap the value in quotes when
// it is pasted. Trims surrounding whitespace and strips ONE matching pair of
// surrounding quotes.
function cleanEnv(v) {
  let s = String(v == null ? '' : v).trim();
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

const PORT = Number(process.env.PORT) || 3000;
const APPS_SCRIPT_URL = cleanEnv(process.env.APPS_SCRIPT_URL);
// Shared secret proving to Apps Script that a request came from THIS server
// (not from anyone who discovered the /exec URL). Server-side only. This is the
// ONLY secret — there is no user login.
const APPS_SCRIPT_SECRET = cleanEnv(process.env.APPS_SCRIPT_SECRET);

function fatal(msg) {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

// Fail closed in production. Tests require() this module with NODE_ENV=test.
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  if (!APPS_SCRIPT_URL) fatal('APPS_SCRIPT_URL is required');
  if (!APPS_SCRIPT_SECRET) fatal('APPS_SCRIPT_SECRET is required');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// ---- static: public assets only ----
app.use(express.static(path.join(__dirname, 'public')));

// Expose ONLY the client-shared domain module. Anything else under lib/ (should
// it ever be added) must never be reachable over HTTP (no static mount on lib/).
app.get('/lib/kitchen-domain.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'lib', 'kitchen-domain.js'));
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- TEMPORARY: /theme-lab palette playground (dev-only, will be deleted) ----
// Not linked from any menu; noindex. Purely static — no app behaviour changes.
app.get('/theme-lab', (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'theme-lab.html'));
});

// ---- Apps Script proxy (POST-only; the body carries {action, ...}) ----
// No user auth: the app is open. The shared secret is injected server-side so a
// client can never override or supply it — it stays server-only.
app.post('/api/sheets', async (req, res) => {
  if (!APPS_SCRIPT_URL) {
    return res.status(503).json({ error: 'backend_not_configured' });
  }
  const clientBody = req.body || {};
  try {
    // Inject the shared secret AFTER the client body so the client can never
    // override it.
    const payload = Object.assign({}, clientBody, { secret: APPS_SCRIPT_SECRET });
    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow', // Apps Script 302s to script.googleusercontent.com
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.set('Cache-Control', 'no-store');
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.type(ct).send(text);
  } catch (err) {
    console.error('Proxy error:', err && err.message);
    res.status(502).json({ error: 'upstream_error', message: String((err && err.message) || err) });
  }
});

// ---- 404 for unknown /api routes (before SPA fallback) ----
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// ---- SPA fallback ----
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ezone-kitchen listening on 0.0.0.0:${PORT}`);
  });
}

module.exports = { app };
