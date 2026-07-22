'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('validateBudgetInput coerces amounts to non-negative numbers', () => {
  const r = KD.validateBudgetInput({ budget: 228109, instructorsBudget: 72744, overrun: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.value.budget, 228109);
  assert.equal(r.value.instructorsBudget, 72744);
  assert.equal(r.value.overrun, 500);
  assert.deepEqual(r.warnings, []);
});

test('validateBudgetInput clamps negative / invalid amounts to 0 (never errors)', () => {
  const r = KD.validateBudgetInput({ budget: -5, instructorsBudget: 'abc', overrun: NaN });
  assert.equal(r.ok, true);
  assert.equal(r.value.budget, 0);
  assert.equal(r.value.instructorsBudget, 0);
  assert.equal(r.value.overrun, 0);
});

test('validateBudgetInput warns (not errors) when instructors budget exceeds the total', () => {
  const r = KD.validateBudgetInput({ budget: 60000, instructorsBudget: 72744 });
  assert.equal(r.ok, true); // still valid — a house may over-commit its instructor line
  assert.equal(r.value.instructorsBudget, 72744);
  assert.ok(r.warnings.includes('instructors_over_total'));
});

test('validateBudgetInput does not warn when instructors ≤ total', () => {
  const r = KD.validateBudgetInput({ budget: 190476, instructorsBudget: 60620 });
  assert.deepEqual(r.warnings, []);
});

test('validateBudgetInput does not warn when the total is 0 (nothing to exceed)', () => {
  const r = KD.validateBudgetInput({ budget: 0, instructorsBudget: 5000 });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.value.instructorsBudget, 5000);
});

test('validateBudgetInput preserves the overrun note and defaults a missing one', () => {
  assert.equal(KD.validateBudgetInput({ overrunNote: 'אישור מנהל' }).value.overrunNote, 'אישור מנהל');
  assert.equal(KD.validateBudgetInput({}).value.overrunNote, '');
});

test('nonNegativeAmount helper: >0 kept, everything else 0', () => {
  assert.equal(KD.nonNegativeAmount(72744), 72744);
  assert.equal(KD.nonNegativeAmount(0), 0);
  assert.equal(KD.nonNegativeAmount(-1), 0);
  assert.equal(KD.nonNegativeAmount('x'), 0);
  assert.equal(KD.nonNegativeAmount(undefined), 0);
});
