/* ezone-kitchen — canonical, testable domain logic.
   Loaded by Node (CommonJS) for tests and by the browser via
   /lib/kitchen-domain.js (served as a static asset by server.js).

   This is a UMD module — no build step. It holds every non-negotiable
   calculation as a small pure function:

     applyBuffer()      the fixed 20% purchasing buffer (one place, one rule)
     aggregateWeek()    Σ over (day, meal, dish, ingredient) qtyKgPerPerson × people(day)
     subtractStock()    max(0, buffered − onHand)   (never negative)
     buildShoppingList() runs aggregate → buffer → subtract → group by 5 categories
     estimateCost()     Σ toBuyKg × pricePerKg      (flags missing prices)

   people(day) = patients + staff for that day, after per-day overrides.

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
   * Units — everything is stored in KILOGRAMS.                       *
   * ---------------------------------------------------------------- */
  function gramsToKg(grams) { return grams / 1000; }
  function kgToGrams(kg) { return kg * 1000; }

  function toKg(value, unit) {
    if (!Number.isFinite(value) || value < 0) return 0;
    return unit === 'g' ? gramsToKg(value) : value;
  }

  function roundKg(kg, decimals) {
    const d = decimals === undefined ? 3 : decimals;
    const f = Math.pow(10, d);
    return Math.round((kg + Number.EPSILON) * f) / f;
  }

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

  function emptyHeadcount() {
    return { basePatients: 0, baseStaff: 0, overrides: {} };
  }

  /* ---------------------------------------------------------------- *
   * Ingredient identity — merge key (category + normalised name).    *
   * ---------------------------------------------------------------- */
  function ingredientKey(name, category) {
    return category + '::' + String(name).trim().toLowerCase();
  }

  /* ---------------------------------------------------------------- *
   * Week aggregation — Σ qtyKgPerPerson × people(day).               *
   * ---------------------------------------------------------------- */
  function aggregateWeek(week, headcount) {
    const merged = new Map();

    for (let di = 0; di < DAYS.length; di++) {
      const day = DAYS[di];
      const people = effectiveForDay(headcount, day).total;
      if (people <= 0) continue;
      const dayPlan = week && week.days ? week.days[day] : null;
      if (!dayPlan) continue;

      for (let mi = 0; mi < MEALS.length; mi++) {
        const dishes = dayPlan[MEALS[mi]] || [];
        for (let i = 0; i < dishes.length; i++) {
          const ings = dishes[i].ingredients || [];
          for (let j = 0; j < ings.length; j++) {
            const ing = ings[j];
            const name = String(ing.name || '').trim();
            if (!name) continue;
            const amount = ing.qtyKgPerPerson * people;
            if (!(amount > 0)) continue;

            const key = ingredientKey(name, ing.category);
            const existing = merged.get(key);
            if (existing) {
              existing.qtyKg += amount;
            } else {
              merged.set(key, { name: name, category: ing.category, qtyKg: amount });
            }
          }
        }
      }
    }

    return Array.from(merged.values())
      .map(function (line) { return { name: line.name, category: line.category, qtyKg: roundKg(line.qtyKg) }; })
      .sort(byCategoryThenName);
  }

  function byCategoryThenName(a, b) {
    const c = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return c !== 0 ? c : a.name.localeCompare(b.name, 'he');
  }

  /* ---------------------------------------------------------------- *
   * Stock subtraction & the full shopping-list pipeline.             *
   * ---------------------------------------------------------------- */
  function indexStock(stock) {
    const map = new Map();
    for (let i = 0; i < (stock || []).length; i++) {
      const item = stock[i];
      const name = String(item.name || '').trim();
      if (!name) continue;
      const key = ingredientKey(name, item.category);
      map.set(key, (map.get(key) || 0) + Math.max(0, item.qtyKg));
    }
    return map;
  }

  function subtractStock(bufferedKg, stockKg) {
    const net = bufferedKg - Math.max(0, stockKg);
    return net > 0 ? net : 0;
  }

  function groupByCategory(lines) {
    const grouped = {};
    for (let i = 0; i < CATEGORIES.length; i++) grouped[CATEGORIES[i]] = [];
    for (let j = 0; j < lines.length; j++) grouped[lines[j].category].push(lines[j]);
    return grouped;
  }

  function buildShoppingList(week, headcount, stock, bufferRate) {
    const rate = bufferRate === undefined ? BUFFER_RATE : bufferRate;
    const aggregated = aggregateWeek(week, headcount);
    const stockIndex = indexStock(stock);

    const lines = aggregated.map(function (line) {
      const bufferedKg = roundKg(applyBuffer(line.qtyKg, rate));
      const stockKg = roundKg(stockIndex.get(ingredientKey(line.name, line.category)) || 0);
      const toBuyKg = roundKg(subtractStock(bufferedKg, stockKg));
      return {
        name: line.name,
        category: line.category,
        requiredKg: line.qtyKg,
        bufferedKg: bufferedKg,
        stockKg: stockKg,
        toBuyKg: toBuyKg,
      };
    });

    return { bufferRate: rate, lines: lines, byCategory: groupByCategory(lines) };
  }

  /* ---------------------------------------------------------------- *
   * Budget — estimate vs actual.                                     *
   * ---------------------------------------------------------------- */
  function indexPrices(prices) {
    const map = new Map();
    for (let i = 0; i < (prices || []).length; i++) {
      const p = prices[i];
      map.set(ingredientKey(p.name, p.category), p);
    }
    return map;
  }

  function estimateCost(lines, prices) {
    const priceIndex = indexPrices(prices);
    const missingPrices = [];

    const estimated = (lines || [])
      .filter(function (l) { return l.toBuyKg > 0; })
      .map(function (l) {
        const price = priceIndex.get(ingredientKey(l.name, l.category)) || null;
        if (!price) missingPrices.push(l.name);
        const lineCost = price ? round2(l.toBuyKg * price.pricePerKg) : 0;
        return {
          name: l.name,
          category: l.category,
          toBuyKg: roundKg(l.toBuyKg),
          pricePerKg: price ? price.pricePerKg : null,
          updatedAt: price ? price.updatedAt : null,
          lineCost: lineCost,
        };
      });

    const estimatedTotal = round2(estimated.reduce(function (sum, l) { return sum + l.lineCost; }, 0));
    return { lines: estimated, estimatedTotal: estimatedTotal, missingPrices: missingPrices };
  }

  function actualSpendForWeek(purchases, weekOf) {
    return round2((purchases || [])
      .filter(function (s) { return s.weekOf === weekOf; })
      .reduce(function (sum, s) { return sum + (Number.isFinite(s.amount) ? s.amount : 0); }, 0));
  }

  function summariseBudget(weeklyBudget, estimated, actual) {
    const budget = Number.isFinite(weeklyBudget) ? weeklyBudget : 0;
    return {
      weeklyBudget: budget,
      estimated: round2(estimated),
      actual: round2(actual),
      varianceVsEstimate: round2(actual - estimated),
      varianceVsBudget: round2(actual - budget),
      overBudget: actual > budget,
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

  function cloneDish(dish) {
    return {
      id: newId('dish'),
      name: dish.name,
      ingredients: (dish.ingredients || []).map(function (ing) {
        return { id: newId('ing'), name: ing.name, category: ing.category, qtyKgPerPerson: ing.qtyKgPerPerson };
      }),
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
    gramsToKg: gramsToKg,
    kgToGrams: kgToGrams,
    toKg: toKg,
    roundKg: roundKg,
    // buffer
    BUFFER_RATE: BUFFER_RATE,
    applyBuffer: applyBuffer,
    // headcount
    effectiveForDay: effectiveForDay,
    emptyHeadcount: emptyHeadcount,
    // aggregation / shopping
    ingredientKey: ingredientKey,
    aggregateWeek: aggregateWeek,
    subtractStock: subtractStock,
    buildShoppingList: buildShoppingList,
    // budget
    estimateCost: estimateCost,
    actualSpendForWeek: actualSpendForWeek,
    summariseBudget: summariseBudget,
    // weeks / menu ops
    toISODate: toISODate,
    weekStart: weekStart,
    shiftWeek: shiftWeek,
    emptyWeekMenu: emptyWeekMenu,
    copyWeekInto: copyWeekInto,
    newId: newId,
  };
}));
