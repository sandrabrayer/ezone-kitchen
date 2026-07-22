'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

/* Regression for the "seeded catalog not appearing" bug: production loaded with a
   NON-empty catalog (only user items) and none of the 89 seed items showed. The
   frontend now seeds the catalog up front and defensively, but the underlying
   data invariant — merge(user catalog, SEED) yields user + all 89, untouched —
   is asserted here so it can't silently regress. */

const SEED_LEN = 90;

test('load with catalog = [one user item] → user item + all 90 seed items', () => {
  const user = [{ name: 'בצים', unit: 'unit', category: 'groceries' }]; // user's own item
  const merged = KD.mergeCatalog(user, KD.SEED_CATALOG);
  assert.equal(merged.length, SEED_LEN + 1);
  assert.ok(KD.catalogLookup(merged, 'בצים'), 'user item present');
  assert.ok(KD.catalogLookup(merged, 'ביצים'), 'seed item ביצים present');
  assert.ok(KD.catalogLookup(merged, 'עוף שלם'), 'split meat item עוף שלם present');
  assert.ok(KD.catalogLookup(merged, 'פרגיות'), 'split meat item פרגיות present');
});

test('the user item is untouched (unit/category preserved over any seed clash)', () => {
  // A user item whose name collides with a seed name but with different unit/cat.
  const user = [{ name: 'אורז', unit: 'g', category: 'groceries', min: 3 }];
  const merged = KD.mergeCatalog(user, KD.SEED_CATALOG);
  const rice = KD.catalogLookup(merged, 'אורז');
  assert.equal(rice.unit, 'g');            // user's unit wins (seed says kg)
  assert.equal(rice.category, 'groceries'); // user's category wins (seed says dry)
  assert.equal(rice.min, 3);               // user's non-zero min wins (seed says 10)
  assert.equal(merged.length, SEED_LEN);   // same name → no duplicate row
});

test('partial data from the failed-save window still ends fully seeded', () => {
  // During the saveCatalog outage the tab could hold a few seed names + junk rows
  // (blanks / malformed). The merge must recover to all 89 seed + any real extras.
  const partial = [
    { name: 'ביצים', unit: 'unit', category: 'groceries' }, // one seed name got saved
    { name: 'חלב', unit: '', category: 'nonsense' },        // saved with bad unit/category
    { name: '', unit: 'kg', category: 'dry' },              // blank row → dropped
    { name: '   ', unit: 'kg', category: 'dry' },           // whitespace → dropped
    { name: 'פריט של הבית', unit: 'unit', category: 'dry' }, // a real user item
  ];
  const merged = KD.mergeCatalog(partial, KD.SEED_CATALOG);
  assert.equal(merged.length, SEED_LEN + 1); // 89 seed + the one real user item
  assert.ok(KD.catalogLookup(merged, 'פריט של הבית'));
  // The bad חלב row is coerced to valid values (empty unit → kg default), kept —
  // not dropped — so every item still surfaces in the datalists.
  assert.equal(KD.catalogLookup(merged, 'חלב').unit, 'kg');
});

test('seeding is idempotent even after a save round-trip loses the min column', () => {
  // Backend catalog tab stores name/unit/category (no min). After a save+reload,
  // the seed re-supplies mins every load; the name set is stable → no churn.
  const afterSave = KD.mergeCatalog([], KD.SEED_CATALOG).map((c) => ({ name: c.name, unit: c.unit, category: c.category }));
  const remerged = KD.mergeCatalog(afterSave, KD.SEED_CATALOG);
  const sig = (cat) => cat.map((c) => KD.catalogKey(c.name)).sort().join('|');
  assert.equal(sig(remerged), sig(afterSave)); // name set unchanged → no re-persist
  assert.equal(KD.catalogLookup(remerged, 'אורז').min, 10); // min re-derived from seed
});
