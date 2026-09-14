const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, screen, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const providers = require('./providers');
const i18n = require('./i18n');

app.setName('TokenMeter');
if (!app.requestSingleInstanceLock()) app.quit();

// ---- config ---------------------------------------------------------------
// userData, because __dirname is inside the read-only asar in a packaged build
const CFG_FILE = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CFG = {
  hotkey: 'Ctrl+Alt+U',
  theme: 'dark',
  lang: 'en',
  pollSeconds: 60,
  accounts: [
    { id: 'codex-1', type: 'codex', home: '~/.codex' },
    { id: 'codex-2', type: 'codex', home: '~/.codex-2' },
    { id: 'claude-1', type: 'claude', home: '~/.claude' },
  ],
};
const firstRun = !fs.existsSync(CFG_FILE);
const cfg = firstRun ? structuredClone(DEFAULT_CFG) : { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) };
const saveCfg = () => fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));
if (firstRun) saveCfg();

// ---- state / polling -------------------------------------------------------
const state = {};     // id -> last known result
const notBefore = {}; // id -> ms; rate-limit backoff
let win, tray, polling = false, suppressHide = false;

// TOKENMETER_DEMO fills the window with fake accounts, for docs screenshots
const DEMO = process.env.TOKENMETER_DEMO && [
  { id: 'codex-1', type: 'codex', loggedIn: true, name: 'alex@example.com', plan: 'pro', updatedAt: Date.now(),
    windows: [{ label: i18n(cfg.lang).weekly, usedPct: 23, resetsAt: Date.now() + 4.3 * 864e5 }] },
  { id: 'codex-2', type: 'codex', loggedIn: true, name: 'alex.work@example.com', plan: 'plus', updatedAt: Date.now(),
    windows: [{ label: i18n(cfg.lang).weekly, usedPct: 68, resetsAt: Date.now() + 2.1 * 864e5 }] },
  { id: 'claude-1', type: 'claude', loggedIn: true, name: 'alex@example.com', plan: 'max 5x', updatedAt: Date.now(),
    windows: [{ label: i18n(cfg.lang).fiveHour, usedPct: 41, resetsAt: Date.now() + 2.7 * 36e5 },
              { label: i18n(cfg.lang).weekly, usedPct: 12, resetsAt: Date.now() + 3.8 * 864e5 },
              { label: i18n(cfg.lang).weekly + ' Opus', usedPct: 87, resetsAt: Date.now() + 3.8 * 864e5 }] },
];

async function poll(force = false) {
  if (DEMO) { DEMO.forEach(d => { state[d.id] = d; }); cfg.accounts = DEMO.map(({ id, type }) => ({ id, type, home: `~/.${id}` })); return push(); }
  if (polling) return;
  polling = true;
  await Promise.all(cfg.accounts.map(async a => {
    if (!force && notBefore[a.id] > Date.now()) return;
    const prev = state[a.id] || {};
    try {
      state[a.id] = { ...a, ...(await providers[a.type].fetch(providers.expand(a.home), cfg.lang)), error: null, soft: false, updatedAt: Date.now() };
    } catch (e) {
      if (e.retryAfter) notBefore[a.id] = Date.now() + e.retryAfter * 1000;
      state[a.id] = { ...a, ...prev, loggedIn: true, soft: !!e.retryAfter, error: e.retryAfter ? i18n(cfg.lang).rateLimited(e.retryAfter) : e.message };
    }
  }));
  for (const id of Object.keys(state)) if (!cfg.accounts.some(a => a.id === id)) delete state[id];
  polling = false;
  push();
}

const LANGS = ['en', 'zh', 'ko'];
const LANG_NAMES = [['ko', '한국어'], ['en', 'English'], ['zh', '中文']]; // dropdown order
function trayMenu() {
  const t = i18n(cfg.lang);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t.trayOpenClose, click: toggle },
    { label: t.trayRefresh, click: () => poll(true) },
    { type: 'separator' },
    { label: t.trayAutostart, type: 'checkbox', checked: isAutostart(), click: m => autostart(m.checked) },
    { label: t.trayOpenConfig, click: () => shell.openPath(CFG_FILE) },
    { type: 'separator' },
    { label: t.trayQuit, click: () => app.quit() },
  ]));
}

