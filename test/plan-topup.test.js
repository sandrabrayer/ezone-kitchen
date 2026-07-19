'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

const CAT = [
  { name: 'חלב', unit: 'l', category: 'groceries', min: 15, price: 6.5 },
  { name: 'אורז', unit: 'kg', category: 'dry', min: 10, price: 8 },
  { name: 'מלח', unit: 'kg', category: 'dry', min: 2, price: 3 },
];

test('effectiveCatalogStock includes unstocked catalog items at qty 0 with the effective par', () => {
  const eff = KD.effectiveCatalogStock(CAT, [], 50, {}); // 50 people → doubled par
  assert.equal(eff.length, 3);
  const milk = eff.find((r) => r.name === 'חלב');
  assert.equal(milk.qty, 0);
  assert.equal(milk.minQty, 30); // 15 × 50/25
  // an override still wins
  const ov = KD.effectiveCatalogStock(CAT, [], 50, { [KD.catalogKey('חלב')]: { min: 12 } }).find((r) => r.name === 'חלב');
  assert.equal(ov.minQty, 12);
});

test('effectiveCatalogStock keeps a free-text pantry item not in the catalog', () => {
  const stock = [{ id: 'e', name: 'מגבונים', category: 'dry', qty: 4, unit: 'unit', minQty: 6 }];
  const eff = KD.effectiveCatalogStock(CAT, stock, 25, {});
  const wipes = eff.find((r) => r.name === 'מגבונים');
  assert.ok(wipes, 'free-text item preserved');
  assert.equal(wipes.qty, 4);
  assert.equal(wipes.minQty, 6); // its own stored par
  assert.equal(eff.length, 4); // 3 catalog + 1 free-text
});

test('REGRESSION: empty stock + catalog → the plan top-up lists every par item (not only stock rows)', () => {
  const week = KD.emptyWeekMenu('2026-07-19');
  const eff = KD.effectiveCatalogStock(CAT, [], 25, {});
  const plan = KD.weeklyPlan(week, eff, undefined);
  assert.equal(plan.menuEmpty, true);
  assert.equal(plan.parTopUp.length, 3); // all three, though NONE are in stock
  const milk = plan.parTopUp.find((p) => p.name === 'חלב');
  assert.equal(milk.stockQty, 0);
  assert.equal(milk.missing, 15); // effective par at 25 people
});

test('REGRESSION: empty stock + FULL seed catalog → every item with min>0 appears in the top-up', () => {
  const week = KD.emptyWeekMenu('2026-07-19');
  const cat = KD.seedCatalog([]); // 89 items, all with a par
  const eff = KD.effectiveCatalogStock(cat, [], 25, {});
  const plan = KD.weeklyPlan(week, eff, undefined);
  const withPar = cat.filter((c) => c.min > 0).length;
  assert.equal(withPar, 89);
  assert.equal(plan.parTopUp.length, 89);
  assert.ok(plan.parTopUp.every((p) => p.missing > 0));
});

test('REGRESSION: קניות over the full catalog buys the effective par for unstocked items', () => {
  const week = KD.emptyWeekMenu('2026-07-19');
  const eff = KD.effectiveCatalogStock(CAT, [], 50, {});
  const list = KD.buildShoppingList(week, eff);
  const milk = list.lines.find((l) => l.name === 'חלב');
  assert.equal(milk.stockQty, 0);
  assert.equal(milk.toBuyQty, 30); // 15 × 50/25
  assert.equal(list.lines.filter((l) => l.toBuyQty > 0).length, 3); // all three surface
});

test('items already stocked at/above par do NOT clutter the top-up', () => {
  const week = KD.emptyWeekMenu('2026-07-19');
  const stock = [{ id: 's', name: 'חלב', category: 'groceries', qty: 99, unit: 'l', minQty: 0 }];
  const eff = KD.effectiveCatalogStock(CAT, stock, 25, {});
  const plan = KD.weeklyPlan(week, eff, undefined);
  assert.equal(plan.parTopUp.find((p) => p.name === 'חלב'), undefined); // above par → hidden
  assert.ok(plan.parTopUp.find((p) => p.name === 'אורז')); // unstocked → still shown
  assert.ok(plan.parTopUp.find((p) => p.name === 'מלח'));
});
