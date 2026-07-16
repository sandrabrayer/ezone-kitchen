'use strict';
/*
 * HMAC session auth — same standard as ezone-managers / ezone-staffing
 * (lib/auth.js there). SERVER-ONLY module: must never be served to the
 * browser. server.js exposes only /lib/kitchen-domain.js explicitly; there is
 * no static mount on lib/.
 *
 * Token format: "<expiresAtMs>.<hmacSha256Hex>" over the payload
 * "kitchen:<expiresAtMs>" keyed by SESSION_SECRET. The app-specific prefix
 * ("kitchen:") means a token minted by another E-Zone app is invalid here.
 */
const crypto = require('crypto');

const APP_SCOPE = 'kitchen';
const DEFAULT_DAYS = 7;

function signToken(secret, days) {
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const ttlMs = (Number(days) || DEFAULT_DAYS) * 24 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const payload = `${APP_SCOPE}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${expiresAt}.${sig}`;
}

function verifyToken(secret, token) {
  if (!secret || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${APP_SCOPE}:${expiresAt}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

function checkPin(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { signToken, verifyToken, checkPin, APP_SCOPE, DEFAULT_DAYS };
