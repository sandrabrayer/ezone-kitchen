'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, weekWithLunch } = require('./fixtures');

test('isBelowMin flags an item under its par level, ignores items with no min', () => {
  assert.equal(KD.isBelowMin({ name: 'Rice', category: 'dry', qty: 2, unit: 'kg', minQty: 5 }), true);
  assert.equal(KD.isBelowMin({ name: 'Rice', category: 'dry', qty: 5, unit: 'kg', minQty: 5 }), false); // equal = not below
  assert.equal(KD.isBelowMin({ name: 'Rice', category: 'dry', qty: 8, unit: 'kg', minQty: 5 }), false);
  assert.equal(KD.isBelowMin({ name: 'Rice', category: 'dry', qty: 0, unit: 'kg' }), false); // no min set
});

test('shopping list tops up to the minimum when the menu needs nothing', () => {
  const week = KD.emptyWeekMenu('2026-07-12'); // no menu at all
  const stock = [{ id: 's1', name: 'Salt', category: 'groceries', qty: 1, unit: 'kg', minQty: 3 }];
  const list = KD.buildShoppingList(week, stock);
  assert.equal(list.lines.length, 1);
  const line = list.lines[0];
  assert.equal(line.requiredQty, 0);
  assert.ok(Math.abs(line.minQty - 3) < 1e-6);
  assert.ok(Math.abs(line.toBuyQty - 2) < 1e-6); // top-up 3 - 1
});

test('shopping list takes the MAX of menu shortfall and top-up, never the sum', () => {
  // Menu needs 10 kg → buffered 12; stock 4; min 5.
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 10, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 4, unit: 'kg', minQty: 5 }];
  const line = KD.buildShoppingList(week, stock).lines[0];
  const menuShort = 12 - 4; // 8
  const topUp = 5 - 4; // 1
  assert.ok(Math.abs(line.toBuyQty - Math.max(menuShort, topUp)) < 1e-6); // 8, NOT 9
});

test('shopping list uses the top-up when it exceeds the menu shortfall', () => {
  // Menu needs 1 kg → buffered 1.2; stock 2 (covers menu); min 10 → top-up 8.
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 2, unit: 'kg', minQty: 10 }];
  const line = KD.buildShoppingList(week, stock).lines[0];
  assert.ok(Math.abs(line.toBuyQty - 8) < 1e-6); // max(0, 10-2)=8 > max(0,1.2-2)=0
});

test('minimum top-up honours unit-family conversion (g stock, kg min via matching)', () => {
  const week = KD.emptyWeekMenu('2026-07-12');
  const stock = [{ id: 's1', name: 'Sugar', category: 'groceries', qty: 500, unit: 'g', minQty: 2000 }]; // 0.5kg on hand, min 2kg
  const line = KD.buildShoppingList(week, stock).lines[0];
  assert.equal(line.unit, 'kg'); // base unit
  assert.ok(Math.abs(line.stockQty - 0.5) < 1e-6);
  assert.ok(Math.abs(line.minQty - 2) < 1e-6);
  assert.ok(Math.abs(line.toBuyQty - 1.5) < 1e-6); // 2 - 0.5
});

test('no min + menu covered → nothing to buy', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg' }]; // no min
  assert.equal(KD.buildShoppingList(week, stock).lines[0].toBuyQty, 0);
});
