'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

const line = (name, category, toBuyKg) => ({ name, category, requiredKg: toBuyKg, bufferedKg: toBuyKg, stockKg: 0, toBuyKg });

const prices = [
  { name: 'Rice', category: 'dry', pricePerKg: 6, updatedAt: '2026-07-01' },
  { name: 'Chicken', category: 'meat', pricePerKg: 25, updatedAt: '2026-07-10' },
];

test('estimateCost multiplies toBuyKg by price per kg and sums', () => {
  const est = KD.estimateCost([line('Rice', 'dry', 2), line('Chicken', 'meat', 4)], prices);
  assert.ok(Math.abs(est.estimatedTotal - (2 * 6 + 4 * 25)) < 1e-6); // 112
  assert.equal(est.missingPrices.length, 0);
  assert.equal(est.lines[0].updatedAt, '2026-07-01');
});

test('estimateCost reports ingredients with no known price and counts them as 0', () => {
  const est = KD.estimateCost([line('Rice', 'dry', 2), line('Tomato', 'vegetables', 3)], prices);
  assert.ok(Math.abs(est.estimatedTotal - 12) < 1e-6);
  assert.deepEqual(est.missingPrices, ['Tomato']);
  const tomato = est.lines.find((l) => l.name === 'Tomato');
  assert.equal(tomato.pricePerKg, null);
  assert.equal(tomato.lineCost, 0);
});

test('estimateCost ignores lines with nothing to buy', () => {
  const est = KD.estimateCost([line('Rice', 'dry', 0)], prices);
  assert.equal(est.lines.length, 0);
  assert.equal(est.estimatedTotal, 0);
});

test('actualSpendForWeek sums only entries for the requested week', () => {
  const log = [
    { id: '1', weekOf: '2026-07-12', amount: 100, date: '2026-07-13' },
    { id: '2', weekOf: '2026-07-12', amount: 50.5, date: '2026-07-14' },
    { id: '3', weekOf: '2026-07-05', amount: 999, date: '2026-07-06' },
  ];
  assert.ok(Math.abs(KD.actualSpendForWeek(log, '2026-07-12') - 150.5) < 1e-6);
  assert.ok(Math.abs(KD.actualSpendForWeek(log, '2026-07-05') - 999) < 1e-6);
  assert.equal(KD.actualSpendForWeek(log, '2026-07-19'), 0);
});

test('summariseBudget computes variance vs estimate and vs budget', () => {
  const s = KD.summariseBudget(1000, 800, 900);
  assert.ok(Math.abs(s.varianceVsEstimate - 100) < 1e-6); // 900 - 800
  assert.ok(Math.abs(s.varianceVsBudget + 100) < 1e-6); // 900 - 1000
  assert.equal(s.overBudget, false);
});

test('summariseBudget flags over budget', () => {
  const s = KD.summariseBudget(1000, 800, 1200);
  assert.equal(s.overBudget, true);
  assert.ok(Math.abs(s.varianceVsBudget - 200) < 1e-6);
});
