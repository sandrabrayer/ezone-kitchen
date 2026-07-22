'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const KD = require('../lib/kitchen-domain');

const APP_PATH = path.join(__dirname, '..', 'public', 'app.js');
const appSrc = fs.readFileSync(APP_PATH, 'utf8');

/* Page-load regression: execute public/app.js inside a DOM-less sandbox (a
   lightweight stand-in for jsdom — the app only needs `window.KitchenDomain`
   and a `document.addEventListener` at load time; nothing hits the network
   unless DOMContentLoaded fires). This proves the module still EVALUATES and
   that the render functions produce the new מדריכים sub-row / input — a much
   stronger guard than string matching alone. */
function loadApp() {
  const domListeners = {};
  const document = {
    addEventListener: (ev, fn) => { domListeners[ev] = fn; },
    getElementById: () => null,
    querySelector: () => null,
  };
  const window = { KitchenDomain: KD };
  window.document = document;
  const sandbox = { window, document, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
  sandbox.__domListeners = domListeners;
  // `state` is a top-level `const`, so it is a lexical binding, NOT a property
  // of the context object — reach the real object by evaluating it in-context,
  // then mutate that reference so the render closures see the changes.
  sandbox.state = vm.runInContext('state', sandbox);
  return sandbox;
}

function houseWith(instructorsBudget, workers) {
  return {
    id: 'ramot-hashavim', name: 'רמות השבים',
    headcount: { basePatients: 10, baseStaff: 5, overrides: {} },
    purchases: [], parOverrides: {},
    budgets: { '2026-07': { budget: 228109, overrun: 0, overrunNote: '', instructorsBudget } },
    workers: workers || [],
  };
}

test('app.js evaluates in a DOM-less sandbox and registers its boot handler', () => {
  const app = loadApp();
  assert.equal(typeof app.renderAdmin, 'function');
  assert.equal(typeof app.renderBudget, 'function');
  assert.equal(typeof app.__domListeners.DOMContentLoaded, 'function', 'boot wired on DOMContentLoaded');
});

test('budget-vs-cost table renders a מדריכים sub-row for a house with an instructors budget', () => {
  const app = loadApp();
  app.state.currentMonth = '2026-07';
  app.state.catalog = [];
  app.state.houses = [houseWith(72744, [])];
  const html = app.renderAdmin();
  assert.match(html, /subrow instructors/, 'sub-row present');
  assert.match(html, /מדריכים/, 'sub-row labelled מדריכים');
  assert.match(html, /ניצול 100%/, 'utilisation shown (100% against the fallback estimate)');
  assert.match(html, /אומדן/, 'estimate badge shown when there is no worker actual');
});

test('a house with NO instructors budget gets no sub-row', () => {
  const app = loadApp();
  app.state.currentMonth = '2026-07';
  app.state.catalog = [];
  app.state.houses = [houseWith(0, [])];
  const html = app.renderAdmin();
  assert.ok(!/subrow instructors/.test(html), 'no sub-row without an instructors budget');
});

test('recorded מדריך actuals drop the אומדן badge and use the real cost', () => {
  const app = loadApp();
  app.state.currentMonth = '2026-07';
  app.state.catalog = [];
  app.state.houses = [houseWith(72744, [
    { role: 'מדריך', cost: 30000, actuals: { '2026-07': 31000 } },
    { role: 'מדריך', cost: 30000, actuals: { '2026-07': 29000 } },
  ])];
  const html = app.renderAdmin();
  assert.match(html, /₪60,000\.00/, 'sums the recorded monthly actuals (31000 + 29000)');
  assert.ok(!/אומדן/.test(html), 'no estimate badge when actuals exist');
});

test('the עריכת תקציב editor exposes a תקציב מדריכים input', () => {
  const app = loadApp();
  app.state.currentMonth = '2026-07';
  app.state.catalog = [];
  const html = app.renderBudget(houseWith(72744, []));
  assert.match(html, /תקציב מדריכים/, 'second budget input labelled');
  assert.match(html, /data-act="instructorsBudgetAmount"/, 'input wired to its handler');
});

/* Static wiring guards (same approach as frontend-shape.test.js) so the pieces
   the sandbox can't reach (event wiring, the live warning) can't silently drop. */
test('split-budget wiring is present in app.js', () => {
  assert.match(appSrc, /case 'instructorsBudgetAmount'/, 'onInput handles the instructors input');
  assert.match(appSrc, /function instructorSubRow/, 'sub-row renderer exists');
  assert.match(appSrc, /KD\.instructorCostForMonth\(house\.workers, month, iBudget\)/, 'cost from מדריך workers with budget fallback');
  assert.match(appSrc, /function updateInstructorsWarn/, 'live over-total warning helper');
  assert.match(appSrc, /instructorsWarn/, 'warning element id used');
});

test('Code.gs stores the instructorsBudget column and validates it', () => {
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.match(gs, /monthlyBudgets:\s*\[[^\]]*'instructorsBudget'[^\]]*\]/, 'monthlyBudgets tab gains instructorsBudget');
  assert.match(gs, /function nonNeg_/, 'non-negative clamp helper');
  assert.match(gs, /instructors_over_total/, 'instructors-over-total warning in saveBudget_');
});
