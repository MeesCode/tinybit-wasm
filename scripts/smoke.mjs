#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', 'target', 'wasm32-wasip1', 'release', 'tinybit_wasm.wasm');
const cartPath = resolve(__dirname, '..', '..', 'TinyBit', 'games', 'flappy.tb.png');

if (!existsSync(wasmPath)) {
  console.error(`missing ${wasmPath}; run ./scripts/build.sh first`);
  process.exit(1);
}
if (!existsSync(cartPath)) {
  console.error(`missing ${cartPath}; expected sibling TinyBit project to exist`);
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

// ---- Run engine -----------------------------------------------------------
tb.tb_init();

const cart = readFileSync(cartPath);
const feedPtr = tb.tb_feed_buffer_ptr();

for (let i = 0; i < cart.length; i += 256) {
  const chunk = cart.subarray(i, Math.min(i + 256, cart.length));
  const view = new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length);
  view.set(chunk);
  const ok = tb.tb_feed_cartridge(chunk.length);
  if (ok === 0) {
    console.error(`tb_feed_cartridge returned 0 at offset ${i}`);
    process.exit(1);
  }
}

if (tb.tb_start() === 0) {
  console.error('tb_start returned 0');
  process.exit(1);
}

for (let frame = 0; frame < 60; frame++) {
  tb.tb_loop_once();
}

const displayPtr = tb.tb_display_ptr();
const display = new Uint16Array(memoryRef.value.buffer, displayPtr, 128 * 128);
let nonzero = 0;
for (let i = 0; i < display.length; i++) if (display[i] !== 0) nonzero++;

if (nonzero === 0) {
  console.error('display all zeros after 60 frames — engine did not render');
  process.exit(1);
}

console.log(`smoke test passed: ${nonzero}/${display.length} display pixels non-zero`);
tb.tb_stop();
