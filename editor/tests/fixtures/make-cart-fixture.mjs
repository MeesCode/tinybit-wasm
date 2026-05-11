#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', '..', '..', 'target', 'wasm32-wasip1', 'release', 'tinybit_wasm.wasm');
if (!existsSync(wasmPath)) {
    console.error(`missing ${wasmPath}; run scripts/build.sh first`);
    process.exit(1);
}

const memoryRef = { value: null };
const dec = new TextDecoder();
const ERRNO_BADF = 8, ERRNO_SUCCESS = 0;
function dv() { return new DataView(memoryRef.value.buffer); }
function bytes(p, l) { return new Uint8Array(memoryRef.value.buffer, p, l); }
const wasi = {
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
        if (fd !== 1 && fd !== 2) return ERRNO_BADF;
        let written = 0;
        const bufs = [];
        for (let i = 0; i < iovsLen; i++) {
            const base = dv().getUint32(iovsPtr + i * 8, true);
            const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
            bufs.push(bytes(base, len)); written += len;
        }
        const merged = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
        let off = 0; for (const b of bufs) { merged.set(b, off); off += b.length; }
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
    clock_time_get(_i, _p, t) { dv().setBigUint64(t, BigInt(Math.floor(performance.now() * 1e6)), true); return ERRNO_SUCCESS; },
    random_get(buf, len) { crypto.getRandomValues(bytes(buf, len)); return ERRNO_SUCCESS; },
    proc_exit(code) { throw new Error(`proc_exit(${code})`); },
};
const importObject = { wasi_snapshot_preview1: new Proxy(wasi, {
    get(t, k) { return k in t ? t[k] : (...a) => { console.error(`unimplemented WASI fn: ${String(k)}(${a.join(', ')})`); return ERRNO_BADF; }; },
})};

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), importObject);
memoryRef.value = instance.exports.memory;
const tb = instance.exports;
tb.tb_init();
if (tb.tb_enc_init() === 0) { console.error('tb_enc_init failed'); process.exit(1); }

const cover  = readFileSync(resolve(__dirname, 'cover-128.png'));
const sprite = readFileSync(resolve(__dirname, 'sprite-128.png'));
const script = new TextEncoder().encode('function _draw()\n  pset(10, 10, 0xFFFF)\nend\n');
const title  = new TextEncoder().encode('upload-fixture');
const author = new TextEncoder().encode('e2e');

function stage(slot, b) {
    const ptr = tb.tb_enc_input_ptr(slot);
    new Uint8Array(memoryRef.value.buffer, ptr, b.length).set(b);
    if (tb.tb_enc_set_input_len(slot, b.length) === 0) { console.error(`stage failed ${slot}`); process.exit(1); }
}
stage(0, cover);
stage(1, sprite);
stage(2, script);
tb.tb_enc_set_input_len(3, 0);
stage(4, title);
stage(5, author);
tb.tb_enc_set_header(1, 0, 1700000000);
const n = tb.tb_enc_run();
if (n < 0) { console.error(`tb_enc_run failed: ${n}`); process.exit(1); }
const out = new Uint8Array(memoryRef.value.buffer, tb.tb_enc_output_ptr(), n).slice();
writeFileSync(resolve(__dirname, 'upload-cart.tb.png'), out);
console.log(`wrote upload-cart.tb.png (${out.length} bytes)`);
