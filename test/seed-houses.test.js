'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const KD = require('../lib/kitchen-domain');

// The agreed production houses: fixed human-readable ids + Hebrew display names.
const EXPECTED = [
  { id: 'ramot-hashavim', name: 'רמות השבים' },
  { id: 'raanana-asher', name: 'רעננה אשר' },
  { id: 'caesarea-ofroni', name: 'קיסריה עפרוני' },
  { id: 'caesarea-rehab', name: 'קיסריה ריהאב' },
  { id: 'pardes', name: 'פרדס' },
];

test('SEED_HOUSES is exactly the five production houses, in order', () => {
  assert.deepEqual(KD.SEED_HOUSES, EXPECTED);
});

test('housesToSeed seeds all five when there are no houses yet', () => {
  const seeded = KD.housesToSeed([]);
  assert.deepEqual(seeded, EXPECTED);
});

test('housesToSeed is a no-op once any house exists (idempotent)', () => {
  // Already-populated tab → seed nothing, so a rerun never duplicates.
  assert.deepEqual(KD.housesToSeed(KD.SEED_HOUSES), []);
  assert.deepEqual(KD.housesToSeed([{ id: 'x', name: 'anything' }]), []);
});

test('housesToSeed accepts a count as well as an array', () => {
  assert.equal(KD.housesToSeed(0).length, 5);
  assert.equal(KD.housesToSeed(5).length, 0);
  assert.equal(KD.housesToSeed(1).length, 0);
});

test('running the seed twice yields five houses, never ten (idempotent simulation)', () => {
  // Model the backend: on each load, append whatever housesToSeed returns.
  let houses = [];
  const load = () => { houses = houses.concat(KD.housesToSeed(houses)); };
  load(); // first ever load → seeds
  load(); // second load → no-op
  assert.equal(houses.length, 5);
  assert.deepEqual(houses.map((h) => h.id).sort(), EXPECTED.map((h) => h.id).sort());
  // No duplicate ids.
  assert.equal(new Set(houses.map((h) => h.id)).size, 5);
});

test('the returned seed objects are fresh copies (mutating them cannot corrupt SEED_HOUSES)', () => {
  const seeded = KD.housesToSeed([]);
  seeded[0].name = 'MUTATED';
  assert.equal(KD.SEED_HOUSES[0].name, 'רמות השבים');
});

// The Apps Script backend (Code.gs) holds a mirror of this list because it
// cannot require() the module. Guard against the two drifting, and against the
// idempotency guard being lost.
test('Code.gs mirrors the seed list and keeps the empty-tab guard', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  for (const h of EXPECTED) {
    assert.ok(gs.includes(`'${h.id}'`), `Code.gs is missing seed id ${h.id}`);
    assert.ok(gs.includes(h.name), `Code.gs is missing Hebrew name ${h.name}`);
  }
  // Seeds only when empty (idempotent) and is wired into the load path.
  assert.match(gs, /readRows_\('houses'\)\.length > 0/, 'Code.gs lost the empty-tab seed guard');
  assert.match(gs, /seedHousesIfEmpty_\(\);/, 'loadAll_ must call seedHousesIfEmpty_');
});
