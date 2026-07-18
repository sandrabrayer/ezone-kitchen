'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');
const { dish, weekWithLunch } = require('./fixtures');

/* The "צפי שבועי" view builds its rows from buildShoppingList (no duplicated
   aggregation) and shows: פריט | נדרש | במלאי | חסר, where חסר = max(0,
   needed − stock). "From today" scopes the requirement to today's weekday
   onward. These tests exercise exactly that contract. */

// Mirror of the view's row math (kept tiny; the heavy lifting is in the domain).
function planRows(week, stock, days) {
  return KD.buildShoppingList(week, stock, undefined, days).lines.map((l) => ({
    name: l.name,
    unit: l.unit,
    needed: l.requiredQty,
    stock: l.stockQty,
    missing: KD.subtractStock(l.requiredQty, l.stockQty),
  }));
}

test('plan aggregates weekly needs vs stock and computes the shortfall', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 2, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice], monday: [rice] });
  const rows = planRows(week, [{ id: 's1', name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0].needed - 4) < 1e-6); // 2 + 2 across the week
  assert.ok(Math.abs(rows[0].stock - 1) < 1e-6);
  assert.ok(Math.abs(rows[0].missing - 3) < 1e-6); // max(0, 4 - 1)
});

test('plan shortfall is clamped to zero when stock covers the need', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [rice] });
  const rows = planRows(week, [{ id: 's1', name: 'Rice', category: 'dry', qty: 5, unit: 'kg' }]);
  assert.equal(rows[0].missing, 0);
});

test('plan "from today" filter scopes the need to the remaining days', () => {
  const rice = dish('Rice', [{ name: 'Rice', category: 'dry', qty: 1, unit: 'kg' }]);
  // Sun, Mon, Tue each need 1 kg.
  const week = weekWithLunch({ sunday: [rice], monday: [rice], tuesday: [rice] });

  const whole = planRows(week, []); // whole week
  assert.ok(Math.abs(whole[0].needed - 3) < 1e-6);

  // "From Tuesday onward" — as the UI computes days = DAYS.slice(todayIdx).
  const fromTue = KD.DAYS.slice(KD.DAYS.indexOf('tuesday'));
  const scoped = planRows(week, [], fromTue);
  assert.ok(Math.abs(scoped[0].needed - 1) < 1e-6); // only Tuesday remains
});

test('plan needs do NOT depend on headcount (no per-person multiplier)', () => {
  const stew = dish('Stew', [{ name: 'Beef', category: 'meat', qty: 6, unit: 'kg' }]);
  const week = weekWithLunch({ sunday: [stew] });
  // buildShoppingList takes no headcount; the need is the dish total, full stop.
  const rows = planRows(week, []);
  assert.ok(Math.abs(rows[0].needed - 6) < 1e-6);
});

test('plan matches stock across units (ml stock vs litre need) via buildShoppingList', () => {
  const soup = dish('Soup', [{ name: 'Milk', category: 'groceries', qty: 2, unit: 'l' }]);
  const week = weekWithLunch({ sunday: [soup] });
  const rows = planRows(week, [{ id: 's1', name: 'Milk', category: 'groceries', qty: 500, unit: 'ml' }]);
  assert.equal(rows[0].unit, 'l');
  assert.ok(Math.abs(rows[0].stock - 0.5) < 1e-6);
  assert.ok(Math.abs(rows[0].missing - 1.5) < 1e-6); // 2 - 0.5
});
