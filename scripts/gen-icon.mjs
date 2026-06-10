// Deterministic marketplace icon generator — no image libraries needed.
// Draws into an RGBA buffer and encodes a PNG via Node's built-in zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const px = new Uint8Array(SIZE * SIZE * 4);

function put(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const sa = a / 255;
  px[i] = Math.round(r * sa + px[i] * (1 - sa));
  px[i + 1] = Math.round(g * sa + px[i + 1] * (1 - sa));
  px[i + 2] = Math.round(b * sa + px[i + 2] * (1 - sa));
  px[i + 3] = Math.max(px[i + 3], a);
}

function fillRoundedRect(x0, y0, w, h, radius, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.max(x0 + radius - x, x - (x0 + w - 1 - radius), 0);
      const dy = Math.max(y0 + radius - y, y - (y0 + h - 1 - radius), 0);
      const d = Math.hypot(dx, dy);
      if (d <= radius) put(x, y, color);
      else if (d <= radius + 1.2) put(x, y, [...color.slice(0, 3), Math.round(255 * (radius + 1.2 - d))]);
    }
  }
}

function thickLine(x1, y1, x2, y2, width, color) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len * 2);
  for (let s = 0; s <= steps; s++) {
    const cx = x1 + ((x2 - x1) * s) / steps;
    const cy = y1 + ((y2 - y1) * s) / steps;
    const r = width / 2;
    for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) put(x, y, color);
        else if (d <= r + 1) put(x, y, [...color.slice(0, 3), Math.round(255 * (r + 1 - d))]);
      }
    }
  }
}

// ---- compose -------------------------------------------------------------
const WHITE = [255, 255, 255];

fillRoundedRect(8, 8, SIZE - 16, SIZE - 16, 52, WHITE);

// chart bars
const colors = [
  [59, 130, 246], // blue
  [168, 85, 247], // purple
  [34, 197, 94], // green
  [249, 115, 22], // orange
];
const barW = 30;
const gap = 14;
const baseY = 204;
const heights = [62, 96, 78, 126];
const startX = Math.round((SIZE - (colors.length * barW + (colors.length - 1) * gap)) / 2);
colors.forEach((color, i) => {
  const h = heights[i];
  fillRoundedRect(startX + i * (barW + gap), baseY - h, barW, h, 8, color);
});

// trend line with end dot
const trend = [
  [startX + barW / 2, baseY - heights[0] - 26],
  [startX + barW + gap + barW / 2, baseY - heights[1] - 26],
  [startX + 2 * (barW + gap) + barW / 2, baseY - heights[2] - 26],
  [startX + 3 * (barW + gap) + barW / 2, baseY - heights[3] - 26],
];
const LINE = [30, 41, 59];
for (let i = 0; i < trend.length - 1; i++) {
  thickLine(trend[i][0], trend[i][1], trend[i + 1][0], trend[i + 1][1], 9, LINE);
}
const [ex, ey] = trend[trend.length - 1];
thickLine(ex, ey, ex, ey, 18, LINE);
thickLine(ex, ey, ex, ey, 9, WHITE);

// ---- encode PNG ----------------------------------------------------------
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(join(here, '..', 'media', 'icon.png'));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`icon written: ${out} (${png.length} bytes)`);
