/* ezone-kitchen — vanilla frontend (no build step).
   Talks to /api/sheets which proxies (POST-only) to the Google Apps Script
   bound to the Sheet. All shopping-list / consumption math comes from the shared
   KitchenDomain UMD module (/lib/kitchen-domain.js), the same code the tests
   exercise. The app is OPEN: no login, no roles — one URL shows the house
   switcher and every tab to every visitor. */
'use strict';

const KD = window.KitchenDomain;

/* ============================ utilities ============================ */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* Money is always ₪ (ILS) with two decimals and thousands separators, symbol
   first: e.g. ₪10,000.00. Kept deliberately simple (no locale currency quirks). */
function fmtCurrency(n) {
  const num = Number(n);
  const safe = Number.isFinite(num) ? num : 0;
  const sign = safe < 0 ? '-' : '';
  return sign + '₪' + Math.abs(safe).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/* Quantity + its unit label (ק"ג / גרם / יחידות / ליטר / מ"ל). */
function fmtQty(qty, unit) {
  const n = KD.roundQty(Number(qty) || 0);
  return n + ' ' + (KD.UNIT_LABELS_HE[KD.safeUnit(unit)] || '');
}
function setStatus(text) {
  const el = document.getElementById('footStatus');
  if (el) el.textContent = text || '';
}
function $(sel, root) { return (root || document).querySelector(sel); }
function clampNum(v) { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; }
function clampInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; }
/* Format a partially-typed money string with thousands separators, preserving a
   trailing dot / up to two decimals, without changing the stored numeric value
   (KD.parseMoney is the source of truth for the number). */
