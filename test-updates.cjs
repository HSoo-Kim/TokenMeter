const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const real = require('./updates');
// Cases default to the Windows installer on any host; macOS cases pass their target explicitly.
const WIN = { platform: 'win32', arch: 'x64' };
const updates = {
  ...real,
  parseRelease: (data, target = WIN) => real.parseRelease(data, target),
  check: (current, request, target = WIN) => real.check(current, request, target),
  install: (file, executable, start, platform = 'win32') => real.install(file, executable, start, platform),
};

const repository = 'https://github.com/HSoo-Kim/TokenMeter';
const bytes = Buffer.from('TokenMeter installer fixture');
const digest = createHash('sha256').update(bytes).digest('hex');
function fixture(tag = 'v1.3.0') {
  const name = `TokenMeter-Setup-${tag.replace(/^v/i, '')}.exe`;
  return {
    tag_name: tag, html_url: `${repository}/releases/tag/${tag}`, draft: false, prerelease: false,
    assets: [{ name, browser_download_url: `${repository}/releases/download/${tag}/${name}`,
      digest: `sha256:${digest}`, size: bytes.length }],
  };
}
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmeter-updates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('parses only a stable release and its exact Windows installer', () => {
  const data = fixture();
  data.assets.unshift({ name: 'TokenMeter-Setup-1.2.1.exe' });
  const result = updates.parseRelease(data);
  assert.equal(result.version, '1.3.0');
  assert.equal(result.installer.sha256, digest);
  assert.equal(result.installer.size, bytes.length);
  assert.equal(result.installer.name, 'TokenMeter-Setup-1.3.0.exe');
  assert.equal(updates.parseRelease({ ...data, draft: true }), null);
  assert.equal(updates.parseRelease({ ...data, prerelease: true }), null);
});

test('rejects invalid versions and release pages outside this repository', () => {
  for (const tag of ['v1.3.0-beta.1', '../1.3.0', '1.3', 'v9007199254740992.0.0']) {
    assert.throws(() => updates.parseRelease(fixture(tag)));
  }
  assert.throws(() => updates.parseRelease({ ...fixture(), html_url: `${repository}.evil/releases/tag/v1.3.0` }));
  assert.throws(() => updates.parseRelease(null));
});

test('unverifiable installers retain the release page for manual installation', () => {
  for (const change of [
    { digest: null }, { digest: 'sha256:not-a-hash' }, { size: 0 }, { size: 0.5 },
    { size: 513 * 1024 * 1024 }, { browser_download_url: 'https://example.com/setup.exe' },
  ]) {
    const data = fixture();
    Object.assign(data.assets[0], change);
    const result = updates.parseRelease(data);
    assert.equal(result.installer, null);
    assert.equal(result.url, data.html_url);
  }
  assert.equal(updates.parseRelease({ ...fixture(), assets: [] }).installer, null);
});

test('compares numeric version components and never offers a downgrade', async () => {
  for (const [current, latest, newer] of [
    ['1.2.1', 'v1.3.0', true], ['1.3.0', 'v1.3.0', false], ['1.3.1', 'v1.3.0', false],
    ['1.9.9', 'v1.10.0', true], ['2.0.0', 'v1.99.99', false], ['1.99.99', 'v2.0.0', true],
  ]) {
    const result = await updates.check(current, async (url, init) => {
      assert.equal(url, 'https://api.github.com/repos/HSoo-Kim/TokenMeter/releases/latest');
      assert.equal(init.headers['User-Agent'], `TokenMeter/${current}`);
      assert.equal(init.headers.Authorization, undefined);
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json(fixture(latest));
    });
    assert.equal(!!result, newer, `${current} -> ${latest}`);
  }
});

test('handles no release, prereleases and failed checks without inventing a version', async () => {
  assert.equal(await updates.check('1.3.0', async () => new Response(null, { status: 404 })), null);
  assert.equal(await updates.check('1.2.1', async () => Response.json({ ...fixture(), prerelease: true })), null);
  await assert.rejects(updates.check('1.2.1', async () => new Response(null, { status: 429 })), /429/);
  await assert.rejects(updates.check('1.2.1', async () => new Response('not JSON')));
  await assert.rejects(updates.check('broken', async () => { throw new Error('must not request'); }), /installed version/);
});

test('streams installer bytes to disk and verifies exact size and SHA-256', async t => {
  const dir = directory(t);
  const release = updates.parseRelease(fixture());
  const file = await updates.download(release, dir, async (url, init) => {
    assert.equal(url, release.installer.url);
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 7));
        controller.enqueue(bytes.subarray(7));
        controller.close();
      },
    }));
  });
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(path.basename(file), release.installer.name);
  assert.equal(path.dirname(path.dirname(file)), dir);
});

test('rejects changed, truncated and oversized downloads and cleans only its own staging folder', async t => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'existing');
  for (const payload of [Buffer.alloc(bytes.length), bytes.subarray(1), Buffer.concat([bytes, bytes])]) {
    await assert.rejects(updates.download(updates.parseRelease(fixture()), dir, async () => new Response(payload)),
      /mismatch/);
    assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
  }
});

