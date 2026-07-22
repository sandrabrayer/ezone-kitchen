'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

/* -------------------- catalog corrections -------------------- */
test('correctCatalog forces canonical units/categories on stale entries', () => {
  const stale = [
    { name: 'גבינה צהובה', unit: 'kg', category: 'groceries', min: 3 },
    { name: 'חמאה', unit: 'kg', category: 'groceries', min: 2 },
    { name: 'גבינה לבנה', unit: 'kg', category: 'groceries', min: 6 },
  ];
  const fixed = KD.correctCatalog(stale);
  const e = (n) => KD.catalogLookup(fixed, n);
  assert.equal(e('גבינה צהובה').unit, 'g');
  assert.equal(e('גבינה צהובה').min, 3000);
  assert.equal(e('חמאה').unit, 'unit');
  assert.equal(e('חמאה').min, 8);
  assert.equal(e('גבינה לבנה').unit, 'unit');
});

test('correctCatalog renames the עכבניות typo to עגבניות in ירקות (deduped)', () => {
  const cat = KD.correctCatalog([
    { name: 'עכבניות', unit: 'kg', category: 'groceries', min: 5 }, // typo + wrong category
    { name: 'עגבניות', unit: 'kg', category: 'vegetables', min: 12 },
  ]);
  const hits = cat.filter((c) => KD.catalogKey(c.name) === KD.catalogKey('עגבניות'));
  assert.equal(hits.length, 1); // deduped
  assert.equal(hits[0].name, 'עגבניות');
  assert.equal(hits[0].category, 'vegetables');
  assert.equal(KD.catalogLookup(cat, 'עכבניות'), null);
});

test('correctCatalog drops the בצים duplicate, keeping ביצים (120 יחידות)', () => {
  const cat = KD.correctCatalog([
    { name: 'בצים', unit: 'unit', category: 'groceries', min: 0 },
    { name: 'ביצים', unit: 'unit', category: 'groceries', min: 120 },
  ]);
  const eggs = cat.filter((c) => KD.catalogKey(c.name) === KD.catalogKey('ביצים'));
  assert.equal(eggs.length, 1);
  assert.equal(eggs[0].name, 'ביצים');
  assert.equal(eggs[0].min, 120);
  assert.equal(KD.catalogLookup(cat, 'בצים'), null);
});

/* -------------------- stock corrections (eggs merge) -------------------- */
test('correctStock merges בצים qty into ביצים and drops בצים', () => {
  const stock = [
    { id: 'a', name: 'ביצים', category: 'groceries', qty: 10, unit: 'unit', minQty: 120 },
    { id: 'b', name: 'בצים', category: 'groceries', qty: 30, unit: 'unit', minQty: 0 },
  ];
  const fixed = KD.correctStock(stock);
  const eggs = fixed.filter((s) => KD.catalogKey(s.name) === KD.catalogKey('ביצים'));
  assert.equal(eggs.length, 1);
  assert.equal(eggs[0].name, 'ביצים');
  assert.equal(eggs[0].qty, 40); // 10 + 30
  assert.equal(fixed.find((s) => s.name === 'בצים'), undefined);
});

test('correctStock renames a lone בצים row to ביצים (no canonical row present)', () => {
  const fixed = KD.correctStock([{ id: 'b', name: 'בצים', category: 'groceries', qty: 24, unit: 'unit', minQty: 0 }]);
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].name, 'ביצים');
  assert.equal(fixed[0].qty, 24);
});

test('correctStock leaves an already-clean pantry unchanged (idempotent)', () => {
  const stock = [{ id: 'a', name: 'אורז', category: 'dry', qty: 5, unit: 'kg', minQty: 10 }];
  const once = KD.correctStock(stock);
  assert.deepEqual(once, stock);
  assert.deepEqual(KD.correctStock(once), once);
});

/* -------------------- split: עוף שלם/פרגיות → עוף שלם + פרגיות -------------------- */
test('SEED_CATALOG splits the combined meat item into two priced items', () => {
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'עוף שלם/פרגיות'), null); // combined gone
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'עוף שלם').price, 22);
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'פרגיות').price, 40);
});

test('correctCatalog folds a stored עוף שלם/פרגיות entry into עוף שלם', () => {
  const cat = KD.correctCatalog([{ name: 'עוף שלם/פרגיות', unit: 'kg', category: 'meat', min: 12 }]);
  assert.equal(KD.catalogLookup(cat, 'עוף שלם/פרגיות'), null);
  assert.equal(KD.catalogLookup(cat, 'עוף שלם').name, 'עוף שלם');
});

