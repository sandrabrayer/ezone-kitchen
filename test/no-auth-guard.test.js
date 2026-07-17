'use strict';
/*
 * SECURITY REGRESSION: every /api/sheets request — read AND write — must be
 * rejected with 401 when there is no valid session token. A mock upstream that
 * returns 200 lets us distinguish "auth rejected" (401) from "auth passed but
 * upstream failed" (would be 200/502), so a bypass cannot hide behind a 502.
 */
process.env.NODE_ENV = 'test';
process.env.ADMIN_PIN = 'RAMOT';
process.env.COOK_PINS = '{}';
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

test('/api/sheets rejects unauthenticated read AND write', async (t) => {
  // Mock upstream that would happily return data IF a request ever reached it
  // without auth — so a bypass shows up as 200, not a masking 502.
  const upstream = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, houses: [{ id: 'ramot-hashavim', name: 'רמות השבים' }] })); });
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

  await t.test('no token → load is 401 (not 200 with data)', async () => {
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' } });
    assert.equal(r.status, 401);
  });

  await t.test('no token → write (saveStock) is 401', async () => {
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'saveStock', houseId: 'ramot-hashavim', stock: [] } });
    assert.equal(r.status, 401);
  });

  await t.test('no token → saveHouse write is 401', async () => {
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'saveHouse', house: { id: 'x', name: 'hijack' } } });
    assert.equal(r.status, 401);
  });

  await t.test('garbage / forged token → 401', async () => {
    for (const bad of ['Bearer nope', 'Bearer a.b', 'Bearer .', 'Bearer ' + 'x'.repeat(64)]) {
      const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' }, headers: { Authorization: bad } });
      assert.equal(r.status, 401);
    }
  });

  await t.test('a valid token DOES reach the upstream (proves the mock would leak if auth were bypassed)', async () => {
    const token = signToken(process.env.SESSION_SECRET, { role: 'admin', houseId: '' }, 1);
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' }, headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.match(r.text, /ramot-hashavim/);
  });
});
