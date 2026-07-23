'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

/* -------------------- normMonth: the shared month-key helper -------------------- */
test('normMonth normalises a Date, a YYYY-MM, or a full ISO date to YYYY-MM', () => {
  assert.equal(KD.normMonth(new Date(2026, 6, 15)), '2026-07'); // month is 0-based
  assert.equal(KD.normMonth('2026-07'), '2026-07');
  assert.equal(KD.normMonth('2026-07-15'), '2026-07');
  assert.equal(KD.normMonth('  2026-07-01T00:00 '), '2026-07');
  assert.equal(KD.normMonth(''), '');
  assert.equal(KD.normMonth('nonsense'), '');
  assert.equal(KD.normMonth(null), '');
});

test('overview and budget agree on the month key (same normalization)', () => {
  // The תקציב tab keys budgets by monthKey(new Date()); the overview reads with
  // normMonth. Both must resolve identically for a plain month and a full date.
  assert.equal(KD.normMonth(KD.monthKey(new Date(2026, 6, 9))), '2026-07');
  assert.equal(KD.normMonth('2026-07-09'), KD.monthKey(new Date(2026, 6, 9)));
});

/* -------------------- houseMonthRaw: the batched-overview row shape -------------------- */
const HOUSE = {
  id: 'h1', name: 'בית א',
  headcount: { basePatients: 20, baseStaff: 5 },
  budgets: { '2026-07': { budget: 20000, overrun: 1000, overrunNote: '' } },
  purchases: [
    { id: 'p1', amount: 5000, date: '2026-07-03' },
    { id: 'p2', amount: 1500, date: '2026-07-20' },
    { id: 'p3', amount: 9999, date: '2026-06-30' }, // other month → excluded
  ],
};

test('houseMonthRaw returns {id,name,month,budget,overrun,actual,diners} for the month', () => {
  const r = KD.houseMonthRaw(HOUSE, '2026-07');
  assert.deepEqual(r, {
    id: 'h1', name: 'בית א', month: '2026-07',
    budget: 20000, overrun: 1000, actual: 6500, diners: 25,
  });
});

test('houseMonthRaw accepts a full ISO date as the month arg (normalised)', () => {
  const r = KD.houseMonthRaw(HOUSE, '2026-07-15');
  assert.equal(r.month, '2026-07');
  assert.equal(r.actual, 6500);
  assert.equal(r.budget, 20000);
});

test('houseMonthRaw tolerates a stored budget key that is not exactly normalised', () => {
  const h = Object.assign({}, HOUSE, { budgets: { ' 2026-07 ': { budget: 12345, overrun: 0 } } });
  assert.equal(KD.houseMonthRaw(h, '2026-07').budget, 12345); // matched by normMonth
});

test('houseMonthRaw is 0 (never undefined/NaN) when the month has no budget', () => {
  const r = KD.houseMonthRaw(HOUSE, '2026-08');
  assert.equal(r.budget, 0);
  assert.equal(r.overrun, 0);
  assert.equal(r.actual, 0);
  assert.equal(r.diners, 25); // diners come from base headcount, not the month
});

test('houseMonthRaw ignores prototype-polluting stored keys', () => {
  const h = Object.assign({}, HOUSE, { budgets: JSON.parse('{"__proto__":{"budget":999},"2026-07":{"budget":7}}') });
  assert.equal(KD.houseMonthRaw(h, '2026-07').budget, 7);
});

/* -------------------- the overview row feeds summariseBudget (single display rule) -------------------- */
test('summariseBudget over houseMonthRaw yields the overview display figures', () => {
  const r = KD.houseMonthRaw(HOUSE, '2026-07');
  const s = KD.summariseBudget(r.budget, r.actual, r.overrun);
  assert.equal(s.budget, 20000);
  assert.equal(s.actual, 6500);
  assert.equal(s.remaining, 14500); // (20000 + 1000) − 6500
  assert.equal(s.overBudget, false);
});

test('a month with spend but no set budget is over budget (real numbers, not a zero stand-in)', () => {
  const h = Object.assign({}, HOUSE, { budgets: {} });
  const r = KD.houseMonthRaw(h, '2026-07');
  assert.equal(r.budget, 0);
  assert.equal(r.actual, 6500);
  const s = KD.summariseBudget(r.budget, r.actual, r.overrun);
  assert.equal(s.overBudget, true);
});

/* -------------------- actualSpendForMonth month-key robustness -------------------- */
test('actualSpendForMonth matches a full-ISO month arg and a YYYY-MM arg alike', () => {
  assert.equal(KD.actualSpendForMonth(HOUSE.purchases, '2026-07'), 6500);
  assert.equal(KD.actualSpendForMonth(HOUSE.purchases, '2026-07-01'), 6500);
});