function formatMoneyTyping(raw) {
  let s = String(raw == null ? '' : raw).replace(/[^0-9.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  let [intPart, dec] = s.split('.');
  intPart = (intPart || '').replace(/^0+(?=\d)/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? grouped + '.' + dec.slice(0, 2) : grouped;
}

/* ============================ API client ============================ */
/* The app is open — no auth. Every call POSTs {action, ...} to /api/sheets,
   which proxies to Apps Script (injecting the server-only shared secret). */
async function api(action, payload) {
  const r = await fetch('/api/sheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('תשובה לא תקינה מהשרת'); }
  if (!r.ok || (data && data.ok === false)) {
    throw new Error((data && (data.error || data.message)) || ('HTTP ' + r.status));
  }
  return data;
}

/* Debounced, per-key saves so rapid typing coalesces into one write. */
const saveTimers = {};
function scheduleSave(key, fn) {
  if (saveTimers[key]) clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(async () => {
    delete saveTimers[key];
    try { setStatus('שומר…'); await fn(); setStatus('נשמר ✓'); }
    catch (err) { setStatus('שגיאת שמירה: ' + err.message); }
  }, 700);
}

/* Persist helpers — one Apps Script action per entity (one tab per entity). */
const persist = {
  house: (h) => scheduleSave('house:' + h.id, () =>
    api('saveHouse', { house: { id: h.id, name: h.name, monthlyBudget: h.monthlyBudget } })),
  headcount: (h) => scheduleSave('hc:' + h.id, () => api('saveHeadcount', { houseId: h.id, headcount: h.headcount })),
  allergies: (h) => scheduleSave('alg:' + h.id, () => api('saveAllergies', { houseId: h.id, allergies: h.allergies })),
  stock: (h) => scheduleSave('stk:' + h.id, () => api('saveStock', { houseId: h.id, stock: h.stock })),
  purchases: (h) => scheduleSave('pur:' + h.id, () => api('savePurchases', { houseId: h.id, purchases: h.purchases })),
  consumption: (h) => scheduleSave('cons:' + h.id, () => api('saveConsumption', { houseId: h.id, consumption: h.consumption })),
  menu: (h, weekOf) => scheduleSave('menu:' + h.id + ':' + weekOf, () =>
    api('saveMenu', { houseId: h.id, weekOf, days: h.weeks[weekOf].days })),
  catalog: () => scheduleSave('catalog', () => api('saveCatalog', { catalog: state.catalog })),
  budget: (h, month) => scheduleSave('budget:' + h.id + ':' + month, () =>
    api('saveBudget', { houseId: h.id, month, budget: budgetForMonth(h, month) })),
  stockCount: (h, count) => scheduleSave('cnt:' + h.id + ':' + count.date, () =>
    api('saveStockCount', { houseId: h.id, count })),
  shoppingExtras: (h, weekOf) => scheduleSave('extras:' + h.id + ':' + weekOf, () =>
    api('saveShoppingExtras', { houseId: h.id, weekOf, extras: (h.shoppingExtras && h.shoppingExtras[weekOf]) || [] })),
  parOverrides: (h) => scheduleSave('par:' + h.id, () =>
    api('saveParOverrides', { houseId: h.id, overrides: h.parOverrides || {} })),
};

/* ============================ state ============================ */
const state = {
  houses: [],
  catalog: [], // shared item catalog { name, unit, category }
  activeHouseId: null,
  currentWeekOf: KD.weekStart(new Date()),
  currentMonth: KD.monthKey(new Date()),
  tab: 'menu',
  mealOpen: {}, // transient accordion state, keyed by `${day}:${meal}`
  checked: {},  // transient shopping-list check-off state (ingredient key -> true)
  planFromToday: false, // weekly-plan filter: whole week vs from today onward
  countMode: false,     // stock-count (ספירת מלאי) mode toggle
  countDate: null,      // ISO date of the count being taken
  countValues: {},      // transient qty edits in count mode, keyed by stock id
};

function activeHouse() {
  return state.houses.find((h) => h.id === state.activeHouseId) || state.houses[0] || null;
}

/* The per-month budget record { budget, overrun, overrunNote, instructorsBudget }
   for a house, created lazily. Each month keeps its own figures. `budget` is the
   TOTAL monthly food budget; `instructorsBudget` is the separate מדריכים line
   (0 when unset — back-compat with pre-split records). */
function budgetForMonth(house, month) {
  if (!house.budgets) house.budgets = {};
  if (!house.budgets[month]) house.budgets[month] = { budget: 0, overrun: 0, overrunNote: '', instructorsBudget: 0 };
  const b = house.budgets[month];
  // Heal a record stored before the split: ensure the instructors line exists.
  if (b.instructorsBudget == null) b.instructorsBudget = 0;
  return b;
}

/* Stock with each item's par replaced by its EFFECTIVE (scaled/override) par —
   what all shortfall math (קניות, צפי) runs against, so shortfalls follow the
   house baseline and recompute live when תפוסה changes. */
function effectiveStock(house) {
  // Full catalog ∪ stock (unstocked items count as 0) so קניות / צפי top-ups
  // cover every catalog item with a par, not just items already in stock.
  return KD.effectiveCatalogStock(state.catalog, house.stock, KD.baseTotal(house.headcount), house.parOverrides || {});
}

/* Add any names to the shared catalog and persist if it changed. */
function catalogAdd(entries) {
  const before = state.catalog.length;
  state.catalog = KD.mergeCatalog(state.catalog, entries);
  if (state.catalog.length !== before) persist.catalog();
}
function ensureWeek(house, weekOf) {
  if (!house.weeks) house.weeks = {};
  if (!house.weeks[weekOf]) house.weeks[weekOf] = KD.emptyWeekMenu(weekOf);
  return house.weeks[weekOf];
}

/* ============================ normalisation ============================ */
/* Coerce data from the Sheet (and older records) into the current shapes:
   ingredients & stock carry { qty, unit }. `qty` is the dish TOTAL (older rows
   stored per-person kilograms in qtyPerPerson / qtyKgPerPerson — now read as
   totals). Every unit is whitelisted. */
function normIngredient(ing) {
  ing = ing || {};
  const raw = ing.qty != null ? ing.qty
    : (ing.qtyPerPerson != null ? ing.qtyPerPerson : ing.qtyKgPerPerson);
  const value = Number(raw);
  return {
    id: ing.id || KD.newId('ing'),
    name: String(ing.name || ''),
    category: KD.isCategory(ing.category) ? ing.category : 'groceries',
    qty: Number.isFinite(value) && value > 0 ? value : 0,
    unit: KD.safeUnit(ing.unit),
  };
}
function normStock(s) {
  s = s || {};
  const raw = s.qty != null ? s.qty : s.qtyKg;
  const value = Number(raw);
  const rawMin = s.minQty != null ? s.minQty : s.min;
  const min = Number(rawMin);
  return {
    id: s.id || KD.newId('stk'),
    name: String(s.name || ''),
    category: KD.isCategory(s.category) ? s.category : 'groceries',
    qty: Number.isFinite(value) && value > 0 ? value : 0,
    unit: KD.safeUnit(s.unit),
    minQty: Number.isFinite(min) && min > 0 ? min : 0,
  };
}

/* Coerce the per-week shopping-extras map { weekOf: [extra,…] } from the Sheet
   (and older records) into normalised shapes; anything unexpected → {}. */
function normaliseExtras(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const wk of Object.keys(raw)) {
    if (Array.isArray(raw[wk])) out[wk] = raw[wk].map((e) => KD.readShoppingExtra(e));
  }
  return out;
}

/* Coerce the per-item par/price overrides map { itemKey: { min?, price? } }.
   Only finite, non-negative numbers are kept; a key with neither is dropped.
   Prototype-pollution keys (__proto__ etc.) are skipped. */
function normaliseParOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const v = raw[key];
    if (!v || typeof v !== 'object') continue;
    const entry = {};
    const min = Number(v.min);
    const price = Number(v.price);
    if (v.min != null && v.min !== '' && Number.isFinite(min) && min >= 0) entry.min = min;
    if (v.price != null && v.price !== '' && Number.isFinite(price) && price >= 0) entry.price = price;
    if ('min' in entry || 'price' in entry) out[key] = entry;
  }
  return out;
}

/* The default seed catalog from the shared domain module, guarded against an
   older/partial `/lib/kitchen-domain.js` that predates it (so a version skew
   can never throw and wipe the seed). */
function seedList() {
  return Array.isArray(KD.SEED_CATALOG) ? KD.SEED_CATALOG : [];
}
const catalogSig = (cat) => cat.map((c) => KD.catalogKey(c.name)).sort().join('|');
// A fuller signature (name + unit + category) so unit/category CORRECTIONS —
// not just added/removed names — trigger a one-time persist that heals the Sheet.
const catalogFullSig = (cat) => cat.map((c) => KD.catalogKey(c.name) + '|' + KD.safeUnit(c.unit) + '|' + (KD.isCategory(c.category) ? c.category : 'groceries')).sort().join(',');

/* ============================ load ============================ */
async function loadState() {
  const d = await api('load', {});
  state.houses = Array.isArray(d.houses) ? d.houses : [];

  // Seed the catalog IMMEDIATELY, before any per-house normalisation runs. The
  // seed must survive even if a house has corrupt/unexpected stored data that
  // throws below — otherwise the datalists silently fall back to user-only items
  // (the bug this fixes). Priority: backend catalog > seed defaults.
  const backendCatalog = Array.isArray(d.catalog) ? d.catalog : [];
  // The RAW backend catalog (normalised) — compared below so a corrected catalog
  // is persisted back once, then converges (idempotent, self-healing).
  const backendSig = catalogFullSig(KD.mergeCatalog(backendCatalog, []));
  // Seed + CORRECT (fix stale units/categories, rename typos, drop duplicates).
  state.catalog = KD.correctCatalog(KD.mergeCatalog(backendCatalog, seedList()));

  const catalogSeed = []; // names discovered in stock + menus, merged in below
  for (const h of state.houses) {
    // One malformed house must not abort the whole load (and skip seeding the
    // rest); isolate each so the app still comes up.
    try {
      normaliseHouse(h, catalogSeed);
    } catch (err) {
      if (window.console) console.warn('skipping malformed house', h && h.id, err);
    }
  }

  // Merge names discovered in stock/menus, then re-correct so nothing a house
  // contributed reintroduces a typo/duplicate/stale unit. Persist when the
  // corrected catalog differs from the backend (name OR unit/category), so the
  // Sheet heals once and then stays stable.
  state.catalog = KD.correctCatalog(KD.mergeCatalog(state.catalog, catalogSeed));
  if (catalogFullSig(state.catalog) !== backendSig) persist.catalog();

  // Persist any house whose stock was migrated (eggs merge / typo rename) so the
  // fix is durable in the Sheet, not re-applied on every load.
  for (const h of state.houses) {
    if (h._stockMigrated) { delete h._stockMigrated; persist.stock(h); }
  }

  // Keep the current house if it still exists, else default to the first.
  if (!state.houses.some((h) => h.id === state.activeHouseId)) {
    state.activeHouseId = state.houses[0] ? state.houses[0].id : null;
  }
}

/* Normalise one house in place and collect its item names for the catalog.
   Defensive against corrupt stored data (e.g. a menu meal that isn't an array). */
function normaliseHouse(h, catalogSeed) {
  h.headcount = h.headcount || KD.emptyHeadcount();
  h.allergies = Array.isArray(h.allergies) ? h.allergies : [];
  h.stock = (Array.isArray(h.stock) ? h.stock : []).map(normStock);
  // Fold historical duplicates/typos (בצים→ביצים, עכבניות→עגבניות) into their
  // canonical item, merging quantities. Flag a change so loadState persists it.
  const stockBefore = JSON.stringify(h.stock);
  h.stock = KD.correctStock(h.stock);
  if (JSON.stringify(h.stock) !== stockBefore) h._stockMigrated = true;
  h.purchases = Array.isArray(h.purchases) ? h.purchases : [];
  h.consumption = Array.isArray(h.consumption) ? h.consumption : []; // served-day markers
  h.stockCounts = Array.isArray(h.stockCounts) ? h.stockCounts : []; // dated snapshots
  h.shoppingExtras = normaliseExtras(h.shoppingExtras); // per-week manual list items
  h.parOverrides = normaliseParOverrides(h.parOverrides); // per-item par/price overrides
  h.budgets = (h.budgets && typeof h.budgets === 'object') ? h.budgets : {};
  // Ensure every stored month carries the instructors line (0 when pre-split).
  for (const mk of Object.keys(h.budgets)) {
    const rec = h.budgets[mk];
    if (rec && typeof rec === 'object' && rec.instructorsBudget == null) rec.instructorsBudget = 0;
  }
  h.workers = Array.isArray(h.workers) ? h.workers : []; // instructor-cost source (role מדריך)
  h.weeks = (h.weeks && typeof h.weeks === 'object') ? h.weeks : {};
  // Legacy single monthlyBudget → migrate into the current month if unset.
  const legacy = typeof h.monthlyBudget === 'number' ? h.monthlyBudget
    : (typeof h.weeklyBudget === 'number' ? h.weeklyBudget : 0);
  if (legacy > 0 && !h.budgets[state.currentMonth]) {
    h.budgets[state.currentMonth] = { budget: legacy, overrun: 0, overrunNote: '' };
  }
  h.stock.forEach((s) => { if (s.name) catalogSeed.push({ name: s.name, unit: s.unit, category: s.category }); });
  // Rebuild every stored week into a COMPLETE 7-day × 3-meal structure, carrying
  // over existing dishes. This tolerates partial/corrupt menus (a missing day, a
  // meal that isn't an array) so no downstream code can trip over them.
  for (const weekOf of Object.keys(h.weeks)) {
    const wk = h.weeks[weekOf];
    const days = (wk && wk.days && typeof wk.days === 'object') ? wk.days : {};
    const rebuilt = {};
    for (const day of KD.DAYS) {
      const plan = (days[day] && typeof days[day] === 'object') ? days[day] : {};
      rebuilt[day] = {};
      for (const meal of KD.MEALS) {
        const dishes = Array.isArray(plan[meal]) ? plan[meal] : [];
        rebuilt[day][meal] = dishes.map((dish) => ({
          id: (dish && dish.id) || KD.newId('dish'),
          name: String((dish && dish.name) || ''),
          ingredients: (Array.isArray(dish && dish.ingredients) ? dish.ingredients : []).map((ing) => {
            const n = normIngredient(ing);
            if (n.name) catalogSeed.push({ name: n.name, unit: n.unit, category: n.category });
            return n;
          }),
        }));
      }
    }
    h.weeks[weekOf] = { weekOf: weekOf, days: rebuilt };
  }
}

/* ============================ house theming ============================ */
/* Each house tints the app bar + its active switcher chip + a subtle page wash
   with its own color. A house without a mapped color falls back to brand green. */
const HOUSE_COLORS = {
  'ramot-hashavim': '#37cabe',
  'raanana-asher': '#497ead',
  'caesarea-ofroni': '#6e519e',
  'caesarea-rehab': '#ad9949',
  'pardes': '#49ad59',
};
const BRAND_GREEN = '#0b8457';
const PAGE_BG = '#e2dbcc';

function hexLum(hex) {
  const c = String(hex).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(c)) return 0.5;
  const v = [0, 2, 4].map((i) => {
    let x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function readableInk(hex) {
  const L = hexLum(hex);
  const white = 1.05 / (L + 0.05);
  const dark = (L + 0.05) / (hexLum('#14231c') + 0.05);
  return white >= dark ? '#ffffff' : '#14231c';
}
function mixHex(a, b, t) {
  const pa = a.replace('#', ''), pb = b.replace('#', '');
  const m = (i) => {
    const x = Math.round(parseInt(pa.substr(i, 2), 16) * t + parseInt(pb.substr(i, 2), 16) * (1 - t));
    return x.toString(16).padStart(2, '0');
  };
  return '#' + m(0) + m(2) + m(4);
}
function applyHouseTheme() {
  const h = activeHouse();
  const color = (h && HOUSE_COLORS[h.id]) || BRAND_GREEN;
  const root = document.documentElement.style;
  root.setProperty('--house-active', color);
  root.setProperty('--house-ink', readableInk(color));
  root.setProperty('--house-wash', mixHex(color, PAGE_BG, 0.10));
}

/* ============================ rendering ============================ */
const TABS = [
  { id: 'headcount', icon: '👥', label: 'תפוסה' },
  { id: 'menu', icon: '🗓️', label: 'תפריט' },
  { id: 'stock', icon: '📦', label: 'מלאי' },
  { id: 'baseline', icon: '🧮', label: 'כמויות בסיס' },
  { id: 'plan', icon: '📊', label: 'צפי' },
  { id: 'shopping', icon: '🛒', label: 'קניות' },
  { id: 'budget', icon: '💰', label: 'תקציב' },
  { id: 'admin', icon: '🏠', label: 'כל הבתים' },
];

function renderChrome() {
  const showHouses = state.tab !== 'admin';
  const switcher = $('#houseSwitcher');
  const active = activeHouse();
  switcher.hidden = !showHouses;
  switcher.innerHTML = showHouses ? state.houses.map((h) =>
    `<button class="house-chip" data-act="selHouse" data-id="${esc(h.id)}" aria-current="${active && h.id === active.id}">${esc(h.name)}</button>`
  ).join('') + `<button class="house-chip add" data-act="addHouse" title="הוסף בית" aria-label="הוסף בית">＋</button>` : '';

  $('#tabs').innerHTML = TABS.map((t) =>
    `<button data-tab="${t.id}" role="tab" aria-current="${state.tab === t.id}">
       <span class="tab-ic" aria-hidden="true">${t.icon}</span><span class="tab-tx">${esc(t.label)}</span>
     </button>`).join('');
}

/* Belt-and-suspenders: guarantee the default seed is present in the in-memory
   catalog before anything renders, so the datalists/comboboxes always include it
   even if the load path was interrupted. Idempotent and cheap (skips once the
   seed is present). */
function ensureCatalogSeeded() {
  const seed = seedList();
  if (!seed.length) return;
  if (KD.catalogLookup(state.catalog, seed[0].name)) return; // already seeded
  state.catalog = KD.mergeCatalog(state.catalog, seed);
}

function render() {
  ensureCatalogSeeded();
  applyHouseTheme();
  renderChrome();
  const screen = $('#screen');
  if (state.tab === 'admin') { screen.innerHTML = renderAdmin(); return; }
  const house = activeHouse();
  if (!house) {
    screen.innerHTML = emptyState('🏠', 'אין בתים עדיין',
      'הוסיפו בית עם הכפתור ＋ שליד מתגי הבתים כדי להתחיל.');
    return;
  }
  const map = { menu: renderMenu, headcount: renderHeadcount, stock: renderStock, baseline: renderBaseline, plan: renderPlan, shopping: renderShopping, budget: renderBudget };
  const fn = map[state.tab] || renderMenu;
  screen.innerHTML = fn(house);
}

function emptyState(icon, title, hint) {
  return `<div class="empty">
    <div class="empty-ic" aria-hidden="true">${icon}</div>
    <div class="empty-title">${esc(title)}</div>
    ${hint ? `<div class="empty-hint">${esc(hint)}</div>` : ''}
  </div>`;
}

/* The three-step pantry flow, shown as a one-line hint atop the מלאי / ספירה /
   קניות tabs so cooks see the chain: count what you have → set what you need →
   buy what's missing. `step` (1-3) is emphasised for the current tab. */
function flowHint(step) {
  const steps = [
    { n: 1, label: 'ספירת מלאי', sub: 'מה יש' },
    { n: 2, label: 'מלאי מינימום', sub: 'מה צריך' },
    { n: 3, label: 'רשימת קניות', sub: 'מה חסר' },
  ];
  const parts = steps.map((s) =>
    `<span class="flow-step${s.n === step ? ' on' : ''}"><b>${s.n}</b> ${esc(s.label)} <small>${esc(s.sub)}</small></span>`);
  return `<div class="flow-hint no-print" role="note" aria-label="שלבי העבודה">${parts.join('<span class="flow-arr" aria-hidden="true">←</span>')}</div>`;
}

function allergyBanner(house) {
  if (!house.allergies.length) return '';
  const pills = house.allergies
    .filter((a) => a.name)
    .map((a) => `<span class="pill">${esc(a.name)} ×${Number(a.count) || 0}</span>`).join('');
  if (!pills) return '';
  return `<div class="allergy-banner"><span>⚠️ אלרגיות:</span>${pills}</div>`;
}

/* ---------------------------- Menu view ---------------------------- */
function todayKey() { return KD.DAYS[new Date().getDay()]; }

/* Distinct dish names already used in this house — the "existing dishes" list
   offered as a dropdown / datalist alongside free-text entry. */
function existingDishNames(house) {
  const set = new Set();
  const weeks = house.weeks || {};
  for (const weekOf of Object.keys(weeks)) {
    const wk = weeks[weekOf];
    if (!wk || !wk.days) continue;
    for (const day of KD.DAYS) {
      for (const meal of KD.MEALS) {
        for (const dish of (wk.days[day] && wk.days[day][meal]) || []) {
          const n = String(dish.name || '').trim();
          if (n) set.add(n);
        }
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
}

/* The most recent dish with this name, to clone its ingredients when a cook
   picks an "existing dish" rather than typing a new one. */
function findDishTemplate(house, name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  let found = null;
  const weeks = house.weeks || {};
  for (const weekOf of Object.keys(weeks)) {
    const wk = weeks[weekOf];
    if (!wk || !wk.days) continue;
    for (const day of KD.DAYS) {
      for (const meal of KD.MEALS) {
        for (const dish of (wk.days[day] && wk.days[day][meal]) || []) {
          if (String(dish.name || '').trim().toLowerCase() === target) found = dish;
        }
      }
    }
  }
  return found;
}

function mealKey(day, meal) { return day + ':' + meal; }

function renderMenu(house) {
  const weekOf = state.currentWeekOf;
  const week = ensureWeek(house, weekOf);
  const hasLast = !!(house.weeks && house.weeks[KD.shiftWeek(weekOf, -1)]);
  const thisWeek = weekOf === KD.weekStart(new Date());
  const today = todayKey();

  const dishNames = existingDishNames(house);
  const dishOptions = dishNames.map((n) => `<option value="${esc(n)}"></option>`).join('');
  const pickerOptions = '<option value="">מנה קיימת…</option>' +
    dishNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

  const cols = KD.DAYS.map((day) => {
    const people = KD.effectiveForDay(house.headcount, day).total;
    const isToday = thisWeek && day === today;
    const served = KD.isDayExecuted(house.consumption, weekOf, day);
    const canServe = KD.dayConsumption(week, day).length > 0;

    const dayPlan = (week.days && week.days[day]) || {};
    const meals = KD.MEALS.map((meal) => {
      const dishes = Array.isArray(dayPlan[meal]) ? dayPlan[meal] : [];
      const open = !!state.mealOpen[mealKey(day, meal)];
      const names = dishes.map((dd) => String(dd.name || '').trim()).filter(Boolean);
      const summary = names.length ? names.join(' · ') : '—';
      const dishHtml = dishes.map((dish) => renderDish(day, meal, dish)).join('');
      const body = open ? `<div class="meal-body">
          <div class="meal-actions">
            <button class="add-row" data-act="addDish" data-day="${day}" data-meal="${meal}">＋ מנה</button>
            <select class="dish-picker" data-act="pickDish" data-day="${day}" data-meal="${meal}" aria-label="הוסף מנה קיימת">${pickerOptions}</select>
          </div>
          ${dishHtml || '<div class="meal-empty">—</div>'}
        </div>` : '';
      return `<div class="meal-block meal-${meal}${open ? ' open' : ''}">
        <button type="button" class="meal-head" data-act="toggleMeal" data-day="${day}" data-meal="${meal}" aria-expanded="${open}">
          <span class="meal-caret" aria-hidden="true">${open ? '▾' : '◂'}</span>
          <span class="meal-label">${esc(KD.MEAL_LABELS_HE[meal])}</span>
          <span class="meal-count">${dishes.length || ''}</span>
          ${open ? '' : `<span class="meal-summary muted">${esc(summary)}</span>`}
        </button>
        ${body}
      </div>`;
    }).join('');

    const serveBtn = served
      ? '<span class="served-badge" title="נוכה מהמלאי">✓ בוצע</span>'
      : (canServe ? `<button class="serve-btn" data-act="serveDay" data-day="${day}" title="נכה מהמלאי את מנות היום">בוצע</button>` : '');

    return `<div class="day-col${isToday ? ' today' : ''}">
      <div class="day-head">
        <span class="day-name">${esc(KD.DAY_LABELS_HE[day])}${isToday ? '<span class="today-badge">היום</span>' : ''}</span>
        <span class="day-head-actions">
          <span class="people-pill" title="סועדים ביום זה">👥 ${people}</span>
          ${serveBtn}
        </span>
      </div>
      ${meals}
    </div>`;
  }).join('');

  return `${allergyBanner(house)}
    <datalist id="dishNames">${dishOptions}</datalist>
    ${catalogDatalist()}
    <div class="week-bar no-print">
      <button class="icon-btn" data-act="weekPrev" aria-label="שבוע קודם">→</button>
      <div class="week-label"><span class="muted">שבוע</span><strong>${esc(KD.formatDateHe(weekOf))}</strong></div>
      <button class="icon-btn" data-act="weekNext" aria-label="שבוע הבא">←</button>
      <button class="primary copy-btn" data-act="copyLast" ${hasLast ? '' : 'disabled'}
        title="${hasLast ? 'העתק את תפריט השבוע הקודם' : 'אין תפריט לשבוע הקודם'}">⧉ העתק שבוע קודם</button>
    </div>
    <div class="week-grid">${cols}</div>`;
}

function unitOptions(selected) {
  const sel = KD.safeUnit(selected);
  return KD.UNITS.map((u) =>
    `<option value="${u}" ${u === sel ? 'selected' : ''}>${esc(KD.UNIT_LABELS_HE[u])}</option>`).join('');
}

function qtyStep(unit) {
  return (unit === 'g' || unit === 'ml' || unit === 'unit') ? '1' : '0.01';
}

/* ---------------------- mobile quantity picker ---------------------- */
/* Tapping a qty field (count + stock) opens a sheet of common values for its
   unit; picking one fills the field (and fires `input` so the normal handlers
   run). Free typing is still allowed via the field itself / "הקלד ידנית". */
function qtyRange(a, b, step) {
  const out = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
const QTY_PRESETS = {
  unit: qtyRange(0, 30, 1).concat([40, 50, 60, 80, 100, 120, 150, 200]),
  kg: qtyRange(0, 10, 0.5).concat([12, 15, 20, 25, 30]),
  g: [0, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000],
  l: qtyRange(0, 10, 0.5).concat([12, 15, 20]),
  ml: [0, 100, 250, 500, 750, 1000, 1500, 2000],
};

function closeQtyPicker() {
  const ex = document.querySelector('.qty-picker-overlay');
  if (ex) ex.remove();
}

function openQtyPicker(input) {
  closeQtyPicker();
  const u = KD.safeUnit(input.dataset.picker);
  const presets = QTY_PRESETS[u] || QTY_PRESETS.unit;
  const cur = String(input.value || '');
  const overlay = document.createElement('div');
  overlay.className = 'qty-picker-overlay';
  overlay.innerHTML = `<div class="qty-picker" role="dialog" aria-label="בחירת כמות">
      <div class="qty-picker-head"><span>בחר כמות · ${esc(KD.UNIT_LABELS_HE[u])}</span>
        <button class="icon-btn" data-picker-close aria-label="סגור">✕</button></div>
      <div class="qty-picker-grid">${presets.map((v) => `<button class="qty-chip${String(v) === cur ? ' on' : ''}" data-picker-val="${v}">${v}</button>`).join('')}</div>
      <div class="qty-picker-foot"><button class="ghost" data-picker-type>⌨️ הקלד ידנית</button></div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-picker-close]')) { closeQtyPicker(); return; }
    if (e.target.closest('[data-picker-type]')) { closeQtyPicker(); input.focus(); return; }
    const chip = e.target.closest('[data-picker-val]');
    if (chip) {
      input.value = chip.dataset.pickerVal;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      closeQtyPicker();
    }
  });
  document.body.appendChild(overlay);
}

/* Shared datalist of catalog item names — referenced by every name field
   (menu ingredients + pantry items) so each is a searchable combobox that still
   accepts free text. */
function catalogDatalist() {
  return `<datalist id="catalogNames">${state.catalog.map((c) => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>`;
}

/* One datalist per category, so EVERY מלאי row's name field is a searchable
   combobox scoped to that category's catalog items (id `catCombo_<category>`).
   Picking an item auto-fills its unit / category / default par (see the stkName
   change handler). Free text is still accepted — the datalist only suggests. */
function categoryComboDatalists() {
  return KD.CATEGORIES.map((c) => {
    const opts = state.catalog
      .filter((x) => x.category === c)
      .map((x) => `<option value="${esc(x.name)}"></option>`)
      .join('');
    return `<datalist id="catCombo_${c}">${opts}</datalist>`;
  }).join('');
}

/* A menu ingredient row: name (catalog combobox) | qty | unit | delete.
   Category is derived from the catalog by name (no per-row category box). */
function renderDish(day, meal, dish) {
  const ings = (dish.ingredients || []).map((ing) => {
    const unit = KD.safeUnit(ing.unit);
    const d = `data-day="${day}" data-meal="${meal}" data-dish="${esc(dish.id)}" data-ing="${esc(ing.id)}"`;
    return `<div class="ing">
      <div class="ing-meta">
        <input class="ing-name" list="catalogNames" value="${esc(ing.name)}" placeholder="מרכיב" data-act="ingName" ${d} />
        <span class="u">
          <input type="number" inputmode="decimal" min="0" step="${qtyStep(unit)}" value="${ing.qty || ''}" placeholder="0" data-act="ingQty" ${d} />
          <select data-act="ingUnit" ${d}>${unitOptions(unit)}</select>
        </span>
        <button class="icon-btn danger" title="מחק מרכיב" data-act="delIng" ${d}>✕</button>
      </div>
    </div>`;
  }).join('');
  const d = `data-day="${day}" data-meal="${meal}" data-dish="${esc(dish.id)}"`;
  return `<div class="dish">
    <div class="dish-title">
      <input class="dish-name" list="dishNames" value="${esc(dish.name)}" placeholder="שם המנה" data-act="dishName" ${d} />
      <button class="icon-btn danger" title="מחק מנה" data-act="delDish" ${d}>🗑</button>
    </div>
    ${ings}
    <button class="add-row ghost" data-act="addIng" ${d}>＋ מרכיב</button>
  </div>`;
}

/* ------------------------- Headcount view ------------------------- */
function renderHeadcount(house) {
  const hc = house.headcount;
  const rows = KD.DAYS.map((day) => {
    const ov = (hc.overrides && hc.overrides[day]) || {};
    const eff = KD.effectiveForDay(hc, day);
    const has = ov.patients != null || ov.staff != null;
    return `<tr>
      <td>${esc(KD.DAY_LABELS_HE[day])}</td>
      <td><input type="number" min="0" placeholder="${hc.basePatients}" value="${ov.patients != null ? ov.patients : ''}" data-act="ovP" data-day="${day}" style="width:70px" /></td>
      <td><input type="number" min="0" placeholder="${hc.baseStaff}" value="${ov.staff != null ? ov.staff : ''}" data-act="ovS" data-day="${day}" style="width:70px" /></td>
      <td class="num"><strong>${eff.total}</strong>${has ? ' <span class="tag">חריגה</span>' : ''}</td>
      <td>${has ? `<button class="danger" data-act="ovClear" data-day="${day}">נקה</button>` : ''}</td>
    </tr>`;
  }).join('');

  return `<div class="card">
      <h2>תפוסת בית — ${esc(house.name)}</h2>
      <p class="muted">מספר בסיס של מטופלים ואנשי צוות. ניתן לעדכן בכל עת ולהגדיר חריגה יומית (אורחים / טיולים).</p>
      <div class="row">
        <label>מטופלים (בסיס): <input type="number" min="0" value="${house.headcount.basePatients || ''}" data-act="baseP" style="width:80px" /></label>
        <label>אנשי צוות (בסיס): <input type="number" min="0" value="${house.headcount.baseStaff || ''}" data-act="baseS" style="width:80px" /></label>
        <span class="pill">סה"כ בסיס: <strong id="baseTotal">${KD.baseTotal(hc)}</strong></span>
      </div>
    </div>
    <div class="card">
      <h3>חריגות יומיות</h3>
      <p class="muted">השאירו ריק כדי להשתמש בערך הבסיס. מלאו ערך כדי לעקוף ליום מסוים.</p>
      <table><thead><tr><th>יום</th><th>מטופלים</th><th>צוות</th><th>סה"כ אפקטיבי</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    ${renderAllergiesCard(house)}`;
}

function renderAllergiesCard(house) {
  const rows = house.allergies.map((a) => `<div class="row" style="margin-bottom:.4rem">
      <input value="${esc(a.name)}" placeholder="אלרגיה (למשל גלוטן)" data-act="algName" data-id="${esc(a.id)}" />
      <label class="muted">כמות: <input type="number" min="0" value="${Number(a.count) || 0}" data-act="algCount" data-id="${esc(a.id)}" style="width:64px" /></label>
      <button class="danger" data-act="algDel" data-id="${esc(a.id)}">מחק</button>
    </div>`).join('');
  return `<div class="card">
    <h3>אלרגיות</h3>
    <p class="muted">מוצג בראש מסך התפריט ומודפס על רשימת הקניות. אין אכיפה בגרסה זו — מידע בלבד.</p>
    ${house.allergies.length ? '' : '<p class="muted">אין אלרגיות מוגדרות.</p>'}
    ${rows}
    <button class="ghost" data-act="algAdd">＋ הוסף אלרגיה</button>
  </div>`;
}

/* --------------------------- Stock view --------------------------- */
/* The last saved stock-count date, if any (latest by ISO date). */
function lastCount(house) {
  const counts = house.stockCounts || [];
  if (!counts.length) return null;
  return counts.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
}

function renderStock(house) {
  if (state.countMode) return renderStockCount(house);

  const active = state.stockCat || 'groceries';
  state.stockCat = active;
  const tabs = KD.CATEGORIES.map((c) =>
    `<button data-act="stockCat" data-cat="${c}" aria-current="${active === c}"><span class="cat-dot cat-${c}" aria-hidden="true"></span>${esc(KD.CATEGORY_LABELS_HE[c])}</button>`).join('');
  const items = house.stock.filter((s) => s.category === active);
  const baseTotal = KD.baseTotal(house.headcount);
  const effItems = KD.withEffectiveMins(items, state.catalog, baseTotal, house.parOverrides || {}); // parallel to items
  const rows = items.length ? items.map((item, i) => {
    const unit = KD.safeUnit(item.unit);
    const effMin = (effItems[i] && effItems[i].minQty) || 0;
    const below = effMin > 0 && (Number(item.qty) || 0) < effMin;
    const parKey = KD.catalogKey(item.name);
    const manualMin = !!(house.parOverrides && house.parOverrides[parKey] && Object.prototype.hasOwnProperty.call(house.parOverrides[parKey], 'min'));
    const catOpts = KD.CATEGORIES.map((c) => `<option value="${c}" ${c === item.category ? 'selected' : ''}>${esc(KD.CATEGORY_LABELS_HE[c])}</option>`).join('');
    return `<tr class="${below ? 'below-min' : ''}">
      <td><input class="stk-name" list="catCombo_${item.category}" value="${esc(item.name)}" placeholder="בחר פריט…" data-act="stkName" data-id="${esc(item.id)}" /></td>
      <td><select data-act="stkCat" data-id="${esc(item.id)}">${catOpts}</select></td>
      <td><span class="u"><input type="number" inputmode="decimal" min="0" step="${qtyStep(unit)}" value="${item.qty || ''}" placeholder="0" data-act="stkQty" data-id="${esc(item.id)}" data-picker="${unit}" style="width:74px" title="כמות במלאי" />
        <select data-act="stkUnit" data-id="${esc(item.id)}">${unitOptions(unit)}</select></span></td>
      <td class="num muted stk-min${below ? ' over' : ''}${manualMin ? ' manual' : ''}" title="${manualMin ? 'מינימום ידני (מהכמויות הבסיסיות)' : 'מחושב לפי הכמויות הבסיסיות'}">${effMin > 0 ? fmtQty(effMin, unit) : '—'}${manualMin ? ` <button class="icon-btn reset-btn no-print" data-act="stkResetMin" data-key="${esc(parKey)}" title="אפס מינימום לברירת מחדל" aria-label="אפס מינימום לברירת מחדל">↺</button>` : ''}</td>
      <td><button class="danger" data-act="stkDel" data-id="${esc(item.id)}">מחק</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="muted">אין פריטים בקטגוריה זו.</td></tr>`;

  const last = lastCount(house);
  const countHistory = (house.stockCounts || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);

  return `<div class="card">
    ${categoryComboDatalists()}
    ${flowHint(1)}
    <div class="row between">
      <h2 style="margin:0">מלאי — ${esc(house.name)}</h2>
      <button class="primary" data-act="countStart">📋 ספירת מלאי</button>
    </div>
    <p class="muted">מה קיים במחסן כרגע. נחסר מרשימת הקניות ומהצפי; פריט מתחת ל<strong>מלאי מינימום</strong> מסומן באדום.
      <br>מלאי המינימום <strong>מחושב</strong> לפי הכמויות הבסיסיות (מותאם לתפוסת הבית) — לעריכה עברו ללשונית «כמויות בסיס».
      ${last ? `<br>ספירה אחרונה: <strong>${esc(KD.formatDateHe(last.date))}</strong>` : ''}</p>
    <div class="subtabs">${tabs}</div>
    <table><thead><tr><th>מרכיב</th><th>קטגוריה</th><th>כמות במלאי</th><th>מינימום (מחושב)</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="stock-add">
      <input id="stkAddName" placeholder="פריט חדש שלא ברשימה…" title="פריט חופשי שאינו בקטלוג — יתווסף לקטלוג" />
      <button class="add-row" data-act="stkAdd" data-cat="${active}">＋ הוסף</button>
    </div>
    ${countHistory.length ? `<details class="count-history"><summary class="muted">היסטוריית ספירות (${countHistory.length})</summary>
      <ul class="count-list">${countHistory.map((c) => `<li><span>${esc(KD.formatDateHe(c.date))} · ${(c.items || []).length} פריטים</span>
        <button class="ghost" data-act="countRestore" data-date="${esc(c.date)}">שחזר</button></li>`).join('')}</ul></details>` : ''}
  </div>`;
}

/* Stock-count mode: the FULL catalog (every seeded + user item), grouped by
   category, each with its unit and a quantity input defaulting to the current
   stock qty (0 when not in stock yet). One pass, dated, saved atomically
   ("שמור ספירה") — writes ALL counted items into stock (items counted >0 that
   weren't in stock get added) AND stores a snapshot. The count is the full
   summary of what exists in the pantry. Transient edits live in
   state.countValues (keyed by catalog/name key) until saved. */
function renderStockCount(house) {
  const date = state.countDate || KD.toISODate(new Date());
  state.countDate = date;
  const allRows = KD.stockCountRows(state.catalog, house.stock);
  const baseTotal = KD.baseTotal(house.headcount);
  const sections = KD.CATEGORIES.map((c) => {
    const list = allRows.filter((r) => r.category === c);
    if (!list.length) return '';
    const rows = list.map((r) => {
      const unit = KD.safeUnit(r.unit);
      const edited = Object.prototype.hasOwnProperty.call(state.countValues, r.key);
      const val = edited ? state.countValues[r.key] : r.qty;
      const eff = KD.effectiveParFor(state.catalog, r.name, baseTotal, house.parOverrides || {});
      const minRef = eff.qty > 0 ? `<span class="count-min muted" title="מלאי מינימום מחושב">מינימום: ${fmtQty(eff.qty, eff.unit)}</span>` : '';
      return `<tr>
        <td>${esc(r.name)}${minRef}</td>
        <td class="muted">${esc(KD.UNIT_LABELS_HE[unit])}</td>
        <td><input type="number" inputmode="decimal" min="0" step="${qtyStep(unit)}" value="${val || ''}" placeholder="0" data-act="countQty" data-key="${esc(r.key)}" data-picker="${unit}" style="width:90px" /></td>
      </tr>`;
    }).join('');
    return `<h3 class="count-cat"><span class="cat-dot cat-${c}" aria-hidden="true"></span>${esc(KD.CATEGORY_LABELS_HE[c])} <span class="muted">(${list.length})</span></h3>
      <table><tbody>${rows}</tbody></table>`;
  }).join('');

  return `<div class="card">
    ${flowHint(1)}
    <div class="row between">
      <h2 style="margin:0">ספירת מלאי — ${esc(house.name)}</h2>
      <label class="muted">תאריך: <input type="date" value="${esc(date)}" data-act="countDate" /></label>
    </div>
    <p class="muted">פשוט: <strong>סִפרו מה שיש</strong>. עברו על כל הפריטים (${allRows.length}) ורשמו כמות לכל אחד; מה שאין — השאירו 0. עם השמירה כל הפריטים נשמרים במלאי (גם ריקים), ונשמר צילום מצב בתאריך זה.</p>
    ${allRows.length ? sections : '<p class="muted">אין פריטים בקטלוג. הוסיפו פריטים תחילה.</p>'}
    <div class="row" style="margin-top:.8rem">
      <button class="primary" data-act="countSave">✓ שמור ספירה</button>
      <button class="ghost" data-act="countCancel">ביטול</button>
    </div>
  </div>`;
}

/* ---------------------- כמויות בסיס (budget baseline) ---------------------- */
/* The house's MONTHLY baseline: for every catalog item, the scaled weekly par,
   its monthly quantity (×4), the estimated price and the monthly cost. The grand
   total is the budget baseline. Qty + price are editable inline; edits save as
   per-item overrides (highlighted) and never rescale. */
function renderBaseline(house) {
  const people = KD.baseTotal(house.headcount);
  const b = KD.baselineForHouse(state.catalog, people, house.parOverrides || {});
  const hasOverrides = Object.keys(house.parOverrides || {}).length > 0;

  const sections = KD.CATEGORIES.map((c) => {
    const rows = b.rows.filter((r) => r.category === c);
    if (!rows.length) return '';
    const trs = rows.map((r) => {
      const manual = r.minSource === 'manual' || r.priceSource === 'manual';
      return `<tr class="${manual ? 'par-manual' : ''}" data-cat="${r.category}">
        <td>${esc(r.name)}</td>
        <td class="muted">${esc(KD.UNIT_LABELS_HE[r.unit])}</td>
        <td><input type="number" inputmode="decimal" min="0" step="${qtyStep(r.unit)}" value="${r.weekQty || ''}" placeholder="0" data-act="parMin" data-key="${esc(r.key)}" class="par-qty${r.minSource === 'manual' ? ' manual' : ''}" style="width:76px" /></td>
        <td class="num muted par-month">${fmtQty(r.monthQty, r.unit)}</td>
        <td><span class="money-in">₪<input type="number" inputmode="decimal" min="0" step="0.01" value="${r.price || ''}" placeholder="0" data-act="parPrice" data-key="${esc(r.key)}" class="par-price${r.priceSource === 'manual' ? ' manual' : ''}" style="width:70px" /></span></td>
        <td class="num par-cost">${fmtCurrency(r.monthlyCost)}</td>
        <td class="muted par-src">${manual ? 'ידני' : 'ברירת מחדל'}</td>
        <td class="par-actions no-print"><button class="icon-btn reset-btn" data-act="parReset" data-key="${esc(r.key)}" title="אפס לברירת מחדל" aria-label="אפס לברירת מחדל" ${manual ? '' : 'hidden'}>↺</button></td>
      </tr>`;
    }).join('');
    return `<h3 class="count-cat"><span class="cat-dot cat-${c}" aria-hidden="true"></span>${esc(KD.CATEGORY_LABELS_HE[c])}</h3>
      <div class="table-scroll"><table class="baseline-table">
        <thead><tr><th>פריט</th><th>יחידה</th><th>כמות לשבוע</th><th>לחודש (×4)</th><th>מחיר משוער</th><th>עלות חודשית</th><th>מקור</th><th class="no-print"></th></tr></thead>
        <tbody>${trs}</tbody></table></div>`;
  }).join('');

  return `<div class="card">
    ${flowHint(2)}
    <div class="print-only print-head"><h1>כמויות בסיס — ${esc(house.name)}</h1><div>מחושב עבור ${people} אנשים (ייחוס: ${KD.BASE_PEOPLE})</div></div>
    <div class="baseline-head">
      <div class="screen-title">
        <h2 class="baseline-title">הכמות הבסיסית לבית לחודש — קובעת את התקציב</h2>
        <span class="muted">מחושב עבור <strong>${people}</strong> אנשים (ייחוס: ${KD.BASE_PEOPLE}). ערכי ברירת המחדל ניתנים לעריכה — עריכה נשמרת כערך <strong>ידני</strong> ומודגשת.</span>
      </div>
      <div class="head-actions no-print">
        <button data-act="parResetAll" ${hasOverrides ? '' : 'disabled'} title="הסר את כל הערכים הידניים בבית זה">↺ אפס הכל לברירת מחדל</button>
        <button data-act="printBaseline">🖨️ הדפס</button>
        <button class="primary" data-act="baselineShare">📱 שיתוף</button>
      </div>
    </div>
    ${b.rows.length ? sections : emptyState('🧮', 'אין פריטים בקטלוג', 'הוסיפו פריטים למלאי כדי לבנות בסיס.')}
    <div class="baseline-total">
      <span>סה"כ עלות חודשית משוערת</span>
      <strong id="baselineTotal">${fmtCurrency(b.total)}</strong>
    </div>
    <p class="muted baseline-note">זהו בסיס התקציב החודשי לבית. אפשר לאמץ אותו בלשונית «תקציב».</p>
  </div>`;
}

/* Live-update a baseline row + the grand total after an inline qty/price edit,
   without a full re-render (keeps the input focused while typing). */
function updateBaselineRowLive(house, inputEl, key) {
  const people = KD.baseTotal(house.headcount);
  const b = KD.baselineForHouse(state.catalog, people, house.parOverrides || {});
  const totalEl = document.getElementById('baselineTotal');
  if (totalEl) totalEl.textContent = fmtCurrency(b.total);
  const r = b.rows.find((x) => x.key === key);
  const tr = inputEl.closest('tr');
  if (!r || !tr) return;
  const set = (sel, txt) => { const el = tr.querySelector(sel); if (el) el.textContent = txt; };
  set('.par-month', fmtQty(r.monthQty, r.unit));
  set('.par-cost', fmtCurrency(r.monthlyCost));
  set('.par-src', (r.minSource === 'manual' || r.priceSource === 'manual') ? 'ידני' : 'ברירת מחדל');
  const minI = tr.querySelector('input[data-act="parMin"]');
  const priceI = tr.querySelector('input[data-act="parPrice"]');
  if (minI) minI.classList.toggle('manual', r.minSource === 'manual');
  if (priceI) priceI.classList.toggle('manual', r.priceSource === 'manual');
  const manual = r.minSource === 'manual' || r.priceSource === 'manual';
  tr.classList.toggle('par-manual', manual);
  const rb = tr.querySelector('button[data-act="parReset"]');
  if (rb) rb.hidden = !manual;
  const resetAll = document.querySelector('button[data-act="parResetAll"]');
  if (resetAll) resetAll.disabled = !Object.keys(house.parOverrides || {}).length;
}

/* Set or clear a per-item par/price override, then persist. */
function setParOverride(house, key, field, rawValue) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
  if (!house.parOverrides) house.parOverrides = {};
  const ov = Object.assign({}, house.parOverrides[key]);
  if (rawValue === '' || rawValue == null) {
    delete ov[field];
  } else {
    const n = parseFloat(rawValue);
    ov[field] = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if ('min' in ov || 'price' in ov) house.parOverrides[key] = ov;
  else delete house.parOverrides[key];
  persist.parOverrides(house);
}

/* WhatsApp/plain text of the monthly baseline (shared/printed summary). */
function baselineText(house) {
  const people = KD.baseTotal(house.headcount);
  const b = KD.baselineForHouse(state.catalog, people, house.parOverrides || {});
  const lines = ['🧮 כמויות בסיס לחודש – ' + house.name, 'מחושב עבור ' + people + ' אנשים (ייחוס ' + KD.BASE_PEOPLE + ')', ''];
  for (const c of KD.CATEGORIES) {
    const rows = b.rows.filter((r) => r.category === c && r.monthlyCost > 0);
    if (!rows.length) continue;
    lines.push('*' + KD.CATEGORY_LABELS_HE[c] + '*');
    for (const r of rows) lines.push('• ' + r.name + ': ' + fmtQty(r.monthQty, r.unit) + ' — ' + fmtCurrency(r.monthlyCost));
    lines.push('');
  }
  lines.push('סה"כ חודשי משוער: ' + fmtCurrency(b.total));
  return lines.join('\n').trim();
}

/* ------------------------ Weekly plan view ------------------------ */
/* צפי — "השוואת תפריט מול מלאי". Two explanatory sections (KD.weeklyPlan):
     • the menu comparison: every ingredient the week's menu needs vs stock;
     • "השלמה למלאי מינימום": items NOT in the menu but below their par, so a
       cook sees WHY each of those lands on the shopping list.
   When the week has no menu at all, a friendly message replaces the table. */
function renderPlan(house) {
  const weekOf = state.currentWeekOf;
  const week = (house.weeks && house.weeks[weekOf]) || KD.emptyWeekMenu(weekOf);
  const isThisWeek = weekOf === KD.weekStart(new Date());
  const todayIdx = new Date().getDay(); // 0 = Sunday … 6 = Saturday
  const daysRemaining = 7 - todayIdx;   // days left in the week, including today
  const fromToday = state.planFromToday;
  const days = fromToday ? KD.DAYS.slice(todayIdx) : KD.DAYS;
  const plan = KD.weeklyPlan(week, effectiveStock(house), days);
  const needLabel = fromToday ? 'נדרש (מהיום)' : 'נדרש לשבוע';

  const menuRows = plan.menu.map((line) => {
    const short = line.missing > 0;
    return `<tr class="${short ? 'plan-short' : ''}">
      <td>${esc(line.name)}</td>
      <td class="num">${fmtQty(line.requiredQty, line.unit)}</td>
      <td class="num muted">${fmtQty(line.stockQty, line.unit)}</td>
      <td class="num ${short ? 'over' : 'under'}">${short ? fmtQty(line.missing, line.unit) : '—'}</td>
    </tr>`;
  }).join('');

  const menuSection = plan.menuEmpty
    ? emptyState('🍽️', 'עדיין לא הוזן תפריט לשבוע זה', 'מלאו את התפריט לכל ימי השבוע כדי לראות מה נדרש מול המלאי.')
    : `<table>
        <thead><tr><th>פריט</th><th>${needLabel}</th><th>קיים במלאי</th><th>חסר</th></tr></thead>
        <tbody>${menuRows}</tbody>
      </table>
      <p class="muted" style="margin-top:.6rem">${plan.menu.some((l) => l.missing > 0)
        ? `⚠️ ${plan.menu.filter((l) => l.missing > 0).length} מרכיבים חסרים ביחס לתפריט`
        : '✓ המלאי מכסה את כל צורכי התפריט'}</p>`;

  const parRows = plan.parTopUp.map((line) => `<tr class="plan-short">
      <td>${esc(line.name)}</td>
      <td class="num muted">${fmtQty(line.minQty, line.unit)}</td>
      <td class="num muted">${fmtQty(line.stockQty, line.unit)}</td>
      <td class="num over">${fmtQty(line.missing, line.unit)}</td>
    </tr>`).join('');
  const parSection = plan.parTopUp.length ? `<div class="card">
      <h3 style="margin:0 0 .3rem">השלמה למלאי מינימום</h3>
      <p class="muted">פריטים שאינם בתפריט השבוע אך מתחת למלאי המינימום — לכן הם נכנסים לרשימת הקניות.</p>
      <table>
        <thead><tr><th>פריט</th><th>מינימום</th><th>קיים במלאי</th><th>חסר</th></tr></thead>
        <tbody>${parRows}</tbody>
      </table>
    </div>` : '';

  return `${allergyBanner(house)}
    <div class="card">
      <div class="row between">
        <h2 style="margin:0">צפי שבועי — השוואת תפריט מול מלאי</h2>
        ${isThisWeek ? `<span class="pill">נותרו ${daysRemaining} ימים</span>` : ''}
      </div>
      <p class="muted">לאחר מילוי התפריטים לכל השבוע: ריכוז כל המרכיבים הנדרשים, מול מה שקיים במלאי. <span class="muted">(שבוע ${esc(KD.formatDateHe(weekOf))})</span></p>
      <div class="subtabs">
        <button data-act="planScope" data-scope="week" aria-current="${!fromToday}">כל השבוע</button>
        <button data-act="planScope" data-scope="today" aria-current="${fromToday}">מהיום והלאה</button>
      </div>
      ${menuSection}
    </div>
    ${parSection}`;
}

/* ------------------------ Shopping list view ------------------------ */
function renderShopping(house) {
  const weekOf = state.currentWeekOf;
  const week = (house.weeks && house.weeks[weekOf]) || KD.emptyWeekMenu(weekOf);
  const list = KD.buildShoppingList(week, effectiveStock(house));
  const pct = Math.round(list.bufferRate * 100);

  const sections = KD.CATEGORIES.map((c) => {
    const rows = list.byCategory[c].filter((r) => r.toBuyQty > 0);
    if (!rows.length) return '';
    const items = rows.map((r) => {
      const key = c + ':' + r.name;
      const done = state.checked[key] ? ' done' : '';
      const sub = (r.bufferedQty > 0 ? 'נדרש ' + fmtQty(r.bufferedQty, r.unit) + ' · ' : '')
        + (r.minQty > 0 ? 'מינ׳ ' + fmtQty(r.minQty, r.unit) + ' · ' : '')
        + 'במלאי ' + fmtQty(r.stockQty, r.unit);
      return `<li class="shop-item${done}" data-act="checkItem" data-key="${esc(key)}">
        <span class="check" aria-hidden="true"></span>
        <span class="shop-body">
          <span class="shop-name">${esc(r.name)}</span>
          <span class="shop-sub muted">${sub}</span>
        </span>
        <span class="shop-qty num">${fmtQty(r.toBuyQty, r.unit)}</span>
      </li>`;
    }).join('');
    return `<section class="card shop-cat">
      <h3 class="shop-cat-head"><span class="cat-dot cat-${c}" aria-hidden="true"></span>${esc(KD.CATEGORY_LABELS_HE[c])}
        <span class="count-badge">${rows.length}</span></h3>
      <ul class="shop-list">${items}</ul>
    </section>`;
  }).join('');

  const alg = house.allergies.filter((a) => a.name);
  const printHead = `<div class="print-only print-head">
      <h1>רשימת קניות — ${esc(house.name)}</h1>
      <div>שבוע ${esc(KD.formatDateHe(weekOf))} · כולל תוספת ${pct}% · בניכוי מלאי קיים</div>
      ${alg.length ? `<div class="print-alg">⚠️ אלרגיות: ${alg.map((a) => esc(a.name) + ' ×' + (Number(a.count) || 0)).join(', ')}</div>` : ''}
    </div>`;

  const extras = (house.shoppingExtras && house.shoppingExtras[weekOf]) || [];
  const nothing = list.lines.every((l) => l.toBuyQty === 0);
  return `${allergyBanner(house)}
    ${catalogDatalist()}
    ${flowHint(3)}
    <div class="screen-head shop-head no-print">
      <div class="screen-title"><h2>רשימת קניות</h2>
        <span class="muted">שבוע ${esc(KD.formatDateHe(weekOf))} · כולל תוספת ${pct}% · בניכוי מלאי</span></div>
      <div class="head-actions">
        <button class="primary" data-act="waShare">📱 וואטסאפ</button>
        <button data-act="printList">🖨️ הדפס</button>
      </div>
    </div>
    ${printHead}
    ${nothing && !extras.length
      ? emptyState('🎉', 'אין מה לקנות', 'המלאי מכסה את כל הצרכים — ניתן להוסיף פריטים ידנית למטה.')
      : sections}
    ${renderShoppingExtras(extras)}`;
}

/* "פריטים נוספים" — free items the cook adds to THIS week's list on top of the
   computed shortfall. Combobox (catalog) or free text + qty + unit; removable;
   persisted per week and included in the printed / shared list. The add row is
   no-print; the items themselves print. */
function renderShoppingExtras(extras) {
  const items = extras.map((e) => `<li class="shop-item extra-item">
      <span class="shop-body"><span class="shop-name">${esc(e.name)}</span></span>
      <span class="shop-qty num">${fmtQty(e.qty, e.unit)}</span>
      <button class="icon-btn danger no-print" title="הסר פריט" data-act="extraDel" data-id="${esc(e.id)}">✕</button>
    </li>`).join('');
  return `<section class="card shop-cat shop-extras">
    <h3 class="shop-cat-head"><span class="cat-dot cat-extra" aria-hidden="true"></span>פריטים נוספים
      ${extras.length ? `<span class="count-badge">${extras.length}</span>` : ''}</h3>
    ${extras.length ? `<ul class="shop-list">${items}</ul>` : '<p class="muted no-print" style="margin:.2rem 0 .6rem">הוסיפו פריטים שאינם נגזרים מהתפריט/מלאי (למשל חד־פעמי, ניקיון).</p>'}
    <div class="extra-add no-print">
      <input id="extraName" list="catalogNames" placeholder="פריט (מהקטלוג או חופשי)…" />
      <input type="number" id="extraQty" min="0" step="0.01" placeholder="0" style="width:80px" title="כמות" />
      <select id="extraUnit" title="יחידה">${unitOptions('unit')}</select>
      <button class="add-row" data-act="extraAdd">＋ הוסף</button>
    </div>
  </section>`;
}

function shoppingListText(house) {
  const weekOf = state.currentWeekOf;
  const week = (house.weeks && house.weeks[weekOf]) || KD.emptyWeekMenu(weekOf);
  const list = KD.buildShoppingList(week, effectiveStock(house));
  const lines = [];
  lines.push('🛒 רשימת קניות – ' + house.name);
  lines.push('שבוע ' + KD.formatDateHe(weekOf));
  const alg = house.allergies.filter((a) => a.name).map((a) => `${a.name} ×${Number(a.count) || 0}`);
  if (alg.length) lines.push('⚠️ אלרגיות: ' + alg.join(', '));
  lines.push('');
  let any = false;
  for (const c of KD.CATEGORIES) {
    const rows = list.byCategory[c].filter((r) => r.toBuyQty > 0);
    if (!rows.length) continue;
    any = true;
    lines.push('*' + KD.CATEGORY_LABELS_HE[c] + '*');
    for (const r of rows) lines.push('• ' + r.name + ': ' + fmtQty(r.toBuyQty, r.unit));
    lines.push('');
  }
  const extras = (house.shoppingExtras && house.shoppingExtras[weekOf]) || [];
  if (extras.length) {
    any = true;
    lines.push('*פריטים נוספים*');
    for (const e of extras) lines.push('• ' + e.name + ': ' + fmtQty(e.qty, e.unit));
    lines.push('');
  }
  if (!any) lines.push('אין מה לקנות – המלאי מכסה את הצרכים 🎉');
  return lines.join('\n').trim();
}

/* --------------------------- Budget view --------------------------- */
/* MONTHLY budget, entered manually and kept PER MONTH. Four figures: תקציב,
   חריגה מאושרת (approved overrun), בפועל, מול תקציב = (budget + overrun) −
   actual. Amounts shown/typed with thousands separators; stored numeric. */
function renderBudget(house) {
  const month = state.currentMonth;
  const b = budgetForMonth(house, month);
  const actual = KD.actualSpendForMonth(house.purchases, month);
  const summary = KD.summariseBudget(b.budget, actual, b.overrun);

  const monthPurchases = house.purchases.filter((p) => KD.monthOf(p.date) === month);
  const purchaseRows = monthPurchases.length ? monthPurchases.map((p) => `<tr>
      <td class="muted">${esc(KD.formatDateHe(p.date || ''))}</td><td class="num">${fmtCurrency(p.amount)}</td><td>${esc(p.note || '')}</td>
      <td><button class="danger" data-act="purDel" data-id="${esc(p.id)}">מחק</button></td></tr>`).join('') : '';

  const baselineTotal = KD.baselineForHouse(state.catalog, KD.baseTotal(house.headcount), house.parOverrides || {}).total;

  return `<div class="card">
      <h2 style="margin:0 0 .3rem">תקציב — ${esc(house.name)}</h2>
      <div class="month-bar">
        <button class="icon-btn" data-act="monthPrev" aria-label="חודש קודם">→</button>
        <strong>${esc(KD.formatMonthHe(month))}</strong>
        <button class="icon-btn" data-act="monthNext" aria-label="חודש הבא">←</button>
      </div>
      <div class="baseline-adopt">
        <span>בסיס מחושב (כמויות בסיס): <strong>${fmtCurrency(baselineTotal)}</strong></span>
        <button class="ghost" data-act="adoptBaseline" ${baselineTotal > 0 ? '' : 'disabled'} title="העתק את הבסיס המחושב לתקציב החודשי">אמץ כתקציב</button>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:1rem">
        <label class="muted">תקציב חודשי (₪): <input type="text" inputmode="decimal" value="${esc(KD.groupThousands(b.budget))}" data-act="budgetAmount" style="width:120px" /></label>
        <label class="muted">תקציב מדריכים ₪: <input type="text" inputmode="decimal" value="${b.instructorsBudget ? esc(KD.groupThousands(b.instructorsBudget)) : ''}" placeholder="0" data-act="instructorsBudgetAmount" style="width:120px" /></label>
        <label class="muted">חריגה מאושרת (₪): <input type="text" inputmode="decimal" value="${b.overrun ? esc(KD.groupThousands(b.overrun)) : ''}" placeholder="0" data-act="overrunAmount" style="width:110px" /></label>
        <label class="muted" style="flex:1;min-width:180px">הערת חריגה: <input value="${esc(b.overrunNote || '')}" placeholder="סיבת האישור (לא חובה)" data-act="overrunNote" style="width:100%" /></label>
      </div>
      <p class="warn-instructors" id="instructorsWarn" style="margin:.2rem 0 0;font-size:.82rem;color:var(--danger);${b.instructorsBudget > b.budget && b.budget > 0 ? '' : 'display:none'}">תקציב המדריכים גבוה מהתקציב החודשי הכולל</p>
      <div class="stat-grid stat-grid-4">
        <div class="stat"><div class="label">תקציב</div><div class="value num" id="tileBudget">${fmtCurrency(summary.budget)}</div></div>
        <div class="stat"><div class="label">חריגה מאושרת</div><div class="value num" id="tileOverrun">${fmtCurrency(summary.overrun)}</div></div>
        <div class="stat"><div class="label">בפועל</div><div class="value num" id="tileActual">${fmtCurrency(summary.actual)}</div></div>
        <div class="stat"><div class="label">מול תקציב</div><div class="value num ${summary.overBudget ? 'over' : 'under'}" id="tileRemaining">${fmtCurrency(summary.remaining)}</div></div>
      </div>
    </div>
    <div class="card">
      <h3>רישום הוצאה בפועל</h3>
      <div class="row">
        <input type="number" min="0" step="0.01" placeholder="סכום ₪" id="spendAmount" style="width:120px" />
        <input placeholder="הערה (לא חובה)" id="spendNote" />
        <button class="primary" data-act="purAdd">הוסף</button>
      </div>
      ${monthPurchases.length ? `<table style="margin-top:.6rem"><thead><tr><th>תאריך</th><th>סכום</th><th>הערה</th><th></th></tr></thead><tbody>${purchaseRows}</tbody></table>` : '<p class="muted" style="margin-top:.6rem">אין הוצאות רשומות לחודש זה.</p>'}
    </div>`;
}

/* Copy the computed monthly baseline (from כמויות בסיס) into this month's
   manual budget field. */
function adoptBaselineAsBudget(house) {
  const total = KD.baselineForHouse(state.catalog, KD.baseTotal(house.headcount), house.parOverrides || {}).total;
  if (!(total > 0)) return;
  const b = budgetForMonth(house, state.currentMonth);
  b.budget = total;
  persist.budget(house, state.currentMonth);
  render();
  setStatus('התקציב עודכן לבסיס המחושב ✓');
}

/* Recompute the four budget tiles in place (no re-render, so the input keeps
   focus while typing) — the fix for the "input says 20,000 but tile shows
   ₪10,000" desync. */
function updateBudgetTiles(house) {
  const month = state.currentMonth;
  const b = budgetForMonth(house, month);
  const s = KD.summariseBudget(b.budget, KD.actualSpendForMonth(house.purchases, month), b.overrun);
  const set = (id, txt, over) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    if (over !== undefined) { el.classList.toggle('over', over); el.classList.toggle('under', !over); }
  };
  set('tileBudget', fmtCurrency(s.budget));
  set('tileOverrun', fmtCurrency(s.overrun));
  set('tileActual', fmtCurrency(s.actual));
  set('tileRemaining', fmtCurrency(s.remaining), s.overBudget);
}

/* An indented "מדריכים" sub-row under a house row in the budget-vs-cost table.
   Shown only for houses that have an instructors budget for the month. The
   actual instructor cost is the sum of the house's מדריך workers' costs — the
   recorded monthly actuals when present, otherwise an estimate flagged with the
   אומדן badge (falling back to the instructors budget when no worker data
   exists). Columns mirror the house row: name, ניצול %, budget, cost, יתרה/חריגה. */
function instructorSubRow(house, b, month) {
  const iBudget = b.instructorsBudget || 0;
  if (!(iBudget > 0)) return '';
  const ic = KD.instructorCostForMonth(house.workers, month, iBudget);
  const s = KD.summariseBudget(iBudget, ic.cost, 0);
  const pct = KD.utilisationPct(ic.cost, iBudget);
  const statusLabel = s.overBudget ? 'חריגה' : 'תקין';
  return `<tr class="subrow instructors">
      <td class="sub-name"><span class="sub-arrow" aria-hidden="true">↳</span> מדריכים <span class="status-chip ${s.overBudget ? 'over' : 'under'}">${statusLabel}</span></td>
      <td class="num muted">ניצול ${pct}%</td>
      <td class="num">${fmtCurrency(s.budget)}</td>
      <td class="num">${fmtCurrency(s.actual)}${ic.estimated ? ' <span class="badge est">אומדן</span>' : ''}</td>
      <td class="num ${s.overBudget ? 'over' : 'under'}">${fmtCurrency(s.remaining)}</td>
      <td></td>
    </tr>`;
}

/* --------------------------- Admin view --------------------------- */
function renderAdmin() {
  const month = state.currentMonth;
  let tB = 0, tA = 0;
  const rows = state.houses.map((house) => {
    const b = budgetForMonth(house, month);
    const actual = KD.actualSpendForMonth(house.purchases, month);
    const s = KD.summariseBudget(b.budget, actual, b.overrun);
    const people = KD.baseTotal(house.headcount);
    tB += s.budget + s.overrun; tA += s.actual;
    const houseRow = `<tr>
      <td><strong>${esc(house.name)}</strong><div class="muted mono" style="font-size:.7rem">${esc(house.id)}</div></td>
      <td class="num">${people}</td>
      <td class="num">${fmtCurrency(s.budget)}</td>
      <td class="num">${fmtCurrency(s.actual)}</td>
      <td class="num ${s.overBudget ? 'over' : 'under'}">${fmtCurrency(s.remaining)}</td>
      <td><button class="ghost" data-act="openHouse" data-id="${esc(house.id)}">פתח</button></td>
    </tr>`;
    return houseRow + instructorSubRow(house, b, month);
  }).join('');

  if (!state.houses.length) {
    return emptyState('🏠', 'אין בתים עדיין', 'הוסיפו בית מתפריט הבתים כדי להתחיל.');
  }
  const totalRemaining = KD.roundQty(tB - tA, 2);
  return `<div class="card">
    <h2>מבט על — כל הבתים</h2>
    <div class="month-bar">
      <button class="icon-btn" data-act="monthPrev" aria-label="חודש קודם">→</button>
      <strong>${esc(KD.formatMonthHe(month))}</strong>
      <button class="icon-btn" data-act="monthNext" aria-label="חודש הבא">←</button>
    </div>
    <p class="muted">תקציב חודשי והוצאה בפועל לכל בית.</p>
    <table>
      <thead><tr><th>בית</th><th>סועדים (בסיס)</th><th>תקציב</th><th>בפועל</th><th>מול תקציב</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><strong>סה"כ</strong></td><td></td>
        <td class="num"><strong>${fmtCurrency(tB)}</strong></td>
        <td class="num"><strong>${fmtCurrency(tA)}</strong></td>
        <td class="num ${tA > tB ? 'over' : 'under'}"><strong>${fmtCurrency(totalRemaining)}</strong></td>
        <td></td></tr></tfoot>
    </table>
  </div>`;
}

/* ============================ event wiring ============================ */
function findDish(house, day, meal, dishId) {
  const week = ensureWeek(house, state.currentWeekOf);
  return (week.days[day][meal] || []).find((d) => d.id === dishId);
}

function onInput(e) {
  const t = e.target;
  const act = t.dataset && t.dataset.act;
  if (!act) return;
  const house = activeHouse();
  if (!house) return;

  switch (act) {
    case 'dishName': {
      const dish = findDish(house, t.dataset.day, t.dataset.meal, t.dataset.dish);
      if (dish) { dish.name = t.value; persist.menu(house, state.currentWeekOf); }
      break;
    }
    case 'ingName': case 'ingQty': {
      const dish = findDish(house, t.dataset.day, t.dataset.meal, t.dataset.dish);
      const ing = dish && dish.ingredients.find((i) => i.id === t.dataset.ing);
      if (!ing) break;
      if (act === 'ingName') {
        ing.name = t.value;
        // Derive category (and, for a fresh row, the default unit) from the
        // shared catalog when the typed name matches an existing item.
        const hit = KD.catalogLookup(state.catalog, t.value);
        if (hit) { ing.category = hit.category; if (!ing.qty) ing.unit = hit.unit; }
      } else ing.qty = clampNum(t.value);
      persist.menu(house, state.currentWeekOf);
      break;
    }
    case 'baseP': house.headcount.basePatients = clampInt(t.value); updateBaseTotal(house); persist.headcount(house); break;
    case 'baseS': house.headcount.baseStaff = clampInt(t.value); updateBaseTotal(house); persist.headcount(house); break;
    case 'ovP': case 'ovS': setOverride(house, t.dataset.day, act === 'ovP' ? 'patients' : 'staff', t.value); persist.headcount(house); break;
    case 'algName': { const a = house.allergies.find((x) => x.id === t.dataset.id); if (a) { a.name = t.value; persist.allergies(house); } break; }
    case 'algCount': { const a = house.allergies.find((x) => x.id === t.dataset.id); if (a) { a.count = clampInt(t.value); persist.allergies(house); } break; }
    case 'stkName': { const s = house.stock.find((x) => x.id === t.dataset.id); if (s) { s.name = t.value; persist.stock(house); } break; }
    case 'stkQty': { const s = house.stock.find((x) => x.id === t.dataset.id); if (s) { s.qty = clampNum(t.value); toggleBelowMin(house, t, s); persist.stock(house); } break; }
    case 'countQty': state.countValues[t.dataset.key] = clampNum(t.value); break;
    case 'parMin': setParOverride(house, t.dataset.key, 'min', t.value); updateBaselineRowLive(house, t, t.dataset.key); break;
    case 'parPrice': setParOverride(house, t.dataset.key, 'price', t.value); updateBaselineRowLive(house, t, t.dataset.key); break;
    case 'budgetAmount': {
      const b = budgetForMonth(house, state.currentMonth);
      b.budget = KD.parseMoney(t.value);
      reformatMoney(t);
      updateBudgetTiles(house); updateInstructorsWarn(b); persist.budget(house, state.currentMonth); break;
    }
    case 'instructorsBudgetAmount': {
      const b = budgetForMonth(house, state.currentMonth);
      b.instructorsBudget = KD.parseMoney(t.value);
      reformatMoney(t);
      updateInstructorsWarn(b); persist.budget(house, state.currentMonth); break;
    }
    case 'overrunAmount': {
      const b = budgetForMonth(house, state.currentMonth);
      b.overrun = KD.parseMoney(t.value);
      reformatMoney(t);
      updateBudgetTiles(house); persist.budget(house, state.currentMonth); break;
    }
    case 'overrunNote': {
      const b = budgetForMonth(house, state.currentMonth);
      b.overrunNote = t.value; persist.budget(house, state.currentMonth); break;
    }
    default: break;
  }
}

/* Toggle the below-minimum red highlight live (no full re-render), comparing
   the on-hand qty to the item's EFFECTIVE (scaled/override) par. */
function toggleBelowMin(house, input, item) {
  const eff = KD.withEffectiveMins([item], state.catalog, KD.baseTotal(house.headcount), house.parOverrides || {})[0];
  const effMin = (eff && eff.minQty) || 0;
  const below = effMin > 0 && (Number(item.qty) || 0) < effMin;
  const row = input.closest('tr');
  if (!row) return;
  row.classList.toggle('below-min', below);
  const mc = row.querySelector('.stk-min');
  if (mc) mc.classList.toggle('over', below);
}

/* Show/hide the "instructors budget exceeds the total" warning live (no
   re-render, so the input keeps focus while typing). A warning, never a block —
   the value is still saved. */
function updateInstructorsWarn(b) {
  const el = document.getElementById('instructorsWarn');
  if (!el) return;
  const over = b.instructorsBudget > b.budget && b.budget > 0;
  el.style.display = over ? '' : 'none';
}

/* Reformat a money input with thousands separators while typing, keeping the
   caret at the end (budget fields are short, so caret-to-end is acceptable). */
function reformatMoney(input) {
  input.value = formatMoneyTyping(input.value);
  const end = input.value.length;
  try { input.setSelectionRange(end, end); } catch { /* number inputs disallow it */ }
}

/* Live update of the "סה"כ בסיס" figure without a full re-render (which would
   drop focus from the input being typed into). */
function updateBaseTotal(house) {
  const el = document.getElementById('baseTotal');
  if (el) el.textContent = KD.baseTotal(house.headcount);
}

function onChange(e) {
  const t = e.target;
  const act = t.dataset && t.dataset.act;
  if (!act) return;
  const house = activeHouse();
  if (!house) return;

  if (act === 'ingName') {
    // Finalised on blur / datalist pick: register the (possibly new) name in the
    // shared catalog so it appears in every dropdown next render.
    const dish = findDish(house, t.dataset.day, t.dataset.meal, t.dataset.dish);
    const ing = dish && dish.ingredients.find((i) => i.id === t.dataset.ing);
    if (ing && ing.name.trim()) catalogAdd([{ name: ing.name, unit: ing.unit, category: ing.category }]);
  } else if (act === 'ingUnit') {
    const dish = findDish(house, t.dataset.day, t.dataset.meal, t.dataset.dish);
    const ing = dish && dish.ingredients.find((i) => i.id === t.dataset.ing);
    if (ing) {
      ing.qty = reunit(ing.qty, ing.unit, t.value);
      ing.unit = KD.safeUnit(t.value);
      persist.menu(house, state.currentWeekOf); render();
    }
  } else if (act === 'stkName') {
    const s = house.stock.find((x) => x.id === t.dataset.id);
    if (!s) return;
    const name = String(s.name || '').trim();
    if (!name) return;
    const hit = KD.catalogLookup(state.catalog, name);
    if (hit) {
      // Picking a catalog item auto-fills its unit, category and default par
      // (מלאי מינימום). A par the cook already set is kept (only a blank one is
      // filled), so re-selecting the same item never clobbers a custom level.
      const movedCat = KD.isCategory(hit.category) && hit.category !== s.category;
      if (KD.isCategory(hit.category)) s.category = hit.category;
      s.unit = KD.safeUnit(hit.unit);
      if (!(s.minQty > 0) && Number(hit.min) > 0) s.minQty = Number(hit.min);
      if (movedCat) state.stockCat = s.category; // follow the item to its tab
      persist.stock(house);
      render();
    } else {
      // Free text — register the new name into the shared catalog.
      catalogAdd([{ name, unit: s.unit, category: s.category }]);
      persist.stock(house);
    }
  } else if (act === 'stkCat') {
    const s = house.stock.find((x) => x.id === t.dataset.id); if (s) { s.category = KD.isCategory(t.value) ? t.value : 'groceries'; persist.stock(house); render(); }
  } else if (act === 'stkUnit') {
    const s = house.stock.find((x) => x.id === t.dataset.id);
    if (s) { s.qty = reunit(s.qty, s.unit, t.value); s.minQty = reunit(s.minQty, s.unit, t.value); s.unit = KD.safeUnit(t.value); persist.stock(house); render(); }
  } else if (act === 'countDate') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) state.countDate = t.value;
  } else if (act === 'pickDish') {
    addExistingDish(house, t.dataset.day, t.dataset.meal, t.value);
    t.value = '';
  }
}

/* When the unit changes within the same family (kg↔g, l↔ml) convert the value
   so the physical amount is preserved; across families keep the number as-is. */
function reunit(value, fromUnit, toUnit) {
  const converted = KD.convertUnit(Number(value) || 0, fromUnit, toUnit);
  return Number.isFinite(converted) ? KD.roundQty(converted) : (clampNum(value));
}

function addExistingDish(house, day, meal, name) {
  const clean = String(name || '').trim();
  if (!clean) return;
  const template = findDishTemplate(house, clean);
  const dish = template
    ? KD.cloneDish(template)
    : { id: KD.newId('dish'), name: clean, ingredients: [] };
  dish.name = clean;
  const week = ensureWeek(house, state.currentWeekOf);
  week.days[day][meal].push(dish);
  state.mealOpen[mealKey(day, meal)] = true;
  persist.menu(house, state.currentWeekOf);
  render();
}

async function onClick(e) {
  const btn = e.target.closest('[data-act],[data-tab]');
  if (!btn) return;
  const house = activeHouse();

  if (btn.dataset.tab) { state.tab = btn.dataset.tab; render(); return; }
  // Tapping a qty field (count + stock) opens the common-values picker.
  if (btn.tagName === 'INPUT' && btn.dataset.picker) { openQtyPicker(btn); return; }
  const act = btn.dataset.act;
  const d = btn.dataset;

  switch (act) {
    case 'weekPrev': state.currentWeekOf = KD.shiftWeek(state.currentWeekOf, -1); render(); break;
    case 'weekNext': state.currentWeekOf = KD.shiftWeek(state.currentWeekOf, 1); render(); break;
    case 'monthPrev': state.currentMonth = KD.shiftMonth(state.currentMonth, -1); render(); break;
    case 'monthNext': state.currentMonth = KD.shiftMonth(state.currentMonth, 1); render(); break;
    case 'planScope': state.planFromToday = d.scope === 'today'; render(); break;
    case 'toggleMeal': { const k = mealKey(d.day, d.meal); state.mealOpen[k] = !state.mealOpen[k]; render(); break; }
    case 'copyLast': {
      const prev = house.weeks[KD.shiftWeek(state.currentWeekOf, -1)];
      if (prev) { house.weeks[state.currentWeekOf] = KD.copyWeekInto(prev, state.currentWeekOf); persist.menu(house, state.currentWeekOf); render(); }
      break;
    }
    case 'addDish': { const w = ensureWeek(house, state.currentWeekOf); w.days[d.day][d.meal].push({ id: KD.newId('dish'), name: '', ingredients: [] }); state.mealOpen[mealKey(d.day, d.meal)] = true; persist.menu(house, state.currentWeekOf); render(); break; }
    case 'delDish': { const w = ensureWeek(house, state.currentWeekOf); w.days[d.day][d.meal] = w.days[d.day][d.meal].filter((x) => x.id !== d.dish); persist.menu(house, state.currentWeekOf); render(); break; }
    case 'addIng': { const dish = findDish(house, d.day, d.meal, d.dish); if (dish) { dish.ingredients.push({ id: KD.newId('ing'), name: '', category: 'groceries', qty: 0, unit: 'kg' }); persist.menu(house, state.currentWeekOf); render(); } break; }
    case 'delIng': { const dish = findDish(house, d.day, d.meal, d.dish); if (dish) { dish.ingredients = dish.ingredients.filter((i) => i.id !== d.ing); persist.menu(house, state.currentWeekOf); render(); } break; }

    case 'serveDay': serveDay(house, d.day); break;

    case 'ovClear': { if (house.headcount.overrides) delete house.headcount.overrides[d.day]; persist.headcount(house); render(); break; }
    case 'algAdd': house.allergies.push({ id: KD.newId('alg'), name: '', count: 1 }); persist.allergies(house); render(); break;
    case 'algDel': house.allergies = house.allergies.filter((a) => a.id !== d.id); persist.allergies(house); render(); break;

    case 'stockCat': state.stockCat = d.cat; render(); break;
    case 'stkAdd': addStockItem(house, d.cat); break;
    case 'stkDel': house.stock = house.stock.filter((s) => s.id !== d.id); persist.stock(house); render(); break;

    case 'countStart': state.countMode = true; state.countDate = KD.toISODate(new Date()); state.countValues = {}; render(); break;
    case 'countCancel': state.countMode = false; state.countValues = {}; render(); break;
    case 'countSave': saveStockCount(house); break;
    case 'countRestore': restoreStockCount(house, d.date); break;

    case 'purAdd': {
      const amount = clampNum($('#spendAmount').value);
      if (!(amount > 0)) break;
      house.purchases.push({ id: KD.newId('pur'), weekOf: state.currentWeekOf, amount, note: ($('#spendNote').value || '').trim() || undefined, date: KD.toISODate(new Date()) });
      persist.purchases(house); render(); break;
    }
    case 'purDel': house.purchases = house.purchases.filter((p) => p.id !== d.id); persist.purchases(house); render(); break;

    case 'extraAdd': addShoppingExtra(house); break;
    case 'extraDel': {
      const wk = state.currentWeekOf;
      if (house.shoppingExtras && Array.isArray(house.shoppingExtras[wk])) {
        house.shoppingExtras[wk] = house.shoppingExtras[wk].filter((e) => e.id !== d.id);
        persist.shoppingExtras(house, wk); render();
      }
      break;
    }

    case 'waShare': window.open('https://wa.me/?text=' + encodeURIComponent(shoppingListText(house)), '_blank'); break;
    case 'printList': window.print(); break;
    case 'printBaseline': window.print(); break;
    case 'baselineShare': window.open('https://wa.me/?text=' + encodeURIComponent(baselineText(house)), '_blank'); break;
    case 'adoptBaseline': adoptBaselineAsBudget(house); break;
    case 'parReset': { // reset one baseline row (qty + price) to the seed default
      house.parOverrides = KD.clearParOverride(house.parOverrides || {}, d.key);
      persist.parOverrides(house); render(); setStatus('אופס לברירת מחדל ✓'); break;
    }
    case 'parResetAll': {
      if (!Object.keys(house.parOverrides || {}).length) break;
      if (!window.confirm('לאפס את כל הכמויות והמחירים לברירת המחדל?\nכל השינויים הידניים בבית זה יימחקו.')) break;
      house.parOverrides = {};
      persist.parOverrides(house); render(); setStatus('כל הערכים אופסו לברירת מחדל ✓'); break;
    }
    case 'stkResetMin': { // reset a stock item's manual MIN override to the default
      house.parOverrides = KD.clearParOverride(house.parOverrides || {}, d.key, 'min');
      persist.parOverrides(house); render(); setStatus('המינימום אופס לברירת מחדל ✓'); break;
    }
    case 'openHouse': state.activeHouseId = d.id; state.tab = 'menu'; render(); break;

    case 'selHouse': state.activeHouseId = d.id; render(); break;
    case 'addHouse': await addHouse(); break;

    // Shopping list: tap a line to check it off (transient, in-store use).
    case 'checkItem': {
      const key = d.key;
      if (state.checked[key]) delete state.checked[key]; else state.checked[key] = true;
      const row = btn.closest('.shop-item');
      if (row) row.classList.toggle('done', !!state.checked[key]);
      break;
    }
    default: break;
  }
}

/* Mark a day served: deduct the day's ACTUAL consumption from the pantry.
   Idempotent — a day already served cannot be deducted again. */
function serveDay(house, day) {
  const weekOf = state.currentWeekOf;
  if (KD.isDayExecuted(house.consumption, weekOf, day)) return; // already done
  const week = ensureWeek(house, weekOf);
  const consumption = KD.dayConsumption(week, day);
  if (!consumption.length) return;
  if (!window.confirm('לנכות מהמלאי את המנות שהוגשו ביום ' + KD.DAY_LABELS_HE[day] + '?\nניתן לבצע פעם אחת בלבד ליום זה.')) return;

  const res = KD.applyConsumption(house.stock, consumption);
  house.stock = res.stock;
  house.consumption.push({ id: KD.newId('cons'), weekOf, day, executedAt: KD.toISODate(new Date()) });
  persist.stock(house);
  persist.consumption(house);
  render();
  if (res.shortfalls.length) setStatus('נוכה מהמלאי — חלק מהמרכיבים לא היו במלאי מספיק');
  else setStatus('המנות נוכו מהמלאי ✓');
}

/* Save a stock count: apply the one-pass edits to current stock, then store a
   dated snapshot (upsert by date). Both persist; shopping/plan recompute on the
   next render from the new numbers. */
function saveStockCount(house) {
  const date = state.countDate || KD.toISODate(new Date());
  // The count is authoritative: rebuild the whole pantry from the counted rows
  // (adds items counted >0 that weren't in stock; keeps existing items at 0).
  house.stock = KD.applyStockCount(state.catalog, house.stock, state.countValues);
  const count = KD.makeStockCount(date, house.stock);
  count.id = KD.newId('cnt');
  house.stockCounts = (house.stockCounts || []).filter((c) => c.date !== date).concat(count);
  persist.stock(house);
  persist.stockCount(house, count);
  state.countMode = false;
  state.countValues = {};
  render();
  setStatus('הספירה נשמרה ✓');
}

/* Add a pantry item from the category's "הוסף פריט" combobox. A seeded/known
   item pre-fills its unit and default **מלאי מינימום** (par level) from the
   catalog (both editable afterwards); free text adds a blank item under the
   active category and registers the new name in the catalog. */
function addStockItem(house, cat) {
  const category = KD.isCategory(cat) ? cat : 'groceries';
  const input = $('#stkAddName');
  const name = input ? String(input.value || '').trim() : '';
  const hit = name ? KD.catalogLookup(state.catalog, name) : null;
  const unit = hit ? KD.safeUnit(hit.unit) : 'kg';
  const minQty = hit ? (Number(hit.min) > 0 ? Number(hit.min) : 0) : 0;
  house.stock.push({ id: KD.newId('stk'), name, category, qty: 0, unit, minQty });
  if (name) catalogAdd([{ name, unit, category, min: minQty }]);
  state.stockCat = category;
  persist.stock(house);
  render();
}

/* Add a free item to the current week's shopping list ("פריטים נוספים"). Name
   may be a catalog pick or free text; qty + unit as entered. Persisted per week
   so it survives reloads and prints/shares with the list. */
function addShoppingExtra(house) {
  const wk = state.currentWeekOf;
  const nameEl = $('#extraName');
  const qtyEl = $('#extraQty');
  const unitEl = $('#extraUnit');
  const name = nameEl ? String(nameEl.value || '').trim() : '';
  if (!name) { setStatus('הזינו שם פריט'); return; }
  const qty = clampNum(qtyEl ? qtyEl.value : 0);
  const unit = KD.safeUnit(unitEl ? unitEl.value : 'unit');
  const hit = KD.catalogLookup(state.catalog, name);
  const category = hit ? hit.category : 'groceries';
  const extra = KD.readShoppingExtra({ name, qty, unit, category });
  if (!house.shoppingExtras) house.shoppingExtras = {};
  house.shoppingExtras[wk] = (house.shoppingExtras[wk] || []).concat(extra);
  persist.shoppingExtras(house, wk);
  render();
}

/* Restore the pantry to a previously saved dated snapshot. */
function restoreStockCount(house, date) {
  const c = (house.stockCounts || []).find((x) => x.date === date);
  if (!c) return;
  if (!window.confirm('לשחזר את המלאי לספירה מתאריך ' + KD.formatDateHe(date) + '?\nהמלאי הנוכחי יוחלף.')) return;
  house.stock = KD.stockFromCount(c).map(normStock);
  persist.stock(house);
  render();
  setStatus('המלאי שוחזר לספירה מ־' + KD.formatDateHe(date) + ' ✓');
}

async function addHouse() {
  const name = window.prompt('שם הבית החדש:');
  if (!name || !name.trim()) return;
  const house = { id: KD.newId('house'), name: name.trim(), headcount: KD.emptyHeadcount(), allergies: [], stock: [], purchases: [], consumption: [], stockCounts: [], shoppingExtras: {}, parOverrides: {}, budgets: {}, weeks: {}, monthlyBudget: 0 };
  state.houses.push(house);
  state.activeHouseId = house.id;
  render();
  try { setStatus('שומר…'); await api('saveHouse', { house: { id: house.id, name: house.name, monthlyBudget: 0 } }); setStatus('נשמר ✓'); }
  catch (err) { setStatus('שגיאת שמירה: ' + err.message); }
}

function setOverride(house, day, field, value) {
  if (!house.headcount.overrides) house.headcount.overrides = {};
  const ov = Object.assign({}, house.headcount.overrides[day]);
  if (value === '' || value == null) delete ov[field];
  else ov[field] = clampInt(value);
  if (ov.patients == null && ov.staff == null) delete house.headcount.overrides[day];
  else house.headcount.overrides[day] = ov;
}

/* ============================ chrome events ============================ */
function wireChrome() {
  const screen = $('#screen');
  screen.addEventListener('input', onInput);
  screen.addEventListener('change', onChange);
  screen.addEventListener('click', onClick);
  $('#tabs').addEventListener('click', onClick);
  $('#houseSwitcher').addEventListener('click', onClick);
}

/* ============================ boot ============================ */
async function start() {
  try {
    setStatus('טוען נתונים…');
    await loadState();
    setStatus('');
    render();
  } catch (err) {
    setStatus('שגיאה בטעינה: ' + err.message);
    render();
  }
}

function boot() {
  wireChrome();
  start();
}

document.addEventListener('DOMContentLoaded', boot);
