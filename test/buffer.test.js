'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('applyBuffer adds exactly 20% by default', () => {
  assert.ok(Math.abs(KD.applyBuffer(10) - 12) < 1e-9);
  assert.ok(Math.abs(KD.applyBuffer(1) - 1.2) < 1e-9);
  assert.ok(Math.abs(KD.applyBuffer(2.5) - 3) < 1e-9);
});

test('applyBuffer uses the documented default rate constant', () => {
  assert.equal(KD.BUFFER_RATE, 0.2);
  assert.ok(Math.abs(KD.applyBuffer(100) - 100 * (1 + KD.BUFFER_RATE)) < 1e-9);
});

test('applyBuffer honours a custom rate', () => {
  assert.ok(Math.abs(KD.applyBuffer(10, 0) - 10) < 1e-9);
  assert.ok(Math.abs(KD.applyBuffer(10, 0.5) - 15) < 1e-9);
});

test('applyBuffer returns 0 for zero, negative, or non-finite input', () => {
  assert.equal(KD.applyBuffer(0), 0);
  assert.equal(KD.applyBuffer(-5), 0);
  assert.equal(KD.applyBuffer(NaN), 0);
  assert.equal(KD.applyBuffer(Infinity), 0);
});