test('correctStock migrates a combined-name stock row to עוף שלם, merging quantity', () => {
  const fixed = KD.correctStock([
    { id: 'a', name: 'עוף שלם', category: 'meat', qty: 4, unit: 'kg', minQty: 0 },
    { id: 'b', name: 'עוף שלם/פרגיות', category: 'meat', qty: 6, unit: 'kg', minQty: 0 },
  ]);
  const rows = fixed.filter((s) => KD.catalogKey(s.name) === KD.catalogKey('עוף שלם'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 10); // 4 + 6
  assert.equal(fixed.find((s) => s.name === 'עוף שלם/פרגיות'), undefined);
});

test('correctStock renames a lone combined-name row to עוף שלם', () => {
  const fixed = KD.correctStock([{ id: 'b', name: 'עוף שלם/פרגיות', category: 'meat', qty: 7, unit: 'kg', minQty: 0 }]);
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].name, 'עוף שלם');
  assert.equal(fixed[0].qty, 7);
});

/* -------------------- par/price override key migration -------------------- */
test('migrateParOverrideKeys moves a combined-name override onto עוף שלם', () => {
  const out = KD.migrateParOverrideKeys({ [KD.catalogKey('עוף שלם/פרגיות')]: { min: 20, price: 25 } });
  assert.deepEqual(out, { [KD.catalogKey('עוף שלם')]: { min: 20, price: 25 } });
});

test('migrateParOverrideKeys: a saved עוף שלם override is NEVER clobbered by the alias', () => {
  const combinedKey = KD.catalogKey('עוף שלם/פרגיות');
  const canonKey = KD.catalogKey('עוף שלם');
  const out = KD.migrateParOverrideKeys({ [combinedKey]: { price: 25 }, [canonKey]: { price: 30 } });
  assert.deepEqual(out, { [canonKey]: { price: 30 } }); // canonical wins, regardless of order
});

test('migrateParOverrideKeys leaves a clean map unchanged (idempotent) and drops proto keys', () => {
  const clean = { [KD.catalogKey('אורז')]: { min: 5 } };
  assert.deepEqual(KD.migrateParOverrideKeys(clean), clean);
  assert.deepEqual(KD.migrateParOverrideKeys(KD.migrateParOverrideKeys(clean)), clean);
  assert.deepEqual(KD.migrateParOverrideKeys({ __proto__: { min: 9 } }), {});
});

/* -------------------- weeklyPlan split -------------------- */
function weekWith(ings) {
  const w = KD.emptyWeekMenu('2026-07-19');
  w.days.sunday.lunch = [{ id: 'd', name: 'תבשיל', ingredients: ings }];
  return w;
}

test('weeklyPlan puts menu items in `menu` and par-only shortfalls in `parTopUp`', () => {
  const week = weekWith([{ id: 'i', name: 'אורז', category: 'dry', qty: 4, unit: 'kg' }]);
  const stock = [
    { id: 's1', name: 'אורז', category: 'dry', qty: 1, unit: 'kg', minQty: 2 },   // in the menu
    { id: 's2', name: 'מלח', category: 'dry', qty: 0, unit: 'kg', minQty: 2 },     // par-only, below min
    { id: 's3', name: 'סוכר', category: 'dry', qty: 9, unit: 'kg', minQty: 5 },     // par-only, above min → excluded
  ];
  const plan = KD.weeklyPlan(week, stock);
  assert.equal(plan.menuEmpty, false);
  const rice = plan.menu.find((m) => m.name === 'אורז');
  assert.equal(rice.requiredQty, 4);
  assert.equal(rice.stockQty, 1);
  assert.equal(rice.missing, 3); // 4 − 1
  assert.equal(plan.menu.length, 1); // only the menu ingredient
  const salt = plan.parTopUp.find((p) => p.name === 'מלח');
  assert.equal(salt.missing, 2); // 2 − 0
  assert.equal(plan.parTopUp.find((p) => p.name === 'סוכר'), undefined); // above min
  assert.equal(plan.parTopUp.find((p) => p.name === 'אורז'), undefined); // it's a menu item
});

test('weeklyPlan flags an empty menu (menuEmpty) with no menu rows', () => {
  const plan = KD.weeklyPlan(KD.emptyWeekMenu('2026-07-19'), [{ id: 's', name: 'מלח', category: 'dry', qty: 0, unit: 'kg', minQty: 2 }]);
  assert.equal(plan.menuEmpty, true);
  assert.equal(plan.menu.length, 0);
  assert.equal(plan.parTopUp.length, 1); // par section still surfaces below-min items
});
