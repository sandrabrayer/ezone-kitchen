/**
 * ezone-kitchen — Google Apps Script backend (bound to the Sheet).
 *
 * POST-ONLY. The Node server (server.js) is the only caller: it proxies the
 * browser's requests here and injects `secret`, which must equal the
 * SHARED_SECRET Script Property. Requests without the correct secret are
 * rejected (fail-closed).
 *
 * One tab per entity — created automatically on first use:
 *   houses           id | name
 *   budget           houseId | weeklyBudget
 *   headcount        houseId | basePatients | baseStaff | overridesJson
 *   allergies        id | houseId | name | count
 *   stock            id | houseId | name | category | qtyKg
 *   ingredientPrices houseId | name | category | pricePerKg | updatedAt
 *   menus            houseId | weekOf | daysJson
 *   purchases        id | houseId | weekOf | amount | note | date
 *
 * Deploy: see docs/APPS-SCRIPT-SETUP.md. Redeploy by publishing a NEW VERSION
 * of the EXISTING deployment (pencil icon) — never create a new deployment,
 * or the /exec URL changes and the server breaks.
 */

var SHEETS = {
  houses: ['id', 'name'],
  budget: ['houseId', 'weeklyBudget'],
  headcount: ['houseId', 'basePatients', 'baseStaff', 'overridesJson'],
  allergies: ['id', 'houseId', 'name', 'count'],
  stock: ['id', 'houseId', 'name', 'category', 'qtyKg'],
  ingredientPrices: ['houseId', 'name', 'category', 'pricePerKg', 'updatedAt'],
  menus: ['houseId', 'weekOf', 'daysJson'],
  purchases: ['id', 'houseId', 'weekOf', 'amount', 'note', 'date']
};

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
          return [s.id || uid_('stk'), body.houseId, s.name || '', s.category || 'groceries', num_(s.qtyKg)];
        })); break;
        case 'savePrices': result = replaceForHouse_('ingredientPrices', body.houseId, (body.prices || []).map(function (p) {
          return [body.houseId, p.name || '', p.category || 'groceries', num_(p.pricePerKg), p.updatedAt || ''];
        })); break;
        case 'savePurchases': result = replaceForHouse_('purchases', body.houseId, (body.purchases || []).map(function (p) {
          return [p.id || uid_('pur'), body.houseId, p.weekOf || '', num_(p.amount), p.note || '', p.date || ''];
        })); break;
        case 'saveMenu': result = saveMenu_(body.houseId, body.weekOf, body.days); break;
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
  upsertRow_('houses', ['id'], [house.id], [house.id, house.name || '']);
  upsertRow_('budget', ['houseId'], [house.id], [house.id, num_(house.weeklyBudget)]);
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

// The five real houses, with fixed human-readable ids and Hebrew display names.
// Mirrors KitchenDomain.SEED_HOUSES (lib/kitchen-domain.js); a Node test asserts
// the two lists never drift.
var SEED_HOUSES = [
  { id: 'ramot-hashavim', name: 'רמות השבים' },
  { id: 'raanana-asher', name: 'רעננה אשר' },
  { id: 'caesarea-ofroni', name: 'קיסריה עפרוני' },
  { id: 'caesarea-rehab', name: 'קיסריה שיקום' },
  { id: 'pardes', name: 'פרדס' }
];

// Idempotent: seed the five houses only when the houses tab is empty. Runs
// inside doPost's LockService lock, so concurrent loads can't double-seed; once
// any house exists this is a no-op, so it never duplicates or clobbers a rename.
function seedHousesIfEmpty_() {
  if (readRows_('houses').length > 0) return;
  for (var i = 0; i < SEED_HOUSES.length; i++) {
    saveHouse_({ id: SEED_HOUSES[i].id, name: SEED_HOUSES[i].name, weeklyBudget: 0 });
  }
}

function loadAll_() {
  seedHousesIfEmpty_();
  var houses = readRows_('houses');
  var budget = indexBy_(readRows_('budget'), 'houseId');
  var headcount = indexBy_(readRows_('headcount'), 'houseId');
  var allergies = groupBy_(readRows_('allergies'), 'houseId');
  var stock = groupBy_(readRows_('stock'), 'houseId');
  var prices = groupBy_(readRows_('ingredientPrices'), 'houseId');
  var purchases = groupBy_(readRows_('purchases'), 'houseId');
  var menus = groupBy_(readRows_('menus'), 'houseId');

  var out = houses.map(function (h) {
    var id = String(h.id);
    var hc = headcount[id];
    var weeks = {};
    (menus[id] || []).forEach(function (m) {
      var days = safeParse_(m.daysJson, {});
      weeks[String(m.weekOf)] = { weekOf: String(m.weekOf), days: days };
    });
    return {
      id: id,
      name: h.name || '',
      weeklyBudget: budget[id] ? num_(budget[id].weeklyBudget) : 0,
      headcount: hc
        ? { basePatients: num_(hc.basePatients), baseStaff: num_(hc.baseStaff), overrides: safeParse_(hc.overridesJson, {}) }
        : { basePatients: 0, baseStaff: 0, overrides: {} },
      allergies: (allergies[id] || []).map(function (a) { return { id: String(a.id), name: a.name, count: num_(a.count) }; }),
      stock: (stock[id] || []).map(function (s) { return { id: String(s.id), name: s.name, category: s.category, qtyKg: num_(s.qtyKg) }; }),
      prices: (prices[id] || []).map(function (p) { return { name: p.name, category: p.category, pricePerKg: num_(p.pricePerKg), updatedAt: String(p.updatedAt || '') }; }),
      purchases: (purchases[id] || []).map(function (p) { return { id: String(p.id), weekOf: String(p.weekOf), amount: num_(p.amount), note: p.note || '', date: String(p.date || '') }; }),
      weeks: weeks
    };
  });
  return { ok: true, houses: out };
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
