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

/* --------- stockCountRows: the count lists the FULL catalog --------- */
const CATALOG = [
  { name: 'Rice', unit: 'kg', category: 'dry', min: 4 },
  { name: 'Milk', unit: 'l', category: 'groceries', min: 15 },
  { name: 'Onion', unit: 'kg', category: 'vegetables', min: 10 },
];

test('stockCountRows lists every catalog item, defaulting missing ones to 0', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 2, unit: 'kg', minQty: 4 }];
  const rows = KD.stockCountRows(CATALOG, stock);
  assert.equal(rows.length, 3); // all three catalog items appear
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.Rice.qty, 2); // current stock qty
  assert.equal(byName.Rice.id, 's1'); // keeps its stock id
  assert.equal(byName.Milk.qty, 0); // not in stock yet
  assert.equal(byName.Milk.id, null);
  assert.equal(byName.Milk.unit, 'l'); // unit from catalog
  assert.equal(byName.Milk.min, 15); // par from catalog
});

test('stockCountRows also includes pantry items not in the catalog', () => {
  const stock = [{ id: 's9', name: 'Eggs', category: 'groceries', qty: 30, unit: 'unit', minQty: 0 }];
  const rows = KD.stockCountRows(CATALOG, stock);
  const eggs = rows.find((r) => r.name === 'Eggs');
  assert.ok(eggs, 'free-text pantry item must still be counted');
  assert.equal(eggs.qty, 30);
  assert.equal(rows.length, 4); // 3 catalog + 1 free-text
});

test('stockCountRows are grouped/ordered by category then name', () => {
  const rows = KD.stockCountRows(CATALOG, []);
  assert.deepEqual(rows.map((r) => r.category), ['groceries', 'vegetables', 'dry']);
});

/* --------- applyStockCount: saving writes ALL counted items --------- */
test('applyStockCount adds a catalog item counted > 0 that was not in stock', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 2, unit: 'kg', minQty: 4 }];
  const milkKey = KD.catalogKey('Milk');
  const next = KD.applyStockCount(CATALOG, stock, { [milkKey]: 8 });
  const milk = next.find((s) => s.name === 'Milk');
  assert.ok(milk, 'Milk counted 8 must be added to stock');
  assert.equal(milk.qty, 8);
  assert.equal(milk.unit, 'l');
  assert.equal(milk.category, 'groceries');
  assert.equal(milk.minQty, 15); // default par carried in
  // Rice untouched keeps its current qty.
  assert.equal(next.find((s) => s.name === 'Rice').qty, 2);
});

test('applyStockCount leaves uncounted catalog items out; keeps existing at 0', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 2, unit: 'kg', minQty: 4 }];
  const riceKey = KD.catalogKey('Rice');
  const next = KD.applyStockCount(CATALOG, stock, { [riceKey]: 0 });
  const rice = next.find((s) => s.name === 'Rice');
  assert.ok(rice, 'an item already in stock counted 0 stays in the list at 0');
  assert.equal(rice.qty, 0);
  assert.equal(rice.id, 's1'); // same row
  assert.equal(next.find((s) => s.name === 'Milk'), undefined); // not in stock, left 0 → omitted
});

test('applyStockCount is a full pantry summary and preserves free-text items', () => {
  const stock = [{ id: 's9', name: 'Eggs', category: 'groceries', qty: 30, unit: 'unit', minQty: 0 }];
  const eggsKey = KD.catalogKey('Eggs');
  const riceKey = KD.catalogKey('Rice');
  const next = KD.applyStockCount(CATALOG, stock, { [riceKey]: 5, [eggsKey]: 24 });
  assert.equal(next.find((s) => s.name === 'Eggs').qty, 24); // free-text item recounted
  assert.equal(next.find((s) => s.name === 'Rice').qty, 5); // catalog item added
  assert.equal(next.find((s) => s.name === 'Milk'), undefined); // untouched, not in stock
});

test('applyStockCount does not mutate the input stock', () => {
  const stock = [{ id: 's1', name: 'Rice', category: 'dry', qty: 2, unit: 'kg', minQty: 4 }];
  KD.applyStockCount(CATALOG, stock, { [KD.catalogKey('Rice')]: 9 });
  assert.equal(stock[0].qty, 2); // input untouched
});
