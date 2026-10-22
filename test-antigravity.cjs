const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const provider = require('./antigravity');
const { parseQuota, parseProcesses, requestLocal, fetchQuota } = provider._test;

const root = 'C:\\Users\\fixture\\AppData\\Local\\Programs\\Antigravity';
const processInfo = {
  ProcessId: 123,
  ExecutablePath: root + '\\resources\\bin\\language_server.exe',
  CommandLine: `"${root}\\resources\\bin\\language_server.exe" --csrf_token="fixture-token"`,
};
const modelResponse = {
  userStatus: {
    email: 'fixture@example.test',
    userTier: { name: 'Ultra' },
    planStatus: { planInfo: { planName: 'Pro' } },
    cascadeModelConfigData: {
      clientModelConfigs: [{
        label: 'Gemini Pro', modelOrAlias: { model: 'gemini-pro' },
        quotaInfo: { remainingFraction: 0.25, resetTime: '2026-10-23T12:00:00Z' },
      }],
    },
  },
};

async function listen(t, handler) {
  const server = http.createServer(handler);
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return { host: '127.0.0.1', port: server.address().port, token: 'fixture-token', scheme: 'http:' };
}

test('model quota preserves account tier, percent used, and absolute reset', () => {
  const result = parseQuota(modelResponse);
  assert.equal(result.loggedIn, true);
  assert.equal(result.name, 'fixture@example.test');
  assert.equal(result.plan, 'Ultra');
  assert.deepEqual(result.windows, [{
    label: 'Gemini Pro', usedPct: 75, resetsAt: Date.parse('2026-10-23T12:00:00Z'),
  }]);
});

test('missing quota is unknown; explicit zero and clamped fractions remain valid', () => {
  const response = {
    clientModelConfigs: [
      { label: 'Unknown', quotaInfo: {} },
      { label: 'Null', quotaInfo: { remainingFraction: null } },
      { label: 'String', quotaInfo: { remainingFraction: '0.5' } },
      { label: 'Empty', quotaInfo: { remainingFraction: 0, resetTime: 'invalid' } },
      { label: 'Full', quotaInfo: { remainingFraction: 2, resetTime: '1792756800' } },
      { label: 'Negative', quotaInfo: { remainingFraction: -1 } },
    ],
  };
  assert.deepEqual(parseQuota(response).windows, [
    { label: 'Empty', usedPct: 100, resetsAt: null },
    { label: 'Full', usedPct: 0, resetsAt: 1792756800000 },
    { label: 'Negative', usedPct: 100, resetsAt: null },
  ]);
});

test('summary buckets support envelopes and oneofs without fabricating disabled usage', () => {
  const payload = { groups: [{
    displayName: 'Gemini',
    buckets: [
      { bucketId: 'gemini-session', displayName: 'Session', window: 'session', remainingFraction: 0.5 },
      { id: 'gemini-weekly', name: 'Weekly', remaining: { case: 'remainingFraction', value: 0.75 } },
      { bucketId: 'disabled', remainingFraction: 0, disabled: true },
      { bucketId: 'unknown' },
      { remainingFraction: 0.3 },
    ],
  }] };
  for (const response of [payload, { response: payload }, { summary: payload }]) {
    const result = parseQuota(response, { fiveHour: 'five', weekly: 'week' });
    assert.deepEqual(result.windows, [
      { label: 'Gemini five', usedPct: 50, resetsAt: null },
      { label: 'Gemini week', usedPct: 25, resetsAt: null },
    ]);
  }
});

test('RPC application errors cannot become successful quota data', () => {
  for (const code of [401, 'unauthenticated', false]) assert.throws(() => parseQuota({ code, ...modelResponse }));
  for (const code of [0, '0', 'OK', 'SUCCESS']) assert.equal(parseQuota({ code, ...modelResponse }).windows.length, 1);
});

