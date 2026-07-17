/* ezone-kitchen — vanilla frontend (no build step).
   Talks to /api/sheets which proxies (POST-only) to the Google Apps Script
   bound to the Sheet. All shopping-list / budget math comes from the shared
   KitchenDomain UMD module (/lib/kitchen-domain.js), the same code the tests
   exercise. Auth: PIN -> HMAC session token (see server.js / lib/auth.js). */
'use strict';

const KD = window.KitchenDomain;

/* ============================ utilities ============================ */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtCurrency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
}
function fmtKg(kg) {
  const n = Math.round((Number(kg) + Number.EPSILON) * 1000) / 1000;
  return n + ' ק"ג';
}
function setStatus(text) {
  const el = document.getElementById('footStatus');
  if (el) el.textContent = text || '';
}
function $(sel, root) { return (root || document).querySelector(sel); }

/* ============================ session token ============================ */
const TOKEN_KEY = 'ezk_session_token';
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } }

/* The role and (for a cook) the house are read from the signed token, not from
   any client-controlled setting — the server decided them from the PIN. The
   payload is only base64url-encoded (not secret); the HMAC (dropped here) is
   what makes it unforgeable, so the browser can safely read the claims. */
function decodeToken(token) {
  try {
    const body = String(token || '').split('.')[0];
    if (!body) return null;
    let b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = atob(b64); // "kitchen:<role>:<houseId>:<exp>"
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== 'kitchen') return null;
    return { role: parts[1], houseId: parts[2], expiresAt: Number(parts[3]) };
  } catch { return null; }
}

/* ============================ API client ============================ */
/* A cook has no login: their house comes from the URL (/h/<houseId>), so their
   API calls go to that same path (/h/<houseId>/api/sheets) with no token — the
   server pins the house from the path. An admin holds a Bearer token and calls
   the all-houses /api/sheets endpoint. */
function apiEndpoint() {
  return state.role === 'cook'
    ? '/h/' + encodeURIComponent(state.myHouseId) + '/api/sheets'
    : '/api/sheets';
}

async function api(action, payload) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (state.role !== 'cook') {
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
  }
  const r = await fetch(apiEndpoint(), {
    method: 'POST',
    headers,
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  if (r.status === 401) {
    // Only the admin surface can re-authenticate; a cook URL has no login.
    if (state.role !== 'cook') { setToken(''); showLogin(); throw new Error('נדרשת התחברות'); }
    throw new Error('הגישה נדחתה');
  }
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
    api('saveHouse', { house: { id: h.id, name: h.name, weeklyBudget: h.weeklyBudget } })),
  headcount: (h) => scheduleSave('hc:' + h.id, () => api('saveHeadcount', { houseId: h.id, headcount: h.headcount })),
  allergies: (h) => scheduleSave('alg:' + h.id, () => api('saveAllergies', { houseId: h.id, allergies: h.allergies })),
  stock: (h) => scheduleSave('stk:' + h.id, () => api('saveStock', { houseId: h.id, stock: h.stock })),
  prices: (h) => scheduleSave('prc:' + h.id, () => api('savePrices', { houseId: h.id, prices: h.prices })),
  purchases: (h) => scheduleSave('pur:' + h.id, () => api('savePurchases', { houseId: h.id, purchases: h.purchases })),
  menu: (h, weekOf) => scheduleSave('menu:' + h.id + ':' + weekOf, () =>
    api('saveMenu', { houseId: h.id, weekOf, days: h.weeks[weekOf].days })),
};

/* ============================ state ============================ */
const state = {
  houses: [],
  activeHouseId: null,
  role: 'cook',    // set from the session token in start()
  myHouseId: '',   // for a cook: the one house this session is locked to
  currentWeekOf: KD.weekStart(new Date()),
  tab: 'menu',
  unitPref: {}, // transient per-ingredient display unit (id -> 'kg'|'g')
};

function activeHouse() {
  return state.houses.find((h) => h.id === state.activeHouseId) || state.houses[0] || null;
}
function ensureWeek(house, weekOf) {
  if (!house.weeks) house.weeks = {};
  if (!house.weeks[weekOf]) house.weeks[weekOf] = KD.emptyWeekMenu(weekOf);
  return house.weeks[weekOf];
}

