'use strict';
/*
 * Proves the server-side "own house only" enforcement for cooks against a mock
 * Apps Script upstream: a cook's `load` is filtered to their house, and a cook's
 * writes are pinned to their house id — a hand-crafted request naming another
 * house cannot read or write it. Admin requests are untouched.
 */
process.env.NODE_ENV = 'test';
process.env.ADMIN_PIN = '4321';
process.env.COOK_PINS = JSON.stringify({ '1111': 'house_alpha' });
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

test('cook scoping is enforced server-side', async (t) => {
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

  const cook = signToken(process.env.SESSION_SECRET, { role: 'cook', houseId: 'house_alpha' }, 1);
  const admin = signToken(process.env.SESSION_SECRET, { role: 'admin', houseId: '' }, 1);

  await t.test('cook load is filtered to their own house', async () => {
    const r = await request(server, 'POST', '/api/sheets', {
      body: { action: 'load' },
      headers: { Authorization: `Bearer ${cook}` },
    });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.houses.length, 1);
    assert.equal(data.houses[0].id, 'house_alpha');
  });

  await t.test('admin load sees every house', async () => {
    const r = await request(server, 'POST', '/api/sheets', {
      body: { action: 'load' },
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.houses.length, 2);
  });

  await t.test('cook write to another house is rewritten to their own house', async () => {
    await request(server, 'POST', '/api/sheets', {
      body: { action: 'saveStock', houseId: 'house_beta', stock: [{ id: 's1', name: 'x' }] },
      headers: { Authorization: `Bearer ${cook}` },
    });
    assert.equal(lastBody.houseId, 'house_alpha'); // pinned, not house_beta
    assert.equal(lastBody.secret, 'shh-server-only'); // server injected the shared secret
  });

  await t.test('cook saveHouse cannot target another house id (only their own)', async () => {
    await request(server, 'POST', '/api/sheets', {
      body: { action: 'saveHouse', house: { id: 'house_beta', name: 'hijack', weeklyBudget: 9 } },
      headers: { Authorization: `Bearer ${cook}` },
    });
    assert.equal(lastBody.house.id, 'house_alpha'); // id pinned
    assert.equal(lastBody.house.name, 'hijack');    // other fields pass through
  });

  await t.test('admin writes are NOT rewritten', async () => {
    await request(server, 'POST', '/api/sheets', {
      body: { action: 'saveStock', houseId: 'house_beta', stock: [] },
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(lastBody.houseId, 'house_beta');
  });
});
