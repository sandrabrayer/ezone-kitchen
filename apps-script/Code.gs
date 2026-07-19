/**
 * ezone-kitchen — Google Apps Script backend (bound to the Sheet).
 *
 * POST-ONLY. The Node server (server.js) is the only caller: it proxies the
 * browser's requests here and injects `secret`, which must equal the
 * SHARED_SECRET Script Property. Requests without the correct secret are
 * rejected (fail-closed).
 *
 * One tab per entity — created automatically on first use:
 *   houses         id | name
 *   budget         houseId | monthlyBudget                 (legacy single budget)
 *   monthlyBudgets houseId | month | budget | overrun | overrunNote   (per month)
 *   headcount      houseId | basePatients | baseStaff | overridesJson
 *   allergies      id | houseId | name | count
 *   stock          id | houseId | name | category | qty | unit | min
 *   catalog        name | unit | category                  (GLOBAL, no houseId)
 *   stockCounts    id | houseId | date | itemsJson          (dated snapshots)
 *   menus          houseId | weekOf | daysJson
 *   purchases      id | houseId | weekOf | amount | note | date
 *   consumption    id | houseId | weekOf | day | executedAt (served-day markers)
 *   shoppingExtras id | houseId | weekOf | name | qty | unit | category  (manual list items, per week)
 *   parOverrides   houseId | overridesJson   (per-item par/price overrides for the budget baseline)
 *
 * Columns are mapped by POSITION (see readRows_), so the header text in an
 * existing Sheet is cosmetic: the `qty` column is what used to be `qtyKg`
 * (legacy kilogram rows read back as qty + an empty unit → treated as kg), and
 * `budget.monthlyBudget` is the old `weeklyBudget` column reused. The `stock`
 * tab gained a trailing `min` column (par level); rows without it read min=0.
 * Pricing was removed — the old `ingredientPrices` tab is no longer read/written.
 *
 * NEW COLUMNS / TABS require a REDEPLOY: publish a NEW VERSION of the EXISTING
 * deployment (pencil icon) — never create a new deployment, or the /exec URL
 * changes and the server breaks. See docs/APPS-SCRIPT-SETUP.md.
 */

var SHEETS = {
  houses: ['id', 'name'],
  budget: ['houseId', 'monthlyBudget'],
  monthlyBudgets: ['houseId', 'month', 'budget', 'overrun', 'overrunNote'],
  headcount: ['houseId', 'basePatients', 'baseStaff', 'overridesJson'],
  allergies: ['id', 'houseId', 'name', 'count'],
  stock: ['id', 'houseId', 'name', 'category', 'qty', 'unit', 'min'],
  catalog: ['name', 'unit', 'category'],
  stockCounts: ['id', 'houseId', 'date', 'itemsJson'],
  menus: ['houseId', 'weekOf', 'daysJson'],
  purchases: ['id', 'houseId', 'weekOf', 'amount', 'note', 'date'],
  consumption: ['id', 'houseId', 'weekOf', 'day', 'executedAt'],
  shoppingExtras: ['id', 'houseId', 'weekOf', 'name', 'qty', 'unit', 'category'],
  parOverrides: ['houseId', 'overridesJson']
};

var CATEGORIES = ['groceries', 'vegetables', 'fruits', 'meat', 'dry'];
function category_(v) { return CATEGORIES.indexOf(v) !== -1 ? v : 'groceries'; }

