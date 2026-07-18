'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('makeStockCount captures a dated snapshot of the pantry', () => {
  const stock = [
    { id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg', minQty: 2 },
    { id: 's2', name: 'Milk', category: 'groceries', qty: 3, unit: 'l', minQty: 0 },
  ];
  const count = KD.makeStockCount('2026-07-18', stock);
  assert.equal(count.date, '2026-07-18');
  assert.equal(count.items.length, 2);
  assert.equal(count.items[0].name, 'Rice');
  assert.equal(count.items[0].qty, 5);
  assert.equal(count.items[0].minQty, 2);
});

test('stockFromCount restores the exact stock a count captured (round-trip)', () => {
  const stock = [
    { id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg', minQty: 2 },
    { id: 's2', name: 'Flour', category: 'dry', qty: 500, unit: 'g', minQty: 1000 },
  ];
  const restored = KD.stockFromCount(KD.makeStockCount('2026-07-18', stock));
  assert.deepEqual(restored, [
    { id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg', minQty: 2 },
    { id: 's2', name: 'Flour', category: 'dry', qty: 500, unit: 'g', minQty: 1000 },
  ]);
});

test('makeStockCount normalises legacy rows and bad values (never mutates input)', () => {
  const stock = [{ id: 's1', name: 'Old', category: 'nope', qtyKg: 4 }]; // legacy qtyKg, bad category, no unit/min
  const count = KD.makeStockCount('2026-07-18', stock);
  assert.equal(count.items[0].qty, 4);
  assert.equal(count.items[0].unit, 'kg');
  assert.equal(count.items[0].category, 'groceries');
  assert.equal(count.items[0].minQty, 0);
  assert.equal(stock[0].qty, undefined); // input untouched
});

test('a saved count restored later reproduces the same shopping math', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 1, unit: 'kg', minQty: 4 }];
  const week = KD.emptyWeekMenu('2026-07-12');
  const before = KD.buildShoppingList(week, stock).lines[0].toBuyQty;
  const restored = KD.stockFromCount(KD.makeStockCount('2026-07-18', stock));
  const after = KD.buildShoppingList(week, restored).lines[0].toBuyQty;
  assert.equal(before, after); // 4 - 1 = 3 both times
  assert.ok(Math.abs(after - 3) < 1e-6);
});
