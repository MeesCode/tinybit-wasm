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

// ---- Minimal WASI snapshot_preview1 shim (copied from smoke.mjs) ----------
const memoryRef = { value: null };
const dec = new TextDecoder();
const ERRNO_SUCCESS = 0, ERRNO_BADF = 8;
function dv() { return new DataView(memoryRef.value.buffer); }
function readBytes(ptr, len) { return new Uint8Array(memoryRef.value.buffer, ptr, len); }

const wasi = {
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
        if (fd !== 1 && fd !== 2) return ERRNO_BADF;
        let written = 0;
        for (let i = 0; i < iovsLen; i++) {
            const base = dv().getUint32(iovsPtr + i * 8, true);
            const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
            const txt = dec.decode(readBytes(base, len));
            process[fd === 1 ? 'stdout' : 'stderr'].write(txt);
            written += len;
        }
        dv().setUint32(nwrittenPtr, written, true);
        return ERRNO_SUCCESS;
    },
    fd_close: () => ERRNO_BADF,
    fd_seek:  () => ERRNO_BADF,
    fd_read:  () => ERRNO_BADF,
    fd_fdstat_get:       () => ERRNO_BADF,
    fd_fdstat_set_flags: () => ERRNO_BADF,
    fd_prestat_get:      () => ERRNO_BADF,
    fd_prestat_dir_name: () => ERRNO_BADF,
    fd_renumber:         () => ERRNO_BADF,
    path_open:           () => ERRNO_BADF,
    proc_exit(code) { process.exit(code); },
    environ_get:        () => ERRNO_SUCCESS,
    environ_sizes_get:  (cP, sP) => { dv().setUint32(cP, 0, true); dv().setUint32(sP, 0, true); return ERRNO_SUCCESS; },
    args_get:           () => ERRNO_SUCCESS,
    args_sizes_get:     (cP, sP) => { dv().setUint32(cP, 0, true); dv().setUint32(sP, 0, true); return ERRNO_SUCCESS; },
    clock_time_get(_id, _prec, outPtr) {
        const ns = BigInt(Date.now()) * 1_000_000n;
        dv().setBigUint64(outPtr, ns, true);
        return ERRNO_SUCCESS;
    },
    random_get(buf, len) {
        const a = readBytes(buf, len);
        for (let i = 0; i < len; i++) a[i] = Math.floor(Math.random() * 256);
        return ERRNO_SUCCESS;
    },
};

const bytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: new Proxy(wasi, {
    get(t, k) {
        if (k in t) return t[k];
        return (...args) => {
            console.error(`unimplemented WASI fn: ${String(k)}(${args.join(', ')})`);
            return ERRNO_BADF;
        };
    },
}) });
const ex = instance.exports;
memoryRef.value = ex.memory;

const requiredExports = [
    'tb_init', 'tb_start', 'tb_loop_once', 'tb_audio_ptr',
    'tb_preview_ptr', 'tb_preview_cap',
    'tb_preview_music_play', 'tb_preview_sfx_play', 'tb_preview_stop',
];
for (const name of requiredExports) {
    if (typeof ex[name] !== 'function') {
        console.error(`missing export: ${name}`);
        process.exit(1);
    }
}

ex.tb_init();

function writeAbc(s) {
    const enc = new TextEncoder().encode(s);
    const ptr = ex.tb_preview_ptr();
    new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
    return enc.length;
}

const AUDIO_FRAME_SAMPLES = 367;
function audioFrame() {
    return new Int16Array(ex.memory.buffer, ex.tb_audio_ptr(), AUDIO_FRAME_SAMPLES).slice();
}

// 1. Load a music score and play.
const musicLen = writeAbc('L:1/4\nK:C\nC4 D4 E4 F4');
let rc = ex.tb_preview_music_play(musicLen);
if (rc !== 0) { console.error(`music play returned ${rc}`); process.exit(1); }

if (ex.tb_start() === 0) { console.error('tb_start failed'); process.exit(1); }

let anyNonZero = false;
for (let i = 0; i < 60; i++) {
    ex.tb_loop_once();
    const f = audioFrame();
    if (f.some((s) => s !== 0)) anyNonZero = true;
}
if (!anyNonZero) { console.error('music preview produced no audio'); process.exit(1); }

// 2. Stop and verify silence.
ex.tb_preview_stop();
let lastFrame;
for (let i = 0; i < 60; i++) {
    ex.tb_loop_once();
    lastFrame = audioFrame();
}
const stillSounding = lastFrame.some((s) => s !== 0);
if (stillSounding) { console.error('audio_stop_all did not silence the channel'); process.exit(1); }

// 3. SFX path returns 0.
const sfxLen = writeAbc('c/4');
rc = ex.tb_preview_sfx_play(sfxLen);
if (rc !== 0) { console.error(`sfx play returned ${rc}`); process.exit(1); }

// 4. Oversized returns -3 without crashing.
rc = ex.tb_preview_music_play(33_000);
if (rc !== -3) { console.error(`oversized expected -3, got ${rc}`); process.exit(1); }

console.log('smoke_preview: OK');
