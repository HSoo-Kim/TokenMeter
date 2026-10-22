// Legacy licensed Code Assist quota, not Gemini web or consumer Antigravity quota.
// Protocol: google-gemini/gemini-cli packages/core/src/code_assist/{oauth2,server,types}.ts
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('./i18n');

const ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:';

const gemini = {
  credFile: home => path.join(home, 'oauth_creds.json'),
  accountHome: n => `~/.tokenmeter/gemini-cli-${n}/.gemini`,
  env: home => ({
    GEMINI_CLI_HOME: path.dirname(home),
    GEMINI_FORCE_ENCRYPTED_FILE_STORAGE: 'false',
    GEMINI_API_KEY: '', GOOGLE_API_KEY: '', GOOGLE_GENAI_USE_VERTEXAI: '',
  }),
  loginCmd: 'gemini',
  async fetch(home, lang = 'en') {
    const t = i18n(lang), file = this.credFile(home);
    if (!fs.existsSync(file)) return { loggedIn: false, error: t.geminiCliSetup };
    const auth = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!auth.access_token && !auth.refresh_token) return { loggedIn: false, error: t.geminiCliSetup };
    const settingsFile = path.join(home, 'settings.json');
    const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
    const refresh = async () => {
      if (!auth.refresh_token) throw new Error(t.geminiCliSetup);
      // Use the installed official CLI's own client, never a bundled OAuth client.
      const roots = [
        settings.tokenmeter?.cliPath,
        ...(process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'node_modules', '@google', 'gemini-cli')),
        path.join(require('node:os').homedir(), '.bun', 'install', 'global', 'node_modules', '@google', 'gemini-cli'),
      ].filter(Boolean);
      let client;
      for (const root of new Set(roots)) {
        const bundle = path.join(root, 'bundle');
        if (!fs.existsSync(bundle)) continue;
        for (const entry of fs.readdirSync(bundle).filter(name => name.endsWith('.js'))) {
          const source = fs.readFileSync(path.join(bundle, entry), 'utf8');
          const id = /\bOAUTH_CLIENT_ID(?:_\d+)?\s*=\s*["']([^"']+)["']/.exec(source)?.[1];
          const secret = /\bOAUTH_CLIENT_SECRET(?:_\d+)?\s*=\s*["']([^"']+)["']/.exec(source)?.[1];
          if (id && secret) { client = { id, secret }; break; }
        }
        if (client) break;
      }
      if (!client) throw new Error(t.geminiCliSetup);
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.id, client_secret: client.secret,
          grant_type: 'refresh_token', refresh_token: auth.refresh_token,
        }).toString(),
      });
      if (!r.ok) throw new Error(t.refreshFailed(r.status));
      const tokens = await r.json();
      if (!tokens.access_token || !Number.isFinite(tokens.expires_in)) throw new Error(t.refreshFailed(r.status));
      Object.assign(auth, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || auth.refresh_token,
        expiry_date: Date.now() + tokens.expires_in * 1000,
      });
      fs.writeFileSync(file + '.tmp', JSON.stringify(auth, null, 2), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
    };
    if (!auth.access_token || (auth.expiry_date && auth.expiry_date < Date.now() + 60000)) await refresh();
    const request = async (method, body) => {
      const send = () => fetch(ENDPOINT + method, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let r = await send();
      if (r.status === 401) { await refresh(); r = await send(); }
      if (r.status === 429) throw Object.assign(new Error('rate limited'), { retryAfter: +r.headers.get('retry-after') || 60 });
      if (!r.ok) throw new Error(t.usageApiFailed(r.status));
      return r.json();
    };
    const configuredProject = settings.tokenmeter?.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (configuredProject && /^\d+$/.test(configuredProject)) throw new Error(t.geminiCliProject);
    const info = await request('loadCodeAssist', {
      cloudaicompanionProject: configuredProject,
      metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI', duetProject: configuredProject },
    });
    if (info.ineligibleTiers?.some(tier => tier.reasonCode === 'UNSUPPORTED_CLIENT')) {
      return { loggedIn: false, error: t.geminiCliDiscontinued };
    }
    const project = info.cloudaicompanionProject || configuredProject;
    if (!info.currentTier || !project) throw new Error(t.geminiCliProject);
    const quota = await request('retrieveUserQuota', { project });
    const windows = (quota.buckets || []).filter(b => Number.isFinite(b.remainingFraction))
      .map(b => ({
        label: [b.modelId || 'Gemini', b.tokenType].filter(Boolean).join(' · '),
        usedPct: (1 - Math.max(0, Math.min(1, b.remainingFraction))) * 100,
        resetsAt: Number.isFinite(Date.parse(b.resetTime)) ? Date.parse(b.resetTime) : undefined,
      }));
    return {
      loggedIn: true, name: auth.id_token ? JSON.parse(Buffer.from(auth.id_token.split('.')[1], 'base64url')).email : undefined,
      plan: info.currentTier.name || info.currentTier.id, windows,
      error: windows.length ? null : t.geminiNoQuota,
    };
  },
};

module.exports = gemini;
