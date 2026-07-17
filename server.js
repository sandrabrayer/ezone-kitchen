'use strict';
/*
 * ezone-kitchen server — auth at the ezone-managers / ezone-staffing standard:
 *   - fail-closed startup (all secrets required in production)
 *   - COOKS DON'T LOG IN. Each house has a dedicated URL /h/<houseId>; opening
 *     it goes straight into that one house in cook scope. The house comes from
 *     the URL PATH — the cook API is POST /h/<houseId>/api/sheets — the way the
 *     cook session token used to carry it. The proxy pins a cook's writes to
 *     that house and filters `load` to that house, so no other house's data is
 *     reachable from a house URL. There is no per-house secret: the URL is the
 *     capability.
 *   - ADMIN_PIN (timing-safe compare, per-IP rate limited) is the ONLY login.
 *     It mints an HMAC-signed admin session token (Bearer) for the root URL /
 *     and the admin all-houses view. POST /api/sheets requires that admin token.
 *   - lib/ is NOT statically mounted; only kitchen-domain.js is exposed
 *
 * The Google Apps Script /exec URL and every secret live ONLY in Railway
 * environment variables — never in the repo, never sent to the browser. The
 * browser talks only to this server; this server proxies to Apps Script.
 * Apps Script routes are POST-only, so the sheets routes forward POST bodies.
 */
const express = require('express');
const path = require('path');

const { signToken, verifyToken, checkCode } = require('./lib/auth');

// Sanitise a value coming from an env var. Hosting dashboards (Railway, etc.)
// commonly introduce a trailing newline/space or wrap the value in quotes when
// it is pasted; the browser sends a trimmed PIN, so without this the stored PIN
// would never match and every login 401s even though the deploy looks healthy.
// Trims surrounding whitespace and strips ONE matching pair of surrounding
// quotes.
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
// (not from anyone who discovered the /exec URL). Server-side only.
const APPS_SCRIPT_SECRET = cleanEnv(process.env.APPS_SCRIPT_SECRET);
// Admin code: all houses + the budget admin (all-houses) view.
const ADMIN_PIN = cleanEnv(process.env.ADMIN_PIN);
const SESSION_SECRET = cleanEnv(process.env.SESSION_SECRET);
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 7;

function fatal(msg) {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

// Fail closed in production. Tests require() this module with NODE_ENV=test.
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  if (!APPS_SCRIPT_URL) fatal('APPS_SCRIPT_URL is required');
  if (!APPS_SCRIPT_SECRET) fatal('APPS_SCRIPT_SECRET is required');
  if (!ADMIN_PIN) fatal('ADMIN_PIN is required');
  if (!SESSION_SECRET) fatal('SESSION_SECRET is required');
  if (SESSION_SECRET.length < 32) fatal('SESSION_SECRET must be at least 32 chars');
}

const app = express();
app.disable('x-powered-by');
// Behind Railway's proxy: without this, req.ip is the proxy's IP for ALL
// users, so the login rate limit becomes one shared bucket for everyone.
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

// ---- static: public assets only ----
app.use(express.static(path.join(__dirname, 'public')));

// Expose ONLY the client-shared domain module. Server-only lib/auth.js must
// never be reachable over HTTP (no static mount on lib/).
app.get('/lib/kitchen-domain.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'lib', 'kitchen-domain.js'));
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- login (rate-limited, timing-safe) ----
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 8;

function rateLimitLogin(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + LOGIN_WINDOW_MS;
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count <= LOGIN_MAX;
}

// ADMIN_PIN is the only login. Cooks don't log in — they use a house URL.
app.post('/api/login', (req, res) => {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!rateLimitLogin(ip)) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.' });
  }
  const pin = String((req.body && req.body.pin) || '');

  if (checkCode(pin, ADMIN_PIN)) {
    const token = signToken(SESSION_SECRET, { role: 'admin', houseId: '' }, SESSION_DAYS);
    return res.json({ token, role: 'admin', houseId: '', expiresInDays: SESSION_DAYS });
  }

  return res.status(401).json({ error: 'קוד שגוי' });
});

// ---- auth middleware ----
// Only the admin session token authorises the all-houses /api/sheets endpoint.
// A cook has no token; a leftover cook-role token (from an older deploy) is not
// admin, so it is rejected here too.
function requireAdmin(req, res, next) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m ? m[1] : '';
  const claims = verifyToken(SESSION_SECRET, token);
  if (!claims || claims.role !== 'admin') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.auth = claims; // { role, houseId, expiresAt }
  next();
}

// A cook may only touch their own house. Rewrite the request body so any house
// reference is pinned to the URL's house — a cook can neither read nor write
// another house even by crafting the request directly.
function scopeBodyForCook(body, houseId) {
  const out = Object.assign({}, body);
  if ('houseId' in out) out.houseId = houseId;
  if (out.house && typeof out.house === 'object') {
    out.house = Object.assign({}, out.house, { id: houseId });
  }
  return out;
}

// Keep only the cook's own house in a `load` response, so no other house's data
// ever reaches their browser. On any unexpected shape, fail closed to an empty
// house list rather than leaking.
function filterLoadForCook(text, houseId) {
  let data;
  try { data = JSON.parse(text); } catch { return text; } // not JSON → upstream error, pass through
  if (!data || typeof data !== 'object' || !Array.isArray(data.houses)) return text;
  data.houses = data.houses.filter((h) => h && String(h.id) === String(houseId));
  return JSON.stringify(data);
}

// ---- Apps Script proxy (POST-only routes; the body carries {action, ...}) ----
// Shared handler. `cookHouseId` non-null → cook scope pinned to that house;
// null → admin scope (all houses, no filter).
async function proxySheets(req, res, cookHouseId) {
  if (!APPS_SCRIPT_URL) {
    return res.status(503).json({ error: 'backend_not_configured' });
  }
  const isCook = cookHouseId != null;
  const clientBody = isCook ? scopeBodyForCook(req.body || {}, cookHouseId) : (req.body || {});
  try {
    // Inject the shared secret AFTER building the client body, so a client can
    // never override or supply it — it stays server-side only.
    const payload = Object.assign({}, clientBody, { secret: APPS_SCRIPT_SECRET });
    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow', // Apps Script 302s to script.googleusercontent.com
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });

    let text = await upstream.text();
    // A cook's `load` is filtered down to their own house server-side.
    if (isCook && upstream.ok && (clientBody.action === 'load')) {
      text = filterLoadForCook(text, cookHouseId);
    }
    res.status(upstream.status);
    res.set('Cache-Control', 'no-store');
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.type(ct).send(text);
  } catch (err) {
    console.error('Proxy error:', err && err.message);
    res.status(502).json({ error: 'upstream_error', message: String((err && err.message) || err) });
  }
}

// Cook: NO login. The house is taken from the URL path — /h/<houseId>/api/sheets
// — the way the cook session token used to carry it. Writes are pinned and
// `load` is filtered to that one house, so a house URL can reach only its own
// house's data.
app.post('/h/:houseId/api/sheets', (req, res) =>
  proxySheets(req, res, String(req.params.houseId || '')));

// Admin: all houses. Requires the admin session token (ADMIN_PIN login).
app.post('/api/sheets', requireAdmin, (req, res) => proxySheets(req, res, null));

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

module.exports = { app, _loginAttempts: loginAttempts };