test('failed HTTP and bodyless responses leave no staged installer', async t => {
  const dir = directory(t);
  for (const status of [200, 404, 503]) {
    await assert.rejects(updates.download(updates.parseRelease(fixture()), dir,
      async () => new Response(null, { status })), /download HTTP/);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
  await assert.rejects(updates.download({ installer: null }, dir), /no verified installer/);
});

test('starts NSIS detached with the same install directory and update/restart flags', async () => {
  let unreferenced = false;
  await updates.install('C:\\Temp\\TokenMeter-Setup-1.3.0.exe', 'C:\\Apps\\Token Meter\\TokenMeter.exe',
    (file, args, options) => {
      assert.equal(file, 'C:\\Temp\\TokenMeter-Setup-1.3.0.exe');
      assert.deepEqual(args, ['/S', '--updated', '--force-run', '/D=C:\\Apps\\Token Meter']);
      assert.deepEqual(options, { detached: true, stdio: 'ignore', windowsHide: true });
      const child = new EventEmitter();
      child.unref = () => { unreferenced = true; };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
  assert.equal(unreferenced, true);
});

test('does not accept a failed installer launch', async () => {
  await assert.rejects(updates.install('missing.exe', 'C:\\Apps\\TokenMeter.exe', () => {
    const child = new EventEmitter();
    child.unref = () => assert.fail('failed launch must not be detached');
    queueMicrotask(() => child.emit('error', new Error('spawn failed')));
    return child;
  }), /spawn failed/);
});

test('macOS picks the zipped bundle for its own CPU and never the Windows installer', () => {
  const data = fixture();
  data.assets.push(...['arm64', 'x64'].map(arch => {
    const name = `TokenMeter-1.3.0-mac-${arch}.zip`;
    return { name, browser_download_url: `${repository}/releases/download/v1.3.0/${name}`, digest: `sha256:${digest}`, size: bytes.length };
  }));
  assert.equal(real.parseRelease(data, { platform: 'darwin', arch: 'arm64' }).installer.name, 'TokenMeter-1.3.0-mac-arm64.zip');
  assert.equal(real.parseRelease(data, { platform: 'darwin', arch: 'x64' }).installer.name, 'TokenMeter-1.3.0-mac-x64.zip');
  assert.equal(real.parseRelease(fixture(), { platform: 'darwin', arch: 'arm64' }).installer, null);
});

function macInstall(t) {
  const dir = directory(t);
  const executable = path.join(dir, 'Apps', 'TokenMeter.app', 'Contents', 'MacOS', 'TokenMeter');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  const staging = path.join(dir, 'pending-1');
  fs.mkdirSync(staging);
  return { executable, zip: path.join(staging, 'TokenMeter-1.3.0-mac-arm64.zip'), staging };
}
const child = (event, ...args) => {
  const emitter = new EventEmitter();
  emitter.unref = () => { emitter.unreferenced = true; };
  queueMicrotask(() => emitter.emit(event, ...args));
  return emitter;
};

test('macOS unpacks the verified zip, then hands the bundle swap to a detached process', async t => {
  const { executable, zip, staging } = macInstall(t);
  const calls = [];
  let swap;
  await real.install(zip, executable, (file, args, options) => {
    calls.push([file, args, options]);
    if (file === '/usr/bin/ditto') {
      fs.mkdirSync(path.join(staging, 'TokenMeter.app', 'Contents', 'MacOS'), { recursive: true });
      return child('close', 0);
    }
    return (swap = child('spawn'));
  }, 'darwin');
  assert.deepEqual(calls[0], ['/usr/bin/ditto', ['-x', '-k', zip, staging], { stdio: 'ignore' }]);
  const [shell, [, , , pid, bundle, next, cleanup], options] = calls[1];
  assert.equal(shell, '/bin/sh');
  assert.deepEqual([pid, bundle, next, cleanup],
    [String(process.pid), path.resolve(executable, '../../..'), path.join(staging, 'TokenMeter.app'), staging]);
  assert.deepEqual(options, { detached: true, stdio: 'ignore' });
  assert.equal(swap.unreferenced, true);
});

test('macOS keeps the running bundle when the update cannot be unpacked or placed', async t => {
  const { executable, zip } = macInstall(t);
  const swapped = () => assert.fail('the swap must not start');
  await assert.rejects(real.install(zip, executable, file => (file === '/usr/bin/ditto' ? child('close', 1) : swapped()), 'darwin'),
    /Unpacking/);
  await assert.rejects(real.install(zip, executable, file => (file === '/usr/bin/ditto' ? child('close', 0) : swapped()), 'darwin'),
    /no TokenMeter\.app/);
  await assert.rejects(real.install(zip, '/usr/local/bin/electron', swapped, 'darwin'), /app bundle/);
});
