'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, headcount, weekWithLunch } = require('./fixtures');

/* dayConsumption: actual served amount for ONE day, NO 20% buffer. */
test('dayConsumption returns qty × people for that day, without the buffer', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice], monday: [rice] });
  const cons = KD.dayConsumption(week, headcount(10, 0), 'sunday');
  assert.equal(cons.length, 1);
  assert.equal(cons[0].unit, 'kg');
  assert.ok(Math.abs(cons[0].qty - 1) < 1e-6); // 0.1 * 10, one day only, no buffer
});

test('dayConsumption is empty for a day with no menu or no people', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  assert.equal(KD.dayConsumption(week, headcount(10, 0), 'tuesday').length, 0);
  assert.equal(KD.dayConsumption(week, headcount(0, 0), 'sunday').length, 0);
  assert.equal(KD.dayConsumption(week, headcount(10, 0), 'not-a-day').length, 0);
});

/* applyConsumption: deduct served amounts from the pantry. */
test('applyConsumption deducts matching stock and never mutates the input', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg' }];
  const cons = [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }];
  const res = KD.applyConsumption(stock, cons);
  assert.equal(res.stock[0].qty, 4); // 5 - 1
  assert.equal(stock[0].qty, 5); // input untouched
  assert.equal(res.shortfalls.length, 0);
});

test('applyConsumption converts across units in the same family (kg stock, g consumption)', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 2, unit: 'kg' }];
  const cons = [{ name: 'Rice', category: 'dry', qty: 0.5, unit: 'kg' }]; // dayConsumption is base units
  const res = KD.applyConsumption(stock, cons);
  assert.ok(Math.abs(res.stock[0].qty - 1.5) < 1e-6);
});

test('applyConsumption floors stock at zero and reports the shortfall', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 0.4, unit: 'kg' }];
  const cons = [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }];
  const res = KD.applyConsumption(stock, cons);
  assert.equal(res.stock[0].qty, 0); // never negative
  assert.equal(res.shortfalls.length, 1);
  assert.ok(Math.abs(res.shortfalls[0].qty - 0.6) < 1e-6); // 1 - 0.4 uncovered
});

test('applyConsumption does not touch a different unit family', () => {
  const stock = [{ id: 's1', name: 'Milk', category: 'groceries', qty: 5, unit: 'kg' }]; // mass
  const cons = [{ name: 'Milk', category: 'groceries', qty: 1, unit: 'l' }]; // volume
  const res = KD.applyConsumption(stock, cons);
  assert.equal(res.stock[0].qty, 5); // untouched
  assert.equal(res.shortfalls.length, 1);
});

test('applyConsumption spreads one consumption across several matching stock rows', () => {
  const stock = [
    { id: 's1', name: 'Rice', category: 'dry', qty: 0.3, unit: 'kg' },
    { id: 's2', name: 'rice', category: 'dry', qty: 500, unit: 'g' }, // 0.5 kg
  ];
  const cons = [{ name: 'Rice', category: 'dry', qty: 0.6, unit: 'kg' }];
  const res = KD.applyConsumption(stock, cons);
  // First row fully drained (0.3), remaining 0.3 taken from the 0.5 kg (=500 g) row → 200 g left.
  assert.equal(res.stock[0].qty, 0);
  assert.ok(Math.abs(res.stock[1].qty - 200) < 1e-6); // grams preserved as the row's unit
  assert.equal(res.stock[1].unit, 'g');
  assert.equal(res.shortfalls.length, 0);
});

/* Idempotency guard — the same day can never be deducted twice. */
test('isDayExecuted detects an already-served (weekOf, day)', () => {
  const markers = [{ weekOf: '2026-07-12', day: 'sunday', executedAt: '2026-07-12' }];
  assert.equal(KD.isDayExecuted(markers, '2026-07-12', 'sunday'), true);
  assert.equal(KD.isDayExecuted(markers, '2026-07-12', 'monday'), false);
  assert.equal(KD.isDayExecuted(markers, '2026-07-19', 'sunday'), false);
  assert.equal(KD.isDayExecuted([], '2026-07-12', 'sunday'), false);
  assert.equal(KD.isDayExecuted(undefined, '2026-07-12', 'sunday'), false);
});

test('guarded execution deducts once, then a second attempt is a no-op (idempotent)', () => {
  let stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg' }];
  const markers = [];
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });

  function serve(day) {
    if (KD.isDayExecuted(markers, '2026-07-12', day)) return false; // guard
    stock = KD.applyConsumption(stock, KD.dayConsumption(week, headcount(10, 0), day)).stock;
    markers.push({ weekOf: '2026-07-12', day: day, executedAt: '2026-07-12' });
    return true;
  }

  assert.equal(serve('sunday'), true);
  assert.equal(stock[0].qty, 4); // 5 - (0.1*10)
  assert.equal(serve('sunday'), false); // blocked
  assert.equal(stock[0].qty, 4); // unchanged — no double deduction
  assert.equal(markers.length, 1);
});
