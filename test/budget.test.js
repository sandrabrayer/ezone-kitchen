'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('monthOf extracts the calendar month from an ISO date', () => {
  assert.equal(KD.monthOf('2026-07-18'), '2026-07');
  assert.equal(KD.monthOf('2026-12-01'), '2026-12');
  assert.equal(KD.monthOf('not-a-date'), '');
  assert.equal(KD.monthOf(undefined), '');
});

test('monthKey / formatMonthHe format month keys', () => {
  assert.equal(KD.monthKey(new Date(2026, 6, 18)), '2026-07'); // month is 0-based
  assert.equal(KD.formatMonthHe('2026-07'), '07/2026');
  assert.equal(KD.formatMonthHe('bad'), 'bad');
});

test('shiftMonth moves whole months and rolls over years', () => {
  assert.equal(KD.shiftMonth('2026-07', 1), '2026-08');
  assert.equal(KD.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(KD.shiftMonth('2026-12', 1), '2027-01');
});

test('actualSpendForMonth sums only purchases whose date falls in the month', () => {
  const log = [
    { id: '1', amount: 100, date: '2026-07-03' },
    { id: '2', amount: 50.5, date: '2026-07-29' },
    { id: '3', amount: 999, date: '2026-06-30' }, // previous month
    { id: '4', amount: -20, date: '2026-07-10' }, // invalid negative → ignored
  ];
  assert.ok(Math.abs(KD.actualSpendForMonth(log, '2026-07') - 150.5) < 1e-6);
  assert.ok(Math.abs(KD.actualSpendForMonth(log, '2026-06') - 999) < 1e-6);
  assert.equal(KD.actualSpendForMonth(log, '2026-08'), 0);
  assert.equal(KD.actualSpendForMonth([], '2026-07'), 0);
});

test('summariseBudget returns budget, actual and remaining (budget − actual)', () => {
  const s = KD.summariseBudget(10000, 3500);
  assert.equal(s.budget, 10000);
  assert.equal(s.actual, 3500);
  assert.equal(s.remaining, 6500);
  assert.equal(s.overBudget, false);
});

test('summariseBudget flags over budget and a negative remaining', () => {
  const s = KD.summariseBudget(10000, 12000);
  assert.equal(s.remaining, -2000);
  assert.equal(s.overBudget, true);
});

test('summariseBudget treats a missing/invalid budget or spend as 0', () => {
  const s = KD.summariseBudget(undefined, NaN);
  assert.equal(s.budget, 0);
  assert.equal(s.actual, 0);
  assert.equal(s.remaining, 0);
  assert.equal(s.overBudget, false);
});
