/* ezone-kitchen — canonical, testable domain logic.
   Loaded by Node (CommonJS) for tests and by the browser via
   /lib/kitchen-domain.js (served as a static asset by server.js).

   This is a UMD module — no build step. It holds every non-negotiable
   calculation as a small pure function:

     applyBuffer()      the fixed 20% purchasing buffer (one place, one rule)
     baseTotal()        base headcount = base patients + base staff
     convertUnit()      convert a quantity within a unit family (kg↔g, l↔ml)
     aggregateWeek()    Σ over (day, meal, dish, ingredient) ingredient totals
     subtractStock()    max(0, required − onHand)   (never negative)
     buildShoppingList() aggregate → buffer → deduct matching stock → group by 5 categories
     summariseBudget()  monthly budget vs actual spend

   Menu quantities are dish TOTALS (not per diner), so headcount does not scale
   them. Headcount is still tracked for occupancy/allergies; baseTotal() =
   patients + staff, and effectiveForDay() reports per-day occupancy for display.

   Nothing here touches the DOM, the network or storage, so it is trivially
   unit-tested and identical in the browser and in Node.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KitchenDomain = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- *
   * Categories — the five fixed ingredient categories (closed set).  *
   * ---------------------------------------------------------------- */
  const CATEGORIES = ['groceries', 'vegetables', 'fruits', 'meat', 'dry'];

  const CATEGORY_LABELS_HE = {
    groceries: 'מכולת',
    vegetables: 'ירקות',
    fruits: 'פירות',
    meat: 'בשר',
    dry: 'יבשים',
  };

  const CATEGORY_LABELS_EN = {
    groceries: 'Groceries',
    vegetables: 'Vegetables',
    fruits: 'Fruits',
    meat: 'Meat',
    dry: 'Dry ingredients',
  };

  const CATEGORY_ORDER = { groceries: 0, vegetables: 1, fruits: 2, meat: 3, dry: 4 };

  function isCategory(value) {
    return CATEGORIES.indexOf(value) !== -1;
  }

  /* ---------------------------------------------------------------- *
   * Days & meals.                                                    *
   * ---------------------------------------------------------------- */
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const DAY_LABELS_HE = {
    sunday: 'ראשון', monday: 'שני', tuesday: 'שלישי', wednesday: 'רביעי',
    thursday: 'חמישי', friday: 'שישי', saturday: 'שבת',
  };

  const MEALS = ['breakfast', 'lunch', 'dinner'];
  const MEAL_LABELS_HE = { breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב' };

  /* ---------------------------------------------------------------- *
   * Units — a small, closed set with three families.                 *
   *   mass:   ק"ג (kg, base) · גרם (g)                                *
   *   volume: ליטר (l, base) · מ"ל (ml)                               *
   *   count:  יחידות (unit, base)                                     *
   * A quantity is stored as { value, unit } in the unit the user      *
   * chose; math converts to the family's BASE unit. Two quantities    *
   * match (for stock deduction) when they share a name and a family,  *
   * converting across kg↔g and l↔ml.                                  *
   * ---------------------------------------------------------------- */
  const UNITS = ['kg', 'g', 'unit', 'l', 'ml'];

  const UNIT_LABELS_HE = { kg: 'ק"ג', g: 'גרם', unit: 'יחידות', l: 'ליטר', ml: 'מ"ל' };

  // family + factor to the family's base unit.
  const UNIT_DEF = {
    kg: { family: 'mass', toBase: 1 },
    g: { family: 'mass', toBase: 0.001 },
    l: { family: 'volume', toBase: 1 },
    ml: { family: 'volume', toBase: 0.001 },
    unit: { family: 'count', toBase: 1 },
  };

  const FAMILY_BASE_UNIT = { mass: 'kg', volume: 'l', count: 'unit' };

  function isUnit(u) {
    return Object.prototype.hasOwnProperty.call(UNIT_DEF, u);
  }

  // Coerce any input to a known unit, defaulting to kg (the legacy unit).
  function safeUnit(u) {
    return isUnit(u) ? u : 'kg';
  }

  function unitFamily(u) {
    return UNIT_DEF[safeUnit(u)].family;
  }

  // The base unit of the family a unit belongs to ('kg' | 'l' | 'unit').
  function baseUnitOf(u) {
    return FAMILY_BASE_UNIT[unitFamily(u)];
  }

  // Convert value from one unit to another WITHIN the same family. Returns NaN
  // across families (kg → l is undefined). Non-finite / negative input → 0.
  function convertUnit(value, fromUnit, toUnit) {
    const from = UNIT_DEF[safeUnit(fromUnit)];
    const to = UNIT_DEF[safeUnit(toUnit)];
    if (from.family !== to.family) return NaN;
    if (!Number.isFinite(value) || value < 0) return 0;
    return (value * from.toBase) / to.toBase;
  }

  // Value expressed in the family's BASE unit. Non-finite / negative → 0.
  function toBaseValue(value, unit) {
    if (!Number.isFinite(value) || value < 0) return 0;
    return value * UNIT_DEF[safeUnit(unit)].toBase;
  }

  /* Legacy kilogram helpers — kept for callers/tests that predate the unit
     system. Everything mass was stored in kg before units existed. */
  function gramsToKg(grams) { return grams / 1000; }
  function kgToGrams(kg) { return kg * 1000; }

  function toKg(value, unit) {
    if (!Number.isFinite(value) || value < 0) return 0;
    return unit === 'g' ? gramsToKg(value) : value;
  }

  function roundQty(qty, decimals) {
    const d = decimals === undefined ? 3 : decimals;
    const f = Math.pow(10, d);
    return Math.round((qty + Number.EPSILON) * f) / f;
  }
  // Back-compat alias (rounding is unit-agnostic).
  const roundKg = roundQty;

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /* ---------------------------------------------------------------- *
   * Buffer — the single, tested 20% rule.                            *
   * ---------------------------------------------------------------- */
  const BUFFER_RATE = 0.2;

  function applyBuffer(qty, rate) {
    const r = rate === undefined ? BUFFER_RATE : rate;
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    return qty * (1 + r);
  }

  /* ---------------------------------------------------------------- *
   * Headcount — effective people per day, after overrides.           *
   * ---------------------------------------------------------------- */
  function clampCount(n) {
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  function effectiveForDay(hc, day) {
    const overrides = (hc && hc.overrides) || {};
    const override = overrides[day] || {};
    const base = hc || {};
    const patients = clampCount(override.patients != null ? override.patients : base.basePatients);
    const staff = clampCount(override.staff != null ? override.staff : base.baseStaff);
    return { patients: patients, staff: staff, total: patients + staff };
  }

  // Base occupancy = base patients + base staff (before any per-day override).
  // Single source of truth for the "סה"כ בסיס" figure shown on the headcount
  // screen and the all-houses view.
  function baseTotal(hc) {
    const base = hc || {};
    return clampCount(Number(base.basePatients)) + clampCount(Number(base.baseStaff));
  }

  function emptyHeadcount() {
    return { basePatients: 0, baseStaff: 0, overrides: {} };
  }

  /* ---------------------------------------------------------------- *
   * Production house seed — the five real houses, with fixed,        *
   * human-readable ids and Hebrew display names. Single source of    *
   * truth: the Apps Script backend (apps-script/Code.gs) mirrors     *
   * this list and a test asserts the two never drift.               *
   * ---------------------------------------------------------------- */
  const SEED_HOUSES = [
    { id: 'ramot-hashavim', name: 'רמות השבים' },
    { id: 'raanana-asher', name: 'רעננה אשר' },
    { id: 'caesarea-ofroni', name: 'קיסריה עפרוני' },
    { id: 'caesarea-rehab', name: 'קיסריה ריהאב' },
    { id: 'pardes', name: 'פרדס' },
  ];

  // Idempotent seed decision: only seed when there are no houses yet. Once any
  // house exists (seeded or admin-created), this is a no-op — so running it
  // twice never duplicates, and it never clobbers a renamed house. Returns the
  // houses to CREATE (empty array when nothing should be seeded).
  function housesToSeed(existingHouses) {
    const count = Array.isArray(existingHouses) ? existingHouses.length : Number(existingHouses) || 0;
    if (count > 0) return [];
    return SEED_HOUSES.map(function (h) { return { id: h.id, name: h.name }; });
  }

  /* ---------------------------------------------------------------- *
   * Ingredient identity — merge/lookup keys.                         *
   *   ingredientKey  : category + name        (display grouping)      *
   *   stockMatchKey  : family + name          (deduction, per spec:   *
   *                    "match by item name + unit")                   *
   * ---------------------------------------------------------------- */
  function normName(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  }

  function ingredientKey(name, category) {
    return category + '::' + normName(name);
  }

  // Stock is matched to a requirement by NAME + UNIT FAMILY, so kg deducts from
  // g and l from ml, but mass never cancels volume. Category is intentionally
  // not part of the key — a pantry item feeds any menu line of the same name.
  function stockMatchKey(name, unit) {
    return unitFamily(unit) + '::' + normName(name);
  }

  /* Normalise a raw ingredient (menu) to { name, category, value, unit }.
     `value` is the TOTAL quantity for the dish (not per diner). Back-compat:
     read the newest field first — `qty` (total), then the older `qtyPerPerson`
     / `qtyKgPerPerson`. Older values are reinterpreted as dish totals (the
     switch away from per-person is a deliberate semantic change). */
  function readIngredient(ing) {
    ing = ing || {};
    const raw = ing.qty != null ? ing.qty
      : (ing.qtyPerPerson != null ? ing.qtyPerPerson : ing.qtyKgPerPerson);
    const value = Number(raw);
    return {
      name: String(ing.name || '').trim(),
      category: isCategory(ing.category) ? ing.category : 'groceries',
      value: Number.isFinite(value) && value > 0 ? value : 0,
      unit: safeUnit(ing.unit),
    };
  }

  /* Normalise a raw stock item to { name, category, value, unit, min }.
     `min` is the minimum-stock (par) level in the item's own unit.
     Back-compat: pre-unit data carried `qtyKg` (kilograms). */
  function readStockItem(item) {
    item = item || {};
    const raw = item.qty != null ? item.qty : item.qtyKg;
    const value = Number(raw);
    const rawMin = item.minQty != null ? item.minQty : item.min;
    const min = Number(rawMin);
    return {
      name: String(item.name || '').trim(),
      category: isCategory(item.category) ? item.category : 'groceries',
      value: Number.isFinite(value) && value > 0 ? value : 0,
      unit: safeUnit(item.unit),
      min: Number.isFinite(min) && min > 0 ? min : 0,
    };
  }

  // Is this pantry item below its minimum (par) level? False when no min set.
  function isBelowMin(item) {
    const it = readStockItem(item);
    return it.min > 0 && it.value < it.min;
  }

  /* ---------------------------------------------------------------- *
   * Week aggregation — Σ ingredient TOTALS over the given days.       *
   * Quantities are dish totals (NOT per diner), so headcount does not *
   * scale them. A line's quantity is carried in its family's BASE     *
   * unit; lines of the same name+category but different families stay *
   * separate.                                                         *
   * ---------------------------------------------------------------- */
  // Sanitise a day list to the known week days, in canonical order; undefined
  // means "the whole week".
  function normalizeDays(days) {
    if (!Array.isArray(days)) return DAYS;
    return DAYS.filter(function (d) { return days.indexOf(d) !== -1; });
  }

  // Σ over the given days of each ingredient's total (converted to its family
  // base unit), merged by (category, name, unit-family). Category-ordered.
  function accumulateDays(week, days) {
    const merged = new Map();
    const dayList = normalizeDays(days);

    for (let di = 0; di < dayList.length; di++) {
      const day = dayList[di];
      const dayPlan = week && week.days ? week.days[day] : null;
      if (!dayPlan) continue;

      for (let mi = 0; mi < MEALS.length; mi++) {
        const dishes = dayPlan[MEALS[mi]] || [];
        for (let i = 0; i < dishes.length; i++) {
          const ings = dishes[i].ingredients || [];
          for (let j = 0; j < ings.length; j++) {
            const ing = readIngredient(ings[j]);
            if (!ing.name) continue;
            const amount = toBaseValue(ing.value, ing.unit);
            if (!(amount > 0)) continue;

            const family = unitFamily(ing.unit);
            const key = ing.category + '::' + normName(ing.name) + '::' + family;
            const existing = merged.get(key);
            if (existing) {
              existing.qty += amount;
            } else {
              merged.set(key, {
                name: ing.name,
                category: ing.category,
                qty: amount,
                unit: baseUnitOf(ing.unit),
              });
            }
          }
        }
      }
    }

    return Array.from(merged.values())
      .map(function (line) {
        return { name: line.name, category: line.category, qty: roundQty(line.qty), unit: line.unit };
      })
      .sort(byCategoryThenName);
  }

  // Requirement across a set of days (default: the whole week). Drives the
  // shopping-list projection and the weekly-plan view.
  function aggregateWeek(week, days) {
    return accumulateDays(week, days);
  }

  // The quantities served on ONE day — dish totals, NO purchasing buffer. This
  // is what a "בוצע" (mark-served) action deducts from the pantry.
  function dayConsumption(week, day) {
    if (DAYS.indexOf(day) === -1) return [];
    return accumulateDays(week, [day]);
  }

  function byCategoryThenName(a, b) {
    const c = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return c !== 0 ? c : a.name.localeCompare(b.name, 'he');
  }

  /* ---------------------------------------------------------------- *
   * Stock subtraction & the full shopping-list pipeline.             *
   * ---------------------------------------------------------------- */
  // Index stock by NAME + FAMILY, summing each item's quantity in the family's
  // base unit (so 500 g + 0.5 kg → 1 kg on the same key).
  function indexStock(stock) {
    const map = new Map();
    for (let i = 0; i < (stock || []).length; i++) {
      const item = readStockItem(stock[i]);
      if (!item.name) continue;
      const key = stockMatchKey(item.name, item.unit);
      map.set(key, (map.get(key) || 0) + toBaseValue(item.value, item.unit));
    }
    return map;
  }

  // Richer stock index: per NAME+FAMILY key, the on-hand quantity AND the
  // minimum (par) level, both summed in the family's base unit, plus a display
  // name/category/unit for stock-only shopping lines.
  function indexStockDetailed(stock) {
    const map = new Map();
    for (let i = 0; i < (stock || []).length; i++) {
      const item = readStockItem(stock[i]);
      if (!item.name) continue;
      const key = stockMatchKey(item.name, item.unit);
      const cur = map.get(key) || { name: item.name, category: item.category, unit: baseUnitOf(item.unit), qty: 0, min: 0 };
      cur.qty += toBaseValue(item.value, item.unit);
      cur.min += toBaseValue(item.min, item.unit);
      map.set(key, cur);
    }
    return map;
  }

  function subtractStock(requiredQty, stockQty) {
    const net = requiredQty - Math.max(0, stockQty);
    return net > 0 ? net : 0;
  }

  function groupByCategory(lines) {
    const grouped = {};
    for (let i = 0; i < CATEGORIES.length; i++) grouped[CATEGORIES[i]] = [];
    for (let j = 0; j < lines.length; j++) grouped[lines[j].category].push(lines[j]);
    return grouped;
  }

  // Inventory-first: for each item, buy the LARGER of
  //   • menu shortfall  = max(0, weekly requirement + buffer − stock), and
  //   • top-up to par    = max(0, minimum-stock level − stock)
  // (the max, never the sum — a single purchase covers both). The item set is
  // the UNION of everything the menu needs and every pantry item that has a
  // minimum set, so par-only items still surface. Stock/min are matched by name
  // + unit family (kg↔g, l↔ml). Pass `days` to scope the menu requirement to a
  // subset of the week (default: the whole week).
  function buildShoppingList(week, stock, bufferRate, days) {
    const rate = bufferRate === undefined ? BUFFER_RATE : bufferRate;
    const aggregated = aggregateWeek(week, days);
    const stockDetail = indexStockDetailed(stock);

    const byKey = new Map();
    aggregated.forEach(function (line) {
      const key = stockMatchKey(line.name, line.unit);
      const prev = byKey.get(key);
      byKey.set(key, {
        name: prev ? prev.name : line.name,
        category: prev ? prev.category : line.category,
        unit: line.unit,
        requiredQty: (prev ? prev.requiredQty : 0) + line.qty,
      });
    });
    // Pantry items with a minimum but no menu demand still need topping up.
    stockDetail.forEach(function (s, key) {
      if (!byKey.has(key) && s.min > 0) {
        byKey.set(key, { name: s.name, category: s.category, unit: s.unit, requiredQty: 0 });
      }
    });

    const lines = Array.from(byKey.values()).map(function (acc) {
      const s = stockDetail.get(stockMatchKey(acc.name, acc.unit));
      const stockQty = roundQty(s ? s.qty : 0);
      const minQty = roundQty(s ? s.min : 0);
      const bufferedQty = roundQty(applyBuffer(acc.requiredQty, rate));
      const menuShortfall = subtractStock(bufferedQty, stockQty);
      const topUpToMin = subtractStock(minQty, stockQty);
      const toBuyQty = roundQty(Math.max(menuShortfall, topUpToMin));
      return {
        name: acc.name,
        category: acc.category,
        unit: acc.unit,
        requiredQty: roundQty(acc.requiredQty),
        bufferedQty: bufferedQty,
        stockQty: stockQty,
        minQty: minQty,
        toBuyQty: toBuyQty,
      };
    }).sort(byCategoryThenName);

    return { bufferRate: rate, lines: lines, byCategory: groupByCategory(lines) };
  }

  /* ---------------------------------------------------------------- *
   * Actual consumption — deduct served quantities from the pantry.   *
   *                                                                  *
   * This is SEPARATE from the shopping-list projection: the shopping *
   * list never mutates stock, it only forecasts the shortfall. The   *
   * deduction below runs only when a day is explicitly marked served *
   * ("בוצע"), and the caller guards it with isDayExecuted() so the   *
   * same day can never be deducted twice (idempotent).               *
   * ---------------------------------------------------------------- */

  // A stock item in the app's shape, with a replaced quantity (kept in the
  // item's own unit). Normalises legacy { qtyKg } rows to { qty, unit }.
  function stockItemWithValue(raw, value) {
    const item = readStockItem(raw);
    const v = Number.isFinite(value) && value > 0 ? value : 0;
    return { id: raw && raw.id, name: item.name, category: item.category, qty: v, unit: item.unit, minQty: item.min };
  }

  // Deduct the given consumption lines (base units, from dayConsumption) from
  // the stock array, matching by name + unit family and converting across
  // kg↔g / l↔ml. Never drives a stock item below zero; consumption with no (or
  // insufficient) matching stock is reported in `shortfalls`. Pure: returns a
  // NEW stock array and does not mutate the input.
  function applyConsumption(stock, consumptionLines) {
    const remaining = new Map(); // name+family -> base qty still to deduct
    (consumptionLines || []).forEach(function (line) {
      const key = stockMatchKey(line.name, line.unit);
      const base = toBaseValue(Number(line.qty), line.unit);
      if (base > 0) remaining.set(key, (remaining.get(key) || 0) + base);
    });

    const newStock = (stock || []).map(function (raw) {
      const item = readStockItem(raw);
      const key = stockMatchKey(item.name, item.unit);
      const need = remaining.get(key) || 0;
      if (!item.name || need <= 0 || item.value <= 0) {
        return stockItemWithValue(raw, item.value);
      }
      const itemBase = toBaseValue(item.value, item.unit);
      const take = Math.min(itemBase, need);
      remaining.set(key, need - take);
      const leftInUnit = roundQty(convertUnit(itemBase - take, baseUnitOf(item.unit), item.unit));
      return stockItemWithValue(raw, leftInUnit);
    });

    const shortfalls = [];
    remaining.forEach(function (v, key) { if (v > 1e-9) shortfalls.push({ key: key, qty: roundQty(v) }); });
    return { stock: newStock, shortfalls: shortfalls };
  }

  // Idempotency guard for the "בוצע" action: has this (weekOf, day) already
  // been deducted? `markers` is the house's list of { weekOf, day, executedAt }.
  function isDayExecuted(markers, weekOf, day) {
    return (markers || []).some(function (m) {
      return m && String(m.weekOf) === String(weekOf) && String(m.day) === String(day);
    });
  }

  /* ---------------------------------------------------------------- *
   * Budget — MONTHLY budget vs actual spend. No pricing/estimates.   *
   * ---------------------------------------------------------------- */
  // 'YYYY-MM' key for a Date (local time).
  function monthKey(date) {
    return toISODate(date).slice(0, 7);
  }

  // Month of an ISO date string ('YYYY-MM-DD' → 'YYYY-MM'); '' if unparseable.
  function monthOf(iso) {
    if (typeof iso !== 'string') return '';
    const m = /^(\d{4})-(\d{2})/.exec(iso.trim());
    return m ? m[1] + '-' + m[2] : '';
  }

  // Actual spend for a calendar month, summed from purchase.date.
  function actualSpendForMonth(purchases, month) {
    return round2((purchases || [])
      .filter(function (p) { return monthOf(p.date) === month; })
      .reduce(function (sum, p) { return sum + (Number.isFinite(p.amount) && p.amount > 0 ? p.amount : 0); }, 0));
  }

  // Monthly budget summary. `overrun` is an APPROVED overrun (חריגה מאושרת) that
  // raises the ceiling: remaining = (budget + approved overrun) − actual, and a
  // month is over budget only once spend exceeds that combined ceiling.
  function summariseBudget(monthlyBudget, actual, overrun) {
    const budget = Number.isFinite(monthlyBudget) && monthlyBudget > 0 ? monthlyBudget : 0;
    const spent = Number.isFinite(actual) && actual > 0 ? actual : 0;
    const approved = Number.isFinite(overrun) && overrun > 0 ? overrun : 0;
    const ceiling = budget + approved;
    return {
      budget: round2(budget),
      overrun: round2(approved),
      actual: round2(spent),
      remaining: round2(ceiling - spent),
      overBudget: spent > ceiling,
    };
  }

  /* ---------------------------------------------------------------- *
   * Money helpers — parse "20,000.50" → number; group "20000" → text. *
   * Budgets are entered with thousands separators but stored numeric. *
   * ---------------------------------------------------------------- */
  function parseMoney(str) {
    if (typeof str === 'number') return Number.isFinite(str) && str > 0 ? str : 0;
    const cleaned = String(str == null ? '' : str).replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    const normalised = firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    const n = parseFloat(normalised);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Group the integer part with commas, keeping up to two decimals. Accepts a
  // number or a (partially typed) string; never throws.
  function groupThousands(value) {
    const n = typeof value === 'number' ? value : parseMoney(value);
    const fixed = Math.round((n + Number.EPSILON) * 100) / 100;
    const parts = String(fixed).split('.');
    const intGrouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts[1] ? intGrouped + '.' + parts[1] : intGrouped;
  }

  /* ---------------------------------------------------------------- *
   * Item catalog — a shared list of { name, unit, category, min }     *
   * offered as a dropdown everywhere a name is typed. `min` is the     *
   * DEFAULT minimum-stock (par) level pre-filled when the item is      *
   * added to a pantry (editable afterwards). Free text is allowed; new *
   * names are merged in, de-duplicated by normalised name.            *
   * ---------------------------------------------------------------- */
  function catalogKey(name) { return normName(name); }

  function sanitizeMin(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Merge `entries` into `catalog`, de-duplicating by normalised name.
  // First-seen wins for name/unit/category, so a user's catalog entry is never
  // overwritten by a later (e.g. seed) one. The ONE exception is `min`: a
  // missing (zero) default min is filled in from a later entry, so seed par
  // levels reach items that were catalogued before par levels existed — without
  // ever clobbering a non-zero default already present. Blank names dropped;
  // returned sorted by Hebrew name.
  function mergeCatalog(catalog, entries) {
    const seen = new Map();
    function add(e) {
      const name = String((e && e.name) || '').trim();
      if (!name) return;
      const key = catalogKey(name);
      const min = sanitizeMin(e && e.min);
      if (seen.has(key)) {
        const cur = seen.get(key);
        if (!(cur.min > 0) && min > 0) cur.min = min; // fill a missing default only
        return;
      }
      seen.set(key, {
        name: name,
        unit: safeUnit(e && e.unit),
        category: isCategory(e && e.category) ? e.category : 'groceries',
        min: min,
      });
    }
    (catalog || []).forEach(add);
    (entries || []).forEach(add);
    return Array.from(seen.values()).sort(function (a, b) { return a.name.localeCompare(b.name, 'he'); });
  }

  // Look a name up in the catalog (case/space-insensitive). Returns the entry or
  // null; used to derive an item's default unit / category / min from its name.
  function catalogLookup(catalog, name) {
    const key = catalogKey(name);
    if (!key) return null;
    return (catalog || []).find(function (e) { return catalogKey(e.name) === key; }) || null;
  }

  /* ---------------------------------------------------------------- *
   * Default catalog seed — a full per-category item list with default *
   * par levels (מלאי מינימום) sized for a 25-person house over 7 days.*
   * Merged into the shared catalog on load (idempotent, never         *
   * overwrites user edits). Cooks may edit/delete/add freely — these  *
   * are defaults, not locked entries.                                 *
   * ---------------------------------------------------------------- */
  const SEED_CATALOG = [
    // מכולת — dairy, eggs & fresh staples
    { name: 'ביצים', unit: 'unit', category: 'groceries', min: 120 },
    { name: 'חלב', unit: 'l', category: 'groceries', min: 15 },
    { name: 'גבינה לבנה', unit: 'kg', category: 'groceries', min: 6 },
    { name: 'גבינה צהובה', unit: 'kg', category: 'groceries', min: 3 },
    { name: "קוטג'", unit: 'unit', category: 'groceries', min: 10 },
    { name: 'יוגורט', unit: 'unit', category: 'groceries', min: 20 },
    { name: 'שמנת מתוקה', unit: 'unit', category: 'groceries', min: 4 },
    { name: 'שמנת חמוצה', unit: 'unit', category: 'groceries', min: 4 },
    { name: 'חמאה', unit: 'kg', category: 'groceries', min: 2 },
    { name: 'גבינת שמנת', unit: 'unit', category: 'groceries', min: 3 },
    { name: 'לחם', unit: 'unit', category: 'groceries', min: 15 },
    // יבשים — pantry / dry goods
    { name: 'שמן קנולה', unit: 'l', category: 'dry', min: 6 },
    { name: 'שמן זית', unit: 'l', category: 'dry', min: 2 },
    { name: 'סוכר', unit: 'kg', category: 'dry', min: 5 },
    { name: 'מלח', unit: 'kg', category: 'dry', min: 2 },
    { name: 'קמח', unit: 'kg', category: 'dry', min: 10 },
    { name: 'אורז', unit: 'kg', category: 'dry', min: 10 },
    { name: 'פסטה', unit: 'kg', category: 'dry', min: 8 },
    { name: 'פתיתים', unit: 'kg', category: 'dry', min: 4 },
    { name: 'קוסקוס', unit: 'kg', category: 'dry', min: 3 },
    { name: 'בורגול', unit: 'kg', category: 'dry', min: 2 },
    { name: 'עדשים', unit: 'kg', category: 'dry', min: 3 },
    { name: 'שעועית יבשה', unit: 'kg', category: 'dry', min: 2 },
    { name: 'חומוס יבש', unit: 'kg', category: 'dry', min: 3 },
    { name: 'אפונה יבשה', unit: 'kg', category: 'dry', min: 2 },
    { name: 'רסק עגבניות', unit: 'unit', category: 'dry', min: 12 },
    { name: 'עגבניות משומרות', unit: 'unit', category: 'dry', min: 8 },
    { name: 'טונה', unit: 'unit', category: 'dry', min: 24 },
    { name: 'תירס משומר', unit: 'unit', category: 'dry', min: 12 },
    { name: 'זיתים', unit: 'unit', category: 'dry', min: 6 },
    { name: 'מלפפון חמוץ', unit: 'unit', category: 'dry', min: 6 },
    { name: 'קטשופ', unit: 'unit', category: 'dry', min: 3 },
    { name: 'מיונז', unit: 'unit', category: 'dry', min: 3 },
    { name: 'חרדל', unit: 'unit', category: 'dry', min: 2 },
    { name: 'טחינה גולמית', unit: 'unit', category: 'dry', min: 4 },
    { name: 'סילאן/דבש', unit: 'unit', category: 'dry', min: 2 },
    { name: 'חומץ', unit: 'l', category: 'dry', min: 2 },
    { name: 'אבקת מרק', unit: 'unit', category: 'dry', min: 3 },
    { name: 'פפריקה', unit: 'g', category: 'dry', min: 500 },
    { name: 'כמון', unit: 'g', category: 'dry', min: 500 },
    { name: 'פלפל שחור', unit: 'g', category: 'dry', min: 300 },
    { name: 'כורכום', unit: 'g', category: 'dry', min: 300 },
    { name: 'קפה', unit: 'kg', category: 'dry', min: 2 },
    { name: 'תה', unit: 'unit', category: 'dry', min: 200 },
    { name: 'קקאו', unit: 'kg', category: 'dry', min: 1 },
    { name: 'שוקולד ציפים', unit: 'kg', category: 'dry', min: 1 },
    { name: 'אבקת אפייה', unit: 'g', category: 'dry', min: 500 },
    { name: 'שמרים', unit: 'g', category: 'dry', min: 500 },
    { name: 'וניל', unit: 'g', category: 'dry', min: 100 },
    { name: 'פריכיות', unit: 'unit', category: 'dry', min: 5 },
    // ירקות — vegetables
    { name: 'בצל', unit: 'kg', category: 'vegetables', min: 10 },
    { name: 'שום', unit: 'kg', category: 'vegetables', min: 1 },
    { name: 'תפוחי אדמה', unit: 'kg', category: 'vegetables', min: 15 },
    { name: 'בטטה', unit: 'kg', category: 'vegetables', min: 5 },
    { name: 'גזר', unit: 'kg', category: 'vegetables', min: 8 },
    { name: 'עגבניות', unit: 'kg', category: 'vegetables', min: 12 },
    { name: 'מלפפונים', unit: 'kg', category: 'vegetables', min: 10 },
    { name: 'פלפלים', unit: 'kg', category: 'vegetables', min: 6 },
    { name: 'כרוב', unit: 'kg', category: 'vegetables', min: 4 },
    { name: 'חסה', unit: 'unit', category: 'vegetables', min: 6 },
    { name: 'קישואים', unit: 'kg', category: 'vegetables', min: 4 },
    { name: 'חצילים', unit: 'kg', category: 'vegetables', min: 4 },
    { name: 'כרובית', unit: 'unit', category: 'vegetables', min: 3 },
    { name: 'ברוקולי', unit: 'unit', category: 'vegetables', min: 3 },
    { name: 'סלרי', unit: 'kg', category: 'vegetables', min: 1 },
    { name: 'פטרוזיליה', unit: 'unit', category: 'vegetables', min: 4 },
    { name: 'כוסברה', unit: 'unit', category: 'vegetables', min: 3 },
    { name: 'שמיר', unit: 'unit', category: 'vegetables', min: 2 },
    { name: 'בצל ירוק', unit: 'unit', category: 'vegetables', min: 3 },
    { name: 'לימון', unit: 'kg', category: 'vegetables', min: 2 },
    { name: 'פטריות', unit: 'kg', category: 'vegetables', min: 2 },
    // פירות — fruit
    { name: 'תפוח עץ', unit: 'kg', category: 'fruits', min: 8 },
    { name: 'בננות', unit: 'kg', category: 'fruits', min: 8 },
    { name: 'תפוזים', unit: 'kg', category: 'fruits', min: 8 },
    { name: 'אבטיח/מלון (עונתי)', unit: 'kg', category: 'fruits', min: 10 },
    { name: 'ענבים', unit: 'kg', category: 'fruits', min: 4 },
    { name: 'אגסים', unit: 'kg', category: 'fruits', min: 4 },
    { name: 'אפרסקים', unit: 'kg', category: 'fruits', min: 4 },
    { name: 'שזיפים', unit: 'kg', category: 'fruits', min: 4 },
    { name: 'פירות יבשים (תמרים/צימוקים/משמש)', unit: 'kg', category: 'fruits', min: 2 },
    { name: 'פיצוחים (גרעינים/בוטנים/שקדים)', unit: 'kg', category: 'fruits', min: 2 },
    // בשר — meat & fish
    { name: 'עוף שלם/פרגיות', unit: 'kg', category: 'meat', min: 12 },
    { name: 'חזה עוף', unit: 'kg', category: 'meat', min: 8 },
    { name: 'כרעיים', unit: 'kg', category: 'meat', min: 8 },
    { name: 'בשר טחון', unit: 'kg', category: 'meat', min: 6 },
    { name: 'שניצל', unit: 'kg', category: 'meat', min: 6 },
    { name: 'נקניקיות', unit: 'kg', category: 'meat', min: 3 },
    { name: 'דג פילה', unit: 'kg', category: 'meat', min: 5 },
    { name: 'כבד עוף', unit: 'kg', category: 'meat', min: 2 },
  ];

  // Merge the default seed into a catalog. Idempotent; user entries win (except a
  // missing default min is filled from the seed). Returns the merged catalog.
  function seedCatalog(catalog) {
    return mergeCatalog(catalog || [], SEED_CATALOG);
  }

  /* ---------------------------------------------------------------- *
   * Stock count (ספירת מלאי) — a dated snapshot of the whole pantry.  *
   * Saving a count overwrites current stock AND stores the snapshot,  *
   * from which stock can be restored later.                           *
   * ---------------------------------------------------------------- */
  function snapshotStockItem(raw) {
    const it = readStockItem(raw);
    return {
      id: (raw && raw.id) || newId('stk'),
      name: it.name,
      category: it.category,
      qty: it.value,
      unit: it.unit,
      minQty: it.min,
    };
  }

  function makeStockCount(date, stock) {
    return { date: String(date || ''), items: (stock || []).map(snapshotStockItem) };
  }

  function stockFromCount(count) {
    return (((count && count.items)) || []).map(snapshotStockItem);
  }

  /* ---------------------------------------------------------------- *
   * Week / date helpers.                                             *
   * ---------------------------------------------------------------- */
  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // DISPLAY ONLY. Turn an internal ISO date (YYYY-MM-DD) into the Israeli
  // DD/MM/YYYY format for the UI. ISO stays the storage/week-key format; this is
  // never parsed back. Anything that is not a plain ISO date (empty, already
  // formatted, unexpected) is returned unchanged so it can't corrupt output.
  function formatDateHe(iso) {
    if (typeof iso !== 'string') return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return iso;
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  // DISPLAY ONLY. 'YYYY-MM' → 'MM/YYYY'. Unrecognised input returned unchanged.
  function formatMonthHe(month) {
    if (typeof month !== 'string') return '';
    const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
    if (!m) return month;
    return m[2] + '/' + m[1];
  }

  function weekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - d.getDay()); // 0 = Sunday
    return toISODate(d);
  }

  function shiftWeek(weekOf, weeks) {
    const parts = String(weekOf).split('-').map(Number);
    const base = new Date(parts[0], parts[1] - 1, parts[2]);
    base.setDate(base.getDate() + weeks * 7);
    return toISODate(base);
  }

  // Shift a 'YYYY-MM' month key by a whole number of months.
  function shiftMonth(month, months) {
    const parts = String(month).split('-').map(Number);
    const base = new Date(parts[0], (parts[1] - 1) + months, 1);
    return toISODate(base).slice(0, 7);
  }

  function emptyDayPlan() {
    const plan = {};
    for (let i = 0; i < MEALS.length; i++) plan[MEALS[i]] = [];
    return plan;
  }

  function emptyWeekMenu(weekOf) {
    const days = {};
    for (let i = 0; i < DAYS.length; i++) days[DAYS[i]] = emptyDayPlan();
    return { weekOf: weekOf, days: days };
  }

  /* ---------------------------------------------------------------- *
   * Ids & "copy last week".                                          *
   * ---------------------------------------------------------------- */
  function newId(prefix) {
    const g = (typeof globalThis !== 'undefined' ? globalThis : this) || {};
    let uuid;
    if (g.crypto && typeof g.crypto.randomUUID === 'function') {
      uuid = g.crypto.randomUUID();
    } else {
      uuid = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    return prefix ? prefix + '_' + uuid : uuid;
  }

  function cloneIngredient(ing) {
    const norm = readIngredient(ing);
    return { id: newId('ing'), name: norm.name, category: norm.category, qty: norm.value, unit: norm.unit };
  }

  function cloneDish(dish) {
    return {
      id: newId('dish'),
      name: dish.name,
      ingredients: (dish.ingredients || []).map(cloneIngredient),
    };
  }

  function copyWeekInto(source, targetWeekOf) {
    const target = emptyWeekMenu(targetWeekOf);
    for (let di = 0; di < DAYS.length; di++) {
      const day = DAYS[di];
      for (let mi = 0; mi < MEALS.length; mi++) {
        const meal = MEALS[mi];
        const srcDishes = (source.days[day] && source.days[day][meal]) || [];
        target.days[day][meal] = srcDishes.map(cloneDish);
      }
    }
    return target;
  }

  return {
    // categories
    CATEGORIES: CATEGORIES,
    CATEGORY_LABELS_HE: CATEGORY_LABELS_HE,
    CATEGORY_LABELS_EN: CATEGORY_LABELS_EN,
    isCategory: isCategory,
    // days / meals
    DAYS: DAYS,
    DAY_LABELS_HE: DAY_LABELS_HE,
    MEALS: MEALS,
    MEAL_LABELS_HE: MEAL_LABELS_HE,
    // units
    UNITS: UNITS,
    UNIT_LABELS_HE: UNIT_LABELS_HE,
    isUnit: isUnit,
    safeUnit: safeUnit,
    unitFamily: unitFamily,
    baseUnitOf: baseUnitOf,
    convertUnit: convertUnit,
    toBaseValue: toBaseValue,
    gramsToKg: gramsToKg,
    kgToGrams: kgToGrams,
    toKg: toKg,
    roundQty: roundQty,
    roundKg: roundKg,
    // buffer
    BUFFER_RATE: BUFFER_RATE,
    applyBuffer: applyBuffer,
    // headcount
    effectiveForDay: effectiveForDay,
    baseTotal: baseTotal,
    emptyHeadcount: emptyHeadcount,
    // production house seed
    SEED_HOUSES: SEED_HOUSES,
    housesToSeed: housesToSeed,
    // aggregation / shopping
    ingredientKey: ingredientKey,
    stockMatchKey: stockMatchKey,
    aggregateWeek: aggregateWeek,
    dayConsumption: dayConsumption,
    subtractStock: subtractStock,
    buildShoppingList: buildShoppingList,
    applyConsumption: applyConsumption,
    isDayExecuted: isDayExecuted,
    isBelowMin: isBelowMin,
    // catalog
    catalogKey: catalogKey,
    mergeCatalog: mergeCatalog,
    catalogLookup: catalogLookup,
    SEED_CATALOG: SEED_CATALOG,
    seedCatalog: seedCatalog,
    // stock counts (dated snapshots)
    makeStockCount: makeStockCount,
    stockFromCount: stockFromCount,
    // budget (monthly)
    monthKey: monthKey,
    monthOf: monthOf,
    shiftMonth: shiftMonth,
    formatMonthHe: formatMonthHe,
    actualSpendForMonth: actualSpendForMonth,
    summariseBudget: summariseBudget,
    parseMoney: parseMoney,
    groupThousands: groupThousands,
    // weeks / menu ops
    toISODate: toISODate,
    formatDateHe: formatDateHe,
    weekStart: weekStart,
    shiftWeek: shiftWeek,
    emptyWeekMenu: emptyWeekMenu,
    copyWeekInto: copyWeekInto,
    cloneDish: cloneDish,
    newId: newId,
  };
}));
