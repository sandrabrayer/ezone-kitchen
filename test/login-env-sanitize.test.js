'use strict';
/*
 * Reproduces the production bug: every /api/login returned 401 with the correct
 * ADMIN_PIN because the Railway env var carried surrounding quotes / trailing
 * whitespace, while the browser sends a trimmed PIN. The server must sanitise
 * env PIN values on startup so the comparison is robust.
 *
 * These realistic env values (quoted admin PIN + trailing spaces, a cook PIN
 * with surrounding whitespace, and the empty COOK_PINS={} that production ran)
 * would all 401 before the fix.
 */
process.env.NODE_ENV = 'test';
process.env.APPS_SCRIPT_URL = 'https://example.invalid/exec';
process.env.APPS_SCRIPT_SECRET = 'shh';
process.env.ADMIN_PIN = '"4321"  ';                       // quoted + trailing spaces
process.env.COOK_PINS = '  {" 1111 ":" house_alpha "}  '; // padded blob, padded pin + houseId
process.env.SESSION_SECRET = 'k'.repeat(32);

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app, _loginAttempts } = require('../server');

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

test('login is robust to quoted / whitespace-padded env PINs', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());

  await t.test('correct ADMIN_PIN logs in even though the env var was quoted + padded', async () => {
    _loginAttempts.clear();
    const r = await request(server, 'POST', '/api/login', { body: { pin: '4321' } });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.role, 'admin');
  });

  await t.test('a cook PIN padded in the env var still authenticates and binds its house', async () => {
    _loginAttempts.clear();
    const r = await request(server, 'POST', '/api/login', { body: { pin: '1111' } });
    assert.equal(r.status, 200);
    const data = JSON.parse(r.text);
    assert.equal(data.role, 'cook');
    assert.equal(data.houseId, 'house_alpha'); // houseId trimmed too
  });

  await t.test('a genuinely wrong PIN is still rejected', async () => {
    _loginAttempts.clear();
    const r = await request(server, 'POST', '/api/login', { body: { pin: '0000' } });
    assert.equal(r.status, 401);
  });

  await t.test('the quotes/space are not part of the accepted PIN', async () => {
    _loginAttempts.clear();
    const r = await request(server, 'POST', '/api/login', { body: { pin: '"4321"' } });
    assert.equal(r.status, 401);
  });
});