test('process discovery accepts only expected executable and its loopback listeners', () => {
  const sockets = [
    ' TCP 127.0.0.1:4567 0.0.0.0:0 LISTENING 123',
    ' TCP [::1]:4568 [::]:0 LISTENING 123',
    ' TCP 127.0.0.1:5555 0.0.0.0:0 LISTENING 124',
    ' TCP 192.168.0.1:4569 0.0.0.0:0 LISTENING 123',
    ' TCP 0.0.0.0:4570 0.0.0.0:0 LISTENING 123',
    ' TCP 127.0.0.1:4571 127.0.0.1:4444 ESTABLISHED 123',
  ].join('\n');
  assert.deepEqual(parseProcesses(processInfo, sockets, [root]), [{ endpoints: [
    { host: '127.0.0.1', port: 4567, token: 'fixture-token' },
    { host: '::1', port: 4568, token: 'fixture-token' },
  ] }]);
  assert.deepEqual(parseProcesses({ ...processInfo, ExecutablePath: 'C:\\impostor\\language_server.exe' }, sockets, [root]), []);
  assert.deepEqual(parseProcesses({ ...processInfo, CommandLine: '--csrf_token="bad\r\ntoken"' }, sockets, [root]), []);
  assert.deepEqual(parseProcesses({ ...processInfo, CommandLine: '--extension_server_csrf_token=wrong' }, sockets, [root]), []);
});

test('actual HTTP boundary sends only expected Connect request and CSRF header', async t => {
  let received;
  const endpoint = await listen(t, (request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      received = { method: request.method, url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks)) };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(modelResponse));
    });
  });
  const result = await requestLocal(endpoint, 'GetUserStatus');
  assert.equal(parseQuota(result).windows[0].usedPct, 75);
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/exa.language_server_pb.LanguageServerService/GetUserStatus');
  assert.equal(received.headers['x-codeium-csrf-token'], 'fixture-token');
  assert.equal(received.headers['connect-protocol-version'], '1');
  assert.equal(received.body.metadata.ideName, 'antigravity');
  assert.equal(received.headers.authorization, undefined);
});

test('local request rejects external targets and never follows redirects', async t => {
  for (const override of [
    { host: 'example.test' }, { host: 'localhost' }, { host: '127.0.0.1.example.test' },
    { port: 0 }, { scheme: 'file:' }, { token: 'bad\r\ntoken' },
  ]) {
    await assert.rejects(requestLocal({ host: '127.0.0.1', port: 1234, token: 'fixture-token', scheme: 'http:', ...override }, 'GetUserStatus'));
  }
  let redirected = 0;
  const destination = await listen(t, (_request, response) => { redirected++; response.end('{}'); });
  const endpoint = await listen(t, (_request, response) => {
    response.writeHead(302, { Location: `http://127.0.0.1:${destination.port}/` });
    response.end();
  });
  await assert.rejects(requestLocal(endpoint, 'GetUserStatus'));
  assert.equal(redirected, 0);
});

test('provider crosses fixture discovery and HTTP boundaries with older-server RPC fallback', async t => {
  const methods = [];
  const endpoint = await listen(t, (request, response) => {
    methods.push(request.url.split('/').pop());
    request.resume();
    if (request.url.endsWith('/GetUserStatus')) response.end(JSON.stringify(modelResponse));
    else { response.statusCode = 404; response.end('{}'); }
  });
  const sockets = ` TCP 127.0.0.1:${endpoint.port} 0.0.0.0:0 LISTENING 123`;
  const find = async () => parseProcesses(processInfo, sockets, [root]);
  const result = await fetchQuota('en', find);
  assert.equal(result.name, 'fixture@example.test');
  assert.equal(result.windows[0].usedPct, 75);
  assert.deepEqual(methods, ['RetrieveUserQuotaSummary', 'GetUserStatus']);
});

test('provider prefers summary windows and keeps identity from GetUserStatus', async t => {
  let summaryBody;
  const endpoint = await listen(t, (request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const summary = request.url.endsWith('/RetrieveUserQuotaSummary');
      if (summary) summaryBody = JSON.parse(Buffer.concat(chunks));
      response.end(JSON.stringify(summary
        ? { groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'session', window: 'session', remainingFraction: 0.5 }] }] }
        : modelResponse));
    });
  });
  const result = await fetchQuota('en', async () => [{ endpoints: [endpoint] }]);
  assert.equal(result.name, 'fixture@example.test');
  assert.equal(result.plan, 'Ultra');
  assert.equal(result.windows.length, 1);
  assert.equal(result.windows[0].usedPct, 50);
  assert.deepEqual(summaryBody, { forceRefresh: true });
});

test('absent app yields no synthetic usage and never attempts local RPC', async () => {
  let calls = 0;
  const result = await fetchQuota('en', async () => [], async () => { calls++; throw new Error('unexpected request'); });
  assert.equal(result.loggedIn, false);
  assert.deepEqual(result.windows, []);
  assert.equal(calls, 0);
  assert.equal(provider.logout, undefined);
});
