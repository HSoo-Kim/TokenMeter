// Gemini app usage, separate from Gemini CLI and Antigravity quotas.
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('./i18n');
const PAGE = 'https://gemini.google.com/usage';
const LOGIN_PAGE = 'https://accounts.google.com/ServiceLogin?continue=' + encodeURIComponent(PAGE);
// UsagePageQuery, CodexBar PR #4535 (merged 499a1feba5f0092853dab865ce56c5e047108830).
const QUERY = '2/dWbCvkVB0X16r9NPnxifeOAAqdCqMf0xeWvau9yPy7g=';
const VARIABLES = {
  g1Request: { entrypoints: ['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER'] },
  workspaceRequest: { recommendationsForSurfaceRequests: [] },
};
const URL_USAGE = 'https://gemini.google.com/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery'
  + `?query_signature=${encodeURIComponent(QUERY)}&variables=${encodeURIComponent(JSON.stringify(VARIABLES))}`;
const logins = new Map();
const signedOut = () => ({ loggedIn: false, windows: [] });

function parseUsage(text, lang = 'en') {
  const t = i18n(lang);
  const invalid = () => { throw new Error(t.geminiQuotaUnavailable); };
  let results;
  try { results = JSON.parse(text.trim().replace(/^\)\]\}'\s*/, '')); }
  catch { return invalid(); }
  if (!Array.isArray(results)) return invalid();
  const data = results.map(r => r?.data).find(d => d && Object.hasOwn(d, 'viewer'));
  if (!data) return invalid();
  if (data.viewer === null) return signedOut();
  const usage = data.viewer?.rpcs?.getUsageInfo;
  if (!usage || !Array.isArray(usage.pools)) return invalid();
  const windows = [];
  for (const [type, label] of [['GXU_FIVE_HOURLY', t.geminiSession], ['GXU_WEEKLY', t.weekly]]) {
    const pool = usage.pools.find(p => p?.poolType === type);
    const fraction = pool?.percentageUsed;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
    const reset = pool.gxu?.windowRefreshesAt;
    const ms = typeof reset === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(reset) ? Date.parse(reset) : NaN;
    windows.push({ label, usedPct: fraction * 100, resetsAt: Number.isFinite(ms) ? ms : null });
  }
  return {
    loggedIn: true, plan: usage.subscriptionTier === 'TIER1' ? 'Pro' : undefined, windows,
    ...(windows.length ? {} : { error: t.geminiNoQuota }),
  };
}

async function requestUsage(fetch, lang = 'en') {
  const r = await fetch(URL_USAGE, {
    method: 'GET', credentials: 'include', cache: 'no-store',
    headers: { Accept: 'application/json', Referer: PAGE },
  });
  if (r.status === 401 || r.status === 403) return signedOut();
  if (r.status === 429) throw Object.assign(new Error('rate limited'), { retryAfter: +r.headers.get('retry-after') || 60 });
  if (!r.ok) throw new Error(i18n(lang).usageApiFailed(r.status));
  const text = await r.text();
  if (text.trimStart().startsWith('<')) return signedOut();
  return parseUsage(text, lang);
}

async function ownSession(home) {
  const { app, session } = require('electron');
  await app.whenReady();
  return session.fromPath(path.resolve(home));
}

module.exports = {
  credFile: home => path.resolve(home),
  accountHome: n => `~/.tokenmeter/gemini-web-${n}`,
  async fetch(home, lang = 'en') {
    if (!fs.existsSync(home)) return signedOut();
    const ses = await ownSession(home);
    return requestUsage(ses.fetch.bind(ses), lang);
  },
  async login(home, lang = 'en') {
    const key = path.resolve(home);
    const active = logins.get(key);
    if (active) { active.win.show(); active.win.focus(); return active.done; }
    fs.mkdirSync(key, { recursive: true });
    const ses = await ownSession(key);
    const { BrowserWindow } = require('electron');
    const win = new BrowserWindow({
      width: 900, height: 760, title: i18n(lang).geminiSignIn, autoHideMenuBar: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const children = new Set();
    // Popups inherit this sandbox/session; only web pages may open, including enterprise SSO.
    win.webContents.setWindowOpenHandler(({ url }) => ({
      action: url.startsWith('https://') ? 'allow' : 'deny',
      overrideBrowserWindowOptions: { webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } },
    }));
    win.webContents.on('did-create-window', child => {
      children.add(child);
      child.once('closed', () => children.delete(child));
    });
    // Closing is cancellation or completion. Only the next fetch can confirm authentication.
    let closing = false;
    win.once('close', () => { closing = true; });
    const done = new Promise((resolve, reject) => {
      win.once('closed', () => {
        closing = true;
        logins.delete(key);
        for (const child of children) child.destroy();
        ses.cookies.flushStore().then(resolve, reject);
      });
      win.loadURL(LOGIN_PAGE).catch(error => {
        if (!closing) { reject(error); win.destroy(); }
      });
    });
    logins.set(key, { win, done });
    return done;
  },
  async logout(home) {
    logins.get(path.resolve(home))?.win.destroy();
    if (!fs.existsSync(home)) return;
    const ses = await ownSession(home);
    await ses.closeAllConnections();
    await ses.clearData();
    await ses.clearAuthCache();
  },
  parseUsage, requestUsage,
};
