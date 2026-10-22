const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmeter-ui-')));
const fail = error => { console.error(error); app.exit(1); };
process.on('unhandledRejection', fail);
const timeout = setTimeout(() => fail(new Error('UI test timed out')), 30000);
const evidence = process.env.TOKENMETER_QA_DIR || path.join(os.tmpdir(), 'tokenmeter-gemini-ui');
fs.mkdirSync(evidence, { recursive: true });
const list = [
  { id: 'gemini-web-1', type: 'gemini-web', name: 'web@example.com', loggedIn: true, plan: 'AI Pro',
    windows: [{ label: '5시간', usedPct: 25, resetsAt: 2000000000000 }, { label: '주간', usedPct: 60, resetsAt: 2000001000000 }] },
  { id: 'antigravity-1', type: 'antigravity', name: 'developer@example.com', loggedIn: true,
    windows: [{ label: 'Gemini 3.1 Pro (High) preview model', usedPct: 0 }, { label: 'Claude Opus 4.7', usedPct: 100, resetsAt: 2000000000000 }] },
  { id: 'gemini-1', type: 'gemini', loggedIn: false,
    error: '기존 Code Assist 라이선스 로그인이 필요합니다. 개인 구독은 Antigravity를 사용하세요.' },
  { id: 'codex-1', type: 'codex', name: 'codex@example.com', loggedIn: true, windows: [{ label: '주간', usedPct: 23 }] },
  { id: 'claude-1', type: 'claude', name: 'claude@example.com', loggedIn: true, windows: [{ label: '5시간', usedPct: 41 }] },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400, height: 720, frame: false, show: false, backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  let height = 720;
  ipcMain.handle('resize', (_, h) => win.setSize(400, Math.min(h, height)));
  let menuRequests = 0;
  let onAdd;
  const addRequested = new Promise(resolve => { onAdd = resolve; });
  ipcMain.handle('menu-add', () => { menuRequests++; onAdd(); });
  await win.loadFile(path.join(__dirname, 'index.html'));
  await win.webContents.executeJavaScript('Date.now = () => 1999990000000; undefined');
  for (const size of [420, 720]) for (const theme of ['light', 'dark']) {
    height = size;
    win.setSize(400, size);
    win.webContents.send('state', { list, hotkey: 'Ctrl+Shift+S', theme, lang: 'ko' });
    await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const measurements = await win.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('#list'), footer = document.querySelector('footer');
      return {
        ids: [...list.children].map(c => c.dataset.id),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        scrollable: list.scrollHeight > list.clientHeight,
        footerVisible: footer.getBoundingClientRect().bottom <= innerHeight,
        invalidValues: /NaN|Invalid Date/.test(document.body.innerText),
      };
    })()`);
    console.log(JSON.stringify({ size, theme, ...measurements }));
    fs.writeFileSync(path.join(evidence, `${size}-${theme}-top.png`), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(measurements.ids, list.map(a => a.id));
    assert.equal(measurements.horizontalOverflow, false);
    if (size === 420) assert.equal(measurements.scrollable, true, 'short screens keep all accounts reachable');
    assert.equal(measurements.footerVisible, true);
    assert.equal(measurements.invalidValues, false);
    await win.webContents.executeJavaScript('document.querySelector("#list").scrollTop = document.querySelector("#list").scrollHeight; new Promise(r => requestAnimationFrame(r))');
    fs.writeFileSync(path.join(evidence, `${size}-${theme}-bottom.png`), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('document.querySelector("#list").scrollTop = 0');
  }
  await win.webContents.executeJavaScript('document.querySelector("#add").click()');
  await addRequested;
  assert.equal(menuRequests, 1, 'Add control reaches the real preload IPC');
  console.log(`PASS: Gemini cards, long labels, unknown reset, scrolling, add IPC; screenshots=${evidence}`);
  clearTimeout(timeout);
  app.quit();
}).catch(fail);
