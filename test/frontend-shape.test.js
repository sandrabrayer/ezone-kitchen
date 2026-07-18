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

test('stock rows are full-width cards with a catalog-combobox name (bug: 36px name box)', () => {
  assert.match(app, /function stockItemCard/, 'stock items render as cards');
  assert.match(app, /class="stk-name" list="catalogAddList"/, 'name is the category catalog combobox');
  assert.ok(!/data-act="stkCat"/.test(app), 'the per-row category <select> is gone (name auto-fills it)');
  assert.match(app, /placeholder="0" data-act="stkQty"/, 'qty box shows a "0" placeholder');
});

test('bottom "הוסף" row is for free-text new items only', () => {
  assert.match(app, /id="stkAddName" placeholder="פריט חדש שלא ברשימה/, 'placeholder guides new items');
  // the bottom add input must NOT carry a datalist (that would make it a picker)
  assert.ok(!/id="stkAddName"[^>]*list=/.test(app), 'bottom add is plain free text');
});

test('stock count uses the FULL catalog (buildCountList / applyStockCount)', () => {
  assert.match(app, /KD\.buildCountList\(state\.catalog, house\.stock\)/, 'count lists the whole catalog');
  assert.match(app, /KD\.applyStockCount\(state\.catalog, house\.stock, state\.countValues\)/, 'save rebuilds stock from the count');
  assert.match(app, /data-act="countQty" data-key=/, 'count inputs are keyed by catalog key');
});

test('shopping list has a persisted per-week "פריטים נוספים" section', () => {
  assert.match(app, /function renderShoppingExtras/, 'extras section');
  assert.match(app, /פריטים נוספים/, 'extras heading');
  for (const act of ['extraAdd', 'extraDel', 'extraName', 'extraQty', 'extraUnit']) {
    assert.ok(app.includes("'" + act + "'") || app.includes('"' + act + '"') || app.includes('data-act="' + act + '"'), 'missing ' + act);
  }
  assert.match(app, /saveShoppingExtras/, 'extras persist to the backend');
  assert.match(app, /weekExtras\(house, weekOf\)/, 'extras are filtered per week');
});

test('Code.gs backs the shoppingExtras tab + action', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.match(gs, /shoppingExtras:\s*\['id',\s*'houseId',\s*'weekOf',\s*'name',\s*'qty',\s*'unit'\]/, 'shoppingExtras tab schema');
  assert.match(gs, /case 'saveShoppingExtras'/, 'saveShoppingExtras action');
  assert.match(gs, /shoppingExtras: \(shoppingExtras\[id\]/, 'load returns shoppingExtras');
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

test('the default seed catalog is merged on load and the add-combobox is wired', () => {
  assert.match(app, /KD\.SEED_CATALOG/, 'loadState must merge the domain seed catalog');
  assert.match(app, /catalogAddDatalist/, 'per-category add datalist helper');
  assert.match(app, /id="stkAddName"/, 'the "הוסף פריט" combobox input');
  assert.match(app, /function addStockItem/, 'add handler that pre-fills the par level');
  assert.match(app, /list="catalogAddList"/, 'add input references the category datalist');
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
  for (const tab of ['catalog', 'stockCounts', 'monthlyBudgets']) {
    assert.ok(gs.includes(tab + ':'), 'Code.gs missing SHEETS.' + tab);
  }
  for (const action of ['saveCatalog', 'saveStockCount', 'saveBudget']) {
    assert.ok(gs.includes("case '" + action + "'"), 'Code.gs missing action ' + action);
  }
  assert.match(gs, /stock:\s*\['id',\s*'houseId',\s*'name',\s*'category',\s*'qty',\s*'unit',\s*'min'\]/, 'stock tab must gain the min column');
});
