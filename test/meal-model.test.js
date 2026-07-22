'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

const approx = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-9), `${a} ≈ ${b}`);

/* -------------------- meal model: per-meal diner counts -------------------- */
test('mealHeadcount: cooked meals = full count, self-serve evening = patients + 2', () => {
  assert.deepEqual(KD.mealHeadcount({ basePatients: 20, baseStaff: 5 }),
    { patients: 20, staff: 5, full: 25, evening: 22 });
});

test('evening count is always מטופלים + 2, independent of staff size', () => {
  assert.equal(KD.mealHeadcount({ basePatients: 10, baseStaff: 0 }).evening, 12);
  assert.equal(KD.mealHeadcount({ basePatients: 10, baseStaff: 8 }).evening, 12);
  assert.equal(KD.EVENING_STAFF, 2);
});

test('mealHeadcount clamps/floors invalid inputs to whole non-negative counts', () => {
  assert.deepEqual(KD.mealHeadcount({ basePatients: '18', baseStaff: 4.9 }),
    { patients: 18, staff: 4, full: 22, evening: 20 });
  assert.deepEqual(KD.mealHeadcount(null), { patients: 0, staff: 0, full: 0, evening: 2 });
});

/* -------------------- daily / weekly effective factors -------------------- */
test('dailyFactor: two full cooked meals + one ½-weight self-serve evening, over 3', () => {
  const hc = { basePatients: 20, baseStaff: 5 }; // full 25, evening 22
  // (2×25 + 0.5×22) / (3×25) = 61/75
  approx(KD.dailyFactor(hc), 61 / 75);
  assert.equal(KD.SELF_SERVE_MEAL_WEIGHT, 0.5);
});

test('dailyFactor is 0 when there are no daytime diners (full = 0)', () => {
  assert.equal(KD.dailyFactor({ basePatients: 0, baseStaff: 0 }), 0);
});

test('weekFactor: 5 weekdays + 2 weekend days at 75% (Fri+Sat -25%), over 7', () => {
  const hc = { basePatients: 20, baseStaff: 5 };
  const daily = KD.dailyFactor(hc);
  approx(KD.weekFactor(hc), (5 * daily + 2 * daily * 0.75) / 7);
  approx(KD.weekFactor(hc), daily * 6.5 / 7); // algebraic identity
  assert.equal(KD.WEEKEND_RATE, 0.75);
});

test('effectivePeople = weekFactor × baseTotal (the diner-equivalent for scaling)', () => {
  const hc = { basePatients: 20, baseStaff: 5 };
  approx(KD.effectivePeople(hc), KD.weekFactor(hc) * KD.baseTotal(hc));
  approx(KD.effectivePeople(hc), 396.5 / 21); // 18.88…
  assert.equal(KD.effectivePeople({ basePatients: 0, baseStaff: 0 }), 0);
});

/* -------------------- par rescale: seedMin × (weekFactor × baseTotal ÷ 25) -------------------- */
const CAT = [
  { name: 'אורז', unit: 'kg', category: 'dry', min: 10, price: 8 },
  { name: 'ביצים', unit: 'unit', category: 'groceries', min: 120, price: 1.2 },
];

test('effective par uses effectivePeople and rounds per unit family', () => {
  const hc = { basePatients: 20, baseStaff: 5 };
  const people = KD.effectivePeople(hc);            // ≈ 18.881
  // אורז: 10 × 18.881/25 = 7.552 → 0.5 step → 7.5
  assert.equal(KD.effectiveParFor(CAT, 'אורז', people, {}).qty, 7.5);
  // ביצים: 120 × 18.881/25 = 90.63 → whole → 91
  assert.equal(KD.effectiveParFor(CAT, 'ביצים', people, {}).qty, 91);
});

test('a manual par override wins and is NOT rescaled by the meal model', () => {
  const hc = { basePatients: 20, baseStaff: 5 };
  const people = KD.effectivePeople(hc);
  const ov = { [KD.catalogKey('אורז')]: { min: 9 } };
  assert.deepEqual(KD.effectiveParFor(CAT, 'אורז', people, ov), { qty: 9, unit: 'kg', source: 'manual' });
});

