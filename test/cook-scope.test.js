'use strict';
/*
 * Proves the server-side "own house only" enforcement for cooks against a mock
 * Apps Script upstream. Cooks DON'T log in: the house comes from the URL path
 * (POST /h/<houseId>/api/sheets). A cook's `load` is filtered to that house, and
 * a cook's writes are pinned to that house id — a hand-crafted request naming
 * another house can neither read nor write it. Admin requests (Bearer token on
 * /api/sheets) are untouched.
 */
process.env.NODE_ENV = 'test';
process.env.ADMIN_PIN = '4321';
process.env.SESSION_SECRET = 'k'.repeat(32);
process.env.APPS_SCRIPT_SECRET = 'shh-server-only';
// APPS_SCRIPT_URL is set to the mock's address before requiring ../server.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

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

test('cook scoping is enforced server-side from the URL path', async (t) => {
  // ---- mock Apps Script upstream ----
  let lastBody = null;
  const upstream = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      lastBody = JSON.parse(buf || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (lastBody.action === 'load') {
        res.end(JSON.stringify({
          ok: true,
          houses: [
            { id: 'house_alpha', name: 'Alpha' },
            { id: 'house_beta', name: 'Beta' },
          ],
        }));
      } else {
        res.end(JSON.stringify({ ok: true, received: lastBody }));
      }
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

  const admin = signToken(process.env.SESSION_SECRET, { role: 'admin', houseId: '' }, 1);

  await t.test('cook load (house URL, no token) is filtered to their own house', async () => {
    const r = await request(server, 'POST', '/h/house_alpha/api/sheets', {
      body: { action: 'load' },
    });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.houses.length, 1);
    assert.equal(data.houses[0].id, 'house_alpha');
  });

  await t.test("another house's data is NOT reachable from a house URL", async () => {
    const r = await request(server, 'POST', '/h/house_alpha/api/sheets', {
      body: { action: 'load' },
    });
    assert.doesNotMatch(r.text, /house_beta/);
    assert.doesNotMatch(r.text, /Beta/);
  });

  await t.test('admin load (Bearer token) sees every house', async () => {
    const r = await request(server, 'POST', '/api/sheets', {
      body: { action: 'load' },
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.houses.length, 2);
  });

  await t.test('cook write to another house is rewritten to their own house', async () => {
    await request(server, 'POST', '/h/house_alpha/api/sheets', {
      body: { action: 'saveStock', houseId: 'house_beta', stock: [{ id: 's1', name: 'x' }] },
    });
    assert.equal(lastBody.houseId, 'house_alpha'); // pinned, not house_beta
    assert.equal(lastBody.secret, 'shh-server-only'); // server injected the shared secret
  });

  await t.test('cook saveHouse cannot target another house id (only their own)', async () => {
    await request(server, 'POST', '/h/house_alpha/api/sheets', {
      body: { action: 'saveHouse', house: { id: 'house_beta', name: 'hijack', weeklyBudget: 9 } },
    });
    assert.equal(lastBody.house.id, 'house_alpha'); // id pinned
    assert.equal(lastBody.house.name, 'hijack');    // other fields pass through
  });

  await t.test('the house URL pins the house it names, not another', async () => {
    // The house comes from the PATH, so the beta URL touches only beta.
    await request(server, 'POST', '/h/house_beta/api/sheets', {
      body: { action: 'saveStock', houseId: 'house_alpha', stock: [] },
    });
    assert.equal(lastBody.houseId, 'house_beta');
  });

  await t.test('admin writes are NOT rewritten', async () => {
    await request(server, 'POST', '/api/sheets', {
      body: { action: 'saveStock', houseId: 'house_beta', stock: [] },
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(lastBody.houseId, 'house_beta');
  });
});