function push() {
  const list = cfg.accounts.map(a => state[a.id] || a);
  win?.webContents.send('state', { list, hotkey: cfg.hotkey, theme: cfg.theme, lang: cfg.lang });
  const used = list.flatMap(s => (s.windows || []).map(w => w.usedPct));
  const worst = used.length ? Math.max(...used) : null;
  tray.setImage(icon(worst));
  const t = i18n(cfg.lang);
  tray.setToolTip(list.map(s => `${s.name || s.id}: ${s.loggedIn ? (s.windows || []).map(w => `${w.label} ${Math.round(100 - w.usedPct)}% ${t.left}`).join(' · ') || '-' : t.loginRequired}`).join('\n'));
  trayMenu();
}

// ---- tray icon: ring gauge rendered to PNG ---------------------------------
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function icon(usedPct) {
  const S = 32, c = (S - 1) / 2, R = 14.5, r = 8.5, buf = Buffer.alloc(S * S * 4);
  const col = usedPct == null ? [150, 154, 170] : usedPct < 50 ? [52, 211, 153] : usedPct < 80 ? [251, 191, 36] : [248, 113, 113];
  const frac = (usedPct ?? 0) / 100;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
    const cov = Math.min(1, Math.max(0, R + 0.5 - d)) * Math.min(1, Math.max(0, d - r + 0.5));
    if (cov <= 0) continue;
    let ang = Math.atan2(dx, -dy); if (ang < 0) ang += Math.PI * 2;
    const on = ang / (Math.PI * 2) <= frac;
    const [cr, cg, cb] = on ? col : [255, 255, 255];
    const i = (y * S + x) * 4;
    buf[i] = cr; buf[i + 1] = cg; buf[i + 2] = cb; buf[i + 3] = Math.round(255 * cov * (on ? 1 : 0.3));
  }
  return nativeImage.createFromBuffer(png(S, S, buf), { scaleFactor: 2 });
}

// ---- window ----------------------------------------------------------------
const W = 400;
function place(h) {
  const wa = screen.getPrimaryDisplay().workArea;
  const H = Math.max(160, Math.min(Math.ceil(h), wa.height - 24));
  win.setBounds({ x: wa.x + wa.width - W - 12, y: wa.y + wa.height - H - 12, width: W, height: H });
}
function toggle() {
  if (win.isVisible()) return win.hide();
  place(win.getBounds().height);
  win.show(); win.focus();
  poll(true);
}

// ---- login / logout ----------------------------------------------------------
function login(a) {
  const home = providers.expand(a.home), p = providers[a.type], t = i18n(cfg.lang);
  fs.mkdirSync(home, { recursive: true });
  spawn('cmd.exe', ['/c', 'start', `"${t.loginTitle(a.id)}"`, 'cmd', '/c', `"${p.loginCmd} & echo. & echo ${t.loginDone} & pause"`],
    { env: { ...process.env, ...p.env(home) }, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  const f = p.credFile(home);
  const before = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
  let n = 0;
  const timer = setInterval(() => {
    if ((fs.existsSync(f) && fs.statSync(f).mtimeMs > before) || ++n > 150) { clearInterval(timer); poll(true); }
  }, 2000);
}
async function logout(a) {
  const f = providers[a.type].credFile(providers.expand(a.home)), t = i18n(cfg.lang);
  suppressHide = true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: [t.logoutConfirm, t.cancel], defaultId: 1, cancelId: 1,
    message: t.logoutTitle(state[a.id]?.name || a.id), detail: t.logoutDetail(f),
  });
  suppressHide = false;
  if (response === 0) { fs.rmSync(f, { force: true }); poll(true); }
}
function addAccount(type) {
  let n = 1; while (cfg.accounts.some(a => a.id === `${type}-${n}`)) n++;
  const a = { id: `${type}-${n}`, type, home: `~/.${type}-${n}` };
  cfg.accounts.push(a); saveCfg(); poll(true); login(a);
}
const move = (from, to) => { cfg.accounts.splice(to, 0, ...cfg.accounts.splice(from, 1)); saveCfg(); push(); };
const popup = template => { suppressHide = true; Menu.buildFromTemplate(template).popup({ window: win, callback: () => { suppressHide = false; } }); };

