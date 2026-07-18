'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

const catalog = [
  { name: 'חלב', unit: 'l', category: 'groceries', min: 15 },
  { name: 'לחם', unit: 'unit', category: 'groceries', min: 15 },
  { name: 'אורז', unit: 'kg', category: 'dry', min: 10 },
];

test('buildCountList = union(catalog, stock), category-ordered, qty defaults', () => {
  const stock = [
    { id: 's1', name: 'חלב', category: 'groceries', qty: 3, unit: 'l', minQty: 15 }, // in stock
    { id: 's2', name: 'בצים', category: 'groceries', qty: 5, unit: 'unit', minQty: 0 }, // free-text, not in catalog
  ];
  const list = KD.buildCountList(catalog, stock);
  assert.equal(list.length, 4); // 3 catalog + 1 free-text stock item
  // groceries before dry (category order)
  assert.deepEqual(list.map((r) => r.category), ['groceries', 'groceries', 'groceries', 'dry']);
  const milk = list.find((r) => r.name === 'חלב');
  assert.equal(milk.qty, 3);        // current stock qty
  assert.equal(milk.stockId, 's1');
  const rice = list.find((r) => r.name === 'אורז');
  assert.equal(rice.qty, 0);        // catalog item not in stock → default 0
  assert.equal(rice.stockId, null);
  const eggs = list.find((r) => r.name === 'בצים');
  assert.equal(eggs.qty, 5);        // free-text stock item still listed
  assert.equal(eggs.stockId, 's2');
});

test('applyStockCount adds catalog items counted > 0 that were not stocked', () => {
  const stock = [];
  const counted = {};
  counted[KD.countKey('חלב', 'groceries')] = 8; // count milk = 8 (not previously stocked)
  const result = KD.applyStockCount(catalog, stock, counted);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'חלב');
  assert.equal(result[0].qty, 8);
  assert.equal(result[0].unit, 'l');   // from catalog
  assert.equal(result[0].minQty, 15);  // default par from catalog
});

test('applyStockCount updates an existing item and keeps it at 0 when counted 0', () => {
  const stock = [{ id: 's1', name: 'חלב', category: 'groceries', qty: 3, unit: 'l', minQty: 15 }];
  const counted = {};
  counted[KD.countKey('חלב', 'groceries')] = 0; // counted zero
  const result = KD.applyStockCount(catalog, stock, counted);
  const milk = result.find((r) => r.id === 's1');
  assert.ok(milk, 'existing item is kept');
  assert.equal(milk.qty, 0);          // remains/becomes 0
  assert.equal(milk.minQty, 15);      // min preserved
});

test('applyStockCount omits catalog items left at 0 that were never stocked', () => {
  const result = KD.applyStockCount(catalog, [], {}); // nothing counted
  assert.equal(result.length, 0); // no rows added for 0-count catalog items
});

test('applyStockCount is the FULL pantry summary (existing + counted, nothing lost)', () => {
  const stock = [
    { id: 's1', name: 'חלב', category: 'groceries', qty: 3, unit: 'l', minQty: 15 },
    { id: 's2', name: 'בצים', category: 'groceries', qty: 5, unit: 'unit', minQty: 0 },
  ];
  const counted = {};
  counted[KD.countKey('חלב', 'groceries')] = 12;      // update existing
  counted[KD.countKey('אורז', 'dry')] = 4;            // add catalog item
  counted[KD.countKey('בצים', 'groceries')] = 6;      // update free-text item
  const result = KD.applyStockCount(catalog, stock, counted);
  const byName = Object.fromEntries(result.map((r) => [r.name, r]));
  assert.equal(byName['חלב'].qty, 12);
  assert.equal(byName['חלב'].id, 's1');  // identity preserved
  assert.equal(byName['בצים'].qty, 6);
  assert.equal(byName['בצים'].id, 's2');
  assert.equal(byName['אורז'].qty, 4);   // newly added
  assert.equal(byName['לחם'], undefined); // not counted, not stocked → omitted
  assert.equal(result.length, 3);
});

test('applyStockCount does not mutate the input stock', () => {
  const stock = [{ id: 's1', name: 'חלב', category: 'groceries', qty: 3, unit: 'l', minQty: 15 }];
  const counted = {}; counted[KD.countKey('חלב', 'groceries')] = 9;
  KD.applyStockCount(catalog, stock, counted);
  assert.equal(stock[0].qty, 3);
});