/* ============================ load ============================ */
async function loadState() {
  const d = await api('load', {});
  state.houses = Array.isArray(d.houses) ? d.houses : [];
  for (const h of state.houses) {
    h.headcount = h.headcount || KD.emptyHeadcount();
    h.allergies = h.allergies || [];
    h.stock = h.stock || [];
    h.prices = h.prices || [];
    h.purchases = h.purchases || [];
    h.weeks = h.weeks || {};
    if (typeof h.weeklyBudget !== 'number') h.weeklyBudget = 0;
  }
  // A cook is locked to their own house (the server returns only that house).
  if (state.role === 'cook') {
    const mine = state.houses.find((h) => h.id === state.myHouseId) || state.houses[0];
    state.activeHouseId = mine ? mine.id : null;
  } else if (!state.activeHouseId && state.houses[0]) {
    state.activeHouseId = state.houses[0].id;
  }
}

/* ============================ rendering ============================ */
const TABS = [
  { id: 'menu', label: '🗓️ תפריט שבועי' },
  { id: 'headcount', label: '👥 תפוסה' },
  { id: 'stock', label: '📦 מלאי' },
  { id: 'shopping', label: '🛒 רשימת קניות' },
  { id: 'budget', label: '💰 תקציב' },
];

function renderChrome() {
  const isAdmin = state.role === 'admin';
  const houseSel = $('#houseSelect');
  const houseLabel = $('#houseLabel');
  const houseName = $('#houseName');
  const addBtn = $('#addHouseBtn');
  const badge = $('#roleBadge');
  const logoutBtn = $('#logoutBtn');

  if (isAdmin) {
    // Admin: switch across all houses, and may add houses.
    houseSel.hidden = false; houseLabel.hidden = false; addBtn.hidden = false; houseName.hidden = true;
    houseSel.innerHTML = state.houses.map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join('');
    if (activeHouse()) houseSel.value = activeHouse().id;
    badge.hidden = false; badge.textContent = 'מנהל/ת';
    if (logoutBtn) logoutBtn.hidden = false; // admin has a session to end
  } else {
    // Cook: locked to one house — no switcher, no add-house, no logout (there is
    // no login; the URL is the access).
    houseSel.hidden = true; houseLabel.hidden = true; addBtn.hidden = true;
    const h = activeHouse();
    houseName.hidden = false; houseName.textContent = h ? h.name : '';
    badge.hidden = false; badge.textContent = 'טבח/ית';
    if (logoutBtn) logoutBtn.hidden = true;
  }

  // Only admin gets the all-houses view.
  const tabs = isAdmin ? TABS.concat([{ id: 'admin', label: '🏠 כל הבתים' }]) : TABS;
  $('#tabs').innerHTML = tabs.map((t) =>
    `<button data-tab="${t.id}" role="tab" aria-current="${state.tab === t.id}">${esc(t.label)}</button>`).join('');
}

