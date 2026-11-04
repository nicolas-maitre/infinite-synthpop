// Draws the app icons (the favicon's pink zigzag on a dark rounded square) as PNGs for the web
// app manifest, without dependencies. Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x14, 0x14, 0x28];
const LINE = [0xff, 0x3d, 0x8b];
// The favicon's path, in a 32-unit box: M6 22 L11 10 L16 22 L21 10 L26 22.
const PATH = [
  [6, 22],
  [11, 10],
  [16, 22],
  [21, 10],
  [26, 22],
];

function draw(size) {
  const s = size / 32;
  const half = 1.6 * s; // stroke width 3.2 units
  const radius = 6 * s;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      // Rounded-square coverage (1 inside, 0 outside, soft edge).
      const dx = Math.max(radius - cx, cx - (size - radius), 0);
      const dy = Math.max(radius - cy, cy - (size - radius), 0);
      const bg = clamp(radius - Math.hypot(dx, dy) + 0.5);
      // Distance to the zigzag.
      let d = Infinity;
      for (let i = 0; i < PATH.length - 1; i++) {
        const [ax, ay] = PATH[i].map((v) => v * s);
        const [bx, by] = PATH[i + 1].map((v) => v * s);
        d = Math.min(d, segmentDistance(cx, cy, ax, ay, bx, by));
      }
      const line = clamp(half - d + 0.5);
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] + (LINE[c] - BG[c]) * line);
      px[o + 3] = Math.round(255 * bg);
    }
  }
  return png(size, px);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function clamp(v) {
  return Math.min(1, Math.max(0, v));
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, draw(size));
  console.log(`public/icons/icon-${size}.png`);
}
