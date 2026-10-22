const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gemini = require('./gemini');

function profile(t, auth) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmeter-gemini-'));
  if (auth) fs.writeFileSync(gemini.credFile(home), JSON.stringify(auth));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
function responses(t, handlers) {
  let calls = 0;
  mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(handlers[calls], `unexpected request ${url}`);
    return handlers[calls++](url, init);
  });
  t.after(() => { mock.restoreAll(); assert.equal(calls, handlers.length); });
}
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('missing profile requires setup without a network request', async t => {
  const home = profile(t);
  responses(t, []);
  assert.equal((await gemini.fetch(home)).loggedIn, false);
  assert.equal(gemini.env(path.join(home, '.gemini')).GEMINI_CLI_HOME, home);
});

test('preserves model and token-type buckets, zero remaining, full remaining, and unknown reset', async t => {
  const home = profile(t, { access_token: 'fixture' });
  responses(t, [
    (url, init) => {
      assert.ok(url.endsWith(':loadCodeAssist'));
      assert.equal(init.headers.Authorization, 'Bearer fixture');
      return json({ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'licensed-project' });
    },
    (url, init) => {
      assert.ok(url.endsWith(':retrieveUserQuota'));
      assert.deepEqual(JSON.parse(init.body), { project: 'licensed-project' });
      return json({ buckets: [
        { modelId: 'gemini-pro', tokenType: 'REQUESTS', remainingFraction: 0, resetTime: '2030-01-01T00:00:00Z' },
        { modelId: 'gemini-pro', tokenType: 'TOKENS', remainingFraction: 1 },
        { modelId: 'unknown', remainingAmount: '40' },
      ] });
    },
  ]);
  const result = await gemini.fetch(home);
  assert.deepEqual(result.windows, [
    { label: 'gemini-pro · REQUESTS', usedPct: 100, resetsAt: Date.parse('2030-01-01T00:00:00Z') },
    { label: 'gemini-pro · TOKENS', usedPct: 0, resetsAt: undefined },
  ]);
});

test('refreshes expired credentials with form encoding and preserves refresh token', async t => {
  mock.method(Date, 'now', () => 1900000000000);
  const home = profile(t, { access_token: 'expired', refresh_token: 'a+b&c%d', expiry_date: 1 });
  const cli = path.join(home, 'official-cli');
  fs.mkdirSync(path.join(cli, 'bundle'), { recursive: true });
  fs.writeFileSync(path.join(cli, 'bundle', 'chunk.js'), 'const OAUTH_CLIENT_ID = "fixture-client"; const OAUTH_CLIENT_SECRET = "fixture-secret";');
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ tokenmeter: { cliPath: cli } }));
  responses(t, [
    (url, init) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.equal(new URLSearchParams(init.body).get('refresh_token'), 'a+b&c%d');
      assert.equal(new URLSearchParams(init.body).get('client_id'), 'fixture-client');
      assert.equal(new URLSearchParams(init.body).get('client_secret'), 'fixture-secret');
      return json({ access_token: 'renewed', expires_in: 3600 });
    },
    (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer renewed');
      return json({ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'p' });
    },
    () => json({ buckets: [] }),
  ]);
  await gemini.fetch(home);
  const saved = JSON.parse(fs.readFileSync(gemini.credFile(home), 'utf8'));
  assert.equal(saved.refresh_token, 'a+b&c%d');
  assert.equal(saved.expiry_date, 1900003600000);
});

test('consumer ineligibility is not represented as a quota or logged-in account', async t => {
  const home = profile(t, { access_token: 'fixture' });
  responses(t, [() => json({ ineligibleTiers: [{ reasonCode: 'UNSUPPORTED_CLIENT' }] })]);
  const result = await gemini.fetch(home);
  assert.equal(result.loggedIn, false);
  assert.equal(result.windows, undefined);
});

test('refresh never falls back to an embedded OAuth client when the official CLI is absent', async t => {
  const home = profile(t, { access_token: 'expired', refresh_token: 'fixture', expiry_date: 1 });
  const oldPath = process.env.PATH;
  process.env.PATH = '';
  mock.method(os, 'homedir', () => home);
  t.after(() => { process.env.PATH = oldPath; });
  responses(t, []);
  await assert.rejects(gemini.fetch(home));
  assert.equal(JSON.parse(fs.readFileSync(gemini.credFile(home), 'utf8')).access_token, 'expired');
});

test('rate limiting retains retry interval', async t => {
  const home = profile(t, { access_token: 'fixture' });
  responses(t, [() => new Response('', { status: 429, headers: { 'retry-after': '120' } })]);
  await assert.rejects(gemini.fetch(home), error => error.retryAfter === 120);
});
