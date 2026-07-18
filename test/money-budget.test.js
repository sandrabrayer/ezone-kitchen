'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('parseMoney reads a thousands-separated string as a number', () => {
  assert.equal(KD.parseMoney('20,000'), 20000);
  assert.equal(KD.parseMoney('20,000.50'), 20000.5);
  assert.equal(KD.parseMoney('₪10,000.00'), 10000);
  assert.equal(KD.parseMoney('1,2,3'), 123); // strays stripped
  assert.equal(KD.parseMoney(20000), 20000); // passthrough number
});

test('parseMoney clamps empty / invalid to 0 and strips a stray minus', () => {
  assert.equal(KD.parseMoney(''), 0);
  assert.equal(KD.parseMoney('abc'), 0);
  assert.equal(KD.parseMoney('-5'), 5); // non-digits (incl. "-") stripped; budgets are positive
  assert.equal(KD.parseMoney(null), 0);
  assert.equal(KD.parseMoney(undefined), 0);
  assert.equal(KD.parseMoney(-5), 0); // numeric negative → 0
});

test('parseMoney keeps only the first decimal point', () => {
  assert.equal(KD.parseMoney('1.2.3'), 1.23);
});

test('groupThousands formats an integer with separators', () => {
  assert.equal(KD.groupThousands(20000), '20,000');
  assert.equal(KD.groupThousands(1000000), '1,000,000');
  assert.equal(KD.groupThousands(500), '500');
  assert.equal(KD.groupThousands(1234.5), '1,234.5');
});

test('groupThousands round-trips with parseMoney', () => {
  assert.equal(KD.parseMoney(KD.groupThousands(20000)), 20000);
});

test('summariseBudget adds approved overrun to the ceiling', () => {
  const s = KD.summariseBudget(10000, 11000, 2000); // budget 10k, spent 11k, approved overrun 2k
  assert.equal(s.budget, 10000);
  assert.equal(s.overrun, 2000);
  assert.equal(s.actual, 11000);
  assert.equal(s.remaining, 1000); // (10000 + 2000) - 11000
  assert.equal(s.overBudget, false); // within the raised ceiling
});

test('summariseBudget flags over budget only past the raised ceiling', () => {
  const s = KD.summariseBudget(10000, 13000, 2000);
  assert.equal(s.remaining, -1000); // 12000 - 13000
  assert.equal(s.overBudget, true);
});

test('summariseBudget defaults overrun to 0 (back-compat 2-arg call)', () => {
  const s = KD.summariseBudget(10000, 3500);
  assert.equal(s.overrun, 0);
  assert.equal(s.remaining, 6500);
  assert.equal(s.overBudget, false);
});

test('summariseBudget treats invalid overrun as 0', () => {
  assert.equal(KD.summariseBudget(10000, 0, NaN).overrun, 0);
  assert.equal(KD.summariseBudget(10000, 0, -50).overrun, 0);
});