/* -------------------- seed bumps: evening +20%, baking +25% -------------------- */
test('evening-staple pars are bumped +20% in the seed', () => {
  const m = (n) => KD.catalogLookup(KD.SEED_CATALOG, n).min;
  assert.equal(KD.EVENING_STAPLE_BUMP, 0.20);
  assert.equal(m('לחם'), 18);      // 15 × 1.2
  assert.equal(m('עגבניות'), 14.4); // 12 × 1.2
  assert.equal(m('חמאה'), 9.6);     // 8 × 1.2
  assert.equal(m('חלב'), 15);       // NOT a staple → unchanged
});

test('baking-staple pars are bumped +25% in the seed', () => {
  const m = (n) => KD.catalogLookup(KD.SEED_CATALOG, n).min;
  assert.equal(KD.BAKING_STAPLE_BUMP, 0.25);
  assert.equal(m('קמח'), 12.5);          // 10 × 1.25
  assert.equal(m('שוקולד ציפים'), 1.25); // 1 × 1.25
  assert.equal(m('אבקת אפייה'), 625);    // 500 × 1.25
  assert.equal(m('וניל'), 125);          // 100 × 1.25
});

test('ביצים gets BOTH bumps (evening ×1.2 and baking ×1.25) multiplicatively', () => {
  assert.equal(KD.catalogLookup(KD.SEED_CATALOG, 'ביצים').min, 180); // 120 × 1.2 × 1.25
});

/* -------------------- baseline summary lines: food / baking / disposables / total -------------------- */
test('budgetRecommendation splits food into food + 15% disposables → total', () => {
  assert.deepEqual(KD.budgetRecommendation(1000), { food: 1000, disposables: 150, total: 1150 });
  assert.equal(KD.DISPOSABLES_RATE, 0.15);
  assert.deepEqual(KD.budgetRecommendation(0), { food: 0, disposables: 0, total: 0 });
});

test('baselineForHouse exposes food total, baking line, and חד"פ recommendation', () => {
  const people = KD.effectivePeople({ basePatients: 20, baseStaff: 5 });
  const b = KD.baselineForHouse(KD.SEED_CATALOG, people, {});
  assert.ok(b.total > 0);
  // recommended = food + 15%
  assert.equal(b.recommended.food, b.total);
  assert.equal(b.recommended.disposables, Math.round(b.total * 0.15 * 100) / 100);
  assert.equal(b.recommended.total, Math.round((b.total * 1.15) * 100) / 100);
  // baking line = Σ over default baking rows of monthlyCost × (0.25/1.25)
  const bakingNames = ['קמח', 'סוכר', 'ביצים', 'שוקולד ציפים', 'אבקת אפייה', 'שמרים', 'קקאו', 'וניל'];
  const bakingKeys = new Set(bakingNames.map(KD.catalogKey));
  const expected = Math.round(b.rows
    .filter((r) => bakingKeys.has(r.key))
    .reduce((s, r) => s + r.monthlyCost * (0.25 / 1.25), 0) * 100) / 100;
  assert.equal(b.baking, expected);
  assert.ok(b.baking > 0);
});

test('the אפייה line skips an overridden baking row (manual par replaced the bump)', () => {
  const people = KD.effectivePeople({ basePatients: 20, baseStaff: 5 });
  const base = KD.baselineForHouse(KD.SEED_CATALOG, people, {});
  const withOv = KD.baselineForHouse(KD.SEED_CATALOG, people, { [KD.catalogKey('קמח')]: { min: 5 } });
  assert.ok(withOv.baking < base.baking); // קמח no longer contributes to the baking line
});

/* -------------------- price overrides survive the seed price correction -------------------- */
test('a saved price override is honoured over the corrected seed price', () => {
  const people = KD.effectivePeople({ basePatients: 20, baseStaff: 5 });
  // חזה עוף seed price is now 38; a cook who saved 35 keeps 35.
  const b = KD.baselineForHouse(KD.SEED_CATALOG, people, { [KD.catalogKey('חזה עוף')]: { price: 35 } });
  const row = b.rows.find((r) => r.name === 'חזה עוף');
  assert.equal(row.price, 35);
  assert.equal(row.priceSource, 'manual');
});
