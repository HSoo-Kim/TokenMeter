const assert = require('node:assert/strict');
const test = require('node:test');
const provider = require('./gemini-web');
const i18n = require('./i18n');
const body = (pools, subscriptionTier = 'TIER1') => JSON.stringify([
  { data: { viewer: { rpcs: { getUsageInfo: { pools, subscriptionTier } } } }, errors: [{ message: 'unrelated' }] },
]);
const pool = (poolType, percentageUsed, windowRefreshesAt) => ({ poolType, percentageUsed, gxu: { windowRefreshesAt } });

if (!process.versions.electron) {
test('maps both fractional windows, reset timestamps, and web plan', () => {
  const result = provider.parseUsage(")]}'\n" + body([
    pool('GXU_FIVE_HOURLY', 0.24, '2026-10-15T05:43:53.558200Z'),
    pool('GXU_WEEKLY', 0.01786011, '2026-10-21T04:43:53.558273Z'),
  ]));
  assert.equal(result.loggedIn, true);
  assert.equal(result.plan, 'Pro');
  assert.equal(result.name, undefined);
  assert.deepEqual(result.windows[0], { label: i18n('en').geminiSession, usedPct: 24, resetsAt: 1792043033558 });
  assert.equal(result.windows[1].label, i18n('en').weekly);
  assert.ok(Math.abs(result.windows[1].usedPct - 1.786011) < 1e-10);
  assert.equal(result.windows[1].resetsAt, 1792557833558);
});

test('reported zero and one differ from missing, invalid, and percentage-scale values', () => {
  for (const missing of [undefined, null, '0.24', -1, 24]) {
    const result = provider.parseUsage(body([pool('GXU_FIVE_HOURLY', missing), pool('GXU_WEEKLY', 0)]));
    assert.equal(result.windows.length, 1);
    assert.equal(result.windows[0].usedPct, 0);
    assert.equal(result.windows[0].resetsAt, null);
  }
  assert.equal(provider.parseUsage(body([pool('GXU_FIVE_HOURLY', 1)])).windows[0].usedPct, 100);
});

test('unsupported pools and unknown plans do not manufacture quota or identity', () => {
  for (const pools of [[], [pool('CLI_QUOTA', 0.5)], [null, pool('GXU_WEEKLY', null)]]) {
    const result = provider.parseUsage(body(pools, 'UNRECOGNIZED'));
    assert.equal(result.loggedIn, true);
    assert.deepEqual(result.windows, []);
    assert.equal(result.plan, undefined);
    assert.ok(Object.hasOwn(result, 'error'));
  }
});

test('missing or invalid reset timestamps remain unavailable', () => {
  for (const reset of [undefined, null, 'unknown', '123', 123]) {
    assert.equal(provider.parseUsage(body([pool('GXU_WEEKLY', 0.5, reset)])).windows[0].resetsAt, null);
  }
  const result = provider.parseUsage(body([pool('GXU_WEEKLY', 0.5, '2026-10-22T18:00:00+09:00')]), 'ko');
  assert.equal(result.windows[0].label, i18n('ko').weekly);
  assert.equal(result.windows[0].resetsAt, Date.UTC(2026, 9, 22, 9));
});

test('finds viewer in batched responses and recognizes signed-out viewer', () => {
  assert.deepEqual(provider.parseUsage('[{"data":{}},{"data":{"viewer":null}}]'), { loggedIn: false, windows: [] });
  const results = JSON.parse(body([pool('GXU_WEEKLY', 0.5)]));
  results.unshift({ data: { upsell: null } });
  assert.equal(provider.parseUsage(JSON.stringify(results)).windows[0].usedPct, 50);
});

test('schema drift and malformed bodies fail without echoing private responses', () => {
  for (const text of ['private-response', '{}', '[]', '[{"data":{}}]', '[{"data":{"viewer":[]}}]',
    '[{"data":{"viewer":{"rpcs":{"getUsageInfo":{"pools":null}}}}}]']) {
    assert.throws(() => provider.parseUsage(text), error => error instanceof Error && !error.message.includes('private-response'));
  }
});

test('request uses exact persisted GET query and Chromium session credentials', async () => {
  let calls = 0;
  const result = await provider.requestUsage(async (url, init) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.origin, 'https://gemini.google.com');
    assert.equal(u.pathname, '/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery');
    assert.equal(u.searchParams.get('query_signature'), '2/dWbCvkVB0X16r9NPnxifeOAAqdCqMf0xeWvau9yPy7g=');
    assert.deepEqual(JSON.parse(u.searchParams.get('variables')), {
      g1Request: { entrypoints: ['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER'] },
      workspaceRequest: { recommendationsForSurfaceRequests: [] },
    });
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'include');
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    return new Response(body([pool('GXU_WEEKLY', 0.5)]));
  });
  assert.equal(calls, 1);
  assert.equal(result.windows[0].usedPct, 50);
});

test('authentication failures and HTML sign-in pages report signed out', async () => {
  for (const response of [new Response('', { status: 401 }), new Response('', { status: 403 }),
    new Response('  <!doctype html><title>Sign in</title>')]) {
    assert.deepEqual(await provider.requestUsage(async () => response), { loggedIn: false, windows: [] });
  }
});

test('rate limits, HTTP failures, and schema errors remain failures', async () => {
  await assert.rejects(provider.requestUsage(async () => new Response('', { status: 429, headers: { 'Retry-After': '12' } })),
    error => error.retryAfter === 12);
  await assert.rejects(provider.requestUsage(async () => new Response('<html>unavailable', { status: 503 })));
  await assert.rejects(provider.requestUsage(async () => new Response('[{"data":{}}]')));
});
} else {
  // Optional live boundary check: electron test-gemini-web.cjs. No account credentials used.
  const { app, session } = require('electron');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmeter-gemini-web-'));
  const fail = error => { console.error(error); app.exit(1); };
  const deadline = setTimeout(() => fail(new Error('Gemini web smoke check timed out')), 30000);
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    assert.deepEqual(await provider.fetch(home), { loggedIn: false, windows: [] });
    app.once('browser-window-created', (_, win) => {
      win.webContents.once('did-finish-load', () => {
        const prefs = win.webContents.getLastWebPreferences();
        assert.equal(prefs.sandbox, true);
        assert.equal(prefs.nodeIntegration, false);
        assert.equal(win.webContents.session, session.fromPath(home));
        console.log('LOGIN_PAGE', win.webContents.getURL(), win.getTitle());
        win.close();
      });
    });
    await provider.login(home);
    app.once('browser-window-created', (_, win) => queueMicrotask(() => win.close()));
    await provider.login(home);
    await provider.logout(home);
    assert.deepEqual(await provider.fetch(home), { loggedIn: false, windows: [] });
    clearTimeout(deadline);
    console.log('PASS: fresh session signed out, sandboxed login cancellation, session logout');
    app.exit(0);
  }).catch(fail);
}
