'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// public/app.js can't be require()d in Node (it needs `window`), so guard its
// structure statically — the same approach the Code.gs seed-mirror test uses.
// This locks in the row-cleanup requirements so they can't silently regress.
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('overview (כל הבתים) is optimistic + refreshable, never renders ₪0 as loading', () => {
  // batched, refreshable data path
  assert.match(app, /function refreshOverview/, 'overview refresh function');
  assert.match(app, /api\('loadOverview', \{ month \}\)/, 'uses the batched loadOverview endpoint');
  assert.match(app, /KD\.houseMonthRaw\(h, month\)/, 'falls back to a local compute on error');
  assert.match(app, /KD\.normMonth\(/, 'overview uses the shared month-key normaliser');
  // loading ≠ zero: skeletons + a boot loading state
  assert.match(app, /function overviewSkeletonRows/, 'per-row skeletons');
  assert.match(app, /function loadingState/, 'boot loading state');
  assert.match(app, /if \(!state\.dataLoaded\) \{ screen\.innerHTML = loadingState\(\)/, 'render shows loading until data arrives');
  assert.match(app, /class="skeleton/, 'skeleton markup present');
  // refresh button + auto-refresh on tab entry and month change
  assert.match(app, /data-act="refreshOverview"/, 'manual refresh button');
  assert.match(app, /state\.tab === 'admin'\) refreshOverview/, 'auto-refresh on admin entry / month change');
  // display rule stays single-sourced through summariseBudget
  assert.match(app, /KD\.summariseBudget\(raw\.budget, raw\.actual, raw\.overrun\)/, 'overview rows go through summariseBudget');
});

test('daily overrides (חריגות יומיות) update סה"כ אפקטיבי instantly (optimistic)', () => {
  assert.match(app, /function updateOverrideRow/, 'per-row optimistic update helper');
  assert.match(app, /data-hc-day="\$\{day\}"/, 'override rows are addressable by day');
  assert.match(app, /class="hc-eff-total"/, 'the effective-total cell is targetable');
  assert.match(app, /case 'ovP': case 'ovS':[^]*?updateOverrideRow\(house, t\.dataset\.day\)/, 'ovP/ovS paint the row instantly, before any save');
  // instant local compute — no awaiting the network for the number
  assert.match(app, /updateOverrideRow[^]*?KD\.effectiveForDay\(house\.headcount, day\)\.total/, 'row total recomputed locally');
});

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
  for (const act of ['countStart', 'countSave', 'countRestore', 'budgetAmount', 'overrunAmount', 'overrunNote']) {
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

test('כמויות בסיס baseline tab is a top-level tab with the required structure', () => {
  assert.match(app, /id: 'baseline'[^]*?label: 'כמויות בסיס'/, 'top-level baseline tab');
  assert.match(app, /baseline: renderBaseline/, 'baseline tab is routed');
  assert.match(app, /function renderBaseline/, 'baseline renderer');
  assert.match(app, /הכמות הבסיסית לבית לחודש — קובעת את התקציב/, 'bold header');
  assert.match(app, /ייחוס: \$\{KD\.BASE_PEOPLE\}/, 'reference-25 subtitle');
  assert.match(app, /סועדים אפקטיביים/, 'effective-diners header');
  assert.match(app, /KD\.baselineForHouse\(state\.catalog/, 'uses the domain baseline');
  assert.match(app, /סה"כ מזון/, 'food subtotal line');
  assert.match(app, /חד"פ \(15%\)/, 'disposables line');
  assert.match(app, /סה"כ תקציב מומלץ/, 'recommended-total line');
  for (const act of ['parMin', 'parPrice', 'printBaseline']) {
    assert.ok(app.includes("'" + act + "'") || app.includes('data-act="' + act + '"'), 'missing wiring for ' + act);
  }
  assert.match(app, /saveParOverrides/, 'overrides persist via the backend action');
});

test('budget tab shows the computed baseline + an אמץ כתקציב button', () => {
  assert.match(app, /בסיס מחושב/, 'baseline shown in budget tab');
  assert.match(app, /data-act="adoptBaseline"/, 'adopt button wired');
  assert.match(app, /function adoptBaselineAsBudget/, 'adopt handler copies baseline into the budget');
  // adopt copies the RECOMMENDED total Z (מזון + חד"פ), not the bare food total.
  assert.match(app, /adoptBaselineAsBudget[^]*?\.recommended\.total/, 'adopt copies the recommended total (Z)');
});

test('meal model: תפוסה shows the read-only per-meal line and scaling uses effectivePeople', () => {
  assert.match(app, /function mealOccupancyLine/, 'meal-occupancy helper');
  assert.match(app, /בוקר\/צהריים:/, 'cooked-meal count line');
  assert.match(app, /ערב עצמאי:/, 'self-serve evening count line');
  // every people-scaled read uses the meal-model effective count, not the raw head count
  assert.match(app, /KD\.effectivePeople\(house\.headcount\)/, 'scaling uses effectivePeople');
  assert.ok(!/KD\.baselineForHouse\(state\.catalog, KD\.baseTotal/.test(app), 'baseline no longer scales by raw baseTotal');
});

test('menu: self-serve evenings collapse with the note; Friday dinner stays planned', () => {
  assert.match(app, /ערב עצמאי — מכוסה ממלאי הבסיס/, 'self-serve note');
  assert.match(app, /KD\.isSelfServeMeal\(day, meal\)/, 'self-serve classification via the domain');
  assert.match(app, /KD\.mealDiners\(house\.headcount, day, meal\)/, 'per-meal diner ref (reduced on Fri/Sat) via the domain');
});

test('weekend window text + reduced-weekend diner references (Fri morning → Sun morning)', () => {
  assert.match(app, /שישי בבוקר עד ראשון בבוקר ‎?-25%/, 'baseline header names the Fri-morning→Sun-morning window');
  assert.ok(!/שישי-שבת ‎?-25%/.test(app), 'the old שישי-שבת wording is gone');
});

test('BUGFIX: תפוסה edits trigger a debounced live re-render (no reload needed)', () => {
  assert.match(app, /function scheduleHeadcountRerender/, 'debounced re-render helper');
  // wired to every base + daily-override input
  assert.match(app, /case 'baseP':[^]*?scheduleHeadcountRerender\(\)/, 'baseP triggers live re-render');
  assert.match(app, /case 'baseS':[^]*?scheduleHeadcountRerender\(\)/, 'baseS triggers live re-render');
  assert.match(app, /case 'ovP': case 'ovS':[^]*?scheduleHeadcountRerender\(\)/, 'daily overrides trigger live re-render');
  assert.match(app, /setTimeout\([^]*?render\(\)[^]*?300\)/, 'debounced ~300ms and re-renders');
  assert.match(app, /el\.focus\(\)/, 'focus is restored after the re-render');
});

test('reset-to-default is wired: per-row (baseline + stock) and bulk', () => {
  assert.match(app, /data-act="parReset"/, 'per-row baseline reset button');
  assert.match(app, /אפס הכל לברירת מחדל/, 'bulk reset button label');
  assert.match(app, /data-act="parResetAll"/, 'bulk reset wired');
  assert.match(app, /data-act="stkResetMin"/, 'per-row stock min reset button');
  assert.match(app, /KD\.clearParOverride/, 'reset uses the pure domain helper');
  // bulk reset must confirm before wiping
  assert.match(app, /parResetAll'[^]*?window\.confirm/, 'bulk reset asks for confirmation');
});

test('effective (scaled/override) par drives shortfall + the count reference', () => {
  assert.match(app, /function effectiveStock/, 'effective-min stock helper');
  // shortfall must run over the FULL catalog union, not just existing stock rows
  assert.match(app, /KD\.effectiveCatalogStock\(state\.catalog, house\.stock/, 'shortfall covers the full catalog');
  assert.match(app, /KD\.withEffectiveMins/, 'per-row stock min uses effective mins');
  assert.match(app, /KD\.effectiveParFor/, 'count/stock show the effective par');
  assert.match(app, /מינימום: /, 'count screen shows the effective minimum');
  assert.ok(!/data-act="stkMin"/.test(app), 'the stock min is no longer directly editable (managed in baseline)');
});

test('mobile qty picker is wired for count + stock qty fields', () => {
  assert.match(app, /function openQtyPicker/, 'picker opener');
  assert.match(app, /const QTY_PRESETS/, 'per-unit preset values');
  assert.match(app, /data-picker="\$\{unit\}"/, 'qty inputs declare their unit for the picker');
  assert.match(app, /btn\.dataset\.picker/, 'tapping a qty field opens the picker');
});

test('count is simplified: no "חדש" badge, "count what you have" framing', () => {
  assert.ok(!/>חדש</.test(app), 'the "חדש" badge must be gone from the count');
  assert.match(app, /סִפרו מה שיש|סיפרו מה שיש/, 'count intro reframed as "count what you have"');
});

test('the 3-step flow hint is shown on the מלאי / ספירה / קניות tabs', () => {
  assert.match(app, /function flowHint/, 'flowHint helper');
  assert.match(app, /flowHint\(1\)/, 'step-1 hint on stock/count');
  assert.match(app, /flowHint\(3\)/, 'step-3 hint on shopping');
  for (const label of ['ספירת מלאי', 'מלאי מינימום', 'רשימת קניות']) {
    assert.ok(app.includes(label), 'hint step label missing: ' + label);
  }
});

test('the צפי plan tab is reworked: new title/subtitle, split sections, empty message', () => {
  assert.match(app, /צפי שבועי — השוואת תפריט מול מלאי/, 'plan title');
  assert.match(app, /ריכוז כל המרכיבים הנדרשים, מול מה שקיים במלאי/, 'plan subtitle');
  assert.match(app, /KD\.weeklyPlan\(week, effectiveStock\(house\), days\)/, 'plan uses the weeklyPlan split over effective-min stock');
  assert.match(app, /עדיין לא הוזן תפריט לשבוע זה/, 'friendly empty-menu message');
  assert.match(app, /השלמה למלאי מינימום/, 'separate par top-up section');
  // Menu table has exactly the 4 agreed columns (no מינימום column in it).
  assert.match(app, /<th>פריט<\/th><th>\$\{needLabel\}<\/th><th>קיים במלאי<\/th><th>חסר<\/th>/, 'menu table columns');
});

test('load applies catalog/stock corrections (typos, units, eggs merge)', () => {
  assert.match(app, /KD\.correctCatalog\(/, 'catalog corrected on load');
  assert.match(app, /KD\.correctStock\(h\.stock\)/, 'each house stock corrected on load');
  assert.match(app, /_stockMigrated/, 'migrated houses are persisted');
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
  for (const tab of ['catalog', 'stockCounts', 'monthlyBudgets', 'shoppingExtras', 'parOverrides']) {
    assert.ok(gs.includes(tab + ':'), 'Code.gs missing SHEETS.' + tab);
  }
  for (const action of ['saveCatalog', 'saveStockCount', 'saveBudget', 'saveShoppingExtras', 'saveParOverrides']) {
    assert.ok(gs.includes("case '" + action + "'"), 'Code.gs missing action ' + action);
  }
  assert.match(gs, /stock:\s*\['id',\s*'houseId',\s*'name',\s*'category',\s*'qty',\s*'unit',\s*'min'\]/, 'stock tab must gain the min column');
});
