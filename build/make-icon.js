// Generates build/icon.ico (the installer + exe icon) and build/icon.icns (the macOS app icon)
// from the same ring gauge the tray draws.
// Run with: node build/make-icon.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const png = (w, h, rgba) => {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

// Filled dark rounded square, then a 72%-complete gauge ring in the tray green.
// `pad` is the margin around the square; the macOS grid uses about 10% (824 of 1024 px).
function frame(S, pad = 0.055) {
  const buf = Buffer.alloc(S * S * 4);
  const k = (1 - 2 * pad) / 0.89; // artwork scale relative to the Windows icon
  const c = (S - 1) / 2, R = S * 0.43 * k, r = S * 0.27 * k, radius = S * 0.22 * k;
  pad *= S;
  const bg = [26, 28, 36], ring = [52, 211, 153], track = [64, 68, 84];
  const frac = 0.72;
  const px = (x, y, [cr, cg, cb], a) => {
    if (a <= 0) return;
    const i = (y * S + x) * 4, prev = buf[i + 3] / 255, out = a + prev * (1 - a);
    buf[i] = (cr * a + buf[i] * prev * (1 - a)) / out;
    buf[i + 1] = (cg * a + buf[i + 1] * prev * (1 - a)) / out;
    buf[i + 2] = (cb * a + buf[i + 2] * prev * (1 - a)) / out;
    buf[i + 3] = Math.round(out * 255);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // rounded-square background: distance to the inner rect, clamped per axis
    const dx = Math.max(pad + radius - x, 0, x - (S - 1 - pad - radius));
    const dy = Math.max(pad + radius - y, 0, y - (S - 1 - pad - radius));
    px(x, y, bg, Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(dx, dy))));

    const ox = x - c, oy = y - c, d = Math.hypot(ox, oy);
    const cov = Math.min(1, Math.max(0, R + 0.5 - d)) * Math.min(1, Math.max(0, d - r + 0.5));
    if (cov <= 0) continue;
    let ang = Math.atan2(ox, -oy); if (ang < 0) ang += Math.PI * 2;
    const on = ang / (Math.PI * 2) <= frac;
    px(x, y, on ? ring : track, cov * (on ? 1 : 0.45));
  }
  return png(S, S, buf);
}

// ICO container; Vista+ reads PNG-compressed entries directly
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(s => frame(s));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});

const out = path.join(__dirname, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...images]));
fs.writeFileSync(path.join(__dirname, 'icon.png'), images[sizes.indexOf(256)]);
console.log('wrote', out, fs.statSync(out).size, 'bytes');

// ICNS container of PNG entries: [type, pixel size]; @2x types reuse the larger renders.
const macTypes = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128],
  ['ic08', 256], ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024]];
const macImages = new Map([16, 32, 64, 128, 256, 512, 1024].map(s => [s, frame(s, 100 / 1024)]));
const icns = macTypes.map(([type, s]) => {
  const head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32BE(8 + macImages.get(s).length, 4);
  return Buffer.concat([head, macImages.get(s)]);
});
const icnsHead = Buffer.alloc(8); icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(8 + icns.reduce((n, e) => n + e.length, 0), 4);
const macOut = path.join(__dirname, 'icon.icns');
fs.writeFileSync(macOut, Buffer.concat([icnsHead, ...icns]));
console.log('wrote', macOut, fs.statSync(macOut).size, 'bytes');
