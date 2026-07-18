'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('converts grams to kg and back', () => {
  assert.equal(KD.gramsToKg(500), 0.5);
  assert.equal(KD.gramsToKg(1000), 1);
  assert.equal(KD.kgToGrams(2), 2000);
});

test('normalises input by unit (legacy toKg helper)', () => {
  assert.equal(KD.toKg(2, 'kg'), 2);
  assert.equal(KD.toKg(250, 'g'), 0.25);
});

test('clamps invalid input to 0', () => {
  assert.equal(KD.toKg(-1, 'kg'), 0);
  assert.equal(KD.toKg(NaN, 'g'), 0);
});

test('rounds without float noise', () => {
  assert.equal(KD.roundQty(0.1 + 0.2), 0.3);
  assert.equal(KD.roundQty(1.23456, 2), 1.23);
  assert.equal(KD.roundKg(0.1 + 0.2), 0.3); // back-compat alias
});

/* ------------------------- unit system ------------------------- */
test('UNITS is the closed set kg / g / unit / l / ml with Hebrew labels', () => {
  assert.deepEqual(KD.UNITS, ['kg', 'g', 'unit', 'l', 'ml']);
  assert.equal(KD.UNIT_LABELS_HE.kg, 'ק"ג');
  assert.equal(KD.UNIT_LABELS_HE.g, 'גרם');
  assert.equal(KD.UNIT_LABELS_HE.unit, 'יחידות');
  assert.equal(KD.UNIT_LABELS_HE.l, 'ליטר');
  assert.equal(KD.UNIT_LABELS_HE.ml, 'מ"ל');
});

test('isUnit / safeUnit guard against unknown units', () => {
  assert.equal(KD.isUnit('kg'), true);
  assert.equal(KD.isUnit('ml'), true);
  assert.equal(KD.isUnit('lb'), false);
  assert.equal(KD.isUnit(''), false);
  assert.equal(KD.safeUnit('lb'), 'kg'); // unknown → kg (legacy default)
  assert.equal(KD.safeUnit('ml'), 'ml');
});

test('unitFamily / baseUnitOf group the three families', () => {
  assert.equal(KD.unitFamily('kg'), 'mass');
  assert.equal(KD.unitFamily('g'), 'mass');
  assert.equal(KD.unitFamily('l'), 'volume');
  assert.equal(KD.unitFamily('ml'), 'volume');
  assert.equal(KD.unitFamily('unit'), 'count');
  assert.equal(KD.baseUnitOf('g'), 'kg');
  assert.equal(KD.baseUnitOf('ml'), 'l');
  assert.equal(KD.baseUnitOf('unit'), 'unit');
});

test('convertUnit converts within a family (kg↔g, l↔ml)', () => {
  assert.equal(KD.convertUnit(1, 'kg', 'g'), 1000);
  assert.equal(KD.convertUnit(500, 'g', 'kg'), 0.5);
  assert.equal(KD.convertUnit(2, 'l', 'ml'), 2000);
  assert.equal(KD.convertUnit(250, 'ml', 'l'), 0.25);
  assert.equal(KD.convertUnit(3, 'unit', 'unit'), 3);
});

test('convertUnit refuses to cross families (kg → l is undefined)', () => {
  assert.ok(Number.isNaN(KD.convertUnit(1, 'kg', 'l')));
  assert.ok(Number.isNaN(KD.convertUnit(1, 'ml', 'g')));
  assert.ok(Number.isNaN(KD.convertUnit(1, 'unit', 'kg')));
});

test('convertUnit clamps invalid / negative input to 0', () => {
  assert.equal(KD.convertUnit(-5, 'kg', 'g'), 0);
  assert.equal(KD.convertUnit(NaN, 'l', 'ml'), 0);
});

test('toBaseValue expresses a quantity in its family base unit', () => {
  assert.equal(KD.toBaseValue(500, 'g'), 0.5); // → kg
  assert.equal(KD.toBaseValue(2, 'kg'), 2);
  assert.equal(KD.toBaseValue(250, 'ml'), 0.25); // → l
  assert.equal(KD.toBaseValue(4, 'unit'), 4);
  assert.equal(KD.toBaseValue(-1, 'kg'), 0);
});
