#!/usr/bin/env node
// One-shot: writes 128x128 RGBA fixtures used by smoke.mjs.
// Re-run only if the fixtures are missing or you want to regenerate them.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = resolve(here, 'fixtures');
if (!existsSync(fixDir)) mkdirSync(fixDir, { recursive: true });

// Minimal RGBA PNG writer (no filtering — type 0 = None per row).
function writePng(path, w, h, makePixel) {
  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter type
    for (let x = 0; x < w; x++) {
      const { r, g, b, a } = makePixel(x, y);
      const i = y * (1 + w * 4) + 1 + x * 4;
      raw[i]     = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  // CRC-32 (IEEE 802.3), Buffer-based.
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
      }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8]  = 8;       // bit depth
  ihdr[9]  = 6;       // RGBA
  ihdr[10] = 0;       // compression
  ihdr[11] = 0;       // filter
  ihdr[12] = 0;       // interlace

  const idat = zlib.deflateSync(raw);

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

writePng(resolve(fixDir, 'smoke_cover.png'), 128, 128, (x, y) => {
  const c = ((x >> 3) ^ (y >> 3)) & 1 ? 0xFF : 0x33;
  return { r: c, g: c, b: c, a: 0xFF };
});

writePng(resolve(fixDir, 'smoke_sprite.png'), 128, 128, (x, y) => {
  return { r: x * 2, g: y * 2, b: ((x + y) & 0xFF), a: 0xFF };
});

// Tiny 64x64 PNG for the negative case.
writePng(resolve(fixDir, 'smoke_cover_64.png'), 64, 64, () => ({ r: 0, g: 0, b: 0, a: 0xFF }));

console.log('fixtures generated');