function render() {
  // The admin-only view is never reachable as a cook, even via a stale tab.
  if (state.role !== 'admin' && state.tab === 'admin') state.tab = 'menu';
  renderChrome();
  const screen = $('#screen');
  const house = activeHouse();
  if (!house) {
    screen.innerHTML = state.role === 'admin'
      ? `<div class="card">אין בתים עדיין. הוסיפו בית עם הכפתור ＋ למעלה כדי להתחיל.</div>`
      : `<div class="card">הבית שלך עדיין לא הוגדר במערכת. פנו למנהל/ת.</div>`;
    return;
  }
  const map = { menu: renderMenu, headcount: renderHeadcount, stock: renderStock, shopping: renderShopping, budget: renderBudget, admin: renderAdmin };
  const fn = map[state.tab] || renderMenu;
  screen.innerHTML = fn(house);
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
function renderMenu(house) {
  const weekOf = state.currentWeekOf;
  const week = ensureWeek(house, weekOf);
  const hasLast = !!(house.weeks && house.weeks[KD.shiftWeek(weekOf, -1)]);

  const cols = KD.DAYS.map((day) => {
    const people = KD.effectiveForDay(house.headcount, day).total;
    const meals = KD.MEALS.map((meal) => {
      const dishes = week.days[day][meal] || [];
      const dishHtml = dishes.map((dish) => renderDish(day, meal, dish)).join('');
      return `<div class="meal-block">
        <div class="row between"><span class="meal-label">${esc(KD.MEAL_LABELS_HE[meal])}</span>
          <button class="ghost" data-act="addDish" data-day="${day}" data-meal="${meal}">＋ מנה</button></div>
        ${dishHtml}
      </div>`;
    }).join('');
    return `<div class="day-col">
      <div class="day-head"><span>${esc(KD.DAY_LABELS_HE[day])}</span><span class="pill" title="סועדים ביום זה">👥 ${people}</span></div>
      ${meals}
    </div>`;
  }).join('');

  return `${allergyBanner(house)}
    <div class="card row between no-print">
      <div class="row">
        <button data-act="weekPrev">← שבוע קודם</button>
        <strong>שבוע ${esc(KD.formatDateHe(weekOf))}</strong>
        <button data-act="weekNext">שבוע הבא →</button>
      </div>
      <button class="primary" data-act="copyLast" ${hasLast ? '' : 'disabled'}
        title="${hasLast ? 'העתק את תפריט השבוע הקודם' : 'אין תפריט לשבוע הקודם'}">⧉ העתק שבוע קודם</button>
    </div>
    <div class="week-grid">${cols}</div>`;
}

function renderDish(day, meal, dish) {
  const ings = (dish.ingredients || []).map((ing) => {
    const unit = state.unitPref[ing.id] || 'kg';
    const shown = unit === 'g' ? Math.round(ing.qtyKgPerPerson * 1000) : ing.qtyKgPerPerson;
    const opts = KD.CATEGORIES.map((c) =>
      `<option value="${c}" ${c === ing.category ? 'selected' : ''}>${esc(KD.CATEGORY_LABELS_HE[c])}</option>`).join('');
    const d = `data-day="${day}" data-meal="${meal}" data-dish="${esc(dish.id)}" data-ing="${esc(ing.id)}"`;
    return `<div class="ing">
      <input value="${esc(ing.name)}" placeholder="מרכיב" data-act="ingName" ${d} />
      <select data-act="ingCat" ${d}>${opts}</select>
      <span class="u">
        <input type="number" min="0" step="${unit === 'g' ? 10 : 0.01}" value="${shown || ''}" placeholder="0" data-act="ingQty" ${d} />
        <select data-act="ingUnit" ${d}><option value="kg" ${unit === 'kg' ? 'selected' : ''}>ק"ג</option><option value="g" ${unit === 'g' ? 'selected' : ''}>גרם</option></select>
      </span>
      <span class="muted" style="font-size:.7rem">לסועד</span>
      <button class="danger" title="מחק מרכיב" data-act="delIng" ${d}>✕</button>
    </div>`;
  }).join('');
  const d = `data-day="${day}" data-meal="${meal}" data-dish="${esc(dish.id)}"`;
  return `<div class="dish">
    <div class="dish-title">
      <input value="${esc(dish.name)}" placeholder="שם המנה" data-act="dishName" ${d} />
      <button class="danger" title="מחק מנה" data-act="delDish" ${d}>✕</button>
    </div>
    ${ings}
    <button class="ghost" style="font-size:.8rem" data-act="addIng" ${d}>＋ מרכיב</button>
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
        <span class="pill">סה"כ בסיס: ${(hc.basePatients || 0) + (hc.baseStaff || 0)}</span>
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
function renderStock(house) {
  const active = state.stockCat || 'groceries';
  state.stockCat = active;
  const tabs = KD.CATEGORIES.map((c) =>
    `<button data-act="stockCat" data-cat="${c}" aria-current="${active === c}">${esc(KD.CATEGORY_LABELS_HE[c])}</button>`).join('');
  const items = house.stock.filter((s) => s.category === active);
  const rows = items.length ? items.map((item) => {
    const unit = state.unitPref['stk_' + item.id] || 'kg';
    const shown = unit === 'g' ? Math.round(item.qtyKg * 1000) : item.qtyKg;
    const catOpts = KD.CATEGORIES.map((c) => `<option value="${c}" ${c === item.category ? 'selected' : ''}>${esc(KD.CATEGORY_LABELS_HE[c])}</option>`).join('');
    return `<tr>
      <td><input value="${esc(item.name)}" placeholder="שם מרכיב" data-act="stkName" data-id="${esc(item.id)}" /></td>
      <td><select data-act="stkCat" data-id="${esc(item.id)}">${catOpts}</select></td>
      <td><span class="u"><input type="number" min="0" step="${unit === 'g' ? 10 : 0.01}" value="${shown || ''}" data-act="stkQty" data-id="${esc(item.id)}" style="width:80px" />
        <select data-act="stkUnit" data-id="${esc(item.id)}"><option value="kg" ${unit === 'kg' ? 'selected' : ''}>ק"ג</option><option value="g" ${unit === 'g' ? 'selected' : ''}>גרם</option></select></span></td>
      <td><button class="danger" data-act="stkDel" data-id="${esc(item.id)}">מחק</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="4" class="muted">אין פריטים בקטגוריה זו.</td></tr>`;

  return `<div class="card">
    <h2>מלאי — ${esc(house.name)}</h2>
    <p class="muted">מה קיים במחסן כרגע (בק"ג). הטבח מעדכן ידנית. נחסר מרשימת הקניות.</p>
    <div class="tabs" style="padding:0;margin:0 0 .8rem">${tabs}</div>
    <table><thead><tr><th>מרכיב</th><th>קטגוריה</th><th>כמות במלאי</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <button class="ghost" data-act="stkAdd" data-cat="${active}">＋ הוסף פריט ל${esc(KD.CATEGORY_LABELS_HE[active])}</button>
  </div>`;
}

/* ------------------------ Shopping list view ------------------------ */
function renderShopping(house) {
  const weekOf = state.currentWeekOf;
  const week = (house.weeks && house.weeks[weekOf]) || KD.emptyWeekMenu(weekOf);
  const list = KD.buildShoppingList(week, house.headcount, house.stock);
  const pct = Math.round(list.bufferRate * 100);

  const sections = KD.CATEGORIES.map((c) => {
    const rows = list.byCategory[c].filter((r) => r.toBuyKg > 0);
    if (!rows.length) return '';
    const trs = rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num muted">${fmtKg(r.bufferedKg)}</td><td class="num muted">${fmtKg(r.stockKg)}</td><td class="num"><strong>${fmtKg(r.toBuyKg)}</strong></td></tr>`).join('');
    return `<div class="card"><h3>${esc(KD.CATEGORY_LABELS_HE[c])}</h3>
      <table><thead><tr><th>מרכיב</th><th>נדרש (+${pct}%)</th><th>במלאי</th><th>לקנות</th></tr></thead><tbody>${trs}</tbody></table></div>`;
  }).join('');

  const nothing = list.lines.every((l) => l.toBuyKg === 0);
  return `${allergyBanner(house)}
    <div class="card row between no-print">
      <div><h2 style="margin:0">רשימת קניות</h2><span class="muted">שבוע ${esc(KD.formatDateHe(weekOf))} · כולל תוספת ${pct}% · בניכוי מלאי קיים</span></div>
      <div class="row">
        <button class="primary" data-act="waShare">📱 שלח בוואטסאפ</button>
        <button data-act="printList">🖨️ הדפס</button>
      </div>
    </div>
    ${nothing ? '<div class="card">אין מה לקנות — המלאי מכסה את כל הצרכים 🎉</div>' : sections}`;
}

