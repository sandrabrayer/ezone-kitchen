'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('isInstructorRole matches only מדריך (trimmed)', () => {
  assert.equal(KD.isInstructorRole('מדריך'), true);
  assert.equal(KD.isInstructorRole('  מדריך  '), true);
  assert.equal(KD.isInstructorRole('טבח'), false);
  assert.equal(KD.isInstructorRole(''), false);
  assert.equal(KD.isInstructorRole(null), false);
});

test('instructorCostForMonth sums recorded monthly actuals for מדריך workers', () => {
  const workers = [
    { name: 'א', role: 'מדריך', cost: 1000, actuals: { '2026-07': 1200 } },
    { name: 'ב', role: 'מדריך', cost: 800, actuals: { '2026-07': 900 } },
    { name: 'ג', role: 'טבח', cost: 5000, actuals: { '2026-07': 5000 } }, // not an instructor
  ];
  const r = KD.instructorCostForMonth(workers, '2026-07', 99999);
  assert.equal(r.cost, 2100);      // 1200 + 900, cook excluded
  assert.equal(r.estimated, false); // real actuals present
  assert.equal(r.count, 2);
});

test('instructorCostForMonth fills a worker missing that month with its standard cost', () => {
  const workers = [
    { name: 'א', role: 'מדריך', cost: 1000, actuals: { '2026-07': 1200 } },
    { name: 'ב', role: 'מדריך', cost: 800 }, // no actuals at all → use base cost
  ];
  const r = KD.instructorCostForMonth(workers, '2026-07', 0);
  assert.equal(r.cost, 2000); // 1200 (actual) + 800 (base fill)
  assert.equal(r.estimated, false);
});

test('instructorCostForMonth ESTIMATES from base costs when no month has an actual', () => {
  const workers = [
    { name: 'א', role: 'מדריך', cost: 1000, actuals: { '2026-06': 1200 } }, // only prior month
    { name: 'ב', role: 'מדריך', cost: 800 },
  ];
  const r = KD.instructorCostForMonth(workers, '2026-07', 99999);
  assert.equal(r.cost, 1800); // 1000 + 800 base estimate (prior-month actual ignored)
  assert.equal(r.estimated, true);
  assert.equal(r.count, 2);
});

test('instructorCostForMonth falls back to the instructors budget when there are no מדריך workers', () => {
  const r = KD.instructorCostForMonth([{ role: 'טבח', cost: 5000 }], '2026-07', 60620);
  assert.equal(r.cost, 60620);
  assert.equal(r.estimated, true);
  assert.equal(r.count, 0);
});

test('instructorCostForMonth is 0/estimated with no workers and no fallback', () => {
  const r = KD.instructorCostForMonth(undefined, '2026-07');
  assert.equal(r.cost, 0);
  assert.equal(r.estimated, true);
  assert.equal(r.count, 0);
});

test('instructorCostForMonth ignores negative/invalid costs (clamped to 0)', () => {
  const workers = [
    { role: 'מדריך', cost: -100 },
    { role: 'מדריך', cost: 'abc' },
    { role: 'מדריך', cost: 500 },
  ];
  const r = KD.instructorCostForMonth(workers, '2026-07', 0);
  assert.equal(r.cost, 500);
  assert.equal(r.estimated, true);
});

test('utilisationPct is cost/budget rounded to whole %, 0 when no budget', () => {
  assert.equal(KD.utilisationPct(60620, 60620), 100);
  assert.equal(KD.utilisationPct(30310, 60620), 50);
  assert.equal(KD.utilisationPct(70000, 60620), 115);
  assert.equal(KD.utilisationPct(1000, 0), 0);
  assert.equal(KD.utilisationPct(0, 60620), 0);
});
