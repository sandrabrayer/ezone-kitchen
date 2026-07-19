'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('readShoppingExtra normalises name/qty/unit/category and assigns an id', () => {
  const e = KD.readShoppingExtra({ name: '  נייר סופג ', qty: '3', unit: 'unit', category: 'dry' });
  assert.equal(e.name, 'נייר סופג');
  assert.equal(e.qty, 3);
  assert.equal(e.unit, 'unit');
  assert.equal(e.category, 'dry');
  assert.ok(e.id, 'an extra gets an id');
});

test('readShoppingExtra coerces bad values to safe defaults', () => {
  const e = KD.readShoppingExtra({ name: 'X', qty: -5, unit: 'lbs', category: 'nope' });
  assert.equal(e.qty, 0); // negative → 0
  assert.equal(e.unit, 'kg'); // unknown unit → kg
  assert.equal(e.category, 'groceries'); // unknown category → groceries
});

test('readShoppingExtra keeps an explicit id and reads legacy value field', () => {
  const e = KD.readShoppingExtra({ id: 'extra_1', name: 'Y', value: 2 });
  assert.equal(e.id, 'extra_1');
  assert.equal(e.qty, 2);
});
