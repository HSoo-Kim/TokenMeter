const { app, Menu, Tray, net, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter, once, on } = require('node:events');
const updates = require('./updates');
const i18n = require('./i18n');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmeter-update-ui-'));
app.setPath('userData', data);
fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({
  accounts: [], hotkey: 'Ctrl+Alt+Shift+F10', lang: 'ko', customSetting: 'preserved',
}));
process.env.TOKENMETER_DEMO = '1';
delete process.env.TOKENMETER_SHOT;

const events = new EventEmitter();
const notices = [];
let menu, requestCount = 0, mode = 'valid', installCalls = 0;
let initialResponse;
const initial = new Promise(resolve => { initialResponse = resolve; });
const body = Buffer.from('verified installer UI fixture');
const release = {
  tag_name: 'v99.0.0', html_url: 'https://github.com/HSoo-Kim/TokenMeter/releases/tag/v99.0.0',
  assets: [{
    name: 'TokenMeter-Setup-99.0.0.exe',
    browser_download_url: 'https://github.com/HSoo-Kim/TokenMeter/releases/download/v99.0.0/TokenMeter-Setup-99.0.0.exe',
    digest: `sha256:${createHash('sha256').update(body).digest('hex')}`, size: body.length,
  }],
};
const build = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = template => {
  const result = build(template);
  if (result.getMenuItemById('check-updates')) {
    menu = result;
    events.emit('menu');
  }
  return result;
};
Tray.prototype.displayBalloon = options => { notices.push(options); };
net.fetch = async url => {
  if (url.endsWith('/releases/latest')) {
    requestCount++;
    if (requestCount === 1) { events.emit('initial'); await initial; }
    if (mode === 'check-error') return new Response(null, { status: 503 });
    return Response.json(release);
  }
  assert.equal(url, release.assets[0].browser_download_url);
  return new Response(mode === 'bad-download' ? Buffer.alloc(body.length) : body);
};
let opened;
shell.openExternal = async url => { opened = url; };
updates.install = async (file, executable) => {
  installCalls++;
  assert.deepEqual(fs.readFileSync(file), body);
  assert.equal(executable, process.execPath);
};
const nativeInterval = global.setInterval;
let autoCheck;
global.setInterval = (callback, interval, ...args) => {
  if (interval === 6 * 60 * 60 * 1000) autoCheck = callback;
  return nativeInterval(callback, interval, ...args);
};
const fail = error => { console.error(error); app.exit(1); };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
const timeout = setTimeout(() => fail(new Error('Update UI test did not finish')), 20000);
const item = id => menu.getMenuItemById(id);
async function waitMenu(predicate) {
  while (!predicate()) await once(events, 'menu', { signal: AbortSignal.timeout(10000) });
}
async function actionAndMenu(action, predicate) {
  const changed = (async () => {
    for await (const event of on(events, 'menu', { signal: AbortSignal.timeout(10000) })) {
      if (predicate()) return;
    }
  })();
  action();
  await changed;
}

const started = once(events, 'initial', { signal: AbortSignal.timeout(10000) });
require('./main.js');
app.whenReady().then(async () => {
  await started;
  assert.equal(item('check-updates').enabled, false);
  assert.equal(item('install-update').visible, false);
  const available = waitMenu(() => item('install-update').visible);
  initialResponse();
  await available;
  assert.equal(notices.length, 1, 'startup detects and announces a newer release');
  assert.equal(item('check-updates').enabled, true);
  assert.equal(item('install-update').enabled, true);
  assert.equal(typeof autoCheck, 'function');
  for (const lang of ['ko', 'en', 'zh']) {
    assert.ok(i18n(lang).trayCheckUpdates);
    assert.ok(i18n(lang).trayInstallUpdate(release.tag_name));
  }

  await autoCheck();
  assert.equal(notices.length, 1, 'periodic checks do not repeat the same notification');
  assert.equal(item('auto-updates').checked, true);
  item('auto-updates').click(item('auto-updates'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'))).checkForUpdates, false);
  const requests = requestCount;
  await autoCheck();
  assert.equal(requestCount, requests, 'disabled automatic checks do not request releases');
  await actionAndMenu(() => item('check-updates').click(), () => item('check-updates').enabled);
  assert.equal(requestCount, requests + 1, 'manual checking still works');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'))).customSetting, 'preserved');

  mode = 'check-error';
  await actionAndMenu(() => item('check-updates').click(), () => item('check-updates').enabled);
  assert.equal(notices.at(-1).iconType, 'warning');
  assert.equal(item('check-updates').enabled, true);
  mode = 'valid';
  await actionAndMenu(() => item('install-update').click(), () => item('install-update').enabled);
  assert.equal(opened, release.html_url, 'source runs open the official release page');
  assert.equal(installCalls, 0);

  Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
  mode = 'bad-download';
  await actionAndMenu(() => item('install-update').click(), () => item('install-update').enabled);
  assert.equal(installCalls, 0, 'tampered download never reaches the installer');
  assert.equal(notices.at(-1).iconType, 'warning');
  assert.equal(item('install-update').enabled, true, 'failure leaves the app usable');
  mode = 'valid';
  app.on('will-quit', () => {
    assert.equal(installCalls, 1, 'successful handoff quits only after launching the verified installer');
    clearTimeout(timeout);
    console.log('PASS: native tray menus, startup/periodic/manual checks, notification deduplication, preference persistence, failures and install handoff');
  });
  item('install-update').click();
}).catch(fail);
