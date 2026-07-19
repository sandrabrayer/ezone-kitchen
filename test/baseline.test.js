'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

/* -------------------- rounding per unit -------------------- */
test('roundParQty steps: יח whole, ק"ג/ל 0.5, גרם/מ"ל 50', () => {
  assert.equal(KD.roundParQty(57.6, 'unit'), 58);
  assert.equal(KD.roundParQty(4.8, 'kg'), 5);      // 0.5 step
  assert.equal(KD.roundParQty(7.2, 'l'), 7);       // 0.5 step
  assert.equal(KD.roundParQty(7.25, 'kg'), 7.5);   // rounds to nearest 0.5
  assert.equal(KD.roundParQty(1440, 'g'), 1450);   // 50 step
  assert.equal(KD.roundParQty(1230, 'ml'), 1250);  // 50 step
  assert.equal(KD.roundParQty(0, 'kg'), 0);
});

/* -------------------- scaling from the 25-person reference -------------------- */
test('scaledPar scales seed pars by baseTotal ÷ 25', () => {
  assert.equal(KD.BASE_PEOPLE, 25);
  assert.equal(KD.scaledPar(120, 'unit', 25), 120); // reference → unchanged
  assert.equal(KD.scaledPar(120, 'unit', 50), 240); // double house → double
  assert.equal(KD.scaledPar(120, 'unit', 30), 144); // 120 × 30/25
  assert.equal(KD.scaledPar(10, 'kg', 30), 12);
  assert.equal(KD.scaledPar(10, 'kg', 12), 5);      // 4.8 → 0.5 step
  assert.equal(KD.scaledPar(3000, 'g', 12), 1450);  // 1440 → 50 step
  assert.equal(KD.scaledPar(120, 'unit', 0), 0);    // no people → 0
});

/* -------------------- override precedence (never rescaled) -------------------- */
test('effectivePar: an override wins and is NOT rescaled', () => {
  assert.equal(KD.effectivePar(120, 'unit', 50, 100), 100); // override absolute
  assert.equal(KD.effectivePar(120, 'unit', 50, undefined), 240); // no override → scaled
  assert.equal(KD.effectivePar(120, 'unit', 50, 0), 0);   // explicit 0 override honoured
  assert.equal(KD.effectivePar(120, 'unit', 50, ''), 240); // blank → scaled
});

test('effectivePrice: override wins, else seed estimate, else 0', () => {
  assert.equal(KD.effectivePrice(6.5, undefined), 6.5);
  assert.equal(KD.effectivePrice(6.5, 7), 7);
  assert.equal(KD.effectivePrice(0, undefined), 0);
  assert.equal(KD.effectivePrice(6.5, ''), 6.5);
});

/* -------------------- seed prices -------------------- */
test('every SEED_CATALOG item carries a positive price (in its own unit)', () => {
  for (const e of KD.SEED_CATALOG) assert.ok(e.price > 0, `missing price for ${e.name}`);
  const p = (n) => KD.catalogLookup(KD.SEED_CATALOG, n).price;
  assert.equal(p('חלב'), 6.5);
  assert.equal(p('גבינה צהובה'), 0.045); // 45 ₪/ק"ג stored per-gram
  assert.equal(p('פפריקה'), 0.03);       // 30 ₪/ק"ג per-gram
  assert.equal(p('בשר טחון'), 55);
  assert.equal(p('ביצים'), 1.2);
});

test('mergeCatalog carries price through and fills a missing one from seed', () => {
  const merged = KD.mergeCatalog([{ name: 'חלב', unit: 'l', category: 'groceries', min: 15 }], KD.SEED_CATALOG);
  assert.equal(KD.catalogLookup(merged, 'חלב').price, 6.5); // filled from seed
});

/* -------------------- monthly cost + baseline total -------------------- */
const CAT = [
  { name: 'חלב', unit: 'l', category: 'groceries', min: 15, price: 6.5 },
  { name: 'אורז', unit: 'kg', category: 'dry', min: 10, price: 8 },
];

test('baselineForHouse computes weekly/monthly qty, monthly cost and total', () => {
  const b = KD.baselineForHouse(CAT, 25, {});
  const milk = b.rows.find((r) => r.name === 'חלב');
  assert.equal(milk.weekQty, 15);
  assert.equal(milk.monthQty, 60);        // × 4 weeks
  assert.equal(milk.price, 6.5);
  assert.equal(milk.monthlyCost, 390);    // 60 × 6.5
  assert.equal(milk.minSource, 'default');
  const rice = b.rows.find((r) => r.name === 'אורז');
  assert.equal(rice.monthlyCost, 320);    // 10×4 × 8
  assert.equal(b.total, 710);             // 390 + 320
});

test('baselineForHouse scales with headcount and honours overrides', () => {
  const big = KD.baselineForHouse(CAT, 50, {});
  assert.equal(big.rows.find((r) => r.name === 'חלב').monthlyCost, 780); // 30×4×6.5
  const withOv = KD.baselineForHouse(CAT, 50, {
    [KD.catalogKey('חלב')]: { min: 10, price: 5 }, // override qty + price
  });
  const milk = withOv.rows.find((r) => r.name === 'חלב');
  assert.equal(milk.weekQty, 10);         // override, not rescaled
  assert.equal(milk.monthlyCost, 200);    // 10×4 × 5
  assert.equal(milk.minSource, 'manual');
  assert.equal(milk.priceSource, 'manual');
});

/* -------------------- effective par drives shortfall -------------------- */
test('withEffectiveMins makes buildShoppingList top up to the SCALED par', () => {
  const stock = [{ id: 's', name: 'חלב', category: 'groceries', qty: 3, unit: 'l', minQty: 0 }];
  const week = KD.emptyWeekMenu('2026-07-19');
  const eff = KD.withEffectiveMins(stock, CAT, 50, {}); // 50 people → par 30
  assert.equal(eff[0].minQty, 30);
  const list = KD.buildShoppingList(week, eff);
  const milk = list.lines.find((l) => l.name === 'חלב');
  assert.equal(milk.toBuyQty, 27); // 30 par − 3 on hand
});

test('withEffectiveMins: an override par wins over the scaled value', () => {
  const stock = [{ id: 's', name: 'חלב', category: 'groceries', qty: 3, unit: 'l', minQty: 0 }];
  const eff = KD.withEffectiveMins(stock, CAT, 50, { [KD.catalogKey('חלב')]: { min: 12 } });
  assert.equal(eff[0].minQty, 12);
});

test('effectiveParFor returns the per-item par + source for hints', () => {
  assert.deepEqual(KD.effectiveParFor(CAT, 'חלב', 50, {}), { qty: 30, unit: 'l', source: 'default' });
  assert.deepEqual(KD.effectiveParFor(CAT, 'חלב', 50, { [KD.catalogKey('חלב')]: { min: 9 } }), { qty: 9, unit: 'l', source: 'manual' });
});
