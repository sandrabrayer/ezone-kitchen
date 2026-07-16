'use strict';
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://example.invalid/exec';
process.env.ADMIN_PIN = '4321';
process.env.COOK_PINS = JSON.stringify({ '1234': 'house_alpha' });
process.env.SESSION_SECRET = 'k'.repeat(32);

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, _loginAttempts } = require('../server');
const { signToken } = require('../lib/auth');

function request(server, method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1', port, method, path,
        headers: Object.assign(
          data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
          headers || {},
        ),
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, text: buf }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('server auth', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  await t.test('/healthz is open', async () => {
    const r = await request(server, 'GET', '/healthz');
    assert.equal(r.status, 200);
  });

  await t.test('the shared domain module is served, but lib/auth.js is NOT', async () => {
    const ok = await request(server, 'GET', '/lib/kitchen-domain.js');
    assert.equal(ok.status, 200);
    assert.match(ok.text, /KitchenDomain/);
    const blocked = await request(server, 'GET', '/lib/auth.js');
    // Never the auth source, whatever the fallback does (SPA index or 404).
    assert.doesNotMatch(blocked.text, /createHmac/);
    assert.doesNotMatch(blocked.text, /SESSION_SECRET/);
  });

  await t.test('/api/sheets without token → 401', async () => {
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' } });
    assert.equal(r.status, 401);
  });

  await t.test('/api/sheets with garbage token → 401', async () => {
    const r = await request(server, 'POST', '/api/sheets', {
      body: { action: 'load' },
      headers: { Authorization: 'Bearer nope.deadbeef' },
    });
    assert.equal(r.status, 401);
  });

  await t.test('login with unknown PIN → 401', async () => {
    _loginAttempts.clear();
    const r = await request(server, 'POST', '/api/login', { body: { pin: '0000' } });
    assert.equal(r.status, 401);
  });

  await t.test('ADMIN_PIN → admin token (all houses, no house bound)', async () => {
    _loginAttempts.clear();
    const login = await request(server, 'POST', '/api/login', { body: { pin: '4321' } });
    assert.equal(login.status, 200);
    const data = JSON.parse(login.text);
    assert.equal(data.role, 'admin');
    assert.equal(data.houseId, '');
    assert.ok(data.token);
  });

  await t.test('a cook PIN → cook token bound to its house; token authorises /api/sheets', async () => {
    _loginAttempts.clear();
    const login = await request(server, 'POST', '/api/login', { body: { pin: '1234' } });
    assert.equal(login.status, 200);
    const data = JSON.parse(login.text);
    assert.equal(data.role, 'cook');
    assert.equal(data.houseId, 'house_alpha');
    assert.ok(data.token);
    // With a valid token the request passes auth and reaches the proxy, which
    // fails to reach the invalid upstream → 502 (NOT 401). That proves the
    // gate opened.
    const r = await request(server, 'POST', '/api/sheets', {
      body: { action: 'load' },
      headers: { Authorization: `Bearer ${data.token}` },
    });
    assert.equal(r.status, 502);
  });

  await t.test('login is rate-limited after too many attempts', async () => {
    _loginAttempts.clear();
    let last = 200;
    for (let i = 0; i < 10; i++) {
      last = (await request(server, 'POST', '/api/login', { body: { pin: '0000' } })).status;
    }
    assert.equal(last, 429);
  });

  await t.test('a directly-minted valid token also authorises', async () => {
    const token = signToken(process.env.SESSION_SECRET, { role: 'admin', houseId: '' }, 1);
    const r = await request(server, 'POST', '/api/sheets', {
      body: { action: 'load' },
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 502); // passed auth, upstream unreachable
  });

  await t.test('unknown /api route → 404', async () => {
    const r = await request(server, 'GET', '/api/nope');
    assert.equal(r.status, 404);
  });
});
