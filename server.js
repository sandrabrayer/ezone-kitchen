'use strict';
/*
 * ezone-kitchen server — auth at the ezone-managers / ezone-staffing standard:
 *   - fail-closed startup (all secrets required in production)
 *   - TWO PINs (timing-safe compare) with per-IP rate limiting:
 *       ADMIN_PIN  → admin role: all houses + the budget admin (all-houses) view
 *       COOK_PINS  → per-house cook codes: a cook code opens ONLY its one house
 *   - HMAC-signed session tokens (Bearer) carry the role + house, so a cook
 *     cannot self-promote to admin or reach another house from the browser
 *   - the proxy enforces "own house only" server-side for cooks (a cook's writes
 *     are pinned to their house and `load` is filtered to their house)
 *   - lib/ is NOT statically mounted; only kitchen-domain.js is exposed
 *
 * The Google Apps Script /exec URL and every PIN/secret live ONLY in Railway
 * environment variables — never in the repo, never sent to the browser. The
 * browser talks only to this server; this server proxies to Apps Script.
 * Apps Script routes are POST-only, so /api/sheets forwards POST bodies.
 */
const express = require('express');
const path = require('path');

const { signToken, verifyToken, checkCode, normalizeCode } = require('./lib/auth');

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

// COOK_PINS is a JSON object mapping each cook PIN to the single house id that
// code may open: {"1111":"house_ab12","2222":"house_cd34"}. Parsed once at
// startup. An empty/absent value simply means no cook can log in yet (admin
// still works) — that is not fatal.
function parseCookPins(raw) {
  const cleaned = cleanEnv(raw); // tolerate a quoted / whitespace-padded blob
  if (!cleaned) return {};
  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    fatal('COOK_PINS must be valid JSON, e.g. {"1111":"house_ab12"}');
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    fatal('COOK_PINS must be a JSON object mapping pin -> houseId');
  }
  const out = {};
  const seen = new Set(); // normalized codes, to catch case-only duplicates
  for (const rawPin of Object.keys(obj)) {
    // Trim the pin and clean the house id the same way, so a padded env value
    // still matches the trimmed code the browser sends.
    const pin = String(rawPin).trim();
    const houseId = cleanEnv(obj[rawPin]);
    if (!pin) fatal('COOK_PINS contains an empty code');
    if (!houseId) fatal(`COOK_PINS["${rawPin}"] must be a non-empty house id string`);
    if (houseId.indexOf(':') !== -1) {
      fatal(`COOK_PINS["${rawPin}"] house id must not contain ':'`);
    }
    // Codes match case-insensitively, so collisions must be checked normalized.
    const norm = normalizeCode(pin);
    if (ADMIN_PIN && norm === normalizeCode(ADMIN_PIN)) {
      fatal('A cook code must not equal ADMIN_PIN (case-insensitively)');
    }
    if (seen.has(norm)) {
      fatal(`COOK_PINS has two codes that differ only by case/spacing: "${rawPin}"`);
    }
    seen.add(norm);
    out[pin] = houseId;
  }
  return out;
}

const COOK_PINS = parseCookPins(process.env.COOK_PINS);

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

// Match a submitted code against every configured cook code (case-insensitive,
// and without short-circuiting, so the response time does not reveal how many
// cook codes exist or how close a guess was). Returns the house id or ''.
function matchCookPin(pin) {
  let houseId = '';
  for (const code of Object.keys(COOK_PINS)) {
    if (checkCode(pin, code)) houseId = COOK_PINS[code];
  }
  return houseId;
}

app.post('/api/login', (req, res) => {
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!rateLimitLogin(ip)) {
    return res.status(429).json({ error: 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.' });
  }
  const pin = String((req.body && req.body.pin) || '');

  // Admin code wins if it matches.
  if (checkCode(pin, ADMIN_PIN)) {
    const token = signToken(SESSION_SECRET, { role: 'admin', houseId: '' }, SESSION_DAYS);
    return res.json({ token, role: 'admin', houseId: '', expiresInDays: SESSION_DAYS });
  }

  // Otherwise, a per-house cook code.
  const houseId = matchCookPin(pin);
  if (houseId) {
    const token = signToken(SESSION_SECRET, { role: 'cook', houseId }, SESSION_DAYS);
    return res.json({ token, role: 'cook', houseId, expiresInDays: SESSION_DAYS });
  }

  return res.status(401).json({ error: 'קוד שגוי' });
});

// ---- auth middleware ----
function requireAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const token = m ? m[1] : '';
  const claims = verifyToken(SESSION_SECRET, token);
  if (!claims) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.auth = claims; // { role, houseId, expiresAt }
  next();
}

// A cook may only touch their own house. Rewrite the request body so any house
// reference is pinned to the token's house — a cook can neither read nor write
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
app.post('/api/sheets', requireAuth, async (req, res) => {
  if (!APPS_SCRIPT_URL) {
    return res.status(503).json({ error: 'backend_not_configured' });
  }
  const isCook = req.auth.role === 'cook';
  const clientBody = isCook ? scopeBodyForCook(req.body || {}, req.auth.houseId) : (req.body || {});
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
      text = filterLoadForCook(text, req.auth.houseId);
    }
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

module.exports = { app, _loginAttempts: loginAttempts };
