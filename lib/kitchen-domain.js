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

  /* ---------------------------------------------------------------- *
   * Meal model (תפוסה) — cooked vs self-serve meals.                  *
   *                                                                  *
   * COOKED (planned by the cook in תפריט), at the FULL count           *
   * (מטופלים + כל הצוות):                                              *
   *   בוקר + צהריים ראשון–שישי, ארוחת ערב שישי, צהריים שבת.            *
   * SELF-SERVE (not planned — diners eat from the base pantry), at      *
   * מטופלים + 2 מדריכים, lighter fare:                                 *
   *   ערב ראשון–חמישי, ערב שבת.                                        *
   *                                                                  *
   * For AUTOMATIC math only, a self-serve evening is weighted 0.5 of a  *
   * cooked meal (lighter pantry food). The weekly effective factor also *
   * knocks 25% off Friday + Saturday quantities. This drives every       *
   * quantity that scales by people (par rescale, baseline, צפי, קניות). *
   * Menu totals are per-meal amounts as entered and are NEVER scaled.   *
   * ---------------------------------------------------------------- */
  // The two מדריכים who stay for a self-serve evening meal.
  const EVENING_STAFF = 2;
  // A self-serve evening consumes ~half a cooked meal's worth of product.
  const SELF_SERVE_MEAL_WEIGHT = 0.5;
  // Friday + Saturday run on 25% less product than a weekday.
  const WEEKEND_RATE = 0.75;
  const WEEKDAYS_PER_WEEK = 5;
  const WEEKEND_DAYS_PER_WEEK = 2;

  // Per-meal diner counts derived from the base occupancy:
  //   full    = מטופלים + כל הצוות   (cooked בוקר / צהריים / planned ערב)
  //   evening = מטופלים + 2 מדריכים  (self-serve ערב)
  // patients/staff are the clamped base figures. `evening` is deliberately the
  // literal מטופלים + 2 (not capped at `full`) so a house's evening reference is
  // a stable, predictable number.
  function mealHeadcount(hc) {
    const base = hc || {};
    const patients = clampCount(Number(base.basePatients));
    const staff = clampCount(Number(base.baseStaff));
    return { patients: patients, staff: staff, full: patients + staff, evening: patients + EVENING_STAFF };
  }

  // Daily consumption as a FRACTION of the full daytime count: two cooked meals
  // at full + one self-serve evening (½ weight, מטופלים+2 diners), over three
  // meal slots. 1.0 would be three full cooked meals. full === 0 → 0.
  //   dailyFactor = (2 × full + 0.5 × evening) / (3 × full)
  function dailyFactor(hc) {
    const m = mealHeadcount(hc);
    if (!(m.full > 0)) return 0;
    return (2 * m.full + SELF_SERVE_MEAL_WEIGHT * m.evening) / (3 * m.full);
  }

  // Weekly consumption fraction of the full count: five weekdays at the daily
  // fraction plus two weekend days at 75% of it (Fri+Sat ‎-25%), over 7 days.
  //   weekFactor = (5 × dailyFactor + 2 × dailyFactor × 0.75) / 7
  function weekFactor(hc) {
    const daily = dailyFactor(hc);
    return (WEEKDAYS_PER_WEEK * daily + WEEKEND_DAYS_PER_WEEK * daily * WEEKEND_RATE) / 7;
  }

  // The effective diner-equivalent count a WEEKLY quantity scales by:
  //   effectivePeople = weekFactor × baseTotal  (≈ full count reduced for
  //   self-serve evenings and the weekend). Used in place of the raw headcount
  //   everywhere par/baseline/צפי/קניות scale by people.
  function effectivePeople(hc) {
    return weekFactor(hc) * baseTotal(hc);
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

  /* Weekly plan (צפי) — split the week's requirement into two explanatory
     buckets against current stock (NO purchasing buffer):
       • menu     — every ingredient the week's menu needs, with the raw
                    shortfall  missing = max(0, required − stock)
       • parTopUp — items NOT in the menu that are below their מלאי מינימום, so a
                    cook sees WHY a par-only item lands on the shopping list.
     `menuEmpty` is true when the week has no menu ingredients at all (used to
     show a "no menu entered yet" message instead of an empty table). Pass
     `days` to scope the menu requirement (default: the whole week). */
  function weeklyPlan(week, stock, days) {
    const list = buildShoppingList(week, stock, 0, days); // rate 0 → no buffer
    const menu = [];
    const parTopUp = [];
    list.lines.forEach(function (l) {
      if (l.requiredQty > 0) {
        menu.push({
          name: l.name, category: l.category, unit: l.unit,
          requiredQty: l.requiredQty, stockQty: l.stockQty,
          missing: subtractStock(l.requiredQty, l.stockQty),
        });
      } else {
        const parNeed = subtractStock(l.minQty, l.stockQty);
        if (parNeed > 0) {
          parTopUp.push({
            name: l.name, category: l.category, unit: l.unit,
            minQty: l.minQty, stockQty: l.stockQty, missing: parNeed,
          });
        }
      }
    });
    return { menu: menu, parTopUp: parTopUp, menuEmpty: menu.length === 0 };
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

  // A non-negative estimated unit price (₪ per the item's own unit). Fractions
  // are allowed (e.g. 0.045 ₪/gram). Non-finite / negative → 0 ("unknown").
  function sanitizePrice(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Merge `entries` into `catalog`, de-duplicating by normalised name.
  // First-seen wins for name/unit/category, so a user's catalog entry is never
  // overwritten by a later (e.g. seed) one. The exceptions are `min` and
  // `price`: a missing (zero) default is filled in from a later entry, so seed
  // par levels / prices reach items that were catalogued before those fields
  // existed — without ever clobbering a non-zero value already present. Blank
  // names dropped; returned sorted by Hebrew name.
  function mergeCatalog(catalog, entries) {
    const seen = new Map();
    function add(e) {
      const name = String((e && e.name) || '').trim();
      if (!name) return;
      const key = catalogKey(name);
      const min = sanitizeMin(e && e.min);
      const price = sanitizePrice(e && e.price);
      if (seen.has(key)) {
        const cur = seen.get(key);
        if (!(cur.min > 0) && min > 0) cur.min = min; // fill a missing default only
        if (!(cur.price > 0) && price > 0) cur.price = price;
        return;
      }
      seen.set(key, {
        name: name,
        unit: safeUnit(e && e.unit),
        category: isCategory(e && e.category) ? e.category : 'groceries',
        min: min,
        price: price,
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
   * Catalog / stock corrections — fix historical typos, duplicate     *
   * items and wrong units/categories in ALREADY-STORED data on load.  *
   * These run every load and are idempotent, so a stale Sheet self-    *
   * heals; the SEED_CATALOG below already carries the corrected values *
   * for fresh installs.                                               *
   * ---------------------------------------------------------------- */
  // Misspelled / duplicate names → their canonical spelling (keys are
  // normalised names). A stored item under an alias is folded into the canonical
  // item (quantities merged for stock).
  const NAME_ALIASES = {
    'בצים': 'ביצים',      // eggs — drop the misspelling, keep ביצים
    'עכבניות': 'עגבניות',  // tomatoes — typo
    // The combined "עוף שלם/פרגיות" item was split into two priced items
    // (עוף שלם 22, פרגיות 40); existing stock/overrides map to עוף שלם.
    'עוף שלם/פרגיות': 'עוף שלם',
  };

  // Canonical unit / category / (optional) default par forced onto matching
  // catalog+stock items, overriding stale stored values. `min` is only applied
  // to the catalog default (never overwrites a cook's stock par).
  const CATALOG_CORRECTIONS = {
    'ביצים': { unit: 'unit', category: 'groceries', min: 120 },
    'גבינה לבנה': { unit: 'unit', category: 'groceries', min: 6 },
    'גבינה צהובה': { unit: 'g', category: 'groceries', min: 3000 },
    'שמנת מתוקה': { unit: 'unit', category: 'groceries' },
    'שמנת חמוצה': { unit: 'unit', category: 'groceries' },
    'חמאה': { unit: 'unit', category: 'groceries', min: 8 },
    'עגבניות': { unit: 'kg', category: 'vegetables', min: 12 },
  };

  function canonicalName(name) {
    const key = catalogKey(name);
    return Object.prototype.hasOwnProperty.call(NAME_ALIASES, key) ? NAME_ALIASES[key] : String(name || '').trim();
  }

  // Migrate a per-item parOverrides map so an override stored under an aliased /
  // renamed catalog name moves to the canonical name's key (e.g. the split
  // combined-meat item → עוף שלם). A cook's saved override for the canonical name
  // is NEVER clobbered: when both an alias key and the canonical key hold
  // overrides, the canonical (identity) one wins. Prototype-pollution keys are
  // dropped. Pure — returns a new map, input untouched. Idempotent.
  function migrateParOverrideKeys(overrides) {
    const out = {};
    const keys = Object.keys(overrides || {}).filter(function (k) {
      return k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
    });
    // First pass: fill each canonical slot (aliases only fill an unclaimed slot).
    keys.forEach(function (k) {
      const canon = catalogKey(canonicalName(k));
      if (canon === k) { out[canon] = overrides[k]; return; }        // identity wins
      if (!Object.prototype.hasOwnProperty.call(out, canon)) out[canon] = overrides[k];
    });
    // Second pass: an identity key seen AFTER an alias still wins its slot.
    keys.forEach(function (k) {
      if (catalogKey(canonicalName(k)) === k) out[k] = overrides[k];
    });
    return out;
  }

  // Correct a catalog: rename aliases, force canonical unit/category/min for
  // known items, de-duplicate. Pure; returns a new, sorted catalog.
  function correctCatalog(catalog) {
    const renamed = (catalog || []).map(function (c) {
      const name = canonicalName((c && c.name) || '');
      const fix = CATALOG_CORRECTIONS[catalogKey(name)];
      return {
        name: name,
        unit: fix && fix.unit ? fix.unit : safeUnit(c && c.unit),
        category: fix && fix.category ? fix.category : (isCategory(c && c.category) ? c.category : 'groceries'),
        min: fix && fix.min != null ? fix.min : sanitizeMin(c && c.min),
        price: sanitizePrice(c && c.price),
      };
    }).filter(function (e) { return e.name !== ''; });
    // mergeCatalog de-dupes by name (first-seen wins); corrections already made
    // every duplicate identical, so the survivor carries the canonical values.
    return mergeCatalog([], renamed);
  }

  // Correct a stock array: fold alias-named rows into their canonical item,
  // summing quantities (converted within a unit family). Blank rows dropped.
  // Pure; returns a NEW stock array (original order of first appearance).
  function correctStock(stock) {
    const acc = new Map();
    const order = [];
    (stock || []).forEach(function (raw) {
      const it = readStockItem(raw);
      if (!it.name) return;
      const name = canonicalName(it.name);
      const key = catalogKey(name);
      if (acc.has(key)) {
        const cur = acc.get(key);
        const conv = convertUnit(it.value, it.unit, cur.unit);
        cur.qty = roundQty(cur.qty + (Number.isFinite(conv) ? conv : it.value));
        if (!(cur.minQty > 0) && it.min > 0) cur.minQty = it.min;
      } else {
        acc.set(key, { id: (raw && raw.id) || newId('stk'), name: name, category: it.category, qty: it.value, unit: it.unit, minQty: it.min });
        order.push(key);
      }
    });
    return order.map(function (k) { return acc.get(k); });
  }

  /* ---------------------------------------------------------------- *
   * Scaled par levels & the budget baseline.                          *
   *                                                                   *
   * Seed pars (`catalog[i].min`) are sized for a REFERENCE house of    *
   * BASE_PEOPLE (25) people/week. A house's effective par scales with  *
   * its base occupancy: seedMin × (baseTotal ÷ 25), rounded to a       *
   * sensible step per unit. A cook may OVERRIDE any item's par (or     *
   * price); an override is an absolute value that is stored and NEVER  *
   * rescaled. All shortfall math uses the effective par.               *
   * ---------------------------------------------------------------- */
  const BASE_PEOPLE = 25;

  // חד"פ (disposables — plates, cutlery, cups, foil, bags…) run at a flat 15% on
  // top of the food baseline, added to the recommended monthly budget.
  const DISPOSABLES_RATE = 0.15;

  // Split a food baseline total into the recommended monthly budget:
  //   food (X) + חד"פ 15% (Y) → total (Z). Z is what "אמץ כתקציב" adopts.
  function budgetRecommendation(foodTotal) {
    const food = round2(Number.isFinite(foodTotal) && foodTotal > 0 ? foodTotal : 0);
    const disposables = round2(food * DISPOSABLES_RATE);
    return { food: food, disposables: disposables, total: round2(food + disposables) };
  }

  // People count for SCALING. Unlike clampCount (a whole-person headcount) this
  // keeps fractions: the effective diner-equivalent (weekFactor) is a weighted
  // average like 22.29, not a count of humans. Non-finite / negative → 0.
  function clampPeople(n) {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj || {}, key); }

  // Round a scaled quantity to a sensible step for its unit family:
  //   count (יחידות) → whole; mass/volume base (ק"ג/ליטר) → 0.5; g/ml → 50.
  function roundParQty(value, unit) {
    if (!(value > 0)) return 0;
    const u = safeUnit(unit);
    if (u === 'unit') return Math.max(1, Math.round(value));
    if (u === 'kg' || u === 'l') return Math.round(value * 2) / 2;
    return Math.max(50, Math.round(value / 50) * 50); // g / ml
  }

  // Seed par scaled to a house of `baseTotal` people (reference: BASE_PEOPLE).
  // `baseTotal` may be a fractional effective diner-equivalent (weekFactor).
  function scaledPar(seedMin, unit, baseTotal) {
    const people = clampPeople(baseTotal);
    const seed = sanitizeMin(seedMin);
    if (!(seed > 0) || people <= 0) return 0;
    return roundParQty((seed * people) / BASE_PEOPLE, unit);
  }

  // Effective par: a stored override wins (absolute, never rescaled); otherwise
  // the scaled seed par. `override` is a number when set, null/undefined if not.
  function effectivePar(seedMin, unit, baseTotal, override) {
    if (override != null && override !== '') {
      const n = Number(override);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return scaledPar(seedMin, unit, baseTotal);
  }

  // Effective unit price: override wins, else the seed estimate, else 0.
  function effectivePrice(seedPrice, override) {
    if (override != null && override !== '') {
      const n = Number(override);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return sanitizePrice(seedPrice);
  }

  // The monthly budget baseline for a house: for every catalog item, the
  // effective weekly par, its monthly quantity (× 4 weeks), the effective unit
  // price and the resulting monthly cost, plus per-item override sources. The
  // grand total is the baseline that determines the budget. `overrides` maps a
  // catalogKey → { min?, price? }. Pure.
  function baselineForHouse(catalog, baseTotal, overrides) {
    overrides = overrides || {};
    const people = clampPeople(baseTotal);
    const rows = (catalog || []).map(function (c) {
      const key = catalogKey(c.name);
      const ov = overrides[key] || {};
      const minOv = hasOwn(ov, 'min') ? ov.min : undefined;
      const priceOv = hasOwn(ov, 'price') ? ov.price : undefined;
      const weekQty = effectivePar(c.min, c.unit, people, minOv);
      const monthQty = roundQty(weekQty * 4);
      const price = effectivePrice(c.price, priceOv);
      const monthlyCost = round2(monthQty * price);
      return {
        key: key,
        name: c.name,
        category: isCategory(c.category) ? c.category : 'groceries',
        unit: safeUnit(c.unit),
        weekQty: weekQty,
        monthQty: monthQty,
        price: price,
        monthlyCost: monthlyCost,
        minSource: minOv != null && minOv !== '' ? 'manual' : 'default',
        priceSource: priceOv != null && priceOv !== '' ? 'manual' : 'default',
      };
    }).sort(byCategoryThenName);
    const total = round2(rows.reduce(function (s, r) { return s + r.monthlyCost; }, 0));
    // "אפייה" — the incremental monthly cost of the baking-staple bump, an
    // ESTIMATE recovered as bumpedCost × 0.2 for each default-par baking row.
    // (Overridden rows are skipped: the manual par replaced the seed bump.)
    const baking = round2(rows.reduce(function (s, r) {
      return (BAKING_STAPLE_KEYS.has(r.key) && r.minSource === 'default')
        ? s + r.monthlyCost * BAKING_COST_SHARE : s;
    }, 0));
    // `total` is the FOOD baseline (X, incl. every bump); `baking` (A) is a
    // breakdown line already inside X; `recommended` adds חד"פ 15% (Y) → Z, the
    // adopt-as-budget figure. baseTotal echoes the effective people used.
    return { baseTotal: people, rows: rows, total: total, baking: baking, recommended: budgetRecommendation(total) };
  }

  // Return a NEW stock array with each item's `minQty` replaced by its EFFECTIVE
  // par (override ?? scaled seed), so buildShoppingList / weeklyPlan compute
  // shortfalls against the scaled par. A free-text item not in the catalog keeps
  // its own stored par. The effective par is expressed in the stock item's unit.
  function withEffectiveMins(stock, catalog, baseTotal, overrides) {
    overrides = overrides || {};
    const people = clampPeople(baseTotal);
    return (stock || []).map(function (raw) {
      const it = readStockItem(raw);
      const c = catalogLookup(catalog, it.name);
      let effMin;
      if (c) {
        const ov = overrides[catalogKey(it.name)] || {};
        const minOv = hasOwn(ov, 'min') ? ov.min : undefined;
        const parInCat = effectivePar(c.min, c.unit, people, minOv);
        const conv = convertUnit(parInCat, c.unit, it.unit);
        effMin = Number.isFinite(conv) ? conv : parInCat;
      } else {
        effMin = it.min;
      }
      return { id: raw && raw.id, name: it.name, category: it.category, qty: it.value, unit: it.unit, minQty: effMin };
    });
  }

  // Stock rows for shortfall math over the FULL catalog: EVERY catalog item
  // (quantity taken from a matching stock row, else 0) PLUS any free-text stock
  // item not in the catalog, each carrying its EFFECTIVE par as `minQty`. This is
  // what קניות / צפי run against, so a catalog item that isn't stocked yet
  // (implicit qty 0) still surfaces in the minimum top-up — not only items that
  // already exist as stock rows. Pure.
  function effectiveCatalogStock(catalog, stock, baseTotal, overrides) {
    overrides = overrides || {};
    const people = clampPeople(baseTotal);
    return stockCountRows(catalog, stock).map(function (r) {
      const c = catalogLookup(catalog, r.name);
      let effMin;
      if (c) {
        const ov = overrides[catalogKey(r.name)] || {};
        const minOv = hasOwn(ov, 'min') ? ov.min : undefined;
        const parInCat = effectivePar(c.min, c.unit, people, minOv);
        const conv = convertUnit(parInCat, c.unit, r.unit);
        effMin = Number.isFinite(conv) ? conv : parInCat;
      } else {
        effMin = r.min; // free-text pantry item keeps its own stored par
      }
      return { id: r.id, name: r.name, category: r.category, qty: r.qty, unit: r.unit, minQty: effMin };
    });
  }

  // The effective par for a single item name (used for the count-screen hint and
  // the מלאי min column). Returns { qty, unit, source }.
  function effectiveParFor(catalog, name, baseTotal, overrides) {
    overrides = overrides || {};
    const c = catalogLookup(catalog, name);
    if (!c) return { qty: 0, unit: 'kg', source: 'default' };
    const ov = overrides[catalogKey(name)] || {};
    const minOv = hasOwn(ov, 'min') ? ov.min : undefined;
    return {
      qty: effectivePar(c.min, c.unit, baseTotal, minOv),
      unit: safeUnit(c.unit),
      source: minOv != null && minOv !== '' ? 'manual' : 'default',
    };
  }

  // Return a NEW overrides map with one item's override reset to the seed
  // default. With `field` ('min' | 'price') only that field is cleared (and the
  // entry dropped if nothing remains); without `field` the whole entry is
  // removed. Pure — the input map is never mutated, so resetting one house's
  // overrides can never affect another house's map.
  function clearParOverride(overrides, key, field) {
    const out = {};
    Object.keys(overrides || {}).forEach(function (k) {
      if (k === key || k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      out[k] = overrides[k];
    });
    const cur = overrides && overrides[key];
    if (field && cur && typeof cur === 'object') {
      const rest = {};
      if (field !== 'min' && hasOwn(cur, 'min')) rest.min = cur.min;
      if (field !== 'price' && hasOwn(cur, 'price')) rest.price = cur.price;
      if ('min' in rest || 'price' in rest) out[key] = rest;
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Default catalog seed — a full per-category item list with default *
   * par levels (מלאי מינימום) sized for a 25-person house over 7 days.*
   * Merged into the shared catalog on load (idempotent, never         *
   * overwrites user edits). Cooks may edit/delete/add freely — these  *
   * are defaults, not locked entries.                                 *
   * ---------------------------------------------------------------- */
  // `price` is an ESTIMATED ₪ unit price in the item's OWN unit (so a per-kg
  // spice like פפריקה 30 ₪/ק"ג is stored as 0.03 ₪/gram). Estimates only — used
  // for the budget baseline; every cook can override them per house.
  //
  // `min` here is the BASE par (25-person reference). Two seed bumps are layered
  // on top below (see EVENING_STAPLE_KEYS / BAKING_STAPLE_KEYS) before this list
  // is exported as SEED_CATALOG, so evening self-serve fare and baking are
  // covered without a cook touching anything.
  const SEED_CATALOG_BASE = [
    // מכולת — dairy, eggs & fresh staples
    { name: 'ביצים', unit: 'unit', category: 'groceries', min: 120, price: 1.2 },
    { name: 'חלב', unit: 'l', category: 'groceries', min: 15, price: 6.5 },
    { name: 'גבינה לבנה', unit: 'unit', category: 'groceries', min: 6, price: 5.5 },   // גביעים
    { name: 'גבינה צהובה', unit: 'g', category: 'groceries', min: 3000, price: 0.045 }, // 45 ₪/ק"ג
    { name: "קוטג'", unit: 'unit', category: 'groceries', min: 10, price: 5.5 },
    { name: 'יוגורט', unit: 'unit', category: 'groceries', min: 20, price: 4 },
    { name: 'שמנת מתוקה', unit: 'unit', category: 'groceries', min: 4, price: 7 },   // גביעים
    { name: 'שמנת חמוצה', unit: 'unit', category: 'groceries', min: 4, price: 5 },   // גביעים
    { name: 'חמאה', unit: 'unit', category: 'groceries', min: 8, price: 8 },
    { name: 'גבינת שמנת', unit: 'unit', category: 'groceries', min: 3, price: 8 },
    { name: 'לחם', unit: 'unit', category: 'groceries', min: 15, price: 8 },
    // יבשים — pantry / dry goods
    { name: 'שמן קנולה', unit: 'l', category: 'dry', min: 6, price: 12 },
    { name: 'שמן זית', unit: 'l', category: 'dry', min: 2, price: 35 },
    { name: 'סוכר', unit: 'kg', category: 'dry', min: 5, price: 5 },
    { name: 'מלח', unit: 'kg', category: 'dry', min: 2, price: 3 },
    { name: 'קמח', unit: 'kg', category: 'dry', min: 10, price: 5 },
    { name: 'אורז', unit: 'kg', category: 'dry', min: 10, price: 8 },
    { name: 'פסטה', unit: 'kg', category: 'dry', min: 8, price: 7 },
    { name: 'פתיתים', unit: 'kg', category: 'dry', min: 4, price: 8 },
    { name: 'קוסקוס', unit: 'kg', category: 'dry', min: 3, price: 8 },
    { name: 'בורגול', unit: 'kg', category: 'dry', min: 2, price: 9 },
    { name: 'עדשים', unit: 'kg', category: 'dry', min: 3, price: 10 },
    { name: 'שעועית יבשה', unit: 'kg', category: 'dry', min: 2, price: 12 },
    { name: 'חומוס יבש', unit: 'kg', category: 'dry', min: 3, price: 10 },
    { name: 'אפונה יבשה', unit: 'kg', category: 'dry', min: 2, price: 9 },
    { name: 'רסק עגבניות', unit: 'unit', category: 'dry', min: 12, price: 5 },
    { name: 'עגבניות משומרות', unit: 'unit', category: 'dry', min: 8, price: 6 },
    { name: 'טונה', unit: 'unit', category: 'dry', min: 24, price: 5.5 },
    { name: 'תירס משומר', unit: 'unit', category: 'dry', min: 12, price: 5 },
    { name: 'זיתים', unit: 'unit', category: 'dry', min: 6, price: 8 },
    { name: 'מלפפון חמוץ', unit: 'unit', category: 'dry', min: 6, price: 7 },
    { name: 'קטשופ', unit: 'unit', category: 'dry', min: 3, price: 10 },
    { name: 'מיונז', unit: 'unit', category: 'dry', min: 3, price: 12 },
    { name: 'חרדל', unit: 'unit', category: 'dry', min: 2, price: 8 },
    { name: 'טחינה גולמית', unit: 'unit', category: 'dry', min: 4, price: 18 },
    { name: 'סילאן/דבש', unit: 'unit', category: 'dry', min: 2, price: 15 },
    { name: 'חומץ', unit: 'l', category: 'dry', min: 2, price: 6 },
    { name: 'אבקת מרק', unit: 'unit', category: 'dry', min: 3, price: 12 },
    { name: 'פפריקה', unit: 'g', category: 'dry', min: 500, price: 0.03 },   // 30 ₪/ק"ג
    { name: 'כמון', unit: 'g', category: 'dry', min: 500, price: 0.035 },    // 35 ₪/ק"ג
    { name: 'פלפל שחור', unit: 'g', category: 'dry', min: 300, price: 0.06 }, // 60 ₪/ק"ג
    { name: 'כורכום', unit: 'g', category: 'dry', min: 300, price: 0.035 },  // 35 ₪/ק"ג
    { name: 'קפה', unit: 'kg', category: 'dry', min: 2, price: 45 },
    { name: 'תה', unit: 'unit', category: 'dry', min: 200, price: 0.15 },
    { name: 'קקאו', unit: 'kg', category: 'dry', min: 1, price: 25 },
    { name: 'שוקולד ציפים', unit: 'kg', category: 'dry', min: 1, price: 30 },
    { name: 'אבקת אפייה', unit: 'g', category: 'dry', min: 500, price: 0.02 },  // 20 ₪/ק"ג
    { name: 'שמרים', unit: 'g', category: 'dry', min: 500, price: 0.025 },     // 25 ₪/ק"ג
    { name: 'וניל', unit: 'g', category: 'dry', min: 100, price: 0.08 },       // 80 ₪/ק"ג
    { name: 'פריכיות', unit: 'unit', category: 'dry', min: 5, price: 8 },
    // ירקות — vegetables
    { name: 'בצל', unit: 'kg', category: 'vegetables', min: 10, price: 4 },
    { name: 'שום', unit: 'kg', category: 'vegetables', min: 1, price: 15 },
    { name: 'תפוחי אדמה', unit: 'kg', category: 'vegetables', min: 15, price: 4 },
    { name: 'בטטה', unit: 'kg', category: 'vegetables', min: 5, price: 7 },
    { name: 'גזר', unit: 'kg', category: 'vegetables', min: 8, price: 4 },
    { name: 'עגבניות', unit: 'kg', category: 'vegetables', min: 12, price: 6 },
    { name: 'מלפפונים', unit: 'kg', category: 'vegetables', min: 10, price: 5 },
    { name: 'פלפלים', unit: 'kg', category: 'vegetables', min: 6, price: 8 },
    { name: 'כרוב', unit: 'kg', category: 'vegetables', min: 4, price: 4 },
    { name: 'חסה', unit: 'unit', category: 'vegetables', min: 6, price: 7 },
    { name: 'קישואים', unit: 'kg', category: 'vegetables', min: 4, price: 6 },
    { name: 'חצילים', unit: 'kg', category: 'vegetables', min: 4, price: 5 },
    { name: 'כרובית', unit: 'unit', category: 'vegetables', min: 3, price: 10 },
    { name: 'ברוקולי', unit: 'unit', category: 'vegetables', min: 3, price: 12 },
    { name: 'סלרי', unit: 'kg', category: 'vegetables', min: 1, price: 8 },
    { name: 'פטרוזיליה', unit: 'unit', category: 'vegetables', min: 4, price: 4 },
    { name: 'כוסברה', unit: 'unit', category: 'vegetables', min: 3, price: 4 },
    { name: 'שמיר', unit: 'unit', category: 'vegetables', min: 2, price: 4 },
    { name: 'בצל ירוק', unit: 'unit', category: 'vegetables', min: 3, price: 4 },
    { name: 'לימון', unit: 'kg', category: 'vegetables', min: 2, price: 8 },
    { name: 'פטריות', unit: 'kg', category: 'vegetables', min: 2, price: 15 },
    // פירות — fruit
    { name: 'תפוח עץ', unit: 'kg', category: 'fruits', min: 8, price: 8 },
    { name: 'בננות', unit: 'kg', category: 'fruits', min: 8, price: 7 },
    { name: 'תפוזים', unit: 'kg', category: 'fruits', min: 8, price: 5 },
    { name: 'אבטיח/מלון (עונתי)', unit: 'kg', category: 'fruits', min: 10, price: 4 },
    { name: 'ענבים', unit: 'kg', category: 'fruits', min: 4, price: 12 },
    { name: 'אגסים', unit: 'kg', category: 'fruits', min: 4, price: 10 },
    { name: 'אפרסקים', unit: 'kg', category: 'fruits', min: 4, price: 10 },
    { name: 'שזיפים', unit: 'kg', category: 'fruits', min: 4, price: 10 },
    { name: 'פירות יבשים (תמרים/צימוקים/משמש)', unit: 'kg', category: 'fruits', min: 2, price: 25 },
    { name: 'פיצוחים (גרעינים/בוטנים/שקדים)', unit: 'kg', category: 'fruits', min: 2, price: 30 },
    // בשר — meat & fish. Prices verified vs market, July 2026.
    { name: 'עוף שלם', unit: 'kg', category: 'meat', min: 12, price: 22 },
    { name: 'פרגיות', unit: 'kg', category: 'meat', min: 12, price: 40 },
    { name: 'חזה עוף', unit: 'kg', category: 'meat', min: 8, price: 38 },
    { name: 'כרעיים', unit: 'kg', category: 'meat', min: 8, price: 20 },
    { name: 'בשר טחון', unit: 'kg', category: 'meat', min: 6, price: 60 },
    { name: 'שניצל', unit: 'kg', category: 'meat', min: 6, price: 45 },
    { name: 'נקניקיות', unit: 'kg', category: 'meat', min: 3, price: 25 },
    { name: 'דג פילה', unit: 'kg', category: 'meat', min: 5, price: 45 },
    { name: 'כבד עוף', unit: 'kg', category: 'meat', min: 2, price: 25 },
  ];

  /* Seed par bumps (applied to SEED_CATALOG_BASE → SEED_CATALOG below).
     • EVENING (+20%): staples the self-serve evenings run on — bread, cheeses,
       eggs, salad vegetables and spreads — so the base pantry covers ערב.
     • BAKING (+25%): cake/cookie staples, so cooks can bake without a shortfall.
     An item in BOTH sets (e.g. ביצים) gets both bumps, multiplicatively.
     The BAKING share of each baking item's cost surfaces as the "אפייה" baseline
     line; keeping the bump a known factor (×1.25) lets that be recovered as
     bumpedCost × (0.25 / 1.25) without storing the pre-bump value. */
  const EVENING_STAPLE_BUMP = 0.20;
  const BAKING_STAPLE_BUMP = 0.25;
  const EVENING_STAPLE_KEYS = new Set([
    'לחם', 'גבינה לבנה', 'גבינה צהובה', 'גבינת שמנת', "קוטג'", 'ביצים',
    'עגבניות', 'מלפפונים', 'פלפלים', 'בצל', 'חסה', 'חמאה',
    'טחינה גולמית', 'מיונז', 'קטשופ', 'חרדל',
  ].map(catalogKey));
  const BAKING_STAPLE_KEYS = new Set([
    'קמח', 'סוכר', 'ביצים', 'שוקולד ציפים', 'אבקת אפייה', 'שמרים', 'קקאו', 'וניל',
  ].map(catalogKey));
  // Fraction of a baking item's (bumped) par/cost attributable to the baking
  // bump: (1.25 − 1) / 1.25 = 0.2. Used for the "אפייה" baseline line.
  const BAKING_COST_SHARE = BAKING_STAPLE_BUMP / (1 + BAKING_STAPLE_BUMP);

  function seedParBumpFactor(name) {
    const k = catalogKey(name);
    let f = 1;
    if (EVENING_STAPLE_KEYS.has(k)) f *= (1 + EVENING_STAPLE_BUMP);
    if (BAKING_STAPLE_KEYS.has(k)) f *= (1 + BAKING_STAPLE_BUMP);
    return f;
  }

  // The exported seed: base pars with the evening + baking bumps applied. Bumped
  // pars are kept as exact fractions (e.g. 14.4); the per-unit step rounding
  // happens later in scaledPar when a house's effective par is computed.
  const SEED_CATALOG = SEED_CATALOG_BASE.map(function (e) {
    const f = seedParBumpFactor(e.name);
    return f === 1 ? e : { name: e.name, unit: e.unit, category: e.category, min: roundQty(e.min * f), price: e.price };
  });

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

  /* A stock count lists the FULL catalog (every seeded + user-added item),
     grouped by category, PLUS any pantry item whose name is not in the catalog
     (e.g. a free-text row) so nothing already counted is lost. Each row carries
     the item's unit, its default par (min), and its CURRENT stock quantity
     (0 when the item is not in stock yet). Rows are matched to stock by
     normalised name. Category-ordered, then Hebrew name. */
  function stockCountRows(catalog, stock) {
    const stockByKey = new Map();
    (stock || []).forEach(function (raw) {
      const it = readStockItem(raw);
      if (!it.name) return;
      stockByKey.set(catalogKey(it.name), { item: it, id: raw && raw.id });
    });

    const rows = [];
    const seen = new Set();
    (catalog || []).forEach(function (c) {
      const name = String((c && c.name) || '').trim();
      if (!name) return;
      const key = catalogKey(name);
      if (seen.has(key)) return;
      seen.add(key);
      const st = stockByKey.get(key);
      rows.push({
        key: key,
        name: st ? st.item.name : name,
        category: st ? st.item.category : (isCategory(c.category) ? c.category : 'groceries'),
        unit: st ? st.item.unit : safeUnit(c.unit),
        min: st ? st.item.min : sanitizeMin(c && c.min),
        qty: st ? st.item.value : 0,
        id: st ? st.id : null,
      });
    });
    // Pantry rows the catalog doesn't know about still need counting.
    (stock || []).forEach(function (raw) {
      const it = readStockItem(raw);
      if (!it.name) return;
      const key = catalogKey(it.name);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ key: key, name: it.name, category: it.category, unit: it.unit, min: it.min, qty: it.value, id: raw && raw.id });
    });
    return rows.sort(byCategoryThenName);
  }

  /* Apply a stock count. `values` maps a count-row key (normalised name) to the
     counted quantity in that row's unit; an untouched row keeps its current
     quantity. The count is simply "count what you have": EVERY item in the count
     (the whole catalog + any free-text pantry row) is written into stock —
     INCLUDING items left at 0, which stay in the pantry list as empty rows. So
     after a save, all counted items exist in stock. Pure: returns a NEW stock
     array. */
  function applyStockCount(catalog, stock, values) {
    values = values || {};
    return stockCountRows(catalog, stock).map(function (r) {
      const raw = Object.prototype.hasOwnProperty.call(values, r.key) ? values[r.key] : undefined;
      let counted;
      if (raw === undefined) {
        counted = r.qty;
      } else {
        const n = Number(raw);
        counted = Number.isFinite(n) && n > 0 ? n : 0;
      }
      return { id: r.id != null ? r.id : newId('stk'), name: r.name, category: r.category, qty: roundQty(counted), unit: r.unit, minQty: r.min };
    }).sort(byCategoryThenName);
  }

  /* ---------------------------------------------------------------- *
   * Shopping-list extras — free items a cook adds to ONE week's list  *
   * on top of the computed shortfall. Persisted per week. Normalise a *
   * raw extra to { id, name, qty, unit, category }.                   *
   * ---------------------------------------------------------------- */
  function readShoppingExtra(e) {
    e = e || {};
    const value = Number(e.qty != null ? e.qty : e.value);
    return {
      id: e.id || newId('extra'),
      name: String(e.name || '').trim(),
      qty: Number.isFinite(value) && value > 0 ? value : 0,
      unit: safeUnit(e.unit),
      category: isCategory(e.category) ? e.category : 'groceries',
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
    EVENING_STAFF: EVENING_STAFF,
    WEEKEND_RATE: WEEKEND_RATE,
    SELF_SERVE_MEAL_WEIGHT: SELF_SERVE_MEAL_WEIGHT,
    mealHeadcount: mealHeadcount,
    dailyFactor: dailyFactor,
    weekFactor: weekFactor,
    effectivePeople: effectivePeople,
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
    weeklyPlan: weeklyPlan,
    applyConsumption: applyConsumption,
    isDayExecuted: isDayExecuted,
    isBelowMin: isBelowMin,
    // catalog
    catalogKey: catalogKey,
    mergeCatalog: mergeCatalog,
    catalogLookup: catalogLookup,
    canonicalName: canonicalName,
    migrateParOverrideKeys: migrateParOverrideKeys,
    correctCatalog: correctCatalog,
    correctStock: correctStock,
    SEED_CATALOG: SEED_CATALOG,
    seedCatalog: seedCatalog,
    // scaled par levels + budget baseline
    BASE_PEOPLE: BASE_PEOPLE,
    DISPOSABLES_RATE: DISPOSABLES_RATE,
    EVENING_STAPLE_BUMP: EVENING_STAPLE_BUMP,
    BAKING_STAPLE_BUMP: BAKING_STAPLE_BUMP,
    budgetRecommendation: budgetRecommendation,
    roundParQty: roundParQty,
    scaledPar: scaledPar,
    effectivePar: effectivePar,
    effectivePrice: effectivePrice,
    baselineForHouse: baselineForHouse,
    withEffectiveMins: withEffectiveMins,
    effectiveCatalogStock: effectiveCatalogStock,
    effectiveParFor: effectiveParFor,
    clearParOverride: clearParOverride,
    // stock counts (dated snapshots)
    makeStockCount: makeStockCount,
    stockFromCount: stockFromCount,
    stockCountRows: stockCountRows,
    applyStockCount: applyStockCount,
    // shopping-list extras (per-week manual items)
    readShoppingExtra: readShoppingExtra,
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
