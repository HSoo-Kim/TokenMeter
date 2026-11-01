// macOS login keychain through /usr/bin/security, the same tool Claude Code uses for its items,
// so reading them needs no extra keychain prompt. Secrets never go to logs or error messages.
const { execFile } = require('node:child_process');

const SECURITY = '/usr/bin/security';
const NOT_FOUND = 44;
const INTERACTIVE_LIMIT = 4032; // `security -i` truncates longer input lines

function run(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(SECURITY, args, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (!error) return resolve({ code: 0, stdout });
      if (Number.isInteger(error.code)) return resolve({ code: error.code, stdout });
      reject(new Error(`Keychain access failed (${error.code || error.signal || 'unknown'})`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
const failed = (code, action) => new Error(`Keychain ${action} failed (${code})`);

// JSON stored in the first generic item for `service`, or null when there is none.
async function readJson(service) {
  const { code, stdout } = await run(['find-generic-password', '-s', service, '-w']);
  if (code === NOT_FOUND) return null;
  if (code) throw failed(code, 'read');
  const value = stdout.replace(/\n$/, '');
  // `security -w` prints hex instead of text when the stored bytes are not plain ASCII.
  try { return JSON.parse(value); } catch {}
  if (/^(?:[0-9a-f]{2})+$/i.test(value)) {
    try { return JSON.parse(Buffer.from(value, 'hex').toString('utf8')); } catch {}
  }
  throw new Error('Keychain item is not JSON');
}

// Non-secret attributes: owning account and last-modified stamp.
async function attributes(service) {
  const { code, stdout } = await run(['find-generic-password', '-s', service]);
  if (code === NOT_FOUND) return null;
  if (code) throw failed(code, 'read');
  return {
    account: /^\s*"acct"<blob>="(.*)"$/m.exec(stdout)?.[1],
    modified: /^\s*"mdat"<timedate>=\S+\s+"([^"\\]+)/m.exec(stdout)?.[1] || '',
  };
}

async function writeJson(service, account, value) {
  if (!/^[\w.@-]+$/.test(account) || /["\\\n]/.test(service)) throw new Error('Invalid keychain item name');
  const hex = Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
  const line = `add-generic-password -U -a "${account}" -s "${service}" -X "${hex}"\n`;
  // stdin keeps the token out of the process list; argv only for oversized items, as Claude Code does.
  const { code } = line.length <= INTERACTIVE_LIMIT
    ? await run(['-i'], line)
    : await run(['add-generic-password', '-U', '-a', account, '-s', service, '-X', hex]);
  if (code) throw failed(code, 'write');
}

async function remove(service) {
  const { code } = await run(['delete-generic-password', '-s', service]);
  if (code && code !== NOT_FOUND) throw failed(code, 'delete');
}

module.exports = { readJson, attributes, writeJson, remove };
