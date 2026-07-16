'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, headcount, weekWithLunch } = require('./fixtures');

test('aggregateWeek scales each ingredient by the day headcount and sums across the week', () => {
  const rice = dish('Rice bowl', [{ name: 'Rice', category: 'dry', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [rice], monday: [rice] });

  const result = KD.aggregateWeek(week, headcount(8, 2)); // 10 people/day
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Rice');
  assert.ok(Math.abs(result[0].qtyKg - 2) < 1e-6); // 0.1 * 10 * 2 days
});

test('aggregateWeek merges the same ingredient across dishes; categories stay distinct', () => {
  const a = dish('Salad', [{ name: 'Tomato', category: 'vegetables', qtyKgPerPerson: 0.05 }]);
  const b = dish('Shakshuka', [
    { name: 'tomato', category: 'vegetables', qtyKgPerPerson: 0.15 }, // same, diff case
    { name: 'Tomato', category: 'groceries', qtyKgPerPerson: 0.02 }, // diff category -> separate
  ]);
  const week = weekWithLunch({ sunday: [a, b] });

  const result = KD.aggregateWeek(week, headcount(10, 0));
  const veg = result.find((r) => KD.ingredientKey(r.name, r.category) === KD.ingredientKey('Tomato', 'vegetables'));
  const groc = result.find((r) => r.category === 'groceries');
  assert.ok(Math.abs(veg.qtyKg - (0.05 + 0.15) * 10) < 1e-6); // 2 kg
  assert.ok(Math.abs(groc.qtyKg - 0.02 * 10) < 1e-6); // 0.2 kg
});

test('aggregateWeek applies per-day overrides (guests/trips)', () => {
  const soup = dish('Soup', [{ name: 'Carrot', category: 'vegetables', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [soup] });
  const hc = headcount(8, 2, { sunday: { patients: 15, staff: 5 } }); // 20 total
  const result = KD.aggregateWeek(week, hc);
  assert.ok(Math.abs(result[0].qtyKg - 0.1 * 20) < 1e-6); // 2 kg, not 1
});

test('aggregateWeek contributes nothing when a day has zero people', () => {
  const soup = dish('Soup', [{ name: 'Carrot', category: 'vegetables', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [soup] });
  assert.equal(KD.aggregateWeek(week, headcount(0, 0)).length, 0);
});

test('aggregateWeek is ordered by fixed category order then name', () => {
  const d = dish('Mix', [
    { name: 'Zucchini', category: 'vegetables', qtyKgPerPerson: 0.1 },
    { name: 'Apple', category: 'fruits', qtyKgPerPerson: 0.1 },
    { name: 'Flour', category: 'dry', qtyKgPerPerson: 0.1 },
    { name: 'Sugar', category: 'groceries', qtyKgPerPerson: 0.1 },
  ]);
  const week = weekWithLunch({ sunday: [d] });
  const result = KD.aggregateWeek(week, headcount(5, 0));
  assert.deepEqual(result.map((r) => r.category), ['groceries', 'vegetables', 'fruits', 'dry']);
});
