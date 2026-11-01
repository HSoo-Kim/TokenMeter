// Read-only quota access to the running Antigravity language server.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const i18n = require('./i18n');

const run = promisify(execFile);
const service = '/exa.language_server_pb.LanguageServerService/';
const metadata = { ideName: 'antigravity', extensionName: 'antigravity', ideVersion: 'unknown', locale: 'en' };
const installRoots = () => [
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Antigravity'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antigravity'),
];
const serverFiles = root => [
  path.join(root, 'resources', 'bin', 'language_server.exe'),
  path.join(root, 'resources', 'app', 'extensions', 'antigravity', 'bin', 'language_server_windows_x64.exe'),
];
const normalizedPath = value => path.win32.normalize(value).toLowerCase();
// macOS bundles: Antigravity.app (2.x app) or "Antigravity IDE.app", system-wide or per user.
const macApps = (dirs = ['/Applications', path.join(os.homedir(), 'Applications')]) => dirs.flatMap(dir => {
  try { return fs.readdirSync(dir).filter(name => /^Antigravity( IDE)?\.app$/.test(name)).map(name => path.join(dir, name)); }
  catch { return []; }
});
const macServer = /^language_server(?:_macos(?:_arm|_x64)?)?$/;
const flag = (command, name) => new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)(?:"([^"]+)"|([^\\s"]+))`).exec(command || '')?.slice(1).find(Boolean);
const validPort = value => Number.isInteger(value) && value > 0 && value <= 65535;
const fraction = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
const text = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;

function resetTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const seconds = Number(value);
  const time = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function parseQuota(data, t = i18n('en')) {
  if (!data || (data.code != null && ![0, '0', 'ok', 'success'].includes(typeof data.code === 'string' ? data.code.toLowerCase() : data.code))) {
    throw new Error('Invalid Antigravity quota response');
  }
  const status = data.userStatus;
  const plan = status?.planStatus?.planInfo;
  const result = {
    loggedIn: true,
    name: text(status?.email),
    plan: text(status?.userTier?.name) || [plan?.planDisplayName, plan?.displayName, plan?.productName, plan?.planName, plan?.planShortName].map(text).find(Boolean),
    windows: [],
  };
  const summary = data.response || data.summary || data;
  if (Array.isArray(summary.groups)) {
    for (const group of summary.groups) {
      for (const bucket of Array.isArray(group.buckets) ? group.buckets : []) {
        const remaining = fraction(bucket.remainingFraction ?? bucket.remaining?.remainingFraction ??
          (bucket.remaining?.case === 'remainingFraction' ? bucket.remaining.value : undefined));
        if (bucket.disabled || remaining === null) continue;
        const id = text(bucket.bucketId) || text(bucket.id);
        if (!id) continue;
        const label = text(bucket.displayName) || text(bucket.name) || id;
        const cadence = (text(bucket.window) || label).toLowerCase().replace(/_/g, '-');
        const window = /^(session|5h|5-hour|five hour|five-hour)$/.test(cadence) ? t.fiveHour :
          cadence === 'weekly' ? t.weekly : label;
        result.windows.push({
          label: [text(group.displayName) || text(group.name), window].filter(Boolean).join(' '),
          usedPct: 100 * (1 - remaining), resetsAt: resetTime(bucket.resetTime),
        });
      }
    }
  } else {
    const models = status?.cascadeModelConfigData?.clientModelConfigs || data.clientModelConfigs;
    for (const model of Array.isArray(models) ? models : []) {
      const remaining = fraction(model.quotaInfo?.remainingFraction);
      const label = text(model.label) || text(model.modelOrAlias?.model);
      if (remaining === null || !label) continue;
      result.windows.push({ label, usedPct: 100 * (1 - remaining), resetsAt: resetTime(model.quotaInfo.resetTime) });
    }
  }
  return result;
}

function parseProcesses(processes, netstat, roots = installRoots()) {
  const expected = new Set(roots.flatMap(serverFiles).map(normalizedPath));
  const entries = Array.isArray(processes) ? processes : processes ? [processes] : [];
  return entries.flatMap(process => {
    if (!text(process.ExecutablePath) || !expected.has(normalizedPath(process.ExecutablePath))) return [];
    if (!Number.isInteger(process.ProcessId) || process.ProcessId < 1) return [];
    const token = flag(process.CommandLine, 'csrf_token');
    if (!token || /[\r\n]/.test(token)) return [];
    const listeners = netstat.split(/\r?\n/).map(line => line.trim().split(/\s+/))
      .filter(fields => fields[0] === 'TCP' && fields[3] === 'LISTENING' && Number(fields[4]) === process.ProcessId)
      .map(fields => fields[1]);
    return [{ endpoints: loopbackEndpoints(listeners, token) }];
  });
}

// "127.0.0.1:port" / "[::1]:port" listeners -> unique endpoints; wildcard and LAN binds are ignored.
function loopbackEndpoints(addresses, token) {
  const ports = new Map();
  for (const value of addresses) {
    const address = /^(127\.0\.0\.1|\[::1\]):(\d+)$/.exec(value);
    if (!address || !validPort(Number(address[2]))) continue;
    const host = address[1] === '[::1]' ? '::1' : '127.0.0.1';
    ports.set(`${host}:${address[2]}`, { host, port: Number(address[2]), token });
  }
  return [...ports.values()];
}

// lsof -F output ("p<pid>", "f<fd>", "n<name>" lines) -> pid -> names, in lsof order.
function lsofNames(output) {
  const names = new Map();
  let current;
  for (const line of output.split('\n')) {
    if (line[0] === 'p') names.set(current = Number(line.slice(1)), []);
    else if (line[0] === 'n' && current) names.get(current).push(line.slice(1));
  }
  return names;
}

// ps: `ps -ax -o pid=,args=`; files: lsof txt names (the executable comes first);
// sockets: lsof TCP listeners. Only language servers inside an installed Antigravity bundle count.
function parseMacProcesses(ps, files, sockets, apps = macApps()) {
  const executables = lsofNames(files), listeners = lsofNames(sockets);
  return ps.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    const pid = Number(match?.[1]), executable = executables.get(pid)?.[0];
    if (!executable || !macServer.test(path.posix.basename(executable)) ||
        !apps.some(app => executable.startsWith(`${app}/Contents/`))) return [];
    const token = flag(match[2], 'csrf_token');
    if (!token || /[\r\n]/.test(token)) return [];
    return [{ endpoints: loopbackEndpoints(listeners.get(pid) || [], token) }];
  });
}

// lsof exits 1 when nothing matches; that is an empty result, not a failure.
const lsof = args => run('/usr/sbin/lsof', args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024 })
  .then(r => r.stdout, error => { if (error.code === 1) return error.stdout || ''; throw error; });

async function discover() {
  if (process.platform === 'darwin') {
    // Only the relevant processes are queried. Never log their CSRF-bearing command lines.
    const { stdout: ps } = await run('/bin/ps', ['-ax', '-o', 'pid=,args='], { timeout: 4000, maxBuffer: 8 * 1024 * 1024 });
    const candidates = ps.split('\n').filter(line => line.includes('language_server') && line.includes('--csrf_token'));
    const pids = candidates.map(line => /^\s*(\d+)\s/.exec(line)?.[1]).filter(Boolean).join(',');
    if (!pids) return [];
    const [files, sockets] = await Promise.all([
      lsof(['-nP', '-a', '-p', pids, '-d', 'txt', '-Fpn']),
      lsof(['-nP', '-a', '-p', pids, '-iTCP', '-sTCP:LISTEN', '-Fpn']),
    ]);
    return parseMacProcesses(candidates.join('\n'), files, sockets);
  }
  if (process.platform !== 'win32') return [];
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  // Only the relevant process is queried. Never log its CSRF-bearing command line.
  const { stdout } = await run(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='language_server.exe' OR Name='language_server_windows_x64.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
  ], { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 });
  if (!stdout.trim()) return [];
  const processes = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  const { stdout: sockets } = await run(path.join(system, 'netstat.exe'), ['-ano', '-p', 'tcp'], {
    windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024,
  });
  return parseProcesses(processes, sockets);
}

function requestLocal(endpoint, method, deadline = Date.now() + 1500) {
  const { host, port, token, scheme } = endpoint;
  if (!['127.0.0.1', '::1'].includes(host) || !validPort(port) ||
      !['http:', 'https:'].includes(scheme) || !text(token) || /[\r\n]/.test(token) ||
      !['RetrieveUserQuotaSummary', 'GetUserStatus', 'GetCommandModelConfigs'].includes(method)) {
    return Promise.reject(new Error('Invalid Antigravity local endpoint'));
  }
  if (Date.now() >= deadline) return Promise.reject(new Error('Antigravity quota deadline'));
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(method === 'RetrieveUserQuotaSummary' ? { forceRefresh: true } : { metadata });
    const request = (scheme === 'https:' ? https : http).request({
      hostname: host, port, method: 'POST', path: service + method,
      // Antigravity generates a self-signed local certificate. This exception
      // applies only to the literal loopback address of its verified process.
      rejectUnauthorized: false,
      agent: false,
      signal: AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now()))),
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': token,
      },
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('Antigravity local RPC unavailable'));
        return;
      }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) { response.destroy(new Error('Antigravity response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid Antigravity JSON')); }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function fetchQuota(lang = 'en', find = discover, request = requestLocal) {
  const t = i18n(lang);
  let processes;
  try { processes = await find(); } catch { return { loggedIn: false, windows: [], error: t.antigravityUnavailable }; }
  if (!processes.length) return { loggedIn: false, windows: [], error: t.antigravityNotRunning };
  const deadline = Date.now() + 10000;
  let identity;
  for (const process of processes) {
    for (const scheme of ['https:', 'http:']) {
      for (const endpoint of process.endpoints) {
        let summary;
        for (const method of ['RetrieveUserQuotaSummary', 'GetUserStatus', 'GetCommandModelConfigs']) {
          if (Date.now() >= deadline) break;
          try {
            const data = await request({ ...endpoint, scheme }, method, deadline);
            const parsed = parseQuota(data, t);
            if (data.userStatus) identity = parsed;
            if (method === 'RetrieveUserQuotaSummary' && parsed.windows.length) { summary = parsed; continue; }
            if (summary || parsed.windows.length) {
              const result = summary || parsed;
              return { ...result, name: identity?.name || result.name, plan: identity?.plan || result.plan };
            }
          } catch { /* A different owned listener or RPC may be available. */ }
          if (summary && method === 'GetUserStatus') return { ...summary, name: identity?.name, plan: identity?.plan };
        }
      }
    }
  }
  return identity
    ? { ...identity, error: t.antigravityNoQuota }
    : { loggedIn: false, windows: [], error: t.antigravityUnavailable };
}

const antigravity = {
  shared: true,
  accountHome: () => '~/.gemini/antigravity',
  credFile: home => path.join(home, 'app_storage.json'),
  async login(home, lang = 'en') {
    const executable = process.platform === 'darwin' ? macApps()[0]
      : installRoots().map(root => path.join(root, 'Antigravity.exe')).find(file => fs.existsSync(file));
    if (!executable) throw new Error(i18n(lang).antigravityNotInstalled);
    const error = await require('electron').shell.openPath(executable);
    if (error) throw new Error(i18n(lang).antigravityUnavailable);
  },
  async fetch(home, lang = 'en') { return fetchQuota(lang); },
};

module.exports = antigravity;
Object.defineProperty(module.exports, '_test', { value: { parseQuota, parseProcesses, parseMacProcesses, macApps, requestLocal, fetchQuota } });
