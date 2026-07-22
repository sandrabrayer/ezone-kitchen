'use strict';
/*
 * End-to-end browser smoke test for the cooks' menu app (מלאי / ספירה / קניות).
 *
 * Not part of `node --test` (CI runs only test/*.js): it needs a real browser.
 * Run locally with Chromium available:
 *
 *   npm i --no-save playwright-core
 *   CHROME=/path/to/chrome node scripts/smoke-browser.cjs
 *
 * It boots an in-memory stub of the Apps Script backend (so no Google/Sheets
 * dependency), serves the real public/ + lib/ assets, drives Chromium through
 * the full compare flow, and asserts the outcomes from the task's step 7:
 *   • seeded stock row names render INSIDE their input (bug #1)
 *   • empty qty box shows the "0" placeholder (#4)
 *   • min=15 + qty=3  →  קניות shows 12 to buy (par top-up)
 *   • menu need beyond stock  →  max(menu shortfall, par) holds
 *   • count a new catalog item >0  →  it appears in stock, and persists a reload
 *   • an extra item persists per week across a reload
 */
const express = require('express');
const path = require('path');
const KD = require('../lib/kitchen-domain');

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.join(__dirname, '..');
const WEEK = KD.weekStart(new Date()); // the week the app opens on

/* ---- in-memory backend (mirrors the actions the frontend calls) ---- */
function makeDb() {
  return {
    houses: [{
      id: 'h1', name: 'בית בדיקה', monthlyBudget: 0, budgets: {},
      headcount: { basePatients: 20, baseStaff: 5, overrides: {} },
      allergies: [],
      // חלב: par 15, on-hand 3  → shortfall 12 with no menu demand.
      // בצים + ביצים both present → the load migration must merge them into ביצים.
      stock: [
        { id: 'stk_milk', name: 'חלב', category: 'groceries', qty: 3, unit: 'l', minQty: 15 },
        { id: 'stk_eggs_old', name: 'בצים', category: 'groceries', qty: 30, unit: 'unit', minQty: 0 },
        { id: 'stk_eggs', name: 'ביצים', category: 'groceries', qty: 10, unit: 'unit', minQty: 120 },
      ],
      purchases: [], consumption: [], stockCounts: [], shoppingExtras: {},
      // A menu that needs 20 l of חלב this week → buffered 24, shortfall 21 > par 12.
      weeks: {
        [WEEK]: {
          weekOf: WEEK,
          days: {
            sunday: { breakfast: [], lunch: [{ id: 'd1', name: 'מרק חלב', ingredients: [{ id: 'i1', name: 'חלב', category: 'groceries', qty: 20, unit: 'l' }] }], dinner: [] },
            monday: {}, tuesday: {}, wednesday: {}, thursday: {}, friday: {}, saturday: {},
          },
        },
      },
    }],
    catalog: [],
  };
}

function startServer() {
  const db = makeDb();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/api/sheets', (req, res) => {
    const b = req.body || {};
    const h = db.houses.find((x) => x.id === b.houseId);
    switch (b.action) {
      case 'load': return res.json({ ok: true, houses: db.houses, catalog: db.catalog });
      case 'saveStock': if (h) h.stock = b.stock; return res.json({ ok: true });
      case 'saveCatalog': db.catalog = b.catalog; return res.json({ ok: true });
      case 'saveStockCount':
        if (h) h.stockCounts = (h.stockCounts || []).filter((c) => c.date !== b.count.date).concat(b.count);
        return res.json({ ok: true });
      case 'saveShoppingExtras':
        if (h) { h.shoppingExtras = h.shoppingExtras || {}; h.shoppingExtras[b.weekOf] = b.extras; }
        return res.json({ ok: true });
      case 'saveMenu': if (h) { h.weeks = h.weeks || {}; h.weeks[b.weekOf] = { weekOf: b.weekOf, days: b.days }; } return res.json({ ok: true });
      case 'saveParOverrides': if (h) h.parOverrides = b.overrides; return res.json({ ok: true });
      default: return res.json({ ok: true });
    }
  });
  app.get('/lib/kitchen-domain.js', (_q, r) => r.type('application/javascript').sendFile(path.join(ROOT, 'lib', 'kitchen-domain.js')));
  app.use(express.static(path.join(ROOT, 'public')));
  app.get('*', (_q, r) => r.sendFile(path.join(ROOT, 'public', 'index.html')));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port, db }));
  });
}

