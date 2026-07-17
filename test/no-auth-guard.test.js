'use strict';
/*
 * SECURITY REGRESSION for the URL-based access model:
 *   - The admin all-houses endpoint (/api/sheets) must reject every request —
 *     read AND write — with 401 when there is no valid admin token. This is the
 *     ONLY way to reach all houses at once, so it stays behind the login.
 *   - A house URL (/h/<houseId>/api/sheets) needs NO login, but must return ONLY
 *     that house's data; another house's data must never be reachable from it.
 * A mock upstream that returns 200 with multiple houses lets us distinguish
 * "auth rejected" (401) from a leak (200 with foreign data).
 */
process.env.NODE_ENV = 'test';
process.env.ADMIN_PIN = 'RAMOT';
process.env.SESSION_SECRET = 'k'.repeat(32);
process.env.APPS_SCRIPT_SECRET = 'shh';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function request(server, method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path,
        headers: Object.assign(
          data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
          headers || {}) },
      (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, text: b })); },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('admin endpoint stays behind login; a house URL reaches only its own house', async (t) => {
  // Mock upstream returning TWO houses, so a scoping bug shows up as foreign
  // data in the response rather than being masked.
  const upstream = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, houses: [
        { id: 'ramot-hashavim', name: 'רמות השבים' },
        { id: 'pardes', name: 'פרדס' },
      ] }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await new Promise((r) => upstream.once('listening', r));
  t.after(() => upstream.close());
  process.env.APPS_SCRIPT_URL = `http://127.0.0.1:${upstream.address().port}/exec`;

  const { app } = require('../server');
  const { signToken } = require('../lib/auth');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  await t.test('admin: no token → load is 401 (not 200 with all houses)', async () => {
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' } });
    assert.equal(r.status, 401);
  });

  await t.test('admin: no token → write (saveStock) is 401', async () => {
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'saveStock', houseId: 'ramot-hashavim', stock: [] } });
    assert.equal(r.status, 401);
  });

  await t.test('admin: garbage / forged token → 401', async () => {
    for (const bad of ['Bearer nope', 'Bearer a.b', 'Bearer .', 'Bearer ' + 'x'.repeat(64)]) {
      const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' }, headers: { Authorization: bad } });
      assert.equal(r.status, 401);
    }
  });

  await t.test('house URL: no login → 200 with ONLY that house', async () => {
    const r = await request(server, 'POST', '/h/ramot-hashavim/api/sheets', { body: { action: 'load' } });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.houses.length, 1);
    assert.equal(data.houses[0].id, 'ramot-hashavim');
    // Another house's data must not be reachable from this URL.
    assert.doesNotMatch(r.text, /pardes/);
    assert.doesNotMatch(r.text, /פרדס/);
  });

  await t.test('house URL write is pinned to the URL house', async () => {
    const r = await request(server, 'POST', '/h/ramot-hashavim/api/sheets', {
      body: { action: 'saveStock', houseId: 'pardes', stock: [] },
    });
    assert.equal(r.status, 200); // accepted, but pinned upstream (see cook-scope test)
  });

  await t.test('a valid admin token DOES reach the upstream (proves the mock would leak if auth were bypassed)', async () => {
    const token = signToken(process.env.SESSION_SECRET, { role: 'admin', houseId: '' }, 1);
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' }, headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.match(r.text, /ramot-hashavim/);
    assert.match(r.text, /pardes/); // admin sees all houses
  });
});