// The closed set of units the app understands; anything else is stored as kg
// (the legacy default) so a bad value can never poison the math.
var UNITS = ['kg', 'g', 'unit', 'l', 'ml'];
function unit_(v) { return UNITS.indexOf(v) !== -1 ? v : 'kg'; }

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);

    if (!secretOk_(body.secret)) return json_({ ok: false, error: 'unauthorized' });

    var action = body.action;
    var result;

    // Writes are serialised so two cooks/admins never corrupt a tab.
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      switch (action) {
        case 'load': result = loadAll_(); break;
        case 'saveHouse': result = saveHouse_(body.house); break;
        case 'saveHeadcount': result = saveHeadcount_(body.houseId, body.headcount); break;
        case 'saveAllergies': result = replaceForHouse_('allergies', body.houseId, (body.allergies || []).map(function (a) {
          return [a.id || uid_('alg'), body.houseId, a.name || '', num_(a.count)];
        })); break;
        case 'saveStock': result = replaceForHouse_('stock', body.houseId, (body.stock || []).map(function (s) {
          var qty = s.qty != null ? s.qty : s.qtyKg; // back-compat with pre-unit clients
          var min = s.minQty != null ? s.minQty : s.min;
          return [s.id || uid_('stk'), body.houseId, s.name || '', category_(s.category), num_(qty), unit_(s.unit), num_(min)];
        })); break;
        case 'saveCatalog': result = saveCatalog_(body.catalog); break;
        case 'saveStockCount': result = saveStockCount_(body.houseId, body.count); break;
        case 'saveBudget': result = saveBudget_(body.houseId, body.month, body.budget); break;
        case 'savePurchases': result = replaceForHouse_('purchases', body.houseId, (body.purchases || []).map(function (p) {
          return [p.id || uid_('pur'), body.houseId, p.weekOf || '', num_(p.amount), p.note || '', p.date || ''];
        })); break;
        case 'saveConsumption': result = replaceForHouse_('consumption', body.houseId, (body.consumption || []).map(function (c) {
          return [c.id || uid_('cons'), body.houseId, c.weekOf || '', c.day || '', c.executedAt || ''];
        })); break;
        case 'saveMenu': result = saveMenu_(body.houseId, body.weekOf, body.days); break;
        case 'saveShoppingExtras': result = saveShoppingExtras_(body.houseId, body.weekOf, body.extras); break;
        case 'saveParOverrides': result = saveParOverrides_(body.houseId, body.overrides); break;
        default: result = { ok: false, error: 'unknown_action:' + action };
      }
    } finally {
      lock.releaseLock();
    }

    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// GET is not part of the API; expose only a harmless health note.
function doGet() {
  return json_({ ok: true, service: 'ezone-kitchen', note: 'POST only' });
}

/* --------------------------- auth --------------------------- */
function secretOk_(provided) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET') || '';
  if (!expected || typeof provided !== 'string' || provided.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* --------------------------- sheet helpers --------------------------- */
function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(SHEETS[name]);
  }
  return sh;
}

function readRows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = SHEETS[name];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) obj[headers[i]] = row[i];
    return obj;
  });
}

// Replace every row belonging to houseId with newRows (arrays in header order).
function replaceForHouse_(name, houseId, newRows) {
  var sh = sheet_(name);
  var headers = SHEETS[name];
  var hIdx = headers.indexOf('houseId');
  var kept = [];
  var last = sh.getLastRow();
  if (last >= 2) {
    var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
    kept = values.filter(function (row) { return String(row[hIdx]) !== String(houseId); });
  }
  var all = kept.concat(newRows);
  // Clear body then rewrite.
  if (last >= 2) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, headers.length).setValues(all);
  return { ok: true, count: newRows.length };
}

// Replace the entire body of a tab (used for global tabs with no houseId).
function replaceAll_(name, newRows) {
  var sh = sheet_(name);
  var headers = SHEETS[name];
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (newRows.length) sh.getRange(2, 1, newRows.length, headers.length).setValues(newRows);
  return { ok: true, count: newRows.length };
}

// Upsert a single row identified by keyField=keyVal (+ optional second key).
function upsertRow_(name, keyFields, keyVals, row) {
  var sh = sheet_(name);
  var headers = SHEETS[name];
  var last = sh.getLastRow();
  var idxs = keyFields.map(function (f) { return headers.indexOf(f); });
  if (last >= 2) {
    var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
    for (var r = 0; r < values.length; r++) {
      var match = true;
      for (var k = 0; k < idxs.length; k++) {
        if (String(values[r][idxs[k]]) !== String(keyVals[k])) { match = false; break; }
      }
      if (match) { sh.getRange(r + 2, 1, 1, headers.length).setValues([row]); return { ok: true, updated: true }; }
    }
  }
  sh.appendRow(row);
  return { ok: true, inserted: true };
}

/* --------------------------- actions --------------------------- */
function saveHouse_(house) {
  if (!house || !house.id) return { ok: false, error: 'house.id required' };
  // Accept monthlyBudget (current) or weeklyBudget (older clients) — the column
  // is the single manual budget figure, now interpreted per MONTH.
  var budget = house.monthlyBudget != null ? house.monthlyBudget : house.weeklyBudget;
  upsertRow_('houses', ['id'], [house.id], [house.id, house.name || '']);
  upsertRow_('budget', ['houseId'], [house.id], [house.id, num_(budget)]);
  return { ok: true };
}

