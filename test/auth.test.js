'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { signToken, verifyToken, checkCode, normalizeCode } = require('../lib/auth');

const SECRET = 's'.repeat(32);

// Rebuild a token from a raw payload string, signing with SECRET — used to
// forge / tamper in the negative tests below.
function tokenFor(payload, secret = SECRET) {
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${body}.${sig}`;
}
function payloadOf(token) {
  return Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
}

test('signToken produces base64url(payload).signature format', () => {
  const t = signToken(SECRET, { role: 'admin', houseId: '' }, 7);
  const [body, sig] = t.split('.');
  assert.match(payloadOf(t), /^kitchen:admin::\d+$/);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.ok(body.length > 0);
});

test('signToken throws without a secret', () => {
  assert.throws(() => signToken('', { role: 'admin', houseId: '' }, 7));
});

test('signToken rejects an invalid role', () => {
  assert.throws(() => signToken(SECRET, { role: 'root', houseId: '' }, 7));
});

test('signToken requires a houseId for a cook', () => {
  assert.throws(() => signToken(SECRET, { role: 'cook', houseId: '' }, 7));
});

test('verifyToken returns the claims for a freshly signed admin token', () => {
  const claims = verifyToken(SECRET, signToken(SECRET, { role: 'admin', houseId: '' }, 1));
  assert.deepEqual({ role: claims.role, houseId: claims.houseId }, { role: 'admin', houseId: '' });
});

test('verifyToken returns role + houseId for a cook token', () => {
  const claims = verifyToken(SECRET, signToken(SECRET, { role: 'cook', houseId: 'house_abc' }, 1));
  assert.equal(claims.role, 'cook');
  assert.equal(claims.houseId, 'house_abc');
});

test('verifyToken rejects wrong secret', () => {
  assert.equal(verifyToken('x'.repeat(32), signToken(SECRET, { role: 'admin', houseId: '' }, 1)), null);
});

test('verifyToken rejects expired token', () => {
  const expired = Date.now() - 1000;
  assert.equal(verifyToken(SECRET, tokenFor(`kitchen:admin::${expired}`)), null);
});

test('verifyToken rejects tampered expiry (old signature reused)', () => {
  const t = signToken(SECRET, { role: 'admin', houseId: '' }, 1);
  const sig = t.split('.')[1];
  const bumped = payloadOf(t).replace(/:\d+$/, `:${Date.now() + 10 * 864e5}`);
  const bumpedBody = Buffer.from(bumped, 'utf8').toString('base64url');
  assert.equal(verifyToken(SECRET, `${bumpedBody}.${sig}`), null);
});

test('verifyToken rejects a cook forging admin (role tampered, old signature)', () => {
  const cook = signToken(SECRET, { role: 'cook', houseId: 'house_abc' }, 1);
  const sig = cook.split('.')[1];
  const forged = payloadOf(cook).replace('kitchen:cook:house_abc:', 'kitchen:admin::');
  const forgedBody = Buffer.from(forged, 'utf8').toString('base64url');
  assert.equal(verifyToken(SECRET, `${forgedBody}.${sig}`), null);
});

test('verifyToken rejects malformed input safely', () => {
  for (const bad of ['', 'nodot', 'x.', '.abc', null, undefined, 42, 'x.zzzz']) {
    assert.equal(verifyToken(SECRET, bad), null);
  }
});

test('verifyToken rejects an unknown role even when correctly signed', () => {
  const exp = Date.now() + 60_000;
  assert.equal(verifyToken(SECRET, tokenFor(`kitchen:root::${exp}`)), null);
});

test('verifyToken uses payload prefix "kitchen:" (other apps\' tokens are invalid here)', () => {
  const exp = Date.now() + 60_000;
  assert.equal(verifyToken(SECRET, tokenFor(`managers:admin::${exp}`)), null);
});

test('checkCode: case-insensitive, whitespace-trimming, timing-safe', () => {
  // Word codes: case and surrounding whitespace must not matter.
  assert.equal(checkCode('ramot', 'RAMOT'), true);
  assert.equal(checkCode('RAMOT', 'RAMOT'), true);
  assert.equal(checkCode('  Ramot  ', 'RAMOT'), true);
  assert.equal(checkCode('RaMoT', 'ramot'), true);
  // But the code itself must still match.
  assert.equal(checkCode('ramotx', 'RAMOT'), false);
  assert.equal(checkCode('ramo', 'RAMOT'), false);
  assert.equal(checkCode('pardes', 'RAMOT'), false);
  // Empty / missing never authenticates.
  assert.equal(checkCode('', ''), false);
  assert.equal(checkCode('   ', 'RAMOT'), false);
  assert.equal(checkCode('RAMOT', ''), false);
  assert.equal(checkCode(null, 'RAMOT'), false);
  assert.equal(checkCode('RAMOT', null), false);
});

test('normalizeCode lower-cases and trims', () => {
  assert.equal(normalizeCode('  RaMoT '), 'ramot');
  assert.equal(normalizeCode(''), '');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode(undefined), '');
});
