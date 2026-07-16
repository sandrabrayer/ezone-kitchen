'use strict';
/*
 * HMAC session auth — same standard as ezone-managers / ezone-staffing
 * (lib/auth.js there). SERVER-ONLY module: must never be served to the
 * browser. server.js exposes only /lib/kitchen-domain.js explicitly; there is
 * no static mount on lib/.
 *
 * A token carries the caller's ROLE and (for a cook) their HOUSE, and those
 * claims are inside the signed payload — so a cook cannot self-promote to admin
 * or point themselves at another house by editing localStorage. The role is
 * decided by which PIN was entered at login (see server.js), never by the
 * client.
 *
 * Payload:  "kitchen:<role>:<houseId>:<expiresAtMs>"
 *   role     'cook' | 'admin'
 *   houseId  the cook's house id; '' for admin (all houses)
 * The app-specific prefix ("kitchen:") means a token minted by another E-Zone
 * app is invalid here.
 *
 * Wire format: "<base64url(payload)>.<hmacSha256Hex(payload)>". The payload is
 * carried in the clear (base64url) so the server can read the claims, and the
 * HMAC makes it unforgeable without SESSION_SECRET.
 */
const crypto = require('crypto');

const APP_SCOPE = 'kitchen';
const DEFAULT_DAYS = 7;
const ROLES = ['cook', 'admin'];

function isRole(r) { return ROLES.indexOf(r) !== -1; }

// House ids are generated as "house_<uuid>" (hex + hyphens) and never contain a
// ':' — the delimiter of the payload — so a colon in houseId is rejected.
function isValidHouseId(h) { return typeof h === 'string' && h.indexOf(':') === -1; }

function signToken(secret, claims, days) {
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const role = claims && claims.role;
  if (!isRole(role)) throw new Error('signToken: role must be one of ' + ROLES.join('/'));
  const houseId = (claims && claims.houseId) || '';
  if (!isValidHouseId(houseId)) throw new Error('signToken: invalid houseId');
  if (role === 'cook' && !houseId) throw new Error('signToken: a cook token requires a houseId');
  const ttlMs = (Number(days) || DEFAULT_DAYS) * 24 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const payload = `${APP_SCOPE}:${role}:${houseId}:${expiresAt}`;
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${body}.${sig}`;
}

/**
 * Verify a token. Returns the claims { role, houseId, expiresAt } when valid,
 * or null when the token is missing, malformed, expired, or the signature does
 * not match. Callers treat null as "unauthorized".
 */
function verifyToken(secret, token) {
  if (!secret || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;

  let payload;
  try { payload = Buffer.from(body, 'base64url').toString('utf8'); } catch { return null; }
  const parts = payload.split(':');
  if (parts.length !== 4) return null;
  const [scope, role, houseId, expStr] = parts;
  if (scope !== APP_SCOPE) return null;
  if (!isRole(role)) return null;
  if (role === 'cook' && !houseId) return null;

  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return { role, houseId, expiresAt };
}

function checkPin(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { signToken, verifyToken, checkPin, isRole, APP_SCOPE, ROLES, DEFAULT_DAYS };
