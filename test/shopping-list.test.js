'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, headcount, weekWithLunch } = require('./fixtures');

test('subtractStock subtracts stock from the buffered need', () => {
  assert.equal(KD.subtractStock(12, 5), 7);
});
test('subtractStock never returns negative when stock exceeds need', () => {
  assert.equal(KD.subtractStock(3, 10), 0);
});
test('subtractStock treats negative stock as zero', () => {
  assert.equal(KD.subtractStock(4, -100), 4);
});

test('buildShoppingList aggregates × headcount, adds 20% buffer, subtracts stock', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [rice] });
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qtyKg: 0.5 }];
  const list = KD.buildShoppingList(week, headcount(10, 0), stock);

  assert.equal(list.bufferRate, 0.2);
  const line = list.lines[0];
  assert.ok(Math.abs(line.requiredKg - 1) < 1e-6); // 0.1 * 10
  assert.ok(Math.abs(line.bufferedKg - 1.2) < 1e-6); // +20%
  assert.ok(Math.abs(line.stockKg - 0.5) < 1e-6);
  assert.ok(Math.abs(line.toBuyKg - 0.7) < 1e-6); // 1.2 - 0.5
});

test('buildShoppingList clamps toBuy to zero when stock covers the buffered need', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [rice] });
  const list = KD.buildShoppingList(week, headcount(10, 0), [{ id: 's1', name: 'Rice', category: 'dry', qtyKg: 5 }]);
  assert.equal(list.lines[0].toBuyKg, 0);
});

test('buildShoppingList groups lines under the five fixed categories', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [rice] });
  const list = KD.buildShoppingList(week, headcount(10, 0), []);
  assert.deepEqual(Object.keys(list.byCategory), ['groceries', 'vegetables', 'fruits', 'meat', 'dry']);
  assert.equal(list.byCategory.dry.length, 1);
  assert.equal(list.byCategory.meat.length, 0);
});

test('buildShoppingList sums stock across duplicate stock rows for the same ingredient', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyKgPerPerson: 0.1 }]);
  const week = weekWithLunch({ sunday: [rice] });
  const stock = [
    { id: 's1', name: 'Rice', category: 'dry', qtyKg: 0.3 },
    { id: 's2', name: 'rice', category: 'dry', qtyKg: 0.2 },
  ];
  const list = KD.buildShoppingList(week, headcount(10, 0), stock);
  assert.ok(Math.abs(list.lines[0].stockKg - 0.5) < 1e-6);
  assert.ok(Math.abs(list.lines[0].toBuyKg - 0.7) < 1e-6);
});
