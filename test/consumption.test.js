'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, weekWithLunch } = require('./fixtures');

/* dayConsumption: the amounts served on ONE day — dish totals, NO buffer,
   NO headcount multiplication. */
test('dayConsumption returns the dish totals for that day (no × people, no buffer)', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice], monday: [rice] });
  const cons = KD.dayConsumption(week, 'sunday');
  assert.equal(cons.length, 1);
  assert.equal(cons[0].unit, 'kg');
  assert.ok(Math.abs(cons[0].qty - 1) < 1e-6); // one day's dish total, not × people
});

test('dayConsumption is empty for a day with no menu', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  assert.equal(KD.dayConsumption(week, 'tuesday').length, 0);
  assert.equal(KD.dayConsumption(week, 'not-a-day').length, 0);
});

/* applyConsumption: deduct served amounts from the pantry. */
test('applyConsumption deducts matching stock and never mutates the input', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg' }];
  const cons = [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }];
  const res = KD.applyConsumption(stock, cons);
  assert.equal(res.stock[0].qty, 4);
  assert.equal(stock[0].qty, 5); // input untouched
  assert.equal(res.shortfalls.length, 0);
});

test('applyConsumption converts across units in the same family', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 2, unit: 'kg' }];
  const cons = [{ name: 'Rice', category: 'dry', qty: 0.5, unit: 'kg' }];
  const res = KD.applyConsumption(stock, cons);
  assert.ok(Math.abs(res.stock[0].qty - 1.5) < 1e-6);
});

test('applyConsumption floors stock at zero and reports the shortfall', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 0.4, unit: 'kg' }];
  const cons = [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }];
  const res = KD.applyConsumption(stock, cons);
  assert.equal(res.stock[0].qty, 0);
  assert.equal(res.shortfalls.length, 1);
  assert.ok(Math.abs(res.shortfalls[0].qty - 0.6) < 1e-6);
});

test('applyConsumption does not touch a different unit family', () => {
  const stock = [{ id: 's1', name: 'Milk', category: 'groceries', qty: 5, unit: 'kg' }]; // mass
  const cons = [{ name: 'Milk', category: 'groceries', qty: 1, unit: 'l' }]; // volume
  const res = KD.applyConsumption(stock, cons);
  assert.equal(res.stock[0].qty, 5);
  assert.equal(res.shortfalls.length, 1);
});

test('applyConsumption spreads one consumption across several matching stock rows', () => {
  const stock = [
    { id: 's1', name: 'Rice', category: 'dry', qty: 0.3, unit: 'kg' },
    { id: 's2', name: 'rice', category: 'dry', qty: 500, unit: 'g' }, // 0.5 kg
  ];
  const cons = [{ name: 'Rice', category: 'dry', qty: 0.6, unit: 'kg' }];
  const res = KD.applyConsumption(stock, cons);
  assert.equal(res.stock[0].qty, 0);
  assert.ok(Math.abs(res.stock[1].qty - 200) < 1e-6); // grams preserved
  assert.equal(res.stock[1].unit, 'g');
  assert.equal(res.shortfalls.length, 0);
});

/* Idempotency guard — the same day can never be deducted twice. */
test('isDayExecuted detects an already-served (weekOf, day)', () => {
  const markers = [{ weekOf: '2026-07-12', day: 'sunday', executedAt: '2026-07-12' }];
  assert.equal(KD.isDayExecuted(markers, '2026-07-12', 'sunday'), true);
  assert.equal(KD.isDayExecuted(markers, '2026-07-12', 'monday'), false);
  assert.equal(KD.isDayExecuted([], '2026-07-12', 'sunday'), false);
  assert.equal(KD.isDayExecuted(undefined, '2026-07-12', 'sunday'), false);
});

test('guarded execution deducts once, then a second attempt is a no-op (idempotent)', () => {
  let stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg' }];
  const markers = [];
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });

  function serve(day) {
    if (KD.isDayExecuted(markers, '2026-07-12', day)) return false;
    stock = KD.applyConsumption(stock, KD.dayConsumption(week, day)).stock;
    markers.push({ weekOf: '2026-07-12', day: day, executedAt: '2026-07-12' });
    return true;
  }

  assert.equal(serve('sunday'), true);
  assert.equal(stock[0].qty, 4); // 5 - 1 (the dish total)
  assert.equal(serve('sunday'), false);
  assert.equal(stock[0].qty, 4);
  assert.equal(markers.length, 1);
});
