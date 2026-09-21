#!/usr/bin/env node
// Renders the toolbar and store icons (16, 32, 48, 128 px) as PNG files without any
// dependency: pixels are shaded from simple distance functions, supersampled for
// anti-aliasing, and written with a minimal PNG encoder on top of node:zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;
const NAVY = [11, 31, 58];
const TEAL = [45, 212, 191];
const WHITE = [255, 255, 255];

// --- PNG encoding -------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

// rgba: Uint8Array of width * height * 4 bytes, straight (non-premultiplied) alpha.
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type "None" for this scanline
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Shape ----------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (distance, edge = 0.012) => clamp(0.5 - distance / edge, 0, 1);

function roundedSquare(x, y, half, radius) {
  const dx = Math.max(Math.abs(x) - (half - radius), 0);
  const dy = Math.max(Math.abs(y) - (half - radius), 0);
  return Math.hypot(dx, dy) - radius;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

// Coordinates are centred: x and y in [-0.5, 0.5], y grows downwards.
function shade(x, y) {
  const layers = [];
  const bgAlpha = smooth(roundedSquare(x, y, 0.5, 0.12));
  if (bgAlpha > 0) layers.push([NAVY, bgAlpha]);
  // Gauge ring open at the bottom (a 70 degree gap).
  const r = Math.hypot(x, y);
  const ringDistance = Math.max(0.26 - r, r - 0.38);
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  const inGap = angle > 55 && angle < 125;
  const ringAlpha = inGap ? 0 : smooth(ringDistance);
  if (ringAlpha > 0) layers.push([TEAL, ringAlpha]);
  // Check mark inside the ring.
  const checkDistance = Math.min(
    segmentDistance(x, y, -0.16, 0.01, -0.05, 0.12),
    segmentDistance(x, y, -0.05, 0.12, 0.17, -0.1)
  ) - 0.045;
  const checkAlpha = smooth(checkDistance);
  if (checkAlpha > 0) layers.push([WHITE, checkAlpha]);
  // Composite the layers ("over" operator).
  let a = 0;
  let rgb = [0, 0, 0];
  for (const [color, alpha] of layers) {
    const outA = alpha + a * (1 - alpha);
    rgb = rgb.map((c, i) => (outA === 0 ? 0 : (color[i] * alpha + c * a * (1 - alpha)) / outA));
    a = outA;
  }
  return [rgb[0], rgb[1], rgb[2], a];
}

export function renderIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step - 0.5;
          const y = (py * SUPERSAMPLE + sy + 0.5) * step - 0.5;
          const [sr, sg, sb, sa] = shade(x, y);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        rgba[offset] = Math.round(r / a);
        rgba[offset + 1] = Math.round(g / a);
        rgba[offset + 2] = Math.round(b / a);
        rgba[offset + 3] = Math.round((a / (SUPERSAMPLE * SUPERSAMPLE)) * 255);
      }
    }
  }
  return rgba;
}

export function writeIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const size of SIZES) {
    const file = join(outDir, `icon${size}.png`);
    writeFileSync(file, encodePng(size, size, renderIcon(size)));
    files.push(file);
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  for (const file of writeIcons(join(root, 'icons'))) console.log(`wrote ${file}`);
}
