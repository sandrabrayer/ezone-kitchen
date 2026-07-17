'use strict';
/*
 * Login codes are WORDS, matched case-insensitively with surrounding whitespace
 * ignored — for ADMIN_PIN and COOK_PINS alike. `ramot`, `RAMOT`, ` Ramot ` all
 * authenticate against a stored `RAMOT`.
 */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://example.invalid/exec';
process.env.APPS_SCRIPT_SECRET = 'shh';
process.env.ADMIN_PIN = 'RAMOT';
process.env.COOK_PINS = JSON.stringify({ Pardes: 'pardes' }); // word code -> house id
process.env.SESSION_SECRET = 'k'.repeat(32);

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, _loginAttempts } = require('../server');

function login(server, pin) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const data = JSON.stringify({ pin });
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/api/login',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : {} })); },
    );
    req.on('error', reject);
    req.write(data); req.end();
  });
}

test('word login codes are case-insensitive and trimmed', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const fresh = async (pin) => { _loginAttempts.clear(); return login(server, pin); };

  for (const variant of ['RAMOT', 'ramot', 'RaMoT', '  ramot  ', 'Ramot\n']) {
    await t.test(`admin code "${variant.trim()}" (as sent: ${JSON.stringify(variant)}) → admin`, async () => {
      const r = await fresh(variant);
      assert.equal(r.status, 200);
      assert.equal(r.body.role, 'admin');
    });
  }

  for (const variant of ['pardes', 'PARDES', ' Pardes ']) {
    await t.test(`cook code "${variant.trim()}" → cook bound to its house`, async () => {
      const r = await fresh(variant);
      assert.equal(r.status, 200);
      assert.equal(r.body.role, 'cook');
      assert.equal(r.body.houseId, 'pardes');
    });
  }

  await t.test('a wrong word is still rejected', async () => {
    const r = await fresh('caesarea');
    assert.equal(r.status, 401);
  });

  await t.test('empty code is rejected', async () => {
    const r = await fresh('   ');
    assert.equal(r.status, 401);
  });
});
