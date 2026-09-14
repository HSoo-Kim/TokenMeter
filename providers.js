// providers.js — read CLI credential files, refresh when expired, fetch quota. Normalized result:
// { loggedIn, name, plan, windows: [{ label, usedPct, resetsAt }] }
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const expand = p => p.replace(/^~(?=$|[\/])/, HOME).replace(/%USERPROFILE%/i, HOME);
const jwt = t => JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const writeJson = (file, obj) => { fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2)); fs.renameSync(file + '.tmp', file); };
const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const i18n = require('./i18n');
const winLabel = (sec, t) => (sec === 18000 ? t.fiveHour : sec === 604800 ? t.weekly : `${Math.round(sec / 3600)}h`);

async function postJson(url, body, t) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(t.refreshFailed(r.status));
  return r.json();
}

const codex = {
  credFile: home => path.join(home, 'auth.json'),
  env: home => ({ CODEX_HOME: home }),
  loginCmd: 'codex login',
  async refresh(file, a, t = i18n('en')) {
    const j = await postJson('https://auth.openai.com/oauth/token', {
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', grant_type: 'refresh_token',
      refresh_token: a.tokens.refresh_token, scope: 'openid profile email',
    }, t);
    Object.assign(a.tokens, { access_token: j.access_token, refresh_token: j.refresh_token || a.tokens.refresh_token, id_token: j.id_token || a.tokens.id_token });
    a.last_refresh = new Date().toISOString();
    writeJson(file, a);
    return a.tokens;
  },
  async fetch(home, lang = 'en') {
    const t = i18n(lang);
    const file = this.credFile(home);
    const a = readJson(file);
    if (!a) return { loggedIn: false };
    let tok = a.tokens;
    if (!tok?.access_token) return { loggedIn: false, error: a.OPENAI_API_KEY ? t.apiKeyMode : null };
    if (jwt(tok.access_token).exp * 1000 < Date.now() + 60_000) tok = await this.refresh(file, a, t);
    const call = () => fetch('https://chatgpt.com/backend-api/wham/usage', { headers: { Authorization: `Bearer ${tok.access_token}`, 'ChatGPT-Account-Id': tok.account_id } });
    let r = await call();
    if (r.status === 401) { tok = await this.refresh(file, a, t); r = await call(); }
    if (r.status === 429) throw Object.assign(new Error('rate limited'), { retryAfter: +r.headers.get('retry-after') || 60 });
    if (!r.ok) throw new Error(t.usageApiFailed(r.status));
    const j = await r.json();
    const rl = j.rate_limit || {};
    const windows = [rl.primary_window, rl.secondary_window].filter(Boolean)
      .map(w => ({ label: winLabel(w.limit_window_seconds, t), usedPct: w.used_percent, resetsAt: w.reset_at * 1000 }));
    return { loggedIn: true, name: j.email, plan: j.plan_type, windows };
  },
};

const claudeProfile = {}; // home -> cached { name, org }
const claude = {
  credFile: home => path.join(home, '.credentials.json'),
  env: home => ({ CLAUDE_CONFIG_DIR: home }),
  loginCmd: 'claude auth login',
  async refresh(file, d, t = i18n('en')) {
    const c = d.claudeAiOauth;
    const j = await postJson('https://console.anthropic.com/v1/oauth/token', {
      grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    }, t);
    Object.assign(c, { accessToken: j.access_token, refreshToken: j.refresh_token || c.refreshToken, expiresAt: Date.now() + j.expires_in * 1000 });
    writeJson(file, d);
    return c;
  },
  async fetch(home, lang = 'en') {
    const t = i18n(lang);
    const file = this.credFile(home);
    const d = readJson(file);
    let c = d?.claudeAiOauth;
    if (!c?.accessToken) return { loggedIn: false };
    if (c.expiresAt < Date.now() + 60_000) c = await this.refresh(file, d, t);
    const headers = () => ({ Authorization: `Bearer ${c.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' });
    let r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: headers() });
    if (r.status === 401) { c = await this.refresh(file, d, t); r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: headers() }); }
    if (r.status === 429) throw Object.assign(new Error('rate limited'), { retryAfter: +r.headers.get('retry-after') || 60 });
    if (!r.ok) throw new Error(t.usageApiFailed(r.status));
    const j = await r.json();
    // `limits` carries every window incl. model-scoped weekly ones (e.g. Fable); legacy keys as fallback
    const kindLabel = { session: t.fiveHour, weekly_all: t.weekly, weekly_scoped: t.weekly };
    const windows = Array.isArray(j.limits) && j.limits.length
      ? j.limits.filter(l => kindLabel[l.kind] && l.percent != null)
          .map(l => ({ label: [kindLabel[l.kind], l.scope?.model?.display_name].filter(Boolean).join(' '), usedPct: l.percent, resetsAt: Date.parse(l.resets_at) }))
      : Object.entries({ five_hour: t.fiveHour, seven_day: t.weekly, seven_day_opus: `${t.weekly} Opus`, seven_day_sonnet: `${t.weekly} Sonnet` })
          .filter(([k]) => j[k]?.utilization != null)
          .map(([k, label]) => ({ label, usedPct: j[k].utilization, resetsAt: Date.parse(j[k].resets_at) }));
    if (!claudeProfile[home]) {
      try {
        const p = await (await fetch('https://api.anthropic.com/api/oauth/profile', { headers: headers() })).json();
        claudeProfile[home] = { name: p.account?.email || p.account?.display_name, org: p.organization?.name };
      } catch { claudeProfile[home] = {}; }
    }
    const plan = (c.rateLimitTier || c.subscriptionType || '').replace(/^default_claude_/, '').replace(/_/g, ' ');
    return { loggedIn: true, name: claudeProfile[home].name, plan, windows };
  },
};

module.exports = { codex, claude, expand };
