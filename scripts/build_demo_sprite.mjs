// Generates editor/public/demo-sprite.png — a 128×128 RGBA spritesheet with
// two 8×8 sprites used by the Star Catcher demo cartridge:
//   - tile (0,0): white ship silhouette
//   - tile (1,0): yellow 4-point star
// All other pixels are fully transparent (alpha 0), which the engine's
// blend() skips during sprite() blits.
//
// Run with: node scripts/build_demo_sprite.mjs
// No npm deps — uses Node's built-in zlib.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'editor', 'public', 'demo-sprite.png');

const W = 128, H = 128;
const px = new Uint8Array(W * H * 4); // RGBA, zero = transparent black

function paint(tileX, tileY, rows, rgba) {
    const [r, g, b, a] = rgba;
    for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < rows[y].length; x++) {
            if (rows[y][x] !== '#') continue;
            const o = ((tileY * 8 + y) * W + (tileX * 8 + x)) * 4;
            px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
        }
    }
}

// Sprite 0: white ship pointing up.
paint(0, 0, [
    '........',
    '...##...',
    '...##...',
    '..####..',
    '..####..',
    '.######.',
    '.######.',
    '########',
], [255, 255, 255, 255]);

// Sprite 1: yellow 4-point star.
paint(1, 0, [
    '........',
    '...#....',
    '..###...',
    '.##.##..',
    '###.###.',
    '.##.##..',
    '..###...',
    '...#....',
], [255, 255, 0, 255]);

// Pack scanlines with PNG filter byte 0 (None) at the start of each row.
const raw = new Uint8Array(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    raw.set(px.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
}
const idat = deflateSync(raw);

// Minimal CRC32 (PNG-compatible) — table-driven.
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[i] = c;
}
function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function be32(n) {
    return Uint8Array.of((n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF);
}
function chunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const out = new Uint8Array(4 + 4 + data.length + 4);
    out.set(be32(data.length), 0);
    out.set(typeBytes, 4);
    out.set(data, 8);
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, typeBytes.length);
    out.set(be32(crc32(crcInput)), 8 + data.length);
    return out;
}

const sig  = Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
const ihdr = new Uint8Array([
    ...be32(W), ...be32(H),
    8,  // bit depth
    6,  // color type: truecolor + alpha (RGBA)
    0,  // compression: deflate
    0,  // filter: adaptive
    0,  // interlace: none
]);

const file = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(idat)),
    chunk('IEND', new Uint8Array(0)),
]);
writeFileSync(OUT, file);
console.log(`Wrote ${OUT} (${file.length} bytes)`);
