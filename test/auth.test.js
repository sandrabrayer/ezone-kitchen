'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { signToken, verifyToken, checkPin } = require('../lib/auth');

const SECRET = 's'.repeat(32);

test('signToken produces expiry.signature format', () => {
  const t = signToken(SECRET, 7);
  const [exp, sig] = t.split('.');
  assert.ok(Number(exp) > Date.now());
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test('signToken throws without a secret', () => {
  assert.throws(() => signToken('', 7));
});

test('verifyToken accepts a freshly signed token', () => {
  assert.equal(verifyToken(SECRET, signToken(SECRET, 1)), true);
});

test('verifyToken rejects wrong secret', () => {
  assert.equal(verifyToken('x'.repeat(32), signToken(SECRET, 1)), false);
});

test('verifyToken rejects expired token', () => {
  const expired = Date.now() - 1000;
  const sig = crypto.createHmac('sha256', SECRET).update(`kitchen:${expired}`).digest('hex');
  assert.equal(verifyToken(SECRET, `${expired}.${sig}`), false);
});

test('verifyToken rejects tampered expiry', () => {
  const t = signToken(SECRET, 1);
  const [exp, sig] = t.split('.');
  assert.equal(verifyToken(SECRET, `${Number(exp) + 99999}.${sig}`), false);
});

test('verifyToken rejects malformed input safely', () => {
  for (const bad of ['', 'nodot', '123.', '.abc', null, undefined, 42, '123.zzzz']) {
    assert.equal(verifyToken(SECRET, bad), false);
  }
});

test('verifyToken uses payload prefix "kitchen:" (other apps\' tokens are invalid here)', () => {
  const exp = Date.now() + 60_000;
  const managersSig = crypto.createHmac('sha256', SECRET).update(`managers:${exp}`).digest('hex');
  assert.equal(verifyToken(SECRET, `${exp}.${managersSig}`), false);
});

test('checkPin: exact match only, timing-safe path', () => {
  assert.equal(checkPin('1234', '1234'), true);
  assert.equal(checkPin('1235', '1234'), false);
  assert.equal(checkPin('123', '1234'), false);
  assert.equal(checkPin('', ''), false); // empty expected PIN never authenticates
  assert.equal(checkPin(null, '1234'), false);
  assert.equal(checkPin('1234', null), false);
});
