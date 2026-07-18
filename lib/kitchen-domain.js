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

  /* Normalise a raw stock item to { name, category, value, unit }.
     Back-compat: pre-unit data carried `qtyKg` (kilograms). */
  function readStockItem(item) {
    item = item || {};
    const raw = item.qty != null ? item.qty : item.qtyKg;
    const value = Number(raw);
    return {
      name: String(item.name || '').trim(),
      category: isCategory(item.category) ? item.category : 'groceries',
      value: Number.isFinite(value) && value > 0 ? value : 0,
      unit: safeUnit(item.unit),
    };
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

  // Inventory-first: menu requirement (+ buffer) MINUS matching pantry stock;
  // only the shortfall (toBuyQty) is bought. Quantities are in each line's base
  // unit; stock is matched by name + unit family (kg↔g, l↔ml). Pass `days` to
  // scope the requirement to a subset of the week (default: the whole week).
  function buildShoppingList(week, stock, bufferRate, days) {
    const rate = bufferRate === undefined ? BUFFER_RATE : bufferRate;
    const aggregated = aggregateWeek(week, days);
    const stockIndex = indexStock(stock);

    const lines = aggregated.map(function (line) {
      const bufferedQty = roundQty(applyBuffer(line.qty, rate));
      const stockQty = roundQty(stockIndex.get(stockMatchKey(line.name, line.unit)) || 0);
      const toBuyQty = roundQty(subtractStock(bufferedQty, stockQty));
      return {
        name: line.name,
        category: line.category,
        unit: line.unit,
        requiredQty: line.qty,
        bufferedQty: bufferedQty,
        stockQty: stockQty,
        toBuyQty: toBuyQty,
      };
    });

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
    return { id: raw && raw.id, name: item.name, category: item.category, qty: v, unit: item.unit };
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

  // Monthly budget summary — the only three figures the budget tab shows:
  // budget (manual), actual (spend), remaining (budget − actual).
  function summariseBudget(monthlyBudget, actual) {
    const budget = Number.isFinite(monthlyBudget) && monthlyBudget > 0 ? monthlyBudget : 0;
    const spent = Number.isFinite(actual) && actual > 0 ? actual : 0;
    return {
      budget: round2(budget),
      actual: round2(spent),
      remaining: round2(budget - spent),
      overBudget: spent > budget,
    };
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
    // budget (monthly)
    monthKey: monthKey,
    monthOf: monthOf,
    shiftMonth: shiftMonth,
    formatMonthHe: formatMonthHe,
    actualSpendForMonth: actualSpendForMonth,
    summariseBudget: summariseBudget,
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
