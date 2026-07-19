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

    /* ---- SHOPPING: max(menu shortfall 21, par top-up 12) = 21 ---- */
    await page.click('[data-tab="shopping"]');
    await page.waitForSelector('.shop-list, .empty');
    const milkBuy = await page.evaluate(() => {
      const item = [...document.querySelectorAll('.shop-item')].find((li) => /חלב/.test(li.textContent));
      return item ? item.querySelector('.shop-qty').textContent.trim() : null;
    });
    ok(milkBuy && /21/.test(milkBuy), 'menu need beyond stock → max logic holds (buy 21 ל, not 12): ' + milkBuy);

    /* ---- Pure par top-up: a week with NO menu → 15 − 3 = 12 to buy ---- */
    await page.click('[data-tab="menu"]');
    await page.click('[data-act="weekNext"]'); // an empty week (no menu demand)
    await page.click('[data-tab="shopping"]');
    await page.waitForSelector('.shop-list, .empty');
    const milkPar = await page.evaluate(() => {
      const item = [...document.querySelectorAll('.shop-item')].find((li) => /חלב/.test(li.textContent));
      return item ? item.querySelector('.shop-qty').textContent.trim() : null;
    });
    ok(milkPar && /12/.test(milkPar), 'min=15 + qty=3 (no menu) → קניות shows 12 to buy: ' + milkPar);
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

    /* ---- כמויות בסיס baseline tab (house is 25 people → par = seed) ---- */
    const milkKey = KD.catalogKey('חלב');
    const riceKey2 = KD.catalogKey('אורז');
    await page.click('[data-tab="baseline"]');
    await page.waitForSelector('.baseline-total');
    const bHead = await page.evaluate(() => document.querySelector('#screen').textContent);
    ok(/הכמות הבסיסית לבית לחודש — קובעת את התקציב/.test(bHead), 'baseline header present');
    ok(/ייחוס: 25/.test(bHead), 'reference-25 subtitle present');
    const milkParBase = await page.$eval(`input[data-act="parMin"][data-key="${milkKey}"]`, (el) => el.value);
    ok(milkParBase === '15', 'חלב weekly par = seed 15 at 25 people: ' + milkParBase);
    const milkCost = await page.evaluate((k) => {
      const inp = document.querySelector(`input[data-act="parMin"][data-key="${k}"]`);
      const tr = inp && inp.closest('tr');
      return tr ? tr.querySelector('.par-cost').textContent.trim() : null;
    }, milkKey);
    ok(milkCost && /390/.test(milkCost), 'חלב monthly cost = 60 × 6.5 = ₪390: ' + milkCost);

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

    /* ---- scaling: bump תפוסה to 50 → אורז par doubles 10 → 20 ---- */
    await page.click('[data-tab="headcount"]');
    await page.fill('input[data-act="baseP"]', '45'); // 45 patients + 5 staff = 50
    await page.click('[data-tab="baseline"]');
    await page.waitForSelector('.baseline-total');
    ok((await page.$eval(`input[data-act="parMin"][data-key="${riceKey2}"]`, (el) => el.value)) === '20',
      'אורז par recomputes to 20 at 50 people (auto on תפוסה change)');

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

    /* ---- adopt the baseline as the monthly budget ---- */
    await page.click('[data-tab="budget"]');
    await page.waitForSelector('[data-act="adoptBaseline"]');
    ok(await page.evaluate(() => /בסיס מחושב/.test(document.querySelector('.baseline-adopt').textContent)), 'budget tab shows the computed baseline');
    await page.click('[data-act="adoptBaseline"]');
    await page.waitForFunction(() => { const el = document.querySelector('input[data-act="budgetAmount"]'); return el && parseFloat(el.value.replace(/,/g, '')) > 0; });
    const budgetVal = parseFloat((await page.$eval('input[data-act="budgetAmount"]', (el) => el.value)).replace(/,/g, ''));
    ok(budgetVal > 0, 'אמץ כתקציב copied the baseline into the monthly budget: ₪' + budgetVal);

    await page.screenshot({ path: path.join(ROOT, 'scripts', 'smoke-shot.png'), fullPage: true });
    ok(errors.length === 0, 'no uncaught page errors' + (errors.length ? ': ' + errors.join('; ') : ''));

    console.log('\nSMOKE OK — ' + passed + ' assertions passed.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('\nSMOKE FAILED:', err.message); process.exit(1); });
