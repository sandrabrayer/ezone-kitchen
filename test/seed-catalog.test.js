'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('SEED_CATALOG entries are all valid (unit, category, positive min, unique)', () => {
  const seen = new Set();
  for (const e of KD.SEED_CATALOG) {
    assert.ok(e.name && e.name.trim(), 'name required');
    assert.ok(KD.isUnit(e.unit), `bad unit for ${e.name}: ${e.unit}`);
    assert.ok(KD.isCategory(e.category), `bad category for ${e.name}: ${e.category}`);
    assert.ok(e.min > 0, `min must be positive for ${e.name}`);
    const key = KD.catalogKey(e.name);
    assert.ok(!seen.has(key), `duplicate seed name: ${e.name}`);
    seen.add(key);
  }
});

test('SEED_CATALOG covers every category with the agreed counts', () => {
  const counts = {};
  for (const e of KD.SEED_CATALOG) counts[e.category] = (counts[e.category] || 0) + 1;
  assert.deepEqual(counts, { groceries: 11, dry: 39, vegetables: 21, fruits: 10, meat: 8 });
  assert.equal(KD.SEED_CATALOG.length, 89);
});

test('SEED_CATALOG carries the specified par levels (spot checks)', () => {
  const min = (n) => KD.catalogLookup(KD.SEED_CATALOG, n).min;
  assert.equal(min('ביצים'), 120);
  assert.equal(min('חלב'), 15);
  assert.equal(min('תפוחי אדמה'), 15);
  assert.equal(min('עוף שלם/פרגיות'), 12);
  assert.equal(min('פפריקה'), 500);
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'ביצים').unit, 'unit');
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'חלב').unit, 'l');
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'פפריקה').unit, 'g');
});

test('SEED_CATALOG dairy unit corrections', () => {
  const e = (n) => KD.catalogLookup(KD.SEED_CATALOG, n);
  assert.equal(e('גבינה לבנה').unit, 'unit');   // גביעים
  assert.equal(e('גבינה לבנה').min, 6);
  assert.equal(e('גבינה צהובה').unit, 'g');
  assert.equal(e('גבינה צהובה').min, 3000);
  assert.equal(e('חמאה').unit, 'unit');
  assert.equal(e('חמאה').min, 8);
  assert.equal(e('שמנת מתוקה').unit, 'unit');   // גביעים
  assert.equal(e('שמנת חמוצה').unit, 'unit');   // גביעים
});

test('SEED_CATALOG has עגבניות in ירקות once, no מכולת duplicate, no typo/eggs-dupe', () => {
  const tomato = KD.SEED_CATALOG.filter((e) => KD.catalogKey(e.name) === KD.catalogKey('עגבניות'));
  assert.equal(tomato.length, 1);
  assert.equal(tomato[0].category, 'vegetables');
  // no misspellings present in the seed
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'עכבניות'), null);
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'בצים'), null);
  // eggs are ביצים only
  assert.ok(KD.catalogLookup(KD.SEED_CATALOG, 'ביצים'));
});

test('seedCatalog populates an empty catalog with every seed item + its min', () => {
  const cat = KD.seedCatalog([]);
  assert.equal(cat.length, 89);
  assert.equal(KD.catalogLookup(cat, 'אורז').min, 10);
});

test('seedCatalog is idempotent — merging again changes nothing', () => {
  const once = KD.seedCatalog([]);
  const twice = KD.seedCatalog(once);
  assert.deepEqual(twice, once);
});

test('seedCatalog never overwrites a user edit (unit / category / non-zero min win)', () => {
  // A cook renamed the unit/category and set a custom par level for אורז.
  const user = [{ name: 'אורז', unit: 'g', category: 'groceries', min: 3 }];
  const cat = KD.seedCatalog(user);
  const rice = KD.catalogLookup(cat, 'אורז');
  assert.equal(rice.unit, 'g');            // user's unit preserved (seed says kg)
  assert.equal(rice.category, 'groceries'); // user's category preserved (seed says dry)
  assert.equal(rice.min, 3);                // user's non-zero min preserved (seed says 10)
});

test('seedCatalog fills a MISSING (zero) default min from the seed', () => {
  // אורז was catalogued before par levels existed → min 0. Seed fills it.
  const legacy = [{ name: 'אורז', unit: 'kg', category: 'dry' }];
  const cat = KD.seedCatalog(legacy);
  assert.equal(KD.catalogLookup(cat, 'אורז').min, 10); // filled from seed
});

test('seedCatalog merges seed alongside genuinely new user items', () => {
  const user = [{ name: 'פריט מיוחד', unit: 'unit', category: 'dry', min: 7 }];
  const cat = KD.seedCatalog(user);
  assert.equal(cat.length, 90); // 89 seed + 1 custom
  assert.equal(KD.catalogLookup(cat, 'פריט מיוחד').min, 7);
});

test('mergeCatalog keeps `min` and only fills a zero default, never lowers a set one', () => {
  const a = KD.mergeCatalog([{ name: 'X', unit: 'kg', category: 'dry', min: 5 }], [{ name: 'X', min: 99 }]);
  assert.equal(a[0].min, 5); // set min not overwritten
  const b = KD.mergeCatalog([{ name: 'Y', unit: 'kg', category: 'dry', min: 0 }], [{ name: 'Y', min: 4 }]);
  assert.equal(b[0].min, 4); // zero default filled
});
