'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KD = require('../lib/kitchen-domain');

test('formatDateHe renders ISO YYYY-MM-DD as Israeli DD/MM/YYYY', () => {
  assert.equal(KD.formatDateHe('2026-07-12'), '12/07/2026');
  assert.equal(KD.formatDateHe('2026-01-05'), '05/01/2026');
  assert.equal(KD.formatDateHe('2026-12-31'), '31/12/2026');
});

test('formatDateHe keeps the zero-padding of day and month', () => {
  assert.equal(KD.formatDateHe('2026-03-09'), '09/03/2026');
});

test('formatDateHe trims surrounding whitespace before formatting', () => {
  assert.equal(KD.formatDateHe('  2026-07-12  '), '12/07/2026');
});

test('formatDateHe returns empty string for non-string input', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(KD.formatDateHe(bad), '');
  }
});

test('formatDateHe leaves empty and non-ISO values unchanged (never corrupts output)', () => {
  assert.equal(KD.formatDateHe(''), '');
  assert.equal(KD.formatDateHe('12/07/2026'), '12/07/2026'); // already formatted
  assert.equal(KD.formatDateHe('2026-7-12'), '2026-7-12');   // not zero-padded ISO
  assert.equal(KD.formatDateHe('not a date'), 'not a date');
});

test('formatDateHe is display-only — the ISO input is not mutated', () => {
  const iso = KD.toISODate(new Date(2026, 6, 12)); // '2026-07-12'
  const shown = KD.formatDateHe(iso);
  assert.equal(iso, '2026-07-12'); // still the storage/week-key format
  assert.equal(shown, '12/07/2026');
});
