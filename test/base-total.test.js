'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

// The "סה"כ בסיס" figure = base patients + base staff. It must reflect the
// numbers entered, not sit stuck at 0 (the bug this covers).
test('baseTotal sums base patients and base staff', () => {
  assert.equal(KD.baseTotal({ basePatients: 15, baseStaff: 10 }), 25);
  assert.equal(KD.baseTotal({ basePatients: 8, baseStaff: 2 }), 10);
});

test('baseTotal ignores per-day overrides (base figure only)', () => {
  const hc = { basePatients: 15, baseStaff: 10, overrides: { sunday: { patients: 100, staff: 100 } } };
  assert.equal(KD.baseTotal(hc), 25);
});

test('baseTotal treats missing / invalid parts as 0 and never goes negative', () => {
  assert.equal(KD.baseTotal({}), 0);
  assert.equal(KD.baseTotal(null), 0);
  assert.equal(KD.baseTotal({ basePatients: 5 }), 5);
  assert.equal(KD.baseTotal({ basePatients: -4, baseStaff: 3 }), 3);
  assert.equal(KD.baseTotal({ basePatients: '12', baseStaff: '3' }), 15); // string inputs coerced
});

test('baseTotal floors fractional counts (people are whole)', () => {
  assert.equal(KD.baseTotal({ basePatients: 10.9, baseStaff: 2.2 }), 12);
});
