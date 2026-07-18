'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, headcount, weekWithLunch } = require('./fixtures');

test('aggregateWeek scales each ingredient by the day headcount and sums across the week', () => {
  const rice = dish('Rice bowl', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice], monday: [rice] });

  const result = KD.aggregateWeek(week, headcount(8, 2)); // 10 people/day
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Rice');
  assert.equal(result[0].unit, 'kg');
  assert.ok(Math.abs(result[0].qty - 2) < 1e-6); // 0.1 * 10 * 2 days
});

test('aggregateWeek merges the same ingredient across dishes; categories stay distinct', () => {
  const a = dish('Salad', [{ name: 'Tomato', category: 'vegetables', qtyPerPerson: 0.05, unit: 'kg' }]);
  const b = dish('Shakshuka', [
    { name: 'tomato', category: 'vegetables', qtyPerPerson: 0.15, unit: 'kg' }, // same, diff case
    { name: 'Tomato', category: 'groceries', qtyPerPerson: 0.02, unit: 'kg' }, // diff category -> separate
  ]);
  const week = weekWithLunch({ sunday: [a, b] });

  const result = KD.aggregateWeek(week, headcount(10, 0));
  const veg = result.find((r) => KD.ingredientKey(r.name, r.category) === KD.ingredientKey('Tomato', 'vegetables'));
  const groc = result.find((r) => r.category === 'groceries');
  assert.ok(Math.abs(veg.qty - (0.05 + 0.15) * 10) < 1e-6); // 2 kg
  assert.ok(Math.abs(groc.qty - 0.02 * 10) < 1e-6); // 0.2 kg
});

test('aggregateWeek converts each unit to its family base and merges g into kg', () => {
  const a = dish('Porridge', [{ name: 'Oats', category: 'dry', qtyPerPerson: 0.05, unit: 'kg' }]); // 50 g
  const b = dish('Cookies', [{ name: 'Oats', category: 'dry', qtyPerPerson: 30, unit: 'g' }]); // 30 g
  const week = weekWithLunch({ sunday: [a, b] });
  const result = KD.aggregateWeek(week, headcount(10, 0));
  assert.equal(result.length, 1);
  assert.equal(result[0].unit, 'kg'); // base unit of the mass family
  assert.ok(Math.abs(result[0].qty - (0.05 + 0.03) * 10) < 1e-6); // 0.8 kg
});

test('aggregateWeek keeps different families (mass vs volume) as separate lines', () => {
  const d = dish('Soup', [
    { name: 'Water', category: 'groceries', qtyPerPerson: 200, unit: 'ml' },
    { name: 'Water', category: 'groceries', qtyPerPerson: 5, unit: 'g' },
  ]);
  const week = weekWithLunch({ sunday: [d] });
  const result = KD.aggregateWeek(week, headcount(10, 0));
  assert.equal(result.length, 2);
  const vol = result.find((r) => r.unit === 'l');
  const mass = result.find((r) => r.unit === 'kg');
  assert.ok(Math.abs(vol.qty - 0.2 * 10) < 1e-6); // 2 l
  assert.ok(Math.abs(mass.qty - 0.005 * 10) < 1e-6); // 0.05 kg
});

test('aggregateWeek counts units (יחידות) without any conversion', () => {
  const d = dish('Eggs', [{ name: 'Egg', category: 'groceries', qtyPerPerson: 2, unit: 'unit' }]);
  const week = weekWithLunch({ sunday: [d] });
  const result = KD.aggregateWeek(week, headcount(12, 0));
  assert.equal(result[0].unit, 'unit');
  assert.equal(result[0].qty, 24); // 2 * 12
});

test('aggregateWeek still reads legacy qtyKgPerPerson ingredients as kilograms', () => {
  const legacy = dish('Legacy', [{ name: 'Flour', category: 'dry', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [legacy] });
  const result = KD.aggregateWeek(week, headcount(10, 0));
  assert.equal(result[0].unit, 'kg');
  assert.ok(Math.abs(result[0].qty - 1) < 1e-6);
});

test('aggregateWeek applies per-day overrides (guests/trips)', () => {
  const soup = dish('Soup', [{ name: 'Carrot', category: 'vegetables', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [soup] });
  const hc = headcount(8, 2, { sunday: { patients: 15, staff: 5 } }); // 20 total
  const result = KD.aggregateWeek(week, hc);
  assert.ok(Math.abs(result[0].qty - 0.1 * 20) < 1e-6); // 2 kg, not 1
});

test('aggregateWeek contributes nothing when a day has zero people', () => {
  const soup = dish('Soup', [{ name: 'Carrot', category: 'vegetables', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [soup] });
  assert.equal(KD.aggregateWeek(week, headcount(0, 0)).length, 0);
});

test('aggregateWeek is ordered by fixed category order then name', () => {
  const d = dish('Mix', [
    { name: 'Zucchini', category: 'vegetables', qtyPerPerson: 0.1, unit: 'kg' },
    { name: 'Apple', category: 'fruits', qtyPerPerson: 0.1, unit: 'kg' },
    { name: 'Flour', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' },
    { name: 'Sugar', category: 'groceries', qtyPerPerson: 0.1, unit: 'kg' },
  ]);
  const week = weekWithLunch({ sunday: [d] });
  const result = KD.aggregateWeek(week, headcount(5, 0));
  assert.deepEqual(result.map((r) => r.category), ['groceries', 'vegetables', 'fruits', 'dry']);
});
