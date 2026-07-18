'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, headcount, weekWithLunch } = require('./fixtures');

test('subtractStock subtracts stock from the required (buffered) quantity', () => {
  assert.equal(KD.subtractStock(12, 5), 7);
});
test('subtractStock never returns negative when stock exceeds need', () => {
  assert.equal(KD.subtractStock(3, 10), 0);
});
test('subtractStock treats negative stock as zero', () => {
  assert.equal(KD.subtractStock(4, -100), 4);
});

test('buildShoppingList aggregates × headcount, adds 20% buffer, deducts stock → shortfall', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 0.5, unit: 'kg' }];
  const list = KD.buildShoppingList(week, headcount(10, 0), stock);

  assert.equal(list.bufferRate, 0.2);
  const line = list.lines[0];
  assert.equal(line.unit, 'kg');
  assert.ok(Math.abs(line.requiredQty - 1) < 1e-6); // 0.1 * 10
  assert.ok(Math.abs(line.bufferedQty - 1.2) < 1e-6); // +20%
  assert.ok(Math.abs(line.stockQty - 0.5) < 1e-6);
  assert.ok(Math.abs(line.toBuyQty - 0.7) < 1e-6); // 1.2 - 0.5 (only the shortfall)
});

test('buildShoppingList deducts stock across units in the same family (g stock vs kg need)', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  // 500 g in stock must cancel 0.5 kg of the buffered 1.2 kg need.
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 500, unit: 'g' }];
  const list = KD.buildShoppingList(week, headcount(10, 0), stock);
  assert.ok(Math.abs(list.lines[0].stockQty - 0.5) < 1e-6);
  assert.ok(Math.abs(list.lines[0].toBuyQty - 0.7) < 1e-6);
});

test('buildShoppingList deducts ml stock from a litre requirement', () => {
  const soup = dish('Soup', [{ name: 'Milk', category: 'groceries', qtyPerPerson: 0.1, unit: 'l' }]);
  const week = weekWithLunch({ sunday: [soup] });
  const stock = [{ id: 's1', name: 'Milk', category: 'groceries', qty: 400, unit: 'ml' }]; // 0.4 l
  const list = KD.buildShoppingList(week, headcount(10, 0), stock);
  const line = list.lines[0];
  assert.equal(line.unit, 'l');
  assert.ok(Math.abs(line.bufferedQty - 1.2) < 1e-6); // 0.1*10*1.2
  assert.ok(Math.abs(line.stockQty - 0.4) < 1e-6);
  assert.ok(Math.abs(line.toBuyQty - 0.8) < 1e-6);
});

test('buildShoppingList does NOT deduct stock of a different family (kg stock vs litre need)', () => {
  const soup = dish('Soup', [{ name: 'Milk', category: 'groceries', qtyPerPerson: 0.1, unit: 'l' }]);
  const week = weekWithLunch({ sunday: [soup] });
  const stock = [{ id: 's1', name: 'Milk', category: 'groceries', qty: 5, unit: 'kg' }]; // mass, not volume
  const list = KD.buildShoppingList(week, headcount(10, 0), stock);
  assert.equal(list.lines[0].stockQty, 0); // no cross-family cancellation
  assert.ok(Math.abs(list.lines[0].toBuyQty - 1.2) < 1e-6);
});

test('buildShoppingList clamps toBuy to zero when stock covers the buffered need', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const list = KD.buildShoppingList(week, headcount(10, 0), [{ id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg' }]);
  assert.equal(list.lines[0].toBuyQty, 0);
});

test('buildShoppingList groups lines under the five fixed categories', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const list = KD.buildShoppingList(week, headcount(10, 0), []);
  assert.deepEqual(Object.keys(list.byCategory), ['groceries', 'vegetables', 'fruits', 'meat', 'dry']);
  assert.equal(list.byCategory.dry.length, 1);
  assert.equal(list.byCategory.meat.length, 0);
});

test('buildShoppingList sums stock across duplicate stock rows for the same ingredient', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const stock = [
    { id: 's1', name: 'Rice', category: 'dry', qty: 0.3, unit: 'kg' },
    { id: 's2', name: 'rice', category: 'dry', qty: 200, unit: 'g' }, // 0.2 kg, mixed units + case
  ];
  const list = KD.buildShoppingList(week, headcount(10, 0), stock);
  assert.ok(Math.abs(list.lines[0].stockQty - 0.5) < 1e-6);
  assert.ok(Math.abs(list.lines[0].toBuyQty - 0.7) < 1e-6);
});

test('buildShoppingList still reads legacy qtyKg stock rows as kilograms', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qtyPerPerson: 0.1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const list = KD.buildShoppingList(week, headcount(10, 0), [{ id: 's1', name: 'Rice', category: 'dry', qtyKg: 0.5 }]);
  assert.ok(Math.abs(list.lines[0].stockQty - 0.5) < 1e-6);
  assert.ok(Math.abs(list.lines[0].toBuyQty - 0.7) < 1e-6);
});
