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

test('the default seed catalog is merged on load and the stock comboboxes are wired', () => {
  assert.match(app, /KD\.SEED_CATALOG/, 'loadState must merge the domain seed catalog');
  assert.match(app, /function categoryComboDatalists/, 'per-category combobox datalist helper');
  assert.match(app, /id="stkAddName"/, 'the "הוסף" free-text input');
  assert.match(app, /function addStockItem/, 'add handler that pre-fills the par level');
});

test('every stock row name is a category-scoped combobox (fixes empty seeded names)', () => {
  // The row name input must be a datalist combobox scoped to the item category,
  // with its value set so a seeded item name always shows INSIDE the input.
  assert.match(app, /list="catCombo_\$\{item\.category\}" value="\$\{esc\(item\.name\)\}"/,
    'row name = category combobox with the value populated');
  // The empty quantity box must hint "0" (כמות במלאי awaiting count).
  assert.match(app, /data-act="stkQty"[^]*?placeholder="0"|placeholder="0"[^]*?data-act="stkQty"/,
    'stock qty input has a visible 0 placeholder');
  // The bottom add-row is free-text only now (no catalog datalist), new placeholder.
  assert.match(app, /פריט חדש שלא ברשימה/, 'add-row placeholder for free-text new items');
  assert.ok(!/list="catalogAddList"/.test(app), 'the bottom add-row must not be a catalog picker anymore');
});

test('the stock count lists the full catalog and saves added items', () => {
  assert.match(app, /KD\.stockCountRows\(state\.catalog, house\.stock\)/, 'count renders full-catalog rows');
  assert.match(app, /KD\.applyStockCount\(state\.catalog, house\.stock, state\.countValues\)/, 'save writes counted items');
  assert.match(app, /data-act="countQty" data-key=/, 'count inputs are keyed by catalog key');
});

test('shopping-list extras (פריטים נוספים) are wired and persisted per week', () => {
  assert.match(app, /function renderShoppingExtras/, 'extras section renderer');
  assert.match(app, /function addShoppingExtra/, 'extras add handler');
  assert.match(app, /פריטים נוספים/, 'the extras section heading');
  for (const act of ['extraAdd', 'extraDel']) {
    assert.ok(app.includes("'" + act + "'") || app.includes('data-act="' + act + '"'), 'missing wiring for ' + act);
  }
  assert.match(app, /saveShoppingExtras/, 'extras persist via the backend action');
  assert.match(app, /KD\.readShoppingExtra/, 'extras are normalised via the domain helper');
});

test('seed-catalog is resilient: seeded before the per-house loop + at render time', () => {
  // Guards the "seed not appearing" regression: a throw in per-house normalisation
  // must not skip seeding, and a missing SEED_CATALOG export must not throw.
  assert.match(app, /function seedList\(\)/, 'guarded seedList() accessor');
  assert.match(app, /Array\.isArray\(KD\.SEED_CATALOG\)/, 'seedList must guard a missing export');
  assert.match(app, /function ensureCatalogSeeded/, 'render-time belt-and-suspenders');
  // The seed must be merged into state.catalog BEFORE the house loop runs.
  const seedIdx = app.indexOf('KD.mergeCatalog(backendCatalog, seedList())');
  const loopIdx = app.indexOf('for (const h of state.houses)');
  assert.ok(seedIdx > 0 && loopIdx > 0 && seedIdx < loopIdx, 'seed must be merged before the per-house loop');
  // render() must ensure the seed before drawing datalists.
  assert.match(app, /function render\(\)\s*\{\s*ensureCatalogSeeded\(\);/, 'render() calls ensureCatalogSeeded first');
  // Per-house normalisation must tolerate corrupt menus (non-array meals).
  assert.match(app, /Array\.isArray\(plan\[meal\]\)/, 'meal normalisation guards non-array meals');
});

test('Code.gs declares the new tabs the frontend relies on', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  for (const tab of ['catalog', 'stockCounts', 'monthlyBudgets', 'shoppingExtras']) {
    assert.ok(gs.includes(tab + ':'), 'Code.gs missing SHEETS.' + tab);
  }
  for (const action of ['saveCatalog', 'saveStockCount', 'saveBudget', 'saveShoppingExtras']) {
    assert.ok(gs.includes("case '" + action + "'"), 'Code.gs missing action ' + action);
  }
  assert.match(gs, /stock:\s*\['id',\s*'houseId',\s*'name',\s*'category',\s*'qty',\s*'unit',\s*'min'\]/, 'stock tab must gain the min column');
});