function shoppingListText(house) {
  const weekOf = state.currentWeekOf;
  const week = (house.weeks && house.weeks[weekOf]) || KD.emptyWeekMenu(weekOf);
  const list = KD.buildShoppingList(week, house.headcount, house.stock);
  const lines = [];
  lines.push('🛒 רשימת קניות – ' + house.name);
  lines.push('שבוע ' + KD.formatDateHe(weekOf));
  const alg = house.allergies.filter((a) => a.name).map((a) => `${a.name} ×${Number(a.count) || 0}`);
  if (alg.length) lines.push('⚠️ אלרגיות: ' + alg.join(', '));
  lines.push('');
  let any = false;
  for (const c of KD.CATEGORIES) {
    const rows = list.byCategory[c].filter((r) => r.toBuyKg > 0);
    if (!rows.length) continue;
    any = true;
    lines.push('*' + KD.CATEGORY_LABELS_HE[c] + '*');
    for (const r of rows) lines.push('• ' + r.name + ': ' + fmtKg(r.toBuyKg));
    lines.push('');
  }
  if (!any) lines.push('אין מה לקנות – המלאי מכסה את הצרכים 🎉');
  return lines.join('\n').trim();
}

/* --------------------------- Budget view --------------------------- */
function renderBudget(house) {
  const weekOf = state.currentWeekOf;
  const week = (house.weeks && house.weeks[weekOf]) || KD.emptyWeekMenu(weekOf);
  const list = KD.buildShoppingList(week, house.headcount, house.stock);
  const estimate = KD.estimateCost(list.lines, house.prices);
  const actual = KD.actualSpendForWeek(house.purchases, weekOf);
  const summary = KD.summariseBudget(house.weeklyBudget, estimate.estimatedTotal, actual);

  const weekPurchases = house.purchases.filter((p) => p.weekOf === weekOf);
  const purchaseRows = weekPurchases.length ? weekPurchases.map((p) => `<tr>
      <td class="muted">${esc(KD.formatDateHe(p.date || ''))}</td><td class="num">${fmtCurrency(p.amount)}</td><td>${esc(p.note || '')}</td>
      <td><button class="danger" data-act="purDel" data-id="${esc(p.id)}">מחק</button></td></tr>`).join('') : '';

  const priceRows = house.prices.length ? house.prices.map((p) => `<tr>
      <td>${esc(p.name)}</td><td>${esc(KD.CATEGORY_LABELS_HE[p.category] || p.category)}</td>
      <td><input type="number" min="0" value="${p.pricePerKg}" data-act="prcVal" data-name="${esc(p.name)}" data-cat="${esc(p.category)}" style="width:90px" /></td>
      <td class="muted">${esc(KD.formatDateHe(p.updatedAt || ''))}</td></tr>`).join('') : `<tr><td colspan="4" class="muted">אין מחירים. הוסיפו מחיר למרכיב שמופיע בתפריט.</td></tr>`;

  const missing = Array.from(new Set(estimate.missingPrices));

  return `<div class="card">
      <div class="row between"><h2 style="margin:0">תקציב — ${esc(house.name)}</h2>
        <label class="muted">תקציב שבועי: <input type="number" min="0" value="${house.weeklyBudget || ''}" data-act="weeklyBudget" style="width:110px" /></label></div>
      <p class="muted">שבוע ${esc(KD.formatDateHe(weekOf))}</p>
      <div class="stat-grid">
        <div class="stat"><div class="label">תקציב</div><div class="value num">${fmtCurrency(summary.weeklyBudget)}</div></div>
        <div class="stat"><div class="label">הערכה (מהתפריט)</div><div class="value num">${fmtCurrency(summary.estimated)}</div></div>
        <div class="stat"><div class="label">בפועל</div><div class="value num">${fmtCurrency(summary.actual)}</div></div>
        <div class="stat"><div class="label">מול תקציב</div><div class="value num ${summary.overBudget ? 'over' : 'under'}">${summary.varianceVsBudget > 0 ? '+' : ''}${fmtCurrency(summary.varianceVsBudget)}</div></div>
      </div>
      ${missing.length ? `<p class="muted" style="margin-top:.6rem">⚠️ חסרים מחירים ל: ${esc(missing.join(', '))}</p>` : ''}
    </div>
    <div class="card">
      <h3>רישום הוצאה בפועל</h3>
      <div class="row">
        <input type="number" min="0" placeholder="סכום ₪" id="spendAmount" style="width:120px" />
        <input placeholder="הערה (לא חובה)" id="spendNote" />
        <button class="primary" data-act="purAdd">הוסף</button>
      </div>
      ${weekPurchases.length ? `<table style="margin-top:.6rem"><thead><tr><th>תאריך</th><th>סכום</th><th>הערה</th><th></th></tr></thead><tbody>${purchaseRows}</tbody></table>` : ''}
    </div>
    <div class="card">
      <h3>מחירים (₪ לק"ג)</h3>
      <p class="muted">משמש לחישוב ההערכה. מוצג תאריך עדכון אחרון.</p>
      <table><thead><tr><th>מרכיב</th><th>קטגוריה</th><th>₪ / ק"ג</th><th>עודכן</th></tr></thead><tbody>${priceRows}</tbody></table>
      <div class="row" style="margin-top:.6rem">
        <input placeholder="שם מרכיב" id="priceName" />
        <select id="priceCat">${KD.CATEGORIES.map((c) => `<option value="${c}">${esc(KD.CATEGORY_LABELS_HE[c])}</option>`).join('')}</select>
        <input type="number" min="0" placeholder='₪ לק"ג' id="priceVal" style="width:100px" />
        <button class="ghost" data-act="prcAdd">＋ הוסף מחיר</button>
      </div>
    </div>`;
}

