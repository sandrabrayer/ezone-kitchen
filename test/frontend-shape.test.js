'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// public/app.js can't be require()d in Node (it needs `window`), so guard its
// structure statically — the same approach the Code.gs seed-mirror test uses.
// This locks in the row-cleanup requirements so they can't silently regress.
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('menu ingredient rows have no orphan category box (the truncated "מכו…")', () => {
  assert.ok(!/ing-cat/.test(app), 'the per-row category <select> (.ing-cat) must be gone');
  assert.ok(!/data-act="ingCat"/.test(app), 'the ingCat handler must be gone');
});

test('the per-diner "לסועד" label is absent everywhere', () => {
  assert.ok(!/לסועד/.test(app));
});

test('ingredient name is a catalog combobox; row keeps name/qty/unit/delete only', () => {
  assert.match(app, /class="ing-name" list="catalogNames"/);
  assert.match(app, /data-act="ingQty"/);
  assert.match(app, /data-act="ingUnit"/);
  assert.match(app, /data-act="delIng"/);
});

test('new stock/count/budget/overrun controls are wired', () => {
  for (const act of ['stkMin', 'countStart', 'countSave', 'countRestore', 'budgetAmount', 'overrunAmount', 'overrunNote']) {
    assert.ok(app.includes("'" + act + "'") || app.includes('"' + act + '"') || app.includes('data-act="' + act + '"'),
      'missing wiring for ' + act);
  }
});

test('Code.gs declares the new tabs the frontend relies on', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  for (const tab of ['catalog', 'stockCounts', 'monthlyBudgets']) {
    assert.ok(gs.includes(tab + ':'), 'Code.gs missing SHEETS.' + tab);
  }
  for (const action of ['saveCatalog', 'saveStockCount', 'saveBudget']) {
    assert.ok(gs.includes("case '" + action + "'"), 'Code.gs missing action ' + action);
  }
  assert.match(gs, /stock:\s*\['id',\s*'houseId',\s*'name',\s*'category',\s*'qty',\s*'unit',\s*'min'\]/, 'stock tab must gain the min column');
});
