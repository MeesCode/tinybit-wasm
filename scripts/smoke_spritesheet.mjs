#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', 'target', 'wasm32-wasip1', 'release', 'tinybit_wasm.wasm');

if (!existsSync(wasmPath)) {
  console.error(`missing ${wasmPath}; run ./scripts/build.sh first`);
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

// ---- Exercise tb_spritesheet_ptr ------------------------------------------
tb.tb_init();

const ptr = tb.tb_spritesheet_ptr();
if (ptr === 0) {
  console.error('tb_spritesheet_ptr() returned 0 — null pointer');
  process.exit(1);
}

const PIXELS = 128 * 128; // 16384
const view = new Uint16Array(instance.exports.memory.buffer, ptr, PIXELS);

// Write and read back first pixel
view[0] = 0xF00F;
if (view[0] !== 0xF00F) {
  console.error(`spritesheet round-trip failed at index 0: wrote 0xF00F, got 0x${view[0].toString(16).toUpperCase()}`);
  process.exit(1);
}

// Write and read back last pixel — guards against pointer-arithmetic mistakes
view[PIXELS - 1] = 0xABCD;
if (view[PIXELS - 1] !== 0xABCD) {
  console.error(`spritesheet round-trip failed at index ${PIXELS - 1}: wrote 0xABCD, got 0x${view[PIXELS - 1].toString(16).toUpperCase()}`);
  process.exit(1);
}

console.log('smoke_spritesheet: OK');
