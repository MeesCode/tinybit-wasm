#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', 'web', 'tinybit_wasm.wasm');

if (!existsSync(wasmPath)) {
  console.error(`missing ${wasmPath}; run scripts/build.sh first`);
  process.exit(1);
}

// ---- Minimal WASI snapshot_preview1 shim ----------------------------------
const memoryRef = { value: null };
const dec = new TextDecoder();

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;

function readBytes(ptr, len) {
  return new Uint8Array(memoryRef.value.buffer, ptr, len);
}
function dv() { return new DataView(memoryRef.value.buffer); }

const wasi = {
  fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
    if (fd !== 1 && fd !== 2) return ERRNO_BADF;
    let written = 0;
    const buffers = [];
    for (let i = 0; i < iovsLen; i++) {
      const base = dv().getUint32(iovsPtr + i * 8, true);
      const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
      buffers.push(readBytes(base, len));
      written += len;
    }
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const b of buffers) { merged.set(b, off); off += b.length; }
    const stream = fd === 1 ? process.stdout : process.stderr;
    stream.write(dec.decode(merged));
    dv().setUint32(nwrittenPtr, written, true);
    return ERRNO_SUCCESS;
  },
  fd_close: () => ERRNO_BADF,
  fd_seek: () => ERRNO_BADF,
  fd_read: () => ERRNO_BADF,
  fd_fdstat_get: () => ERRNO_BADF,
  fd_fdstat_set_flags: () => ERRNO_BADF,
  fd_prestat_get: () => ERRNO_BADF,
  fd_prestat_dir_name: () => ERRNO_BADF,
  fd_renumber: () => ERRNO_BADF,
  path_open: () => ERRNO_BADF,
  environ_get: () => ERRNO_SUCCESS,
  environ_sizes_get(countPtr, sizePtr) {
    dv().setUint32(countPtr, 0, true);
    dv().setUint32(sizePtr, 0, true);
    return ERRNO_SUCCESS;
  },
  args_get: () => ERRNO_SUCCESS,
  args_sizes_get(countPtr, sizePtr) {
    dv().setUint32(countPtr, 0, true);
    dv().setUint32(sizePtr, 0, true);
    return ERRNO_SUCCESS;
  },
  clock_time_get(_id, _precision, timePtr) {
    const ns = BigInt(Math.floor(performance.now() * 1e6));
    dv().setBigUint64(timePtr, ns, true);
    return ERRNO_SUCCESS;
  },
  random_get(buf, len) {
    crypto.getRandomValues(readBytes(buf, len));
    return ERRNO_SUCCESS;
  },
  proc_exit(code) {
    throw new Error(`proc_exit(${code})`);
  },
};

const importObject = { wasi_snapshot_preview1: new Proxy(wasi, {
  get(t, k) {
    if (k in t) return t[k];
    return (...args) => {
      console.error(`unimplemented WASI fn: ${String(k)}(${args.join(', ')})`);
      return ERRNO_BADF;
    };
  },
}) };

// ---- Instantiate ----------------------------------------------------------
const wasmBytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
memoryRef.value = instance.exports.memory;
const tb = instance.exports;

tb.tb_init();
if (tb.tb_enc_init() === 0) {
  console.error('tb_enc_init returned 0');
  process.exit(1);
}

const fixDir = resolve(__dirname, 'fixtures');
const coverBytes  = readFileSync(resolve(fixDir, 'smoke_cover.png'));
const spriteBytes = readFileSync(resolve(fixDir, 'smoke_sprite.png'));
const scriptBytes = readFileSync(resolve(fixDir, 'smoke_script.lua'));
const smallCover  = readFileSync(resolve(fixDir, 'smoke_cover_64.png'));
const titleBytes  = new TextEncoder().encode('smoke');
const authorBytes = new TextEncoder().encode('ci');

function stage(slot, bytes, label) {
  const cap = tb.tb_enc_input_cap(slot);
  if (bytes.length > cap) { console.error(`${label}: ${bytes.length} > cap ${cap}`); process.exit(1); }
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    console.error(`${label}: tb_enc_set_input_len failed`); process.exit(1);
  }
}

function decodeError() {
  const len = tb.tb_enc_error_len();
  if (len === 0) return '<empty>';
  const ptr = tb.tb_enc_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}

// ---- Negative case (before round-trip so we never double-init) -----------
console.log('--- encoder negative case ---');
stage(0, smallCover, 'cover_64'); // wrong size — must be 128x128
stage(1, spriteBytes, 'sprite');
stage(2, scriptBytes, 'script');
tb.tb_enc_set_input_len(3, 0);
stage(4, titleBytes, 'title');
stage(5, authorBytes, 'author');
tb.tb_enc_set_header(1, 0, Math.floor(Date.now() / 1000));
const neg = tb.tb_enc_run();
if (neg !== -1) { console.error(`expected -1 from wrong-size cover, got ${neg}`); process.exit(1); }
const negMsg = decodeError();
if (!negMsg.includes('128')) { console.error(`negative msg missing '128': ${negMsg}`); process.exit(1); }
console.log(`encoder negative case OK: ${neg} (${negMsg})`);

// ---- Round-trip ----------------------------------------------------------
console.log('--- encoder round-trip ---');
stage(0, coverBytes, 'cover'); // restore valid 128x128 cover
tb.tb_enc_set_header(1, 0, Math.floor(Date.now() / 1000));
const n = tb.tb_enc_run();
if (n < 0) { console.error(`tb_enc_run failed: ${n} — ${decodeError()}`); process.exit(1); }
console.log(`encoded ${n} PNG bytes`);

const outPtr = tb.tb_enc_output_ptr();
const encoded = new Uint8Array(memoryRef.value.buffer, outPtr, n).slice();

const feedPtr = tb.tb_feed_buffer_ptr();
for (let i = 0; i < encoded.length; i += 256) {
  const chunk = encoded.subarray(i, Math.min(i + 256, encoded.length));
  new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length).set(chunk);
  if (tb.tb_feed_cartridge(chunk.length) === 0) {
    console.error(`round-trip feed failed at offset ${i}`); process.exit(1);
  }
}
if (tb.tb_start() === 0) { console.error('round-trip tb_start returned 0'); process.exit(1); }
for (let f = 0; f < 60; f++) tb.tb_loop_once();

const displayPtr = tb.tb_display_ptr();
const display = new Uint16Array(memoryRef.value.buffer, displayPtr, 128 * 128);
const target = display[10 * 128 + 10];
if (target !== 0xFFFF) {
  console.error(`round-trip pixel mismatch at (10,10): got 0x${target.toString(16)}, want 0xFFFF`);
  process.exit(1);
}
console.log('encoder round-trip OK: pixel (10,10) = 0xFFFF after 60 frames');
tb.tb_stop();
