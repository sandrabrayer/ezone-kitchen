'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, weekWithLunch } = require('./fixtures');

test('aggregateWeek sums ingredient TOTALS across the week (no headcount scaling)', () => {
  const rice = dish('Rice bowl', [{ name: 'Rice', category: 'dry', qty: 2, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice], monday: [rice] });
  const result = KD.aggregateWeek(week);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Rice');
  assert.equal(result[0].unit, 'kg');
  assert.ok(Math.abs(result[0].qty - 4) < 1e-6); // 2 + 2, NOT × people
});

test('aggregateWeek does NOT multiply by people — the same menu yields the same totals', () => {
  const soup = dish('Soup', [{ name: 'Carrot', category: 'vegetables', qty: 3, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [soup] });
  // aggregateWeek takes no headcount argument at all; the total is the dish total.
  assert.ok(Math.abs(KD.aggregateWeek(week)[0].qty - 3) < 1e-6);
  // A day with a dish contributes even though no headcount is involved.
  assert.equal(KD.aggregateWeek(week).length, 1);
});

test('aggregateWeek merges the same ingredient across dishes; categories stay distinct', () => {
  const a = dish('Salad', [{ name: 'Tomato', category: 'vegetables', qty: 0.5, unit: 'kg' }]);
  const b = dish('Shakshuka', [
    { name: 'tomato', category: 'vegetables', qty: 1.5, unit: 'kg' }, // same, diff case
    { name: 'Tomato', category: 'groceries', qty: 0.2, unit: 'kg' }, // diff category -> separate
  ]);
  const week = weekWithLunch({ sunday: [a, b] });
  const result = KD.aggregateWeek(week);
  const veg = result.find((r) => KD.ingredientKey(r.name, r.category) === KD.ingredientKey('Tomato', 'vegetables'));
  const groc = result.find((r) => r.category === 'groceries');
  assert.ok(Math.abs(veg.qty - 2) < 1e-6); // 0.5 + 1.5
  assert.ok(Math.abs(groc.qty - 0.2) < 1e-6);
});

test('aggregateWeek converts each unit to its family base and merges g into kg', () => {
  const a = dish('Porridge', [{ name: 'Oats', category: 'dry', qty: 0.5, unit: 'kg' }]);
  const b = dish('Cookies', [{ name: 'Oats', category: 'dry', qty: 300, unit: 'g' }]); // 0.3 kg
  const week = weekWithLunch({ sunday: [a, b] });
  const result = KD.aggregateWeek(week);
  assert.equal(result.length, 1);
  assert.equal(result[0].unit, 'kg');
  assert.ok(Math.abs(result[0].qty - 0.8) < 1e-6);
});

test('aggregateWeek keeps different families (mass vs volume) as separate lines', () => {
  const d = dish('Soup', [
    { name: 'Water', category: 'groceries', qty: 2000, unit: 'ml' }, // 2 l
    { name: 'Water', category: 'groceries', qty: 50, unit: 'g' }, // 0.05 kg
  ]);
  const week = weekWithLunch({ sunday: [d] });
  const result = KD.aggregateWeek(week);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result.find((r) => r.unit === 'l').qty - 2) < 1e-6);
  assert.ok(Math.abs(result.find((r) => r.unit === 'kg').qty - 0.05) < 1e-6);
});

test('aggregateWeek counts units (יחידות) without conversion', () => {
  const d = dish('Eggs', [{ name: 'Egg', category: 'groceries', qty: 24, unit: 'unit' }]);
  const week = weekWithLunch({ sunday: [d] });
  const result = KD.aggregateWeek(week);
  assert.equal(result[0].unit, 'unit');
  assert.equal(result[0].qty, 24);
});

test('aggregateWeek reads legacy per-person fields as dish totals', () => {
  const legacyA = dish('Legacy', [{ name: 'Flour', category: 'dry', qtyKgPerPerson: 1 }]);
  const legacyB = dish('Legacy2', [{ name: 'Flour', category: 'dry', qtyPerPerson: 0.5 }]);
  const week = weekWithLunch({ sunday: [legacyA, legacyB] });
  const result = KD.aggregateWeek(week);
  assert.equal(result[0].unit, 'kg');
  assert.ok(Math.abs(result[0].qty - 1.5) < 1e-6); // 1 + 0.5, taken as totals
});

test('aggregateWeek can scope to a subset of days (used by the plan "from today" filter)', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice], monday: [rice], tuesday: [rice] });
  const all = KD.aggregateWeek(week);
  const fromMonday = KD.aggregateWeek(week, ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
  assert.ok(Math.abs(all[0].qty - 3) < 1e-6); // sun+mon+tue
  assert.ok(Math.abs(fromMonday[0].qty - 2) < 1e-6); // mon+tue only (sunday excluded)
});

test('aggregateWeek ignores unknown day names in the subset and keeps canonical order', () => {
  const d = dish('Mix', [
    { name: 'Zucchini', category: 'vegetables', qty: 1, unit: 'kg' },
    { name: 'Apple', category: 'fruits', qty: 1, unit: 'kg' },
    { name: 'Flour', category: 'dry', qty: 1, unit: 'kg' },
    { name: 'Sugar', category: 'groceries', qty: 1, unit: 'kg' },
  ]);
  const week = weekWithLunch({ sunday: [d] });
  const result = KD.aggregateWeek(week, ['sunday', 'not-a-day']);
  assert.deepEqual(result.map((r) => r.category), ['groceries', 'vegetables', 'fruits', 'dry']);
});
