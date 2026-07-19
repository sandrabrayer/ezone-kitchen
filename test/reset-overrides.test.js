'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('clearParOverride removes a single item override (whole entry)', () => {
  const ov = { a: { min: 5 }, b: { min: 3, price: 2 } };
  const out = KD.clearParOverride(ov, 'a');
  assert.deepEqual(out, { b: { min: 3, price: 2 } });
});

test('clearParOverride with a field clears only that field, keeping the rest', () => {
  const ov = { b: { min: 3, price: 2 } };
  assert.deepEqual(KD.clearParOverride(ov, 'b', 'min'), { b: { price: 2 } });
  assert.deepEqual(KD.clearParOverride(ov, 'b', 'price'), { b: { min: 3 } });
});

test('clearParOverride drops the entry when the last field is cleared', () => {
  assert.deepEqual(KD.clearParOverride({ b: { min: 3 } }, 'b', 'min'), {});
});

test('clearParOverride is pure — the input map is never mutated (house-scoped)', () => {
  const houseA = { milk: { min: 5, price: 6 } };
  const houseB = { rice: { min: 9 } };
  const out = KD.clearParOverride(houseA, 'milk');
  assert.deepEqual(out, {});
  assert.deepEqual(houseA, { milk: { min: 5, price: 6 } }); // input untouched
  assert.deepEqual(houseB, { rice: { min: 9 } });           // other house untouched
});

test('clearParOverride ignores prototype-pollution keys', () => {
  const ov = { real: { min: 1 } };
  const out = KD.clearParOverride(ov, '__proto__');
  assert.deepEqual(out, { real: { min: 1 } });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('reset single: baseline row returns to the scaled default after clearing', () => {
  const cat = [{ name: 'חלב', unit: 'l', category: 'groceries', min: 15, price: 6.5 }];
  const key = KD.catalogKey('חלב');
  const withOv = KD.baselineForHouse(cat, 50, { [key]: { min: 10, price: 5 } });
  const milkOv = withOv.rows.find((r) => r.name === 'חלב');
  assert.equal(milkOv.weekQty, 10);            // override
  assert.equal(milkOv.minSource, 'manual');
  const cleared = KD.baselineForHouse(cat, 50, KD.clearParOverride({ [key]: { min: 10, price: 5 } }, key));
  const milk = cleared.rows.find((r) => r.name === 'חלב');
  assert.equal(milk.weekQty, 30);              // scaled seed (15 × 50/25)
  assert.equal(milk.price, 6.5);               // seed price
  assert.equal(milk.minSource, 'default');
  assert.equal(milk.priceSource, 'default');
});

test('reset all: an empty override map yields an all-default baseline', () => {
  const cat = [
    { name: 'חלב', unit: 'l', category: 'groceries', min: 15, price: 6.5 },
    { name: 'אורז', unit: 'kg', category: 'dry', min: 10, price: 8 },
  ];
  const b = KD.baselineForHouse(cat, 25, {}); // all cleared
  assert.ok(b.rows.every((r) => r.minSource === 'default' && r.priceSource === 'default'));
});

test('reset min only leaves a price override in place (מלאי per-row reset)', () => {
  const cat = [{ name: 'חלב', unit: 'l', category: 'groceries', min: 15, price: 6.5 }];
  const key = KD.catalogKey('חלב');
  const next = KD.clearParOverride({ [key]: { min: 10, price: 5 } }, key, 'min');
  assert.deepEqual(next, { [key]: { price: 5 } });
  const b = KD.baselineForHouse(cat, 50, next);
  const milk = b.rows.find((r) => r.name === 'חלב');
  assert.equal(milk.weekQty, 30);      // par back to scaled default
  assert.equal(milk.minSource, 'default');
  assert.equal(milk.price, 5);         // price override kept
  assert.equal(milk.priceSource, 'manual');
});
