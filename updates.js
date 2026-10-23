const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const repository = 'https://github.com/HSoo-Kim/TokenMeter';
const latestApi = 'https://api.github.com/repos/HSoo-Kim/TokenMeter/releases/latest';
const maxInstallerSize = 512 * 1024 * 1024;

function version(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function parseRelease(data) {
  if (data?.draft || data?.prerelease) return null;
  const parts = version(data?.tag_name);
  if (!parts || data.html_url !== `${repository}/releases/tag/${data.tag_name}`) {
    throw new Error('Invalid TokenMeter release');
  }
  const number = parts.join('.');
  const name = `TokenMeter-Setup-${number}.exe`;
  const asset = Array.isArray(data.assets) ? data.assets.find(a => a.name === name) : undefined;
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset?.digest);
  const url = `${repository}/releases/download/${data.tag_name}/${name}`;
  const installer = asset?.browser_download_url === url && digest &&
    Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maxInstallerSize
    ? { name, url, sha256: digest[1].toLowerCase(), size: asset.size } : null;
  return { tag: data.tag_name, version: number, url: data.html_url, installer };
}

async function check(current, request = fetch) {
  const installed = version(current);
  if (!installed) throw new Error('Invalid installed version');
  const response = await request(latestApi, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `TokenMeter/${current}` },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Update check HTTP ${response.status}`);
  const release = parseRelease(await response.json());
  if (!release) return null;
  const available = version(release.version);
  const different = available.findIndex((part, index) => part !== installed[index]);
  return different !== -1 && available[different] > installed[different] ? release : null;
}

async function download(release, directory, request = fetch) {
  if (!release.installer) throw new Error('Release has no verified installer');
  const { name, url, sha256, size } = release.installer;
  await fs.promises.mkdir(directory, { recursive: true });
  const staging = await fs.promises.mkdtemp(path.join(directory, 'pending-'));
  const file = path.join(staging, name);
  try {
    const response = await request(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Installer download HTTP ${response.status}`);
    const hash = createHash('sha256');
    let bytes = 0;
    const verify = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > size) { callback(new Error('Installer size mismatch')); return; }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), verify, fs.createWriteStream(file, { flags: 'wx' }));
    if (bytes !== size || hash.digest('hex') !== sha256) throw new Error('Installer SHA-256 or size mismatch');
    return file;
  } catch (error) {
    await fs.promises.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function install(file, executable, start = spawn) {
  // /D must be the final argument. NSIS preserves the current install folder.
  const child = start(file, ['/S', '--updated', '--force-run', `/D=${path.dirname(executable)}`], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  // Quit only after Windows has accepted the installer, not after a failed spawn.
  await once(child, 'spawn');
  child.unref();
}

module.exports = { check, download, install, parseRelease };