// ---- autostart -----------------------------------------------------------------
const loginItem = app.isPackaged ? { path: process.execPath, args: [] } : { path: process.execPath, args: [path.resolve(__dirname)] };
const autostart = on => app.setLoginItemSettings({ openAtLogin: on, ...loginItem });
const isAutostart = () => app.getLoginItemSettings(loginItem).openAtLogin;

// ---- settings ----------------------------------------------------------------------
function setHotkey(acc) {
  if (acc === cfg.hotkey) return { ok: true };
  globalShortcut.unregister(cfg.hotkey);
  if (!globalShortcut.register(acc, toggle)) { globalShortcut.register(cfg.hotkey, toggle); return { ok: false, error: i18n(cfg.lang).hotkeyFailed }; }
  cfg.hotkey = acc; saveCfg(); push();
  return { ok: true };
}

// ---- ipc -------------------------------------------------------------------------
ipcMain.handle('set-hotkey', (_, acc) => setHotkey(acc));
ipcMain.handle('set-theme', (_, t) => { cfg.theme = t === 'light' ? 'light' : 'dark'; saveCfg(); push(); });
ipcMain.handle('set-lang', (_, l) => { if (LANGS.includes(l)) { cfg.lang = l; saveCfg(); push(); } });
ipcMain.handle('reorder', (_, ids) => {          // ids: the account order the drag ended on
  const byId = new Map(cfg.accounts.map(a => [a.id, a]));
  const next = ids.map(id => byId.get(id)).filter(Boolean);
  for (const a of cfg.accounts) if (!ids.includes(a.id)) next.push(a);
  cfg.accounts = next; saveCfg(); push();
});
ipcMain.handle('menu-lang', () => popup(LANG_NAMES.map(([id, label]) => ({
  label, type: 'radio', checked: cfg.lang === id, click: () => { cfg.lang = id; saveCfg(); push(); },
}))));
ipcMain.handle('refresh', () => poll(true));
ipcMain.handle('hide', () => win.hide());
ipcMain.handle('resize', (_, h) => place(h));
ipcMain.handle('menu-add', () => { const t = i18n(cfg.lang); popup([
  { label: t.addCodex, click: () => addAccount('codex') },
  { label: t.addClaude, click: () => addAccount('claude') },
]); });
ipcMain.handle('menu', (_, id) => {
  const i = cfg.accounts.findIndex(x => x.id === id), a = cfg.accounts[i], s = state[id] || {}, t = i18n(cfg.lang);
  popup([
    { label: s.loggedIn ? t.reLoginWeb : t.loginWeb, click: () => login(a) },
    { label: t.logout, enabled: !!s.loggedIn, click: () => logout(a) },
    { type: 'separator' },
    { label: t.openCredFolder, click: () => shell.openPath(providers.expand(a.home)) },
    { type: 'separator' },
    { label: t.moveUp, enabled: i > 0, click: () => move(i, i - 1) },
    { label: t.moveDown, enabled: i < cfg.accounts.length - 1, click: () => move(i, i + 1) },
    { type: 'separator' },
    { label: t.removeAccount, click: () => { cfg.accounts = cfg.accounts.filter(x => x.id !== id); saveCfg(); poll(true); } },
  ]);
});

// ---- boot --------------------------------------------------------------------------
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: W, height: 420, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('blur', () => { if (!suppressHide) win.hide(); });
  win.webContents.on('did-finish-load', push);
  if (process.env.TOKENMETER_SHOT) win.webContents.on('did-finish-load', () => setTimeout(async () => { // self-check: render once, save PNG, quit
    win.show(); await new Promise(r => setTimeout(r, 1500));
    fs.writeFileSync(process.env.TOKENMETER_SHOT, (await win.webContents.capturePage()).toPNG()); app.quit();
  }, 5000));

  tray = new Tray(icon(null));
  tray.on('click', toggle);
  trayMenu();

  if (!globalShortcut.register(cfg.hotkey, toggle)) console.error('hotkey register failed:', cfg.hotkey);
  if (firstRun) autostart(true);
  app.on('second-instance', () => { if (!win.isVisible()) toggle(); });

  poll(true);
  setInterval(poll, cfg.pollSeconds * 1000);
});
app.on('window-all-closed', e => e.preventDefault());
