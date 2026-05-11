import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    TABLE[i] = c;
}
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ TABLE[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 4, 'ascii');
    data.copy(out, 8);
    const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    out.writeUInt32BE(crc, 8 + data.length);
    return out;
}
function rgbaPng(width, height, r, g, b, a) {
    const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const row = y * (1 + width * 4);
        raw[row] = 0;
        for (let x = 0; x < width; x++) {
            const p = row + 1 + x * 4;
            raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
        }
    }
    const idat = deflateSync(raw);
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
writeFileSync(resolve(here, 'sprite-128.png'), rgbaPng(128, 128, 0x22, 0x22, 0x22, 0xFF));
writeFileSync(resolve(here, 'cover-128.png'),  rgbaPng(128, 128, 0xED, 0x22, 0x5D, 0xFF));
console.log('fixtures written to', here);