function saveHeadcount_(houseId, hc) {
  if (!houseId) return { ok: false, error: 'houseId required' };
  hc = hc || {};
  var overrides = JSON.stringify(hc.overrides || {});
  upsertRow_('headcount', ['houseId'], [houseId], [houseId, num_(hc.basePatients), num_(hc.baseStaff), overrides]);
  return { ok: true };
}

function saveMenu_(houseId, weekOf, days) {
  if (!houseId || !weekOf) return { ok: false, error: 'houseId & weekOf required' };
  upsertRow_('menus', ['houseId', 'weekOf'], [houseId, weekOf], [houseId, weekOf, JSON.stringify(days || {})]);
  return { ok: true };
}

// The shared item catalog is GLOBAL (no houseId), so it is replaced wholesale.
function saveCatalog_(catalog) {
  var rows = (catalog || []).map(function (c) {
    return [String(c.name || '').trim(), unit_(c.unit), category_(c.category)];
  }).filter(function (r) { return r[0] !== ''; });
  replaceAll_('catalog', rows);
  return { ok: true, count: rows.length };
}

// A dated pantry snapshot. Upsert by (houseId, date) so recounting the same day
// overwrites rather than piling up. The full stock list is stored as JSON.
function saveStockCount_(houseId, count) {
  if (!houseId || !count || !count.date) return { ok: false, error: 'houseId & count.date required' };
  var id = count.id || uid_('cnt');
  upsertRow_('stockCounts', ['houseId', 'date'], [houseId, count.date],
    [id, houseId, String(count.date), JSON.stringify(count.items || [])]);
  return { ok: true };
}

// Manual shopping-list items ("פריטים נוספים") for ONE week. Replace every row
// for (houseId, weekOf) so that removing an item persists. Blank names dropped.
function saveShoppingExtras_(houseId, weekOf, extras) {
  if (!houseId || !weekOf) return { ok: false, error: 'houseId & weekOf required' };
  var sh = sheet_('shoppingExtras');
  var headers = SHEETS.shoppingExtras;
  var hIdx = headers.indexOf('houseId');
  var wIdx = headers.indexOf('weekOf');
  var kept = [];
  var last = sh.getLastRow();
  if (last >= 2) {
    var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
    kept = values.filter(function (row) {
      return !(String(row[hIdx]) === String(houseId) && String(row[wIdx]) === String(weekOf));
    });
  }
  var newRows = (extras || []).map(function (e) {
    return [e.id || uid_('extra'), houseId, String(weekOf), String(e.name || ''), num_(e.qty), unit_(e.unit), category_(e.category)];
  }).filter(function (r) { return String(r[3]).trim() !== ''; });
  var all = kept.concat(newRows);
  if (last >= 2) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, headers.length).setValues(all);
  return { ok: true, count: newRows.length };
}

// Per-item par / price overrides for the budget baseline. One row per house
// holding a JSON map { itemKey: { min?, price? } }. Upsert by houseId.
function saveParOverrides_(houseId, overrides) {
  if (!houseId) return { ok: false, error: 'houseId required' };
  upsertRow_('parOverrides', ['houseId'], [houseId], [houseId, JSON.stringify(overrides || {})]);
  return { ok: true };
}

// Per-month budget + approved overrun. Upsert by (houseId, month).
function saveBudget_(houseId, month, budget) {
  if (!houseId || !month) return { ok: false, error: 'houseId & month required' };
  budget = budget || {};
  upsertRow_('monthlyBudgets', ['houseId', 'month'], [houseId, month],
    [houseId, String(month), num_(budget.budget), num_(budget.overrun), String(budget.overrunNote || '')]);
  return { ok: true };
}

// The five real houses, with fixed human-readable ids and Hebrew display names.
// Mirrors KitchenDomain.SEED_HOUSES (lib/kitchen-domain.js); a Node test asserts
// the two lists never drift.
var SEED_HOUSES = [
  { id: 'ramot-hashavim', name: 'רמות השבים' },
  { id: 'raanana-asher', name: 'רעננה אשר' },
  { id: 'caesarea-ofroni', name: 'קיסריה עפרוני' },
  { id: 'caesarea-rehab', name: 'קיסריה ריהאב' },
  { id: 'pardes', name: 'פרדס' }
];

