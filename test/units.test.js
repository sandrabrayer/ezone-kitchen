'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('converts grams to kg and back', () => {
  assert.equal(KD.gramsToKg(500), 0.5);
  assert.equal(KD.gramsToKg(1000), 1);
  assert.equal(KD.kgToGrams(2), 2000);
});

test('normalises input by unit', () => {
  assert.equal(KD.toKg(2, 'kg'), 2);
  assert.equal(KD.toKg(250, 'g'), 0.25);
});

test('clamps invalid input to 0', () => {
  assert.equal(KD.toKg(-1, 'kg'), 0);
  assert.equal(KD.toKg(NaN, 'g'), 0);
});

test('rounds without float noise', () => {
  assert.equal(KD.roundKg(0.1 + 0.2), 0.3);
  assert.equal(KD.roundKg(1.23456, 2), 1.23);
});
