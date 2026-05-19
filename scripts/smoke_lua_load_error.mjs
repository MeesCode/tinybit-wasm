#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', 'target', 'wasm32-wasip1', 'release', 'tinybit_wasm.wasm');

if (!existsSync(wasmPath)) {
  console.error(`missing ${wasmPath}; run scripts/build.sh first`);
  process.exit(1);
}

const memoryRef = { value: null };
const dec = new TextDecoder();
const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
function readBytes(ptr, len) { return new Uint8Array(memoryRef.value.buffer, ptr, len); }
function dv() { return new DataView(memoryRef.value.buffer); }

const wasi = {
  fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
    if (fd !== 1 && fd !== 2) return ERRNO_BADF;
    let written = 0; const buffers = [];
    for (let i = 0; i < iovsLen; i++) {
      const base = dv().getUint32(iovsPtr + i * 8, true);
      const len  = dv().getUint32(iovsPtr + i * 8 + 4, true);
      buffers.push(readBytes(base, len)); written += len;
    }
    const merged = Buffer.concat(buffers.map(b => Buffer.from(b)));
    (fd === 1 ? process.stdout : process.stderr).write(dec.decode(merged));
    dv().setUint32(nwrittenPtr, written, true);
    return ERRNO_SUCCESS;
  },
  fd_close: () => ERRNO_BADF, fd_seek: () => ERRNO_BADF, fd_read: () => ERRNO_BADF,
  fd_fdstat_get: () => ERRNO_BADF, fd_fdstat_set_flags: () => ERRNO_BADF,
  fd_prestat_get: () => ERRNO_BADF, fd_prestat_dir_name: () => ERRNO_BADF,
  fd_renumber: () => ERRNO_BADF, path_open: () => ERRNO_BADF,
  environ_get: () => ERRNO_SUCCESS,
  environ_sizes_get(c, s) { dv().setUint32(c, 0, true); dv().setUint32(s, 0, true); return ERRNO_SUCCESS; },
  args_get: () => ERRNO_SUCCESS,
  args_sizes_get(c, s) { dv().setUint32(c, 0, true); dv().setUint32(s, 0, true); return ERRNO_SUCCESS; },
  clock_time_get(_id, _p, ptr) { dv().setBigUint64(ptr, BigInt(Math.floor(performance.now() * 1e6)), true); return ERRNO_SUCCESS; },
  random_get(buf, len) { crypto.getRandomValues(readBytes(buf, len)); return ERRNO_SUCCESS; },
  proc_exit(code) { throw new Error(`proc_exit(${code})`); },
};

const importObject = { wasi_snapshot_preview1: new Proxy(wasi, {
  get(t, k) {
    if (k in t) return t[k];
    return (...a) => { console.error(`unimplemented WASI: ${String(k)}(${a.join(', ')})`); return ERRNO_BADF; };
  },
}) };

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), importObject);
memoryRef.value = instance.exports.memory;
const tb = instance.exports;

tb.tb_init();
if (tb.tb_enc_init() === 0) { console.error('tb_enc_init failed'); process.exit(1); }

const fixDir = resolve(__dirname, 'fixtures');
const coverBytes  = readFileSync(resolve(fixDir, 'smoke_cover.png'));
const spriteBytes = readFileSync(resolve(fixDir, 'smoke_sprite.png'));
// Syntax error: unclosed paren.
const scriptBytes = new TextEncoder().encode('function _draw(\n');

function stage(slot, bytes) {
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    console.error(`stage ${slot} failed`); process.exit(1);
  }
}
stage(0, coverBytes);
stage(1, spriteBytes);
stage(2, scriptBytes);
tb.tb_enc_set_input_len(3, 0);
stage(4, new TextEncoder().encode('luaload'));
stage(5, new TextEncoder().encode('smoke'));
tb.tb_enc_set_header(1, 0, Math.floor(Date.now() / 1000));
const n = tb.tb_enc_run();
if (n < 0) { console.error(`encode failed: ${n}`); process.exit(1); }
const encoded = new Uint8Array(memoryRef.value.buffer, tb.tb_enc_output_ptr(), n).slice();

const feedPtr = tb.tb_feed_buffer_ptr();
for (let i = 0; i < encoded.length; i += 256) {
  const chunk = encoded.subarray(i, Math.min(i + 256, encoded.length));
  new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length).set(chunk);
  if (tb.tb_feed_cartridge(chunk.length) === 0) { console.error(`feed @${i}`); process.exit(1); }
}

const started = tb.tb_start();
if (started !== 0) { console.error(`tb_start should fail for syntax error, got ${started}`); process.exit(1); }

const mlen = tb.tb_lua_error_msg_len();
const tlen = tb.tb_lua_error_trace_len();
if (mlen === 0) { console.error('no error message after failed tb_start'); process.exit(1); }
if (tlen !== 0) { console.error(`load error has unexpected traceback len=${tlen}`); process.exit(1); }
const msg = dec.decode(new Uint8Array(memoryRef.value.buffer, tb.tb_lua_error_msg_ptr(), mlen));
if (!msg.includes('script:')) { console.error(`msg missing 'script:': "${msg}"`); process.exit(1); }
console.log(`smoke_lua_load_error OK: "${msg.trim()}"`);

tb.tb_stop();
