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

// ---- Minimal WASI snapshot_preview1 shim (copy of smoke_encoder.mjs) -----
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
  fd_seek:  () => ERRNO_BADF,
  fd_read:  () => ERRNO_BADF,
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
  proc_exit(code) { throw new Error(`proc_exit(${code})`); },
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

const wasmBytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
memoryRef.value = instance.exports.memory;
const tb = instance.exports;

tb.tb_init();
if (tb.tb_enc_init() === 0) { console.error('tb_enc_init returned 0'); process.exit(1); }
if (tb.tb_dec_init() === 0) { console.error('tb_dec_init returned 0'); process.exit(1); }

const fixDir = resolve(__dirname, 'fixtures');
const coverBytes  = readFileSync(resolve(fixDir, 'smoke_cover.png'));
const spriteBytes = readFileSync(resolve(fixDir, 'smoke_sprite.png'));
const scriptBytes = readFileSync(resolve(fixDir, 'smoke_script.lua'));
const titleBytes  = new TextEncoder().encode('smoke');
const authorBytes = new TextEncoder().encode('ci');

function stageEnc(slot, bytes, label) {
  const cap = tb.tb_enc_input_cap(slot);
  if (bytes.length > cap) { console.error(`${label}: ${bytes.length} > cap ${cap}`); process.exit(1); }
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    console.error(`${label}: tb_enc_set_input_len failed`); process.exit(1);
  }
}
function decodeEncError() {
  const len = tb.tb_enc_error_len();
  if (len === 0) return '<empty>';
  const ptr = tb.tb_enc_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}
function decodeDecError() {
  const len = tb.tb_dec_error_len();
  if (len === 0) return '<empty>';
  const ptr = tb.tb_dec_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}

// 1. Encode a cartridge.
console.log('--- decoder smoke: encode source cartridge ---');
stageEnc(0, coverBytes, 'cover');
stageEnc(1, spriteBytes, 'sprite');
stageEnc(2, scriptBytes, 'script');
tb.tb_enc_set_input_len(3, 0);
stageEnc(4, titleBytes, 'title');
stageEnc(5, authorBytes, 'author');
tb.tb_enc_set_header(7, 0xBEEF, 1700000000);
const n = tb.tb_enc_run();
if (n < 0) { console.error(`tb_enc_run failed: ${n} — ${decodeEncError()}`); process.exit(1); }
const encoded = new Uint8Array(memoryRef.value.buffer, tb.tb_enc_output_ptr(), n).slice();
console.log(`encoded ${encoded.length} PNG bytes`);

// 2. Decode it.
console.log('--- decoder smoke: decode round-trip ---');
const inputCap = tb.tb_dec_input_cap();
if (encoded.length > inputCap) { console.error(`encoded ${encoded.length} > cap ${inputCap}`); process.exit(1); }
const inputPtr = tb.tb_dec_input_ptr();
new Uint8Array(memoryRef.value.buffer, inputPtr, encoded.length).set(encoded);
const rc = tb.tb_dec_run(encoded.length);
if (rc !== 0) { console.error(`tb_dec_run failed: ${rc} — ${decodeDecError()}`); process.exit(1); }

const readBytesCopy = (ptr, len) => new Uint8Array(memoryRef.value.buffer, ptr, len).slice();
const td = new TextDecoder();
const title  = td.decode(readBytesCopy(tb.tb_dec_title_ptr(),  tb.tb_dec_title_len()));
const author = td.decode(readBytesCopy(tb.tb_dec_author_ptr(), tb.tb_dec_author_len()));
const script = td.decode(readBytesCopy(tb.tb_dec_script_ptr(), tb.tb_dec_script_len()));
const meta = tb.tb_dec_meta();
const formatVersion = Number(meta & 0xFFFFn);
const flags         = Number((meta >> 16n) & 0xFFFFn);
const gameVersion   = Number((meta >> 32n) & 0xFFFFn);
const crcOk         = Number((meta >> 48n) & 0xFFn) === 1;
const packageDate   = tb.tb_dec_package_date();

if (title !== 'smoke')   { console.error(`title mismatch: ${title}`); process.exit(1); }
if (author !== 'ci')     { console.error(`author mismatch: ${author}`); process.exit(1); }
if (script !== new TextDecoder().decode(scriptBytes)) {
  console.error('script byte mismatch'); process.exit(1);
}
if (formatVersion !== 1)      { console.error(`format_version ${formatVersion} != 1`); process.exit(1); }
if (flags !== 0xBEEF)         { console.error(`flags ${flags.toString(16)} != BEEF`); process.exit(1); }
if (gameVersion !== 7)        { console.error(`game_version ${gameVersion} != 7`); process.exit(1); }
if (packageDate !== 1700000000) { console.error(`package_date ${packageDate}`); process.exit(1); }
if (!crcOk)                   { console.error('crc_ok = false on a fresh round-trip'); process.exit(1); }

const spriteLen = tb.tb_dec_sprite_len();
const coverLen  = tb.tb_dec_cover_len();
if (spriteLen < 200) { console.error(`sprite PNG too short: ${spriteLen}`); process.exit(1); }
if (coverLen  < 200) { console.error(`cover PNG too short: ${coverLen}`); process.exit(1); }
const spritePng = readBytesCopy(tb.tb_dec_sprite_ptr(), spriteLen);
const coverPng  = readBytesCopy(tb.tb_dec_cover_ptr(),  coverLen);
const magic = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
if (!magic(spritePng)) { console.error('sprite PNG missing magic'); process.exit(1); }
if (!magic(coverPng))  { console.error('cover PNG missing magic');  process.exit(1); }

console.log('decoder round-trip OK: title/author/script/header/PNG outputs match');

// 3. Negative case: truncated input → decode error.
console.log('--- decoder smoke: negative case ---');
const truncated = encoded.subarray(0, Math.max(100, encoded.length - 1000));
new Uint8Array(memoryRef.value.buffer, inputPtr, truncated.length).set(truncated);
const rc2 = tb.tb_dec_run(truncated.length);
if (rc2 >= 0) { console.error(`expected negative rc on truncated input, got ${rc2}`); process.exit(1); }
console.log(`decoder negative case OK: rc=${rc2} (${decodeDecError()})`);