// Idempotent: seed the five houses only when the houses tab is empty. Runs
// inside doPost's LockService lock, so concurrent loads can't double-seed; once
// any house exists this is a no-op, so it never duplicates or clobbers a rename.
function seedHousesIfEmpty_() {
  if (readRows_('houses').length > 0) return;
  for (var i = 0; i < SEED_HOUSES.length; i++) {
    saveHouse_({ id: SEED_HOUSES[i].id, name: SEED_HOUSES[i].name, monthlyBudget: 0 });
  }
}

function loadAll_() {
  seedHousesIfEmpty_();
  var houses = readRows_('houses');
  var budget = indexBy_(readRows_('budget'), 'houseId');
  var headcount = indexBy_(readRows_('headcount'), 'houseId');
  var allergies = groupBy_(readRows_('allergies'), 'houseId');
  var stock = groupBy_(readRows_('stock'), 'houseId');
  var purchases = groupBy_(readRows_('purchases'), 'houseId');
  var consumption = groupBy_(readRows_('consumption'), 'houseId');
  var stockCounts = groupBy_(readRows_('stockCounts'), 'houseId');
  var monthlyBudgets = groupBy_(readRows_('monthlyBudgets'), 'houseId');
  var menus = groupBy_(readRows_('menus'), 'houseId');
  var shoppingExtras = groupBy_(readRows_('shoppingExtras'), 'houseId');
  var parOverrides = indexBy_(readRows_('parOverrides'), 'houseId');
  var catalog = readRows_('catalog').map(function (c) {
    return { name: String(c.name || ''), unit: unit_(c.unit), category: category_(c.category) };
  }).filter(function (c) { return c.name !== ''; });

  var out = houses.map(function (h) {
    var id = String(h.id);
    var hc = headcount[id];
    var weeks = {};
    (menus[id] || []).forEach(function (m) {
      var days = safeParse_(m.daysJson, {});
      weeks[String(m.weekOf)] = { weekOf: String(m.weekOf), days: days };
    });
    var budgets = {};
    (monthlyBudgets[id] || []).forEach(function (b) {
      budgets[String(b.month)] = { budget: num_(b.budget), overrun: num_(b.overrun), overrunNote: String(b.overrunNote || '') };
    });
    var extras = {};
    (shoppingExtras[id] || []).forEach(function (e) {
      var wk = String(e.weekOf);
      (extras[wk] = extras[wk] || []).push({ id: String(e.id), name: e.name || '', qty: num_(e.qty), unit: unit_(e.unit), category: category_(e.category) });
    });
    return {
      id: id,
      name: h.name || '',
      monthlyBudget: budget[id] ? num_(budget[id].monthlyBudget) : 0,
      budgets: budgets,
      headcount: hc
        ? { basePatients: num_(hc.basePatients), baseStaff: num_(hc.baseStaff), overrides: safeParse_(hc.overridesJson, {}) }
        : { basePatients: 0, baseStaff: 0, overrides: {} },
      allergies: (allergies[id] || []).map(function (a) { return { id: String(a.id), name: a.name, count: num_(a.count) }; }),
      stock: (stock[id] || []).map(function (s) { return { id: String(s.id), name: s.name, category: category_(s.category), qty: num_(s.qty), unit: unit_(s.unit), minQty: num_(s.min) }; }),
      purchases: (purchases[id] || []).map(function (p) { return { id: String(p.id), weekOf: String(p.weekOf), amount: num_(p.amount), note: p.note || '', date: String(p.date || '') }; }),
      consumption: (consumption[id] || []).map(function (c) { return { id: String(c.id), weekOf: String(c.weekOf), day: String(c.day), executedAt: String(c.executedAt || '') }; }),
      stockCounts: (stockCounts[id] || []).map(function (c) { return { id: String(c.id), date: String(c.date), items: safeParse_(c.itemsJson, []) }; }),
      shoppingExtras: extras,
      parOverrides: parOverrides[id] ? safeParse_(parOverrides[id].overridesJson, {}) : {},
      weeks: weeks
    };
  });
  return { ok: true, houses: out, catalog: catalog };
}

/* --------------------------- small utils --------------------------- */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function uid_(prefix) { return prefix + '_' + Utilities.getUuid(); }
function safeParse_(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
function indexBy_(rows, key) {
  var m = {};
  rows.forEach(function (r) { m[String(r[key])] = r; });
  return m;
}
function groupBy_(rows, key) {
  var m = {};
  rows.forEach(function (r) { var k = String(r[key]); (m[k] = m[k] || []).push(r); });
  return m;
}
