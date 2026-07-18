'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('mergeCatalog de-duplicates by normalised name (case/space-insensitive)', () => {
  const merged = KD.mergeCatalog(
    [{ name: 'Rice', unit: 'kg', category: 'dry' }],
    [{ name: 'rice', unit: 'g', category: 'groceries' }, { name: '  RICE  ', unit: 'kg', category: 'dry' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Rice'); // first-seen (existing) wins
  assert.equal(merged[0].unit, 'kg');
  assert.equal(merged[0].category, 'dry');
});

test('mergeCatalog appends genuinely new names and drops blanks', () => {
  const merged = KD.mergeCatalog(
    [{ name: 'Rice', unit: 'kg', category: 'dry' }],
    [{ name: 'Milk', unit: 'l', category: 'groceries' }, { name: '   ', unit: 'kg', category: 'dry' }, { name: '' }],
  );
  assert.deepEqual(merged.map((e) => e.name).sort(), ['Milk', 'Rice']);
});

test('mergeCatalog whitelists unit and category (bad values coerced)', () => {
  const merged = KD.mergeCatalog([], [{ name: 'Thing', unit: 'lbs', category: 'nope' }]);
  assert.equal(merged[0].unit, 'kg'); // unknown unit → kg
  assert.equal(merged[0].category, 'groceries'); // unknown category → groceries
});

test('catalogLookup finds an entry case-insensitively, else null', () => {
  const cat = [{ name: 'Olive Oil', unit: 'l', category: 'groceries' }];
  assert.equal(KD.catalogLookup(cat, 'olive oil').unit, 'l');
  assert.equal(KD.catalogLookup(cat, 'OLIVE OIL').category, 'groceries');
  assert.equal(KD.catalogLookup(cat, 'butter'), null);
  assert.equal(KD.catalogLookup(cat, ''), null);
});

test('mergeCatalog is stable/idempotent — merging its own output changes nothing', () => {
  const once = KD.mergeCatalog([], [{ name: 'A', unit: 'kg', category: 'dry' }, { name: 'B', unit: 'l', category: 'groceries' }]);
  const twice = KD.mergeCatalog(once, once);
  assert.deepEqual(twice, once);
});
