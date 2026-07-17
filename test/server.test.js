'use strict';
/*
 * The app is OPEN: no login, no tokens. /api/sheets proxies straight to Apps
 * Script for any visitor. What this test locks in:
 *   - a request with NO auth reaches the upstream and gets data back (open app);
 *   - the server injects APPS_SCRIPT_SECRET and a client canNOT override it
 *     (the shared secret stays server-side only);
 *   - /healthz is open; the shared domain module is served; unknown /api → 404.
 */
process.env.NODE_ENV = 'test';
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

test('open server proxies to Apps Script with no user auth', async (t) => {
  // ---- mock Apps Script upstream ----
  let lastBody = null;
  const upstream = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      lastBody = JSON.parse(buf || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (lastBody.action === 'load') {
        res.end(JSON.stringify({ ok: true, houses: [{ id: 'ramot-hashavim', name: 'רמות השבים' }] }));
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
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  await t.test('/healthz is open', async () => {
    const r = await request(server, 'GET', '/healthz');
    assert.equal(r.status, 200);
  });

  await t.test('the shared domain module is served', async () => {
    const r = await request(server, 'GET', '/lib/kitchen-domain.js');
    assert.equal(r.status, 200);
    assert.match(r.text, /KitchenDomain/);
  });

  await t.test('load reaches the upstream with NO auth and returns data', async () => {
    const r = await request(server, 'POST', '/api/sheets', { body: { action: 'load' } });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.houses.length, 1);
    assert.equal(data.houses[0].id, 'ramot-hashavim');
  });

  await t.test('a write reaches the upstream with NO auth', async () => {
    const r = await request(server, 'POST', '/api/sheets', {
      body: { action: 'saveStock', houseId: 'ramot-hashavim', stock: [{ id: 's1', name: 'x' }] },
    });
    assert.equal(r.status, 200);
    assert.equal(lastBody.houseId, 'ramot-hashavim');
  });

  await t.test('the server injects the shared secret and a client cannot override it', async () => {
    await request(server, 'POST', '/api/sheets', {
      body: { action: 'load', secret: 'attacker-supplied' },
    });
    assert.equal(lastBody.secret, 'shh-server-only'); // server value wins, always
  });

  await t.test('unknown /api route → 404', async () => {
    const r = await request(server, 'GET', '/api/nope');
    assert.equal(r.status, 404);
  });
});