/* --------------------------- Admin view --------------------------- */
function renderAdmin() {
  const weekOf = state.currentWeekOf;
  let tB = 0, tE = 0, tA = 0;
  const rows = state.houses.map((house) => {
    const week = (house.weeks && house.weeks[weekOf]) || KD.emptyWeekMenu(weekOf);
    const list = KD.buildShoppingList(week, house.headcount, house.stock);
    const estimate = KD.estimateCost(list.lines, house.prices);
    const actual = KD.actualSpendForWeek(house.purchases, weekOf);
    const s = KD.summariseBudget(house.weeklyBudget, estimate.estimatedTotal, actual);
    const people = (house.headcount.basePatients || 0) + (house.headcount.baseStaff || 0);
    tB += s.weeklyBudget; tE += s.estimated; tA += s.actual;
    return `<tr>
      <td><strong>${esc(house.name)}</strong><div class="muted mono" style="font-size:.7rem">${esc(house.id)}</div></td>
      <td class="num">${people}</td>
      <td class="num">${fmtCurrency(s.weeklyBudget)}</td>
      <td class="num muted">${fmtCurrency(s.estimated)}</td>
      <td class="num">${fmtCurrency(s.actual)}</td>
      <td class="num ${s.overBudget ? 'over' : 'under'}">${s.varianceVsBudget > 0 ? '+' : ''}${fmtCurrency(s.varianceVsBudget)}</td>
      <td><button class="ghost" data-act="openHouse" data-id="${esc(house.id)}">פתח</button></td>
    </tr>`;
  }).join('');

  return `<div class="card">
    <h2>מבט מנהל — כל הבתים</h2>
    <p class="muted">שבוע ${esc(KD.formatDateHe(weekOf))}</p>
    <p class="muted" style="font-size:.75rem">💡 המזהה שמתחת לשם הבית הוא ה־house id — כתובת הבית לטבח/ית היא <code>/h/&lt;house id&gt;</code> (למשל <code>/h/ramot-hashavim</code>). פתיחת הכתובת נכנסת ישירות לאותו בית, ללא כניסה.</p>
    <table>
      <thead><tr><th>בית</th><th>סועדים (בסיס)</th><th>תקציב</th><th>הערכה</th><th>בפועל</th><th>מול תקציב</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><strong>סה"כ</strong></td><td></td>
        <td class="num"><strong>${fmtCurrency(tB)}</strong></td>
        <td class="num"><strong>${fmtCurrency(tE)}</strong></td>
        <td class="num"><strong>${fmtCurrency(tA)}</strong></td>
        <td class="num ${tA > tB ? 'over' : 'under'}"><strong>${tA - tB > 0 ? '+' : ''}${fmtCurrency(tA - tB)}</strong></td>
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
      if (act === 'ingName') ing.name = t.value;
      else {
        const unit = state.unitPref[ing.id] || 'kg';
        ing.qtyKgPerPerson = KD.toKg(parseFloat(t.value) || 0, unit);
      }
      persist.menu(house, state.currentWeekOf);
      break;
    }
    case 'baseP': house.headcount.basePatients = clampInt(t.value); persist.headcount(house); break;
    case 'baseS': house.headcount.baseStaff = clampInt(t.value); persist.headcount(house); break;
    case 'ovP': case 'ovS': setOverride(house, t.dataset.day, act === 'ovP' ? 'patients' : 'staff', t.value); persist.headcount(house); break;
    case 'algName': { const a = house.allergies.find((x) => x.id === t.dataset.id); if (a) { a.name = t.value; persist.allergies(house); } break; }
    case 'algCount': { const a = house.allergies.find((x) => x.id === t.dataset.id); if (a) { a.count = clampInt(t.value); persist.allergies(house); } break; }
    case 'stkName': { const s = house.stock.find((x) => x.id === t.dataset.id); if (s) { s.name = t.value; persist.stock(house); } break; }
    case 'stkQty': { const s = house.stock.find((x) => x.id === t.dataset.id); if (s) { const u = state.unitPref['stk_' + s.id] || 'kg'; s.qtyKg = KD.toKg(parseFloat(t.value) || 0, u); persist.stock(house); } break; }
    case 'weeklyBudget': house.weeklyBudget = Math.max(0, parseFloat(t.value) || 0); persist.house(house); break;
    case 'prcVal': { const p = house.prices.find((x) => x.name === t.dataset.name && x.category === t.dataset.cat); if (p) { p.pricePerKg = Math.max(0, parseFloat(t.value) || 0); p.updatedAt = KD.toISODate(new Date()); persist.prices(house); } break; }
    default: break;
  }
}

function onChange(e) {
  const t = e.target;
  const act = t.dataset && t.dataset.act;
  if (!act) return;
  const house = activeHouse();
  if (!house) return;

  if (act === 'ingCat') {
    const dish = findDish(house, t.dataset.day, t.dataset.meal, t.dataset.dish);
    const ing = dish && dish.ingredients.find((i) => i.id === t.dataset.ing);
    if (ing) { ing.category = t.value; persist.menu(house, state.currentWeekOf); }
  } else if (act === 'ingUnit') {
    const dish = findDish(house, t.dataset.day, t.dataset.meal, t.dataset.dish);
    const ing = dish && dish.ingredients.find((i) => i.id === t.dataset.ing);
    if (ing) { state.unitPref[ing.id] = t.value; const inp = t.closest('.u').querySelector('[data-act="ingQty"]'); if (inp) inp.value = t.value === 'g' ? Math.round(ing.qtyKgPerPerson * 1000) : ing.qtyKgPerPerson; }
  } else if (act === 'stkCat') {
    const s = house.stock.find((x) => x.id === t.dataset.id); if (s) { s.category = t.value; persist.stock(house); render(); }
  } else if (act === 'stkUnit') {
    const s = house.stock.find((x) => x.id === t.dataset.id);
    if (s) { state.unitPref['stk_' + s.id] = t.value; const inp = t.closest('.u').querySelector('[data-act="stkQty"]'); if (inp) inp.value = t.value === 'g' ? Math.round(s.qtyKg * 1000) : s.qtyKg; }
  }
}

async function onClick(e) {
  const btn = e.target.closest('[data-act],[data-tab]');
  if (!btn) return;
  const house = activeHouse();

  if (btn.dataset.tab) { state.tab = btn.dataset.tab; render(); return; }
  const act = btn.dataset.act;
  const d = btn.dataset;

  switch (act) {
    case 'weekPrev': state.currentWeekOf = KD.shiftWeek(state.currentWeekOf, -1); render(); break;
    case 'weekNext': state.currentWeekOf = KD.shiftWeek(state.currentWeekOf, 1); render(); break;
    case 'copyLast': {
      const prev = house.weeks[KD.shiftWeek(state.currentWeekOf, -1)];
      if (prev) { house.weeks[state.currentWeekOf] = KD.copyWeekInto(prev, state.currentWeekOf); persist.menu(house, state.currentWeekOf); render(); }
      break;
    }
    case 'addDish': { const w = ensureWeek(house, state.currentWeekOf); w.days[d.day][d.meal].push({ id: KD.newId('dish'), name: '', ingredients: [] }); persist.menu(house, state.currentWeekOf); render(); break; }
    case 'delDish': { const w = ensureWeek(house, state.currentWeekOf); w.days[d.day][d.meal] = w.days[d.day][d.meal].filter((x) => x.id !== d.dish); persist.menu(house, state.currentWeekOf); render(); break; }
    case 'addIng': { const dish = findDish(house, d.day, d.meal, d.dish); if (dish) { dish.ingredients.push({ id: KD.newId('ing'), name: '', category: 'groceries', qtyKgPerPerson: 0 }); persist.menu(house, state.currentWeekOf); render(); } break; }
    case 'delIng': { const dish = findDish(house, d.day, d.meal, d.dish); if (dish) { dish.ingredients = dish.ingredients.filter((i) => i.id !== d.ing); persist.menu(house, state.currentWeekOf); render(); } break; }

    case 'ovClear': { if (house.headcount.overrides) delete house.headcount.overrides[d.day]; persist.headcount(house); render(); break; }
    case 'algAdd': house.allergies.push({ id: KD.newId('alg'), name: '', count: 1 }); persist.allergies(house); render(); break;
    case 'algDel': house.allergies = house.allergies.filter((a) => a.id !== d.id); persist.allergies(house); render(); break;

    case 'stockCat': state.stockCat = d.cat; render(); break;
    case 'stkAdd': house.stock.push({ id: KD.newId('stk'), name: '', category: d.cat, qtyKg: 0 }); persist.stock(house); render(); break;
    case 'stkDel': house.stock = house.stock.filter((s) => s.id !== d.id); persist.stock(house); render(); break;

    case 'purAdd': {
      const amount = parseFloat($('#spendAmount').value);
      if (!(amount > 0)) break;
      house.purchases.push({ id: KD.newId('pur'), weekOf: state.currentWeekOf, amount, note: ($('#spendNote').value || '').trim() || undefined, date: KD.toISODate(new Date()) });
      persist.purchases(house); render(); break;
    }
    case 'purDel': house.purchases = house.purchases.filter((p) => p.id !== d.id); persist.purchases(house); render(); break;

    case 'prcAdd': {
      const name = ($('#priceName').value || '').trim();
      const val = parseFloat($('#priceVal').value);
      if (!name || !(val >= 0)) break;
      const cat = $('#priceCat').value;
      const idx = house.prices.findIndex((p) => p.name.trim().toLowerCase() === name.toLowerCase() && p.category === cat);
      const entry = { name, category: cat, pricePerKg: val, updatedAt: KD.toISODate(new Date()) };
      if (idx >= 0) house.prices[idx] = entry; else house.prices.push(entry);
      persist.prices(house); render(); break;
    }

    case 'waShare': window.open('https://wa.me/?text=' + encodeURIComponent(shoppingListText(house)), '_blank'); break;
    case 'printList': window.print(); break;
    case 'openHouse': state.activeHouseId = d.id; state.tab = 'budget'; render(); break;
    default: break;
  }
}

function setOverride(house, day, field, value) {
  if (!house.headcount.overrides) house.headcount.overrides = {};
  const ov = Object.assign({}, house.headcount.overrides[day]);
  if (value === '' || value == null) delete ov[field];
  else ov[field] = clampInt(value);
  if (ov.patients == null && ov.staff == null) delete house.headcount.overrides[day];
  else house.headcount.overrides[day] = ov;
}
function clampInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; }

/* ============================ chrome events ============================ */
function wireChrome() {
  $('#houseSelect').addEventListener('change', (e) => { state.activeHouseId = e.target.value; render(); });
  $('#addHouseBtn').addEventListener('click', async () => {
    const name = window.prompt('שם הבית החדש:');
    if (!name) return;
    const house = { id: KD.newId('house'), name: name.trim(), headcount: KD.emptyHeadcount(), allergies: [], stock: [], prices: [], purchases: [], weeks: {}, weeklyBudget: 0 };
    state.houses.push(house);
    state.activeHouseId = house.id;
    render();
    try { setStatus('שומר…'); await api('saveHouse', { house: { id: house.id, name: house.name, weeklyBudget: 0 } }); setStatus('נשמר ✓'); }
    catch (err) { setStatus('שגיאת שמירה: ' + err.message); }
  });
  $('#logoutBtn').addEventListener('click', () => { setToken(''); location.reload(); });

  const screen = $('#screen');
  screen.addEventListener('input', onInput);
  screen.addEventListener('change', onChange);
  screen.addEventListener('click', onClick);
  // Tab buttons live in #tabs (outside #screen), so they need their own
  // delegated click handler — onClick routes data-tab buttons.
  $('#tabs').addEventListener('click', onClick);
}

/* ============================ login ============================ */
function showLogin() { const ov = $('#loginOverlay'); if (ov) { ov.hidden = false; const p = $('#loginPin'); if (p) { p.value = ''; setTimeout(() => p.focus(), 50); } } }
function hideLogin() { const ov = $('#loginOverlay'); if (ov) ov.hidden = true; }
function setLoginError(msg) { const el = $('#loginError'); if (el) { el.textContent = msg || ''; el.hidden = !msg; } }

async function submitLogin() {
  const pin = ($('#loginPin').value || '').trim();
  const btn = $('#loginBtn');
  if (!pin) { setLoginError('נא להזין קוד'); return; }
  setLoginError(''); btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ pin }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.token) { setLoginError(data.error || 'קוד שגוי'); return; }
    setToken(data.token);
    hideLogin();
    await start();
  } catch { setLoginError('שגיאת רשת. נסו שוב.'); }
  finally { btn.disabled = false; }
}

/* ============================ boot ============================ */
/* A house URL is /h/<houseId>. When the page is opened there, we go straight
   into that house in cook scope — no login. The root URL / is the admin surface
   and stays behind the ADMIN_PIN login. */
function housePathId() {
  const m = /^\/h\/([^/]+)\/?$/.exec(location.pathname);
  return m ? decodeURIComponent(m[1]) : '';
}

async function start() {
  try {
    if (state.role === 'cook') {
      // House came from the URL path; the server pins it. No token, no login.
      state.tab = state.tab === 'admin' ? 'menu' : state.tab;
    } else {
      // Admin: role + (no) house come from the signed token, set at login.
      const claims = decodeToken(getToken());
      if (!claims || claims.role !== 'admin') { setToken(''); showLogin(); return; }
      state.role = 'admin';
      state.myHouseId = '';
    }
    setStatus('טוען נתונים…');
    await loadState();
    setStatus('');
    render();
  } catch (err) {
    if (String(err.message).includes('התחברות')) return; // login shown
    setStatus('שגיאה בטעינה: ' + err.message);
    render();
  }
}

function boot() {
  wireChrome();
  $('#loginBtn').addEventListener('click', submitLogin);
  $('#loginPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); });

  const houseId = housePathId();
  if (houseId) {
    // Cook: dedicated house URL — locked to this one house, no login.
    state.role = 'cook';
    state.myHouseId = houseId;
    start();
  } else {
    // Admin surface at the root URL — needs the ADMIN_PIN session token.
    state.role = 'admin';
    if (getToken()) start(); else showLogin();
  }
}

document.addEventListener('DOMContentLoaded', boot);