/* ---- tiny assert helpers ---- */
let passed = 0;
function ok(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); passed++; console.log('  ✓ ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, msg, timeout) {
  const end = Date.now() + (timeout || 5000);
  while (Date.now() < end) { if (fn()) return; await sleep(100); }
  throw new Error('TIMEOUT waiting for backend: ' + msg);
}

async function main() {
  const { chromium } = require('playwright-core');
  const { server, port, db } = await startServer();
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const base = 'http://localhost:' + port + '/';

  // Effective par helpers (meal model): par scales by weekFactor × baseTotal
  // (self-serve evenings + weekend -25%), NOT the raw head count.
  const SEEDCAT = KD.seedCatalog([]);
  const effP = (p, s) => KD.effectivePeople({ basePatients: p, baseStaff: s });
  const parOf = (name, p, s) => String(KD.effectiveParFor(SEEDCAT, name, effP(p, s), {}).qty);

  try {
    await page.goto(base);
    await page.waitForFunction(() => window.KitchenDomain && document.querySelector('#tabs button'));

    /* ---- STOCK TAB: bug #1 (name inside input) + #4 (0 placeholder) ---- */
    await page.click('[data-tab="stock"]');
    await page.waitForSelector('input[data-act="stkName"]');
    const milk = await page.$eval('input[data-act="stkName"]', (el) => ({ value: el.value, list: el.getAttribute('list') }));
    ok(milk.value === 'חלב', 'seeded row name renders INSIDE its input (value="חלב")');
    ok(/^catCombo_/.test(milk.list || ''), 'row name is a category-scoped combobox (' + milk.list + ')');
    const qtyPlaceholder = await page.$eval('input[data-act="stkQty"]', (el) => el.getAttribute('placeholder'));
    ok(qtyPlaceholder === '0', 'empty qty box shows the "0" placeholder');
    const addPlaceholder = await page.$eval('#stkAddName', (el) => el.getAttribute('placeholder'));
    ok(/שלא ברשימה/.test(addPlaceholder), 'bottom add-row placeholder = free-text "not in list"');

    /* ---- EGGS MERGE migration: בצים folded into ביצים on load ---- */
    const eggs = await page.evaluate(() => {
      const names = [...document.querySelectorAll('input[data-act="stkName"]')].map((el) => el.value);
      const row = [...document.querySelectorAll('#screen table tbody tr')]
        .find((tr) => { const n = tr.querySelector('input[data-act="stkName"]'); return n && n.value === 'ביצים'; });
      return { names, eggsQty: row ? row.querySelector('input[data-act="stkQty"]').value : null };
    });
    ok(!eggs.names.includes('בצים'), 'the בצים duplicate is gone after the load migration');
    ok(eggs.eggsQty === '40', 'בצים qty merged into ביצים (30 + 10 = 40): ' + eggs.eggsQty);

    /* ---- 3-step flow hint on the stock tab ---- */
    ok(!!(await page.$('.flow-hint')), 'the 3-step flow hint is shown on the stock tab');

    /* ---- REGRESSION: par top-up covers the FULL catalog, not just stock rows.
       Stock here holds only a couple of items; on an empty-menu week every
       catalog item with a par should appear in "השלמה למלאי מינימום". ---- */
    await page.click('[data-tab="menu"]');
    await page.click('[data-act="weekNext"]'); // a week with no menu
    await page.click('[data-tab="plan"]');
    await page.waitForSelector('#screen');
    const parInfo = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#screen .card')]
        .find((c) => /השלמה למלאי מינימום/.test(c.textContent));
      if (!card) return { present: false };
      const names = [...card.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent.trim());
      return { present: true, rows: names.length, hasUnstocked: names.includes('אורז') && names.includes('סוכר') };
    });
    ok(parInfo.present, 'the par top-up section renders on an empty-menu week');
    ok(parInfo.rows > 50, 'par top-up lists the FULL catalog (' + parInfo.rows + ' rows), not just the ~2 stock items');
    ok(parInfo.hasUnstocked, 'catalog items with a par but NOT in stock (אורז, סוכר) appear with a shortfall');
    await page.click('[data-tab="menu"]');
    await page.click('[data-act="weekPrev"]'); // back to the current week

    /* ---- SHOPPING: max(menu shortfall 21, par top-up 12) = 21 ---- */
    await page.click('[data-tab="shopping"]');
    await page.waitForSelector('.shop-list, .empty');
    const milkBuy = await page.evaluate(() => {
      const item = [...document.querySelectorAll('.shop-item')].find((li) => /חלב/.test(li.textContent));
      return item ? item.querySelector('.shop-qty').textContent.trim() : null;
    });
    ok(milkBuy && /21/.test(milkBuy), 'menu need beyond stock → max logic holds (buy 21 ל, not 12): ' + milkBuy);

    /* ---- Pure par top-up: a week with NO menu → effective par − 3 to buy ---- */
    await page.click('[data-tab="menu"]');
    await page.click('[data-act="weekNext"]'); // an empty week (no menu demand)
    await page.click('[data-tab="shopping"]');
    await page.waitForSelector('.shop-list, .empty');
    const milkPar = await page.evaluate(() => {
      const item = [...document.querySelectorAll('.shop-item')].find((li) => /חלב/.test(li.textContent));
      return item ? item.querySelector('.shop-qty').textContent.trim() : null;
    });
    // effective par at 20+5 people minus 3 on hand.
    const milkBuyExpected = String(KD.roundQty(Number(parOf('חלב', 20, 5)) - 3));
    ok(milkPar && milkPar.includes(milkBuyExpected),
      'min (effective) + qty=3 (no menu) → קניות shows ' + milkBuyExpected + ' to buy: ' + milkPar);
    await page.click('[data-tab="menu"]');
    await page.click('[data-act="weekPrev"]'); // back to the current week
    await page.click('[data-tab="shopping"]');
    await page.waitForSelector('.shop-list, .empty');

    /* ---- SHOPPING extras: add + persist per week across reload ---- */
    await page.fill('#extraName', 'מפיות');
    await page.fill('#extraQty', '4');
    await page.click('[data-act="extraAdd"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.shop-name')].some((s) => s.textContent.includes('מפיות')));
    ok(true, 'extra item added to the list');
    // wait for the debounced save to flush to the backend before reloading
    await waitFor(() => (db.houses[0].shoppingExtras[WEEK] || []).some((e) => e.name === 'מפיות'), 'extra saved');
    // reload → still there (persisted per week in the backend)
    await page.reload();
    await page.waitForFunction(() => window.KitchenDomain && document.querySelector('#tabs button'));
    await page.click('[data-tab="shopping"]');
    await page.waitForSelector('.shop-list, .empty');
    const extraStill = await page.evaluate(() => [...document.querySelectorAll('.shop-name')].some((s) => s.textContent.includes('מפיות')));
    ok(extraStill, 'extra item persists per week across a reload');
    ok(!!(db.houses[0].shoppingExtras[WEEK] || []).find((e) => e.name === 'מפיות'), 'extra is stored in the backend for this week');

    /* ---- STOCK COUNT: count a NEW catalog item >0 → appears in stock ---- */
    await page.click('[data-tab="stock"]');
    await page.click('[data-act="countStart"]');
    await page.waitForSelector('input[data-act="countQty"]');
    // full catalog must be listed, not just the single in-stock item.
    const countRows = await page.$$eval('input[data-act="countQty"]', (els) => els.length);
    ok(countRows > 50, 'count lists the FULL catalog (' + countRows + ' rows), not just in-stock items');
    // Simplified count: no "חדש" (or any) badge in the count table.
    const countBadges = await page.$$eval('#screen .tag', (els) => els.length);
    ok(countBadges === 0, 'no "חדש"/other badges in the simplified count');
    // Count אורז (rice, dry) — not in stock yet — to 5.
    const riceKey = KD.catalogKey('אורז');
    const riceSel = 'input[data-act="countQty"][data-key="' + riceKey + '"]';
    await page.fill(riceSel, '5');
    await page.click('[data-act="countSave"]');
    await page.waitForSelector('[data-act="countStart"]'); // back to stock view
    // Switch to the dry category and confirm אורז=5 is now a stock row.
    await page.click('[data-act="stockCat"][data-cat="dry"]');
    await page.waitForSelector('input[data-act="stkName"]');
    const rice = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#screen table tbody tr')]
        .find((tr) => tr.querySelector('input[data-act="stkName"]') && tr.querySelector('input[data-act="stkName"]').value === 'אורז');
      if (!row) return null;
      return { name: row.querySelector('input[data-act="stkName"]').value, qty: row.querySelector('input[data-act="stkQty"]').value };
    });
    ok(rice && rice.qty === '5', 'a new catalog item counted >0 now appears in stock (אורז = 5)');
    await waitFor(() => !!db.houses[0].stock.find((s) => s.name === 'אורז' && s.qty === 5), 'stock count saved');
    ok(!!db.houses[0].stock.find((s) => s.name === 'אורז' && s.qty === 5), 'the counted item is persisted to the backend');

    /* ---- After a count, ALL items exist in stock incl 0-qty (+ unit fix) ---- */
    await page.click('[data-act="stockCat"][data-cat="groceries"]');
    await page.waitForSelector('input[data-act="stkName"]');
    const cheese = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#screen table tbody tr')]
        .find((tr) => { const n = tr.querySelector('input[data-act="stkName"]'); return n && n.value === 'גבינה צהובה'; });
      if (!row) return null;
      const u = row.querySelector('select[data-act="stkUnit"]');
      return { qty: row.querySelector('input[data-act="stkQty"]').value, unit: u ? u.value : null };
    });
    ok(cheese && (cheese.qty === '' || cheese.qty === '0'), 'a 0-qty catalog item is kept in stock after a count (גבינה צהובה)');
    ok(cheese && cheese.unit === 'g', 'unit correction applied: גבינה צהובה is in גרם (g)');

    /* ---- צפי plan tab: title, menu section, separate par section ---- */
    await page.click('[data-tab="plan"]');
    await page.waitForSelector('#screen');
    const planText = await page.evaluate(() => document.querySelector('#screen').textContent);
    ok(/השוואת תפריט מול מלאי/.test(planText), 'plan tab shows the new title');
    ok(/השלמה למלאי מינימום/.test(planText), 'plan shows the separate par top-up section');
    // Empty-menu week → friendly message instead of a table.
    await page.click('[data-tab="menu"]');
    await page.click('[data-act="weekNext"]');
    await page.click('[data-tab="plan"]');
    await page.waitForSelector('#screen');
    const planEmpty = await page.evaluate(() => document.querySelector('#screen').textContent);
    ok(/עדיין לא הוזן תפריט לשבוע זה/.test(planEmpty), 'empty-menu week shows the friendly message');

    /* ---- כמויות בסיס baseline tab (meal-model effective people, not raw 25) ---- */
    const milkKey = KD.catalogKey('חלב');
    const riceKey2 = KD.catalogKey('אורז');
    await page.click('[data-tab="baseline"]');
    await page.waitForSelector('.baseline-total');
    const bHead = await page.evaluate(() => document.querySelector('#screen').textContent);
    ok(/הכמות הבסיסית לבית לחודש — קובעת את התקציב/.test(bHead), 'baseline header present');
    ok(/ייחוס: 25/.test(bHead), 'reference-25 subtitle present');
    ok(/סועדים אפקטיביים/.test(bHead), 'effective-diners header present (meal model)');
    // Four-part summary: מזון X | אפייה A | חד"פ 15% Y | תקציב מומלץ Z.
    ok(/סה"כ מזון/.test(bHead) && /חד"פ \(15%\)/.test(bHead) && /סה"כ תקציב מומלץ/.test(bHead),
      'baseline summary shows מזון / אפייה / חד"פ / תקציב מומלץ');
    const milkParBase = await page.$eval(`input[data-act="parMin"][data-key="${milkKey}"]`, (el) => el.value);
    const milkParExpected = parOf('חלב', 20, 5); // 15 × effP/25 → 11.5
    ok(milkParBase === milkParExpected, 'חלב weekly par = effective ' + milkParExpected + ' at 20+5 people: ' + milkParBase);

    /* ---- count reference + qty picker ---- */
    await page.click('[data-tab="stock"]');
    await page.click('[data-act="countStart"]');
    await page.waitForSelector('input[data-act="countQty"]');
    ok(await page.evaluate(() => /מינימום:/.test(document.querySelector('#screen').textContent)), 'count screen shows the effective מינימום reference');
    const milkCountSel = `input[data-act="countQty"][data-key="${milkKey}"]`;
    await page.click(milkCountSel);
    await page.waitForSelector('.qty-picker-overlay');
    ok(true, 'tapping a count qty field opens the picker');
    await page.click('.qty-picker [data-picker-val="5"]');
    await page.waitForFunction(() => !document.querySelector('.qty-picker-overlay'));
    ok((await page.$eval(milkCountSel, (el) => el.value)) === '5', 'picking a value fills the qty field (חלב = 5)');
    await page.click('[data-act="countCancel"]');

    /* ---- תפוסה read-only meal line + live rescale on headcount change ---- */
    await page.click('[data-tab="headcount"]');
    const occ = await page.evaluate(() => document.querySelector('#mealOccupancy').textContent);
    ok(/בוקר\/צהריים:\s*25/.test(occ), 'תפוסה shows cooked-meal count 25');
    ok(/ערב עצמאי:\s*22/.test(occ), 'תפוסה shows self-serve evening count 22 (patients + 2)');
    await page.fill('input[data-act="baseP"]', '45'); // 45 patients + 5 staff = full 50
    await page.click('[data-tab="baseline"]');
    await page.waitForSelector('.baseline-total');
    const riceParExpected = parOf('אורז', 45, 5);
    ok((await page.$eval(`input[data-act="parMin"][data-key="${riceKey2}"]`, (el) => el.value)) === riceParExpected,
      'אורז par recomputes to effective ' + riceParExpected + ' at 45+5 people (auto on תפוסה change)');

    /* ---- override wins and is NOT rescaled; persists ---- */
    await page.fill(`input[data-act="parMin"][data-key="${milkKey}"]`, '12');
    await page.fill(`input[data-act="parPrice"][data-key="${milkKey}"]`, '5');
    await waitFor(() => {
      const ov = db.houses[0].parOverrides && db.houses[0].parOverrides[milkKey];
      return ov && Number(ov.min) === 12 && Number(ov.price) === 5;
    }, 'par override saved');
    ok(true, 'par + price override persists to the backend (absolute, not rescaled)');
    ok(await page.$eval(`input[data-act="parMin"][data-key="${milkKey}"]`, (el) => el.classList.contains('manual')),
      'an overridden field is highlighted as ידני');

    /* ---- reset overrides: per-row, stock-min, and bulk (house-scoped) ---- */
    page.on('dialog', (dlg) => dlg.accept()); // accept the bulk-reset confirm
    // per-row baseline reset → override cleared, par back to the effective default
    await page.click(`button[data-act="parReset"][data-key="${milkKey}"]`);
    await waitFor(() => !(db.houses[0].parOverrides && db.houses[0].parOverrides[milkKey]), 'per-row reset cleared the override');
    ok(true, 'per-row אפס לברירת מחדל clears the override');
    await page.waitForSelector('.baseline-total');
    const milkResetExpected = parOf('חלב', 45, 5);
    ok((await page.$eval(`input[data-act="parMin"][data-key="${milkKey}"]`, (el) => el.value)) === milkResetExpected,
      'reset row returns to the effective default (' + milkResetExpected + ' @ 45+5 people)');
    ok(!(await page.$eval(`input[data-act="parMin"][data-key="${milkKey}"]`, (el) => el.classList.contains('manual'))),
      'reset row loses the ידני highlight');

    // stock-min reset: set an override, then reset it from the מלאי tab
    await page.fill(`input[data-act="parMin"][data-key="${milkKey}"]`, '9');
    await waitFor(() => db.houses[0].parOverrides && db.houses[0].parOverrides[milkKey] && Number(db.houses[0].parOverrides[milkKey].min) === 9, 'min override set');
    await page.click('[data-tab="stock"]');
    await page.waitForSelector('input[data-act="stkName"]');
    ok(!!(await page.$(`button[data-act="stkResetMin"][data-key="${milkKey}"]`)), 'מלאי shows a reset for a manually-overridden min');
    await page.click(`button[data-act="stkResetMin"][data-key="${milkKey}"]`);
    await waitFor(() => !(db.houses[0].parOverrides && db.houses[0].parOverrides[milkKey]), 'stock-min reset cleared the override');
    ok(true, 'per-row מלאי reset clears the min override');

    // bulk reset: set two overrides, then clear all with confirm
    await page.click('[data-tab="baseline"]');
    await page.waitForSelector('.baseline-total');
    await page.fill(`input[data-act="parMin"][data-key="${milkKey}"]`, '8');
    await page.fill(`input[data-act="parMin"][data-key="${riceKey2}"]`, '7');
    await waitFor(() => db.houses[0].parOverrides && db.houses[0].parOverrides[milkKey] && db.houses[0].parOverrides[riceKey2], 'two overrides set');
    await page.click('button[data-act="parResetAll"]');
    await waitFor(() => !Object.keys(db.houses[0].parOverrides || {}).length, 'bulk reset cleared all overrides');
    ok(true, 'אפס הכל לברירת מחדל clears every override for the house');

    /* ---- menu: self-serve evenings show the note (except Friday) ---- */
    await page.click('[data-tab="menu"]');
    await page.waitForSelector('.week-grid');
    const menuText = await page.evaluate(() => document.querySelector('#screen').textContent);
    ok(/ערב עצמאי — מכוסה ממלאי הבסיס/.test(menuText), 'self-serve evenings show the pantry note');
    ok(/סועדים/.test(menuText), 'meal headers show the diner reference');

    /* ---- adopt the RECOMMENDED total (Z = מזון + חד"פ) as the monthly budget ---- */
    await page.click('[data-tab="budget"]');
    await page.waitForSelector('[data-act="adoptBaseline"]');
    // The "בסיס מחושב" figure shown is Z; adopt must copy exactly that.
    const recShown = await page.evaluate(() => {
      const m = document.querySelector('.baseline-adopt').textContent.match(/([\d,]+(?:\.\d+)?)/);
      return m ? parseFloat(m[1].replace(/,/g, '')) : 0;
    });
    ok(recShown > 0, 'budget tab shows the recommended total (מזון + חד"פ): ₪' + recShown);
    await page.click('[data-act="adoptBaseline"]');
    await page.waitForFunction(() => { const el = document.querySelector('input[data-act="budgetAmount"]'); return el && parseFloat(el.value.replace(/,/g, '')) > 0; });
    const budgetVal = parseFloat((await page.$eval('input[data-act="budgetAmount"]', (el) => el.value)).replace(/,/g, ''));
    ok(Math.abs(budgetVal - recShown) < 0.5, 'אמץ כתקציב copied the recommended total Z (₪' + budgetVal + ' = ₪' + recShown + ')');

    await page.screenshot({ path: path.join(ROOT, 'scripts', 'smoke-shot.png'), fullPage: true });
    ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors.join('; ') : ''));

    console.log('\nSMOKE OK — ' + passed + ' assertions passed.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('\nSMOKE FAILED:', err.message); process.exit(1); });
