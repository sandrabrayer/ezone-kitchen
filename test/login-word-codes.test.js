'use strict';
/*
 * The ADMIN login code is a WORD, matched case-insensitively with surrounding
 * whitespace ignored. `ramot`, `RAMOT`, ` Ramot ` all authenticate against a
 * stored `RAMOT`. (Cooks no longer log in — they use a house URL — so ADMIN_PIN
 * is the only login code.)
 */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://example.invalid/exec';
process.env.APPS_SCRIPT_SECRET = 'shh';
process.env.ADMIN_PIN = 'RAMOT';
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
    await t.test(`a non-admin word "${variant.trim()}" is rejected (no cook login)`, async () => {
      const r = await fresh(variant);
      assert.equal(r.status, 401);
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
