#!/usr/bin/env node
'use strict';
/*
 * scripts/seed_budgets.js — seed each house's split monthly budget: the TOTAL
 * food budget plus a separate מדריכים (instructors) budget.
 *
 * The figures below are the agreed opening budgets. Houses not listed (פרדס,
 * שדה אליעזר, מטה) have no seeded budget and are skipped.
 *
 * Talks to the SAME Google Apps Script the server proxies to, using the shared
 * secret. It NEVER writes unless you pass --apply: the default is a DRY RUN that
 * prints exactly what would be sent, so it is safe to run first.
 *
 *   Dry run (default):  node scripts/seed_budgets.js
 *   Apply:              node scripts/seed_budgets.js --apply
 *   Pick a month:       node scripts/seed_budgets.js --month=2026-07 --apply
 *
 * Config (env or flags):
 *   APPS_SCRIPT_URL     the /exec URL   (or --url=…)
 *   APPS_SCRIPT_SECRET  the shared secret (or --secret=…)
 *
 * On --apply the script first LOADS current data and preserves each month's
 * approved overrun / note, so seeding a budget never wipes an existing חריגה
 * מאושרת. Amounts are validated non-negative via the shared domain module; an
 * instructors budget above the total is reported as a warning, not an error.
 */
const KD = require('../lib/kitchen-domain');

// houseId → { total, instructors }. Only the four funded houses are seeded;
// pardes / sde_eliezer / hq have no instructor budget and are intentionally absent.
const SEED = [
  { houseId: 'ramot-hashavim', label: 'רמות השבים', total: 228109, instructors: 72744 },
  { houseId: 'raanana-asher', label: 'רעננה אשר', total: 190476, instructors: 60620 },
  { houseId: 'caesarea-ofroni', label: 'קיסריה עפרוני', total: 186779, instructors: 60620 },
  { houseId: 'caesarea-rehab', label: 'קיסריה ריהאב', total: 166430, instructors: 60620 },
];

function cleanEnv(v) {
  let s = String(v == null ? '' : v).trim();
  if (s.length >= 2) {
    const q = s[0];
    if ((q === '"' || q === "'") && s[s.length - 1] === q) s = s.slice(1, -1).trim();
  }
  return s;
}

function parseArgs(argv) {
  const out = { apply: false, month: '', url: '', secret: '', help: false };
  for (const a of argv) {
    if (a === '--apply' || a === '--commit') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--month=')) out.month = a.slice('--month='.length).trim();
    else if (a.startsWith('--url=')) out.url = a.slice('--url='.length).trim();
    else if (a.startsWith('--secret=')) out.secret = a.slice('--secret='.length).trim();
  }
  return out;
}

function usage() {
  console.log([
    'Seed split house budgets (total + instructors).',
    '',
    'Usage: node scripts/seed_budgets.js [--apply] [--month=YYYY-MM]',
    '',
    '  --apply           actually write (default is a dry run that only prints)',
    '  --month=YYYY-MM   month to seed (default: current month)',
    '  --url=…           Apps Script /exec URL (default: $APPS_SCRIPT_URL)',
    '  --secret=…        shared secret (default: $APPS_SCRIPT_SECRET)',
  ].join('\n'));
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('non-JSON response: ' + text.slice(0, 200)); }
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
  }
  return data;
}

// Existing per-month budget records keyed houseId → { [month]: record }, so a
// seed can preserve an approved overrun the cooks already entered.
async function loadExisting(url, secret) {
  const data = await post(url, { action: 'load', secret });
  const byHouse = {};
  (data.houses || []).forEach((h) => { byHouse[String(h.id)] = (h.budgets || {}); });
  return byHouse;
}

function fmt(n) { return '₪' + Number(n).toLocaleString('en-US'); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  const month = args.month || KD.monthKey(new Date());
  if (!/^\d{4}-\d{2}$/.test(month)) {
    console.error('[error] --month must be YYYY-MM, got: ' + month);
    process.exit(1);
  }

  const url = cleanEnv(args.url || process.env.APPS_SCRIPT_URL);
  const secret = cleanEnv(args.secret || process.env.APPS_SCRIPT_SECRET);

  console.log(`\nSeed split budgets — month ${month} — ${args.apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  // Validate & report every planned write up front (shared domain validation).
  const plans = SEED.map((s) => {
    const v = KD.validateBudgetInput({ budget: s.total, instructorsBudget: s.instructors });
    return { seed: s, value: v.value, warnings: v.warnings };
  });

  for (const p of plans) {
    const warn = p.warnings.length ? '  ⚠ ' + p.warnings.join(', ') : '';
    console.log(`  ${p.seed.houseId.padEnd(18)} ${p.seed.label.padEnd(14)} total ${fmt(p.value.budget).padStart(12)}   instructors ${fmt(p.value.instructorsBudget).padStart(10)}${warn}`);
  }
  console.log('');

  if (!args.apply) {
    console.log('Dry run only. Re-run with --apply to write these budgets.\n');
    return;
  }

  if (!url || !secret) {
    console.error('[error] APPS_SCRIPT_URL and APPS_SCRIPT_SECRET are required to --apply (or pass --url / --secret).');
    process.exit(1);
  }

  let existing = {};
  try {
    existing = await loadExisting(url, secret);
  } catch (err) {
    console.error('[error] could not load current data: ' + err.message);
    process.exit(1);
  }

  let ok = 0;
  for (const p of plans) {
    const prev = (existing[p.seed.houseId] || {})[month] || {};
    const budget = {
      budget: p.value.budget,
      instructorsBudget: p.value.instructorsBudget,
      overrun: KD.nonNegativeAmount(prev.overrun),          // preserve an approved overrun
      overrunNote: String(prev.overrunNote || ''),
    };
    try {
      const res = await post(url, { action: 'saveBudget', houseId: p.seed.houseId, month, budget, secret });
      const warn = res && res.warnings && res.warnings.length ? '  ⚠ ' + res.warnings.join(', ') : '';
      console.log(`  ✓ ${p.seed.houseId} saved${warn}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${p.seed.houseId} failed: ${err.message}`);
    }
  }
  console.log(`\nDone: ${ok}/${plans.length} houses seeded for ${month}.\n`);
  if (ok !== plans.length) process.exit(1);
}

main().catch((err) => { console.error('[fatal] ' + (err && err.message || err)); process.exit(1); });
