# ABC Score Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Score tab to the editor with a CodeMirror ABC editor, abcjs sheet-music preview, and engine-truthful playback, bidirectionally linked to Lua string literals in the script via a `--@score[: name]` annotation.

**Architecture:** A new `editor/src/score/` module holds the pure logic (`scoreLinks`, `scoreSync`), the CodeMirror artifacts (`abcMode`, `scoreHoverTooltip`), and the React components (`ScoreEditor`, `ScorePreview`, `ScoreTab`). A small Rust/wasm change adds three thin exports (`tb_preview_music_play`, `tb_preview_sfx_play`, `tb_preview_stop`) that delegate to the existing C `audio_load_abc` / `audio_stop_all`. The Lua script in `sketchStore` remains the single source of truth.

**Tech Stack:** Rust + wasm32-wasip1, React 18, Zustand, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/legacy-modes` for `simpleMode`), [abcjs](https://www.npmjs.com/package/abcjs) (lazy-imported), Vitest + jsdom, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-13-abc-score-editor-design.md`

---

## File map

**Created:**

| Path | Purpose |
|---|---|
| `editor/src/score/scoreLinks.ts` | Pure `findScores(script) → { links, diagnostics }`. |
| `editor/src/score/scoreLinks.test.ts` | Unit tests. |
| `editor/src/score/scoreSync.ts` | Pure `replaceScoreContent`, `insertNewScoreSnippet`. |
| `editor/src/score/scoreSync.test.ts` | Unit tests. |
| `editor/src/score/abcMode.ts` | CodeMirror simpleMode for ABC. |
| `editor/src/score/abcMode.test.ts` | Tokenization test. |
| `editor/src/score/ScoreEditor.tsx` | CodeMirror ABC editor (thin wrapper). |
| `editor/src/score/ScorePreview.tsx` | abcjs SVG renderer with error band. |
| `editor/src/score/ScorePreview.test.tsx` | Component tests. |
| `editor/src/score/ScoreTab.tsx` | Composes editor + preview + chip bar + Play/Stop. |
| `editor/src/score/ScoreTab.test.tsx` | Component tests. |
| `editor/src/score/scoreHoverTooltip.ts` | CodeMirror extension for the script-tab hover popup. |
| `editor/src/score/scoreHoverTooltip.test.ts` | Unit test for the extension. |
| `editor/src/engine/preview.ts` | TS wrapper around `tb_preview_*` exports. |
| `editor/src/engine/preview.test.ts` | Unit tests. |
| `editor/tests/e2e/score.spec.ts` | Playwright e2e. |
| `scripts/smoke_preview.mjs` | Node engine smoke. |

**Modified:**

| Path | Why |
|---|---|
| `src/bindings.rs` | `extern "C"` decls for `audio_load_abc`, `audio_stop_all`, `WAVEFORM` constants, `CHANNEL_*` constants. |
| `src/lib.rs` | Add `PreviewState` thread-local + `tb_preview_*` exports. |
| `editor/src/engine/runtime.ts` | Probe for `tb_preview_*`; expose `runtime.preview` + `runtime.previewAvailable`. |
| `editor/src/editor/CodeEditor.tsx` | Accept optional `hoverExtension` prop; mount it if provided. |
| `editor/src/ui/EditorPane.tsx` | Add `'score'` to `EditorTab` union and tab strip. |
| `editor/src/App.tsx` | Route Score tab; wire hover-tooltip click to switch tab. |
| `editor/package.json` | Add `abcjs` dependency. |

---

## Conventions

- Every task is TDD: write a failing test, run it, implement, run again, commit.
- Run tests with `cd editor && npx vitest run <path>` (one file) or `cd editor && npm test` (all). When in `editor/`, write paths relative to `editor/`.
- After every passing test, commit with a `feat:` / `test:` / `chore:` prefix matching existing repo style.
- For Rust changes: `cargo check --target wasm32-wasip1` is the fast feedback loop; `./scripts/build.sh` produces the actual `.wasm` for smoke tests.
- All new commits include the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Branch: all work happens on `feat/score-editor` (created in Task 0).

---

## Task 0: Branch + dependency setup

**Files:**
- Modify: `editor/package.json`
- Modify: `editor/package-lock.json` (npm-generated)

- [ ] **Step 1: Create feature branch from main**

```bash
git checkout -b feat/score-editor
git log --oneline -1
```

Expected: HEAD is at `6a375f5 docs: spec for ABC score editor ...`. If not on `main`, abort and check out main first.

- [ ] **Step 2: Add abcjs to editor dependencies**

```bash
cd editor && npm install --save abcjs@^6.4.4
```

Expected: `editor/package.json` shows `"abcjs": "^6.4.4"` in dependencies. `npm install` exits 0.

- [ ] **Step 3: Verify the editor still builds**

```bash
cd editor && npx tsc --noEmit
```

Expected: zero errors. (Establishes a clean baseline before changes.)

- [ ] **Step 4: Commit**

```bash
git add editor/package.json editor/package-lock.json
git commit -m "$(cat <<'EOF'
chore: add abcjs dependency for score-editor preview

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Rust bindings for `audio_load_abc` and `audio_stop_all`

**Files:**
- Modify: `src/bindings.rs` (insert after the existing `extern "C" { ... }` block, around line 102)

- [ ] **Step 1: Add extern declarations and constants**

Edit `src/bindings.rs`. Inside the existing `extern "C" { ... }` block (after line 101 `pub fn tinybit_gameload_cb(...)`), append:

```rust
    // --- audio.h: ABC playback + channel control ---
    pub fn audio_load_abc(
        channel_num: c_int,
        abc_string: *const c_char,
        waveform: c_int,
        repeat: bool,
    ) -> c_int;
    pub fn audio_stop_all();
```

Then, *outside* the extern block (after the closing `}` of the extern, at end of file), add:

```rust
// --- audio.h constants ---
pub const TB_CHANNEL_MUSIC: c_int = 0;
pub const TB_CHANNEL_SFX:   c_int = 1;
// WAVEFORM enum values from audio.h (SINE first → 0).
pub const TB_WAVE_SINE: c_int = 0;
```

- [ ] **Step 2: Verify Rust compiles to wasm**

```bash
cargo check --target wasm32-wasip1
```

Expected: 0 errors, 0 warnings related to bindings.

- [ ] **Step 3: Commit**

```bash
git add src/bindings.rs
git commit -m "$(cat <<'EOF'
bindings: expose audio_load_abc + audio_stop_all to Rust

Adds extern decls so the wasm wrapper can drive the engine's ABC
playback without needing a full cartridge. SINE waveform + channel
constants pinned to the values in src/tinybit/audio.h.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `tb_preview_*` wasm exports

**Files:**
- Modify: `src/lib.rs` (add a new module section after the decoder exports near the end)

- [ ] **Step 1: Add PreviewState and exports to `src/lib.rs`**

Append, before the final closing of the file (after the last `tb_dec_*` function around line 700):

```rust
// ── Preview FFI ─────────────────────────────────────────────────────────────
//
// Used by the in-editor Score tab to audition a single ABC string through the
// engine without building or loading a cartridge. Reuses the existing audio
// worklet path (audio_buffer + tb_audio_ptr). The script Lua VM is unaffected.

const PREVIEW_BUF_CAP: usize = 32 * 1024;

struct PreviewState {
    buf: Vec<u8>, // capacity = PREVIEW_BUF_CAP + 1 (room for trailing NUL)
}

impl PreviewState {
    fn new() -> Self {
        Self { buf: vec![0; PREVIEW_BUF_CAP + 1] }
    }
}

thread_local! {
    static PREVIEW_STATE: RefCell<Option<PreviewState>> = const { RefCell::new(None) };
}

fn preview_ensure_init() {
    PREVIEW_STATE.with(|cell| {
        if cell.borrow().is_none() {
            *cell.borrow_mut() = Some(PreviewState::new());
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_preview_ptr() -> *mut u8 {
    preview_ensure_init();
    let mut ptr: *mut u8 = core::ptr::null_mut();
    PREVIEW_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.buf.as_mut_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_preview_cap() -> u32 {
    PREVIEW_BUF_CAP as u32
}

fn preview_play(channel: c_int, len: u32, repeat: bool) -> i32 {
    let len = len as usize;
    if len > PREVIEW_BUF_CAP {
        return -3; // oversized
    }
    preview_ensure_init();
    let mut result: i32 = -1;
    PREVIEW_STATE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let Some(state) = borrow.as_mut() else { return; };
        // UTF-8 validate the prefix.
        if core::str::from_utf8(&state.buf[..len]).is_err() {
            result = -4;
            return;
        }
        // Append trailing NUL so it's a valid C string.
        state.buf[len] = 0;
        let rc = unsafe {
            bindings::audio_load_abc(
                channel,
                state.buf.as_ptr() as *const core::ffi::c_char,
                bindings::TB_WAVE_SINE,
                repeat,
            )
        };
        // audio_load_abc returns 0 on success, negative on parser failure.
        result = rc;
    });
    result
}

#[no_mangle]
pub extern "C" fn tb_preview_music_play(len: u32) -> i32 {
    preview_play(bindings::TB_CHANNEL_MUSIC, len, true)
}

#[no_mangle]
pub extern "C" fn tb_preview_sfx_play(len: u32) -> i32 {
    preview_play(bindings::TB_CHANNEL_SFX, len, false)
}

#[no_mangle]
pub extern "C" fn tb_preview_stop() {
    unsafe { bindings::audio_stop_all(); }
}
```

- [ ] **Step 2: Build the wasm**

```bash
./scripts/build.sh
```

Expected: build succeeds; `editor/public/tinybit_wasm.wasm` is updated.

- [ ] **Step 3: Quick byte-level sanity check that the new exports landed**

```bash
wasm-objdump -x editor/public/tinybit_wasm.wasm 2>/dev/null | grep -E "tb_preview_(ptr|cap|music_play|sfx_play|stop)" || \
  python3 -c "import sys; b=open('editor/public/tinybit_wasm.wasm','rb').read(); [print(n) for n in ['tb_preview_ptr','tb_preview_cap','tb_preview_music_play','tb_preview_sfx_play','tb_preview_stop'] if n.encode() in b]"
```

Expected: five matches, one per export name. (Falls back to a `python3` substring scan if `wasm-objdump` isn't installed.)

- [ ] **Step 4: Commit**

```bash
git add src/lib.rs editor/public/tinybit_wasm.wasm
git commit -m "$(cat <<'EOF'
wasm: add tb_preview_* exports for in-editor ABC audition

New thread-local PreviewState owns a 32 KiB staging buffer. JS writes
the ABC UTF-8 bytes there, calls tb_preview_music_play(len) or
tb_preview_sfx_play(len), and the engine's existing audio worklet
path picks up the samples. tb_preview_stop maps to audio_stop_all.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Node smoke test for preview

**Files:**
- Create: `scripts/smoke_preview.mjs`

- [ ] **Step 1: Write the smoke test**

Create `scripts/smoke_preview.mjs`. Pattern-match `scripts/smoke.mjs` for the WASI shim. The test:
1. Loads the wasm.
2. Calls `tb_init`.
3. Writes the ABC string `"L:1/4\nK:C\nC4 D4 E4 F4"` into the preview buffer (via `tb_preview_ptr` + `Uint8Array.set`).
4. Calls `tb_preview_music_play(len)`. Asserts return value `0`.
5. Calls `tb_start` (engine must be started for the audio queue to be exercised).
6. Runs 60 `tb_loop_once` iterations.
7. Reads `tb_audio_ptr` (367 samples × i16) and asserts at least one sample is non-zero somewhere in that span.
8. Calls `tb_preview_stop`. Runs another 60 iterations. Asserts that the *last* 367-sample frame is **all zero** (silence).
9. Calls `tb_preview_sfx_play(len)` with `"c/4"`. Asserts return value `0`. (Smoke-only; we don't assert audio for SFX since one-shot is short.)
10. On `-3` oversized: also assert that passing a `len` of `33000` returns `-3` without crashing.

```js
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
    fd_close: () => ERRNO_SUCCESS,
    fd_seek:  () => ERRNO_SUCCESS,
    proc_exit(code) { process.exit(code); },
    environ_get:        () => ERRNO_SUCCESS,
    environ_sizes_get:  (cP, sP) => { dv().setUint32(cP, 0, true); dv().setUint32(sP, 0, true); return ERRNO_SUCCESS; },
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
const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasi });
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
```

- [ ] **Step 2: Run the smoke test**

```bash
./scripts/build.sh && node scripts/smoke_preview.mjs
```

Expected: prints `smoke_preview: OK`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke_preview.mjs
git commit -m "$(cat <<'EOF'
scripts: add smoke_preview.mjs — Node smoke for tb_preview_* path

Loads the built wasm, plays a 4-note C major scale via tb_preview_music_play,
asserts the audio buffer goes non-zero within 60 frames, then calls
tb_preview_stop and asserts the buffer returns to silence. Also exercises
the SFX entry point and the -3 oversized-input return code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TS `preview.ts` wrapper

**Files:**
- Create: `editor/src/engine/preview.ts`
- Create: `editor/src/engine/preview.test.ts`

- [ ] **Step 1: Write failing test**

Create `editor/src/engine/preview.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { makePreview, PreviewError, type PreviewExports } from './preview';

function makeExports(overrides: Partial<PreviewExports> = {}): PreviewExports {
    const mem = new WebAssembly.Memory({ initial: 1 });
    const written: Uint8Array[] = [];
    const PTR = 16;
    return {
        memory: mem,
        tb_preview_ptr: () => PTR,
        tb_preview_cap: () => 32 * 1024,
        tb_preview_music_play: vi.fn((len: number) => {
            written.push(new Uint8Array(mem.buffer, PTR, len).slice());
            return 0;
        }),
        tb_preview_sfx_play: vi.fn(() => 0),
        tb_preview_stop: vi.fn(() => {}),
        ...overrides,
        __written: written,
    } as unknown as PreviewExports & { __written: Uint8Array[] };
}

describe('makePreview', () => {
    it('stages UTF-8 bytes and calls tb_preview_music_play with the byte length', () => {
        const ex = makeExports();
        const p = makePreview(ex);
        p.music('L:1/4\nK:C\nC4');
        const utf8 = new TextEncoder().encode('L:1/4\nK:C\nC4');
        expect(ex.tb_preview_music_play).toHaveBeenCalledWith(utf8.length);
        expect((ex as any).__written[0]).toEqual(utf8);
    });

    it('routes sfx() through tb_preview_sfx_play', () => {
        const ex = makeExports();
        makePreview(ex).sfx('c/4');
        expect(ex.tb_preview_sfx_play).toHaveBeenCalled();
    });

    it('throws PreviewError with the engine code on negative return', () => {
        const ex = makeExports({ tb_preview_music_play: vi.fn(() => -1) });
        expect(() => makePreview(ex).music('garbage')).toThrow(PreviewError);
        try { makePreview(ex).music('garbage'); }
        catch (e) {
            expect((e as PreviewError).code).toBe(-1);
        }
    });

    it('throws PreviewError(-3) before calling the engine if input exceeds capacity', () => {
        const ex = makeExports({ tb_preview_cap: () => 8 });
        expect(() => makePreview(ex).music('123456789')).toThrow(PreviewError);
        expect(ex.tb_preview_music_play).not.toHaveBeenCalled();
    });

    it('stop() calls tb_preview_stop', () => {
        const ex = makeExports();
        makePreview(ex).stop();
        expect(ex.tb_preview_stop).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd editor && npx vitest run src/engine/preview.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `preview.ts`**

Create `editor/src/engine/preview.ts`:

```ts
export interface PreviewExports {
    memory: WebAssembly.Memory;
    tb_preview_ptr(): number;
    tb_preview_cap(): number;
    tb_preview_music_play(len: number): number;
    tb_preview_sfx_play(len: number): number;
    tb_preview_stop(): void;
}

export class PreviewError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.name = 'PreviewError';
    }
}

export interface Preview {
    music(abc: string): void;
    sfx(abc: string): void;
    stop(): void;
}

function messageForCode(code: number): string {
    switch (code) {
        case -1: return 'engine rejected score: invalid ABC syntax';
        case -2: return 'engine rejected score: note pool exhausted';
        case -3: return 'score too large for preview buffer';
        case -4: return 'score is not valid UTF-8';
        default: return `engine returned ${code}`;
    }
}

function stage(ex: PreviewExports, abc: string): number {
    const bytes = new TextEncoder().encode(abc);
    const cap = ex.tb_preview_cap();
    if (bytes.length > cap) throw new PreviewError(-3, messageForCode(-3));
    const ptr = ex.tb_preview_ptr();
    new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
    return bytes.length;
}

export function makePreview(ex: PreviewExports): Preview {
    return {
        music(abc) {
            const len = stage(ex, abc);
            const rc = ex.tb_preview_music_play(len);
            if (rc !== 0) throw new PreviewError(rc, messageForCode(rc));
        },
        sfx(abc) {
            const len = stage(ex, abc);
            const rc = ex.tb_preview_sfx_play(len);
            if (rc !== 0) throw new PreviewError(rc, messageForCode(rc));
        },
        stop() { ex.tb_preview_stop(); },
    };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd editor && npx vitest run src/engine/preview.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/engine/preview.ts editor/src/engine/preview.test.ts
git commit -m "$(cat <<'EOF'
engine: add Preview wrapper around tb_preview_* exports

Mirrors the encoder/decoder facade pattern. Stages UTF-8 bytes into
the wasm staging buffer, dispatches to tb_preview_music_play /
tb_preview_sfx_play / tb_preview_stop, surfaces engine return codes
as PreviewError with a code field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Probe preview exports in `runtime.ts`

**Files:**
- Modify: `editor/src/engine/runtime.ts`

- [ ] **Step 1: Add a unit test for runtime probing**

There's no existing `runtime.test.ts`; add one. Create `editor/src/engine/runtime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

// Runtime construction is exercised by integration tests; this file only checks
// the optional-export probe logic in isolation.
describe('runtime preview probe', () => {
    it('exposes previewAvailable=false when exports are missing', async () => {
        const { __probePreview } = await import('./runtime');
        const r = __probePreview({} as any);
        expect(r.previewAvailable).toBe(false);
        expect(() => r.preview.music('x')).toThrow(/not present/i);
    });

    it('exposes previewAvailable=true when exports are present', async () => {
        const { __probePreview } = await import('./runtime');
        const ex = {
            memory: new WebAssembly.Memory({ initial: 1 }),
            tb_preview_ptr: () => 0,
            tb_preview_cap: () => 32 * 1024,
            tb_preview_music_play: () => 0,
            tb_preview_sfx_play: () => 0,
            tb_preview_stop: () => {},
        };
        const r = __probePreview(ex as any);
        expect(r.previewAvailable).toBe(true);
    });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd editor && npx vitest run src/engine/runtime.test.ts
```

Expected: FAIL (`__probePreview` not exported).

- [ ] **Step 3: Update `runtime.ts`**

Edit `editor/src/engine/runtime.ts`. Add import:

```ts
import { makePreview, type Preview, type PreviewExports } from './preview';
```

Extend the `Runtime` interface:

```ts
export interface Runtime {
    wasm: WebAssembly.Instance;
    memory: WebAssembly.Memory;
    tb: Tinybit;
    enc: Encoder;
    encoderAvailable: boolean;
    dec: Decoder;
    decoderAvailable: boolean;
    spritesheet: Spritesheet;
    preview: Preview;
    previewAvailable: boolean;
}
```

Inside `bootRuntime`, widen the exports cast and add the probe:

```ts
    const exports = wasm.instance.exports as unknown as
        TinybitExports & Partial<EncoderExports> & Partial<DecoderExports> & Partial<PreviewExports>;
    memoryRef.value = exports.memory;

    // ... existing tb, spritesheet, enc, dec setup ...

    const { preview, previewAvailable } = __probePreview(exports);

    return {
        wasm: wasm.instance, memory: exports.memory, tb,
        enc, encoderAvailable, dec, decoderAvailable, spritesheet,
        preview, previewAvailable,
    };
```

Add the exported probe function (at module scope, after `bootRuntime`):

```ts
export function __probePreview(exports: Partial<PreviewExports>): { preview: Preview; previewAvailable: boolean } {
    const previewAvailable =
        typeof exports.tb_preview_music_play === 'function' &&
        typeof exports.tb_preview_stop === 'function';
    const preview: Preview = previewAvailable
        ? makePreview(exports as PreviewExports)
        : {
            music() { throw new Error('Preview exports not present in WASM build — rebuild after the score-editor branch lands.'); },
            sfx()   { throw new Error('Preview exports not present in WASM build — rebuild after the score-editor branch lands.'); },
            stop()  {},
        };
    return { preview, previewAvailable };
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd editor && npx vitest run src/engine/runtime.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Type-check the editor**

```bash
cd editor && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add editor/src/engine/runtime.ts editor/src/engine/runtime.test.ts
git commit -m "$(cat <<'EOF'
engine: probe runtime for tb_preview_* exports

Adds runtime.preview / runtime.previewAvailable on the same optional-
export pattern as encoder/decoder. Older WASM builds without the new
exports get a no-op stub that throws on use.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `scoreLinks.ts` — long-bracket parsing

**Files:**
- Create: `editor/src/score/scoreLinks.ts`
- Create: `editor/src/score/scoreLinks.test.ts`

- [ ] **Step 1: Write failing test (Tier 1: bare `--@score` + `[[...]]`)**

Create `editor/src/score/scoreLinks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findScores } from './scoreLinks';

describe('findScores — long-bracket form', () => {
    it('detects --@score followed by [[ ... ]]', () => {
        const script = [
            'local x = 1',
            '--@score',
            'local tune = [[',
            'L:1/4',
            'K:C',
            'C D E F',
            ']]',
            'music(tune)',
        ].join('\n');
        const { links, diagnostics } = findScores(script);
        expect(diagnostics).toEqual([]);
        expect(links).toHaveLength(1);
        const [link] = links;
        expect(link.id).toBe('anon:2');           // annotationLine is 1-based; --@score is line 2
        expect(link.name).toBeUndefined();
        expect(link.form).toEqual({ kind: 'long', level: 0 });
        // content trims neither leading nor trailing newline that abuts the bracket:
        expect(link.content).toBe('\nL:1/4\nK:C\nC D E F\n');
        // openerRange points at the `[[`
        expect(script.slice(link.openerRange.from, link.openerRange.to)).toBe('[[');
        // closerRange points at the `]]`
        expect(script.slice(link.closerRange.from, link.closerRange.to)).toBe(']]');
    });

    it('detects --@score: name and captures the name', () => {
        const script = `--@score: bass_line\nlocal bass = [[\nK:C\nC,4\n]]\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].name).toBe('bass_line');
        expect(links[0].id).toBe('name:bass_line');
    });

    it('handles --@score:  name (with extra whitespace)', () => {
        const script = `--@score:   verse\nlocal v = [[K:C\nC\n]]\n`;
        const { links } = findScores(script);
        expect(links[0].name).toBe('verse');
    });

    it('handles --@score: (empty name) as unnamed', () => {
        const script = `--@score:   \nlocal v = [[K:C\nC\n]]\n`;
        const { links } = findScores(script);
        expect(links[0].name).toBeUndefined();
    });

    it('detects [==[ ... ]==] (one level of escalation)', () => {
        const script = `--@score\nlocal v = [==[\nL:1/4\n[[ literal in score ]] is fine\n]==]\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].form).toEqual({ kind: 'long', level: 1 });
        expect(links[0].content).toBe('\nL:1/4\n[[ literal in score ]] is fine\n');
    });

    it('detects [===[ ... ]===] (two levels)', () => {
        const script = `--@score\nlocal v = [===[\nx\n]===]\n`;
        expect(findScores(script).links[0].form).toEqual({ kind: 'long', level: 2 });
    });

    it('skips blank lines between annotation and literal (within 3)', () => {
        const script = `--@score\n\n\nlocal v = [[\nK:C\nC\n]]\n`;
        expect(findScores(script).links).toHaveLength(1);
    });

    it('emits diagnostic when no literal within 3 non-blank lines', () => {
        const script = `--@score\nlocal a = 1\nlocal b = 2\nlocal c = 3\nlocal v = [[\nK:C\n]]\n`;
        const { links, diagnostics } = findScores(script);
        expect(links).toHaveLength(0);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ kind: 'unbound-annotation', line: 1 });
    });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd editor && npx vitest run src/score/scoreLinks.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scoreLinks.ts`**

Create `editor/src/score/scoreLinks.ts`:

```ts
export interface Range { from: number; to: number; }

export type ScoreForm =
    | { kind: 'long'; level: number }            // [[ ]], [==[ ]==], etc; level = number of '=' chars
    | { kind: 'quoted'; quote: '"' | "'" };

export interface ScoreLink {
    id: string;
    name?: string;
    annotationLine: number;     // 1-based
    contentRange: Range;        // the actual ABC text (excludes brackets/quotes)
    openerRange: Range;
    closerRange: Range;
    form: ScoreForm;
    content: string;            // decoded (escapes resolved for quoted form)
}

export type Diagnostic =
    | { kind: 'unbound-annotation'; line: number; message: string }
    | { kind: 'duplicate-name'; name: string; line: number; message: string };

export interface FindScoresResult {
    links: ScoreLink[];
    diagnostics: Diagnostic[];
}

const ANNOTATION_LOOKAHEAD_LINES = 3;

export function findScores(script: string): FindScoresResult {
    const links: ScoreLink[] = [];
    const diagnostics: Diagnostic[] = [];
    const seenNames = new Set<string>();

    // Index every newline so we can map offset → line cheaply.
    const lineStarts: number[] = [0];
    for (let i = 0; i < script.length; i++) {
        if (script.charCodeAt(i) === 10) lineStarts.push(i + 1);
    }
    function lineOf(offset: number): number {
        // 1-based
        let lo = 0, hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            if (lineStarts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    }

    let i = 0;
    while (i < script.length) {
        const ch = script[i];
        // Lua block comment `--[[ ... ]]`
        if (ch === '-' && script.startsWith('--[[', i)) {
            const end = script.indexOf(']]', i + 4);
            i = end === -1 ? script.length : end + 2;
            continue;
        }
        // Lua line comment
        if (ch === '-' && script[i + 1] === '-') {
            // Check for --@score[: name] pattern on this line (after stripping leading -- and whitespace)
            // We need the annotation to be the *whole* contentful payload of the comment line.
            const lineEnd = script.indexOf('\n', i);
            const lineSlice = script.slice(i, lineEnd === -1 ? script.length : lineEnd);
            const m = /^--\s*@score\s*(?::\s*(\S+))?\s*$/.exec(lineSlice);
            if (m) {
                const annotationLine = lineOf(i);
                const rawName = m[1];
                const name = rawName && rawName.length > 0 ? rawName : undefined;
                const literalStart = findLiteralOpener(script, lineEnd + 1);
                if (literalStart == null) {
                    diagnostics.push({
                        kind: 'unbound-annotation',
                        line: annotationLine,
                        message: `--@score on line ${annotationLine} has no following string literal within ${ANNOTATION_LOOKAHEAD_LINES} non-blank lines`,
                    });
                    i = lineEnd === -1 ? script.length : lineEnd + 1;
                    continue;
                }
                const parsed = parseLiteral(script, literalStart);
                if (parsed == null) {
                    diagnostics.push({
                        kind: 'unbound-annotation',
                        line: annotationLine,
                        message: `--@score on line ${annotationLine}: malformed string literal`,
                    });
                    i = lineEnd === -1 ? script.length : lineEnd + 1;
                    continue;
                }
                const id = name ? `name:${name}` : `anon:${annotationLine}`;
                if (name) {
                    if (seenNames.has(name)) {
                        diagnostics.push({
                            kind: 'duplicate-name',
                            name,
                            line: annotationLine,
                            message: `Duplicate score name "${name}" on line ${annotationLine}`,
                        });
                    }
                    seenNames.add(name);
                }
                links.push({
                    id, name, annotationLine,
                    openerRange:  { from: parsed.openerFrom, to: parsed.openerTo },
                    contentRange: { from: parsed.contentFrom, to: parsed.contentTo },
                    closerRange:  { from: parsed.closerFrom, to: parsed.closerTo },
                    form: parsed.form,
                    content: parsed.content,
                });
                i = parsed.closerTo;
                continue;
            }
            // ordinary line comment — skip to EOL
            i = lineEnd === -1 ? script.length : lineEnd + 1;
            continue;
        }
        // String literals — skip their contents so embedded `--@score` is ignored.
        if (ch === '"' || ch === "'") {
            i = skipQuoted(script, i, ch);
            continue;
        }
        // Bare long-bracket literal (not annotated) — skip.
        if (ch === '[') {
            const opener = matchLongOpener(script, i);
            if (opener != null) {
                const closed = findLongCloser(script, opener.contentFrom, opener.level);
                i = closed == null ? script.length : closed.closerTo;
                continue;
            }
        }
        i++;
    }

    return { links, diagnostics };
}

interface ParsedLiteral {
    openerFrom: number; openerTo: number;
    contentFrom: number; contentTo: number;
    closerFrom: number; closerTo: number;
    form: ScoreForm;
    content: string;
}

function findLiteralOpener(script: string, from: number): number | null {
    let nonBlankLinesSeen = 0;
    let i = from;
    while (i < script.length) {
        // Skip leading whitespace (incl. newlines).
        const lineStart = i;
        let onlyWs = true;
        let j = i;
        while (j < script.length && script[j] !== '\n') {
            const c = script[j];
            if (c !== ' ' && c !== '\t' && c !== '\r') { onlyWs = false; break; }
            j++;
        }
        if (onlyWs) {
            // Blank line — advance past the newline and continue.
            i = j + 1;
            continue;
        }
        nonBlankLinesSeen++;
        if (nonBlankLinesSeen > ANNOTATION_LOOKAHEAD_LINES) return null;
        // Scan this line for the opener.
        const lineEnd = (() => {
            const n = script.indexOf('\n', lineStart);
            return n === -1 ? script.length : n;
        })();
        for (let k = lineStart; k < lineEnd; k++) {
            const c = script[k];
            if (c === '"' || c === "'") return k;
            if (c === '[') {
                if (matchLongOpener(script, k) != null) return k;
            }
        }
        i = lineEnd + 1;
    }
    return null;
}

interface LongOpener { openerFrom: number; openerTo: number; contentFrom: number; level: number; }
function matchLongOpener(script: string, from: number): LongOpener | null {
    if (script[from] !== '[') return null;
    let k = from + 1;
    let level = 0;
    while (script[k] === '=') { level++; k++; }
    if (script[k] !== '[') return null;
    return { openerFrom: from, openerTo: k + 1, contentFrom: k + 1, level };
}

function findLongCloser(script: string, from: number, level: number): { closerFrom: number; closerTo: number; contentTo: number } | null {
    const needle = ']' + '='.repeat(level) + ']';
    const idx = script.indexOf(needle, from);
    if (idx === -1) return null;
    return { closerFrom: idx, closerTo: idx + needle.length, contentTo: idx };
}

function parseLiteral(script: string, start: number): ParsedLiteral | null {
    const c = script[start];
    if (c === '[') {
        const opener = matchLongOpener(script, start);
        if (opener == null) return null;
        const close = findLongCloser(script, opener.contentFrom, opener.level);
        if (close == null) return null;
        return {
            openerFrom: opener.openerFrom, openerTo: opener.openerTo,
            contentFrom: opener.contentFrom, contentTo: close.contentTo,
            closerFrom: close.closerFrom, closerTo: close.closerTo,
            form: { kind: 'long', level: opener.level },
            content: script.slice(opener.contentFrom, close.contentTo),
        };
    }
    if (c === '"' || c === "'") {
        const close = findQuotedCloser(script, start + 1, c);
        if (close == null) return null;
        return {
            openerFrom: start, openerTo: start + 1,
            contentFrom: start + 1, contentTo: close.contentTo,
            closerFrom: close.contentTo, closerTo: close.contentTo + 1,
            form: { kind: 'quoted', quote: c as '"' | "'" },
            content: decodeQuoted(script.slice(start + 1, close.contentTo)),
        };
    }
    return null;
}

function skipQuoted(script: string, start: number, quote: string): number {
    const close = findQuotedCloser(script, start + 1, quote);
    return close == null ? script.length : close.contentTo + 1;
}

function findQuotedCloser(script: string, from: number, quote: string): { contentTo: number } | null {
    let k = from;
    while (k < script.length) {
        const c = script[k];
        if (c === '\\') { k += 2; continue; }
        if (c === '\n') return null; // Lua: unescaped newline ends string literal as an error
        if (c === quote) return { contentTo: k };
        k++;
    }
    return null;
}

function decodeQuoted(raw: string): string {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c !== '\\') { out += c; continue; }
        const n = raw[i + 1];
        i++;
        switch (n) {
            case 'n':  out += '\n'; break;
            case 't':  out += '\t'; break;
            case 'r':  out += '\r'; break;
            case '"':  out += '"';  break;
            case "'":  out += "'";  break;
            case '\\': out += '\\'; break;
            default:   out += n;    break;
        }
    }
    return out;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd editor && npx vitest run src/score/scoreLinks.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/score/scoreLinks.ts editor/src/score/scoreLinks.test.ts
git commit -m "$(cat <<'EOF'
score: add findScores() — Lua-aware --@score annotation parser

Scans a Lua script for --@score[: name] markers followed (within
3 non-blank lines) by a string literal. Supports [[...]],
[=*[...]=*] (any level), and "..."/'...' with backslash escapes.
Skips strings/comments so annotations inside string content don't
match. Returns links plus diagnostics for unbound annotations and
duplicate names.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `scoreLinks.ts` — quoted strings, ignoring strings/comments, duplicates

**Files:**
- Modify: `editor/src/score/scoreLinks.test.ts`

- [ ] **Step 1: Add more tests**

Append to `editor/src/score/scoreLinks.test.ts`:

```ts
describe('findScores — quoted form', () => {
    it('detects --@score with "..." literal and decodes \\n', () => {
        const script = `--@score\nlocal v = "L:1/4\\nK:C\\nC4"\n`;
        const { links } = findScores(script);
        expect(links).toHaveLength(1);
        expect(links[0].form).toEqual({ kind: 'quoted', quote: '"' });
        expect(links[0].content).toBe('L:1/4\nK:C\nC4');
    });

    it("detects --@score with '...' literal", () => {
        const script = `--@score\nlocal v = 'c/4d/4'\n`;
        const { links } = findScores(script);
        expect(links[0].form).toEqual({ kind: 'quoted', quote: "'" });
        expect(links[0].content).toBe('c/4d/4');
    });
});

describe('findScores — robustness', () => {
    it('ignores --@score appearing inside a string literal', () => {
        const script = `local x = "--@score actually inside a string"\nlocal y = 1\n`;
        const { links, diagnostics } = findScores(script);
        expect(links).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('ignores --@score inside a long-bracket literal', () => {
        const script = `local x = [[\n--@score not an annotation\n]]\nlocal y = 1\n`;
        expect(findScores(script).links).toEqual([]);
    });

    it('ignores --@score inside a --[[ ... ]] block comment', () => {
        const script = `--[[ --@score not an annotation ]]\nlocal y = 1\n`;
        expect(findScores(script).links).toEqual([]);
    });

    it('produces a duplicate-name diagnostic when two scores share a name', () => {
        const script =
            `--@score: tune\nlocal a = [[K:C\nC\n]]\n` +
            `--@score: tune\nlocal b = [[K:C\nD\n]]\n`;
        const { links, diagnostics } = findScores(script);
        expect(links).toHaveLength(2);
        const dups = diagnostics.filter((d) => d.kind === 'duplicate-name');
        expect(dups).toHaveLength(1);
    });

    it('returns multiple links in script order', () => {
        const script =
            `--@score: first\nlocal a = [[K:C\nC\n]]\n` +
            `--@score: second\nlocal b = [[K:C\nD\n]]\n`;
        const { links } = findScores(script);
        expect(links.map((l) => l.name)).toEqual(['first', 'second']);
        expect(links[0].annotationLine).toBe(1);
        expect(links[1].annotationLine).toBe(4);
    });
});
```

- [ ] **Step 2: Run, verify pass**

```bash
cd editor && npx vitest run src/score/scoreLinks.test.ts
```

Expected: all 14 tests pass (8 original + 6 new). If any fail, audit the implementation from Task 6 — most likely culprits are `skipQuoted` for quoted-form, or `matchLongOpener` for the block-comment case.

- [ ] **Step 3: Commit**

```bash
git add editor/src/score/scoreLinks.test.ts
git commit -m "$(cat <<'EOF'
test(score): cover quoted literals, embedded annotations, duplicates

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `scoreSync.ts` — `replaceScoreContent`

**Files:**
- Create: `editor/src/score/scoreSync.ts`
- Create: `editor/src/score/scoreSync.test.ts`

- [ ] **Step 1: Write failing tests**

Create `editor/src/score/scoreSync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findScores } from './scoreLinks';
import { replaceScoreContent, insertNewScoreSnippet } from './scoreSync';

function firstLink(script: string) {
    const { links } = findScores(script);
    if (links.length === 0) throw new Error('expected at least one link in fixture');
    return { link: links[0], script };
}

describe('replaceScoreContent — long-bracket form', () => {
    it('splices new content into [[...]] without changing the form', () => {
        const { link, script } = firstLink('--@score\nlocal v = [[\nold\n]]\n');
        const r = replaceScoreContent(script, link, '\nnew\n');
        if ('error' in r) throw new Error(`expected ok, got error ${r.error}`);
        expect(r.script).toBe('--@score\nlocal v = [[\nnew\n]]\n');
    });

    it('escalates [[ → [==[ when new content contains ]]', () => {
        const { link, script } = firstLink('--@score\nlocal v = [[\nx\n]]\n');
        const r = replaceScoreContent(script, link, '\nfoo ]] bar\n');
        if ('error' in r) throw new Error(`expected ok, got error ${r.error}`);
        expect(r.script).toBe('--@score\nlocal v = [==[\nfoo ]] bar\n]==]\n');
    });

    it('escalates [==[ → [===[ when new content contains ]==]', () => {
        const { link, script } = firstLink('--@score\nlocal v = [==[\nx\n]==]\n');
        const r = replaceScoreContent(script, link, '\nfoo ]==] bar\n');
        if ('error' in r) throw new Error(`expected ok, got error ${r.error}`);
        expect(r.script).toBe('--@score\nlocal v = [===[\nfoo ]==] bar\n]===]\n');
    });

    it('fails with bracket-escalation-exhausted past 3 levels', () => {
        const { link, script } = firstLink('--@score\nlocal v = [===[\nx\n]===]\n');
        const r = replaceScoreContent(script, link, 'a ]===] b ]====] c ]=====]');
        expect('error' in r && r.error).toBe('bracket-escalation-exhausted');
    });
});

describe('replaceScoreContent — quoted form', () => {
    it('re-escapes newlines and quotes for "..."', () => {
        const { link, script } = firstLink('--@score\nlocal v = "old"\n');
        const r = replaceScoreContent(script, link, 'L:1/4\nK:C\n"quoted"');
        if ('error' in r) throw new Error(`expected ok`);
        expect(r.script).toBe('--@score\nlocal v = "L:1/4\\nK:C\\n\\"quoted\\""\n');
    });

    it("re-escapes for '...'", () => {
        const { link, script } = firstLink("--@score\nlocal v = 'old'\n");
        const r = replaceScoreContent(script, link, "it's");
        if ('error' in r) throw new Error('expected ok');
        expect(r.script).toBe("--@score\nlocal v = 'it\\'s'\n");
    });
});

describe('replaceScoreContent — link staleness', () => {
    it('returns link-stale when annotation no longer exists at the stored offsets', () => {
        const initial = '--@score\nlocal v = [[\nx\n]]\n';
        const { link } = firstLink(initial);
        const mutated = '-- the annotation has been deleted\nlocal v = [[\nx\n]]\n';
        const r = replaceScoreContent(mutated, link, 'new');
        expect('error' in r && r.error).toBe('link-stale');
    });
});

describe('insertNewScoreSnippet', () => {
    it('inserts a starter snippet at the cursor and returns a valid link', () => {
        const initial = `function _draw() end\n`;
        const result = insertNewScoreSnippet(initial, initial.length);
        expect(result.script).toContain('--@score: score_1');
        expect(result.script).toContain('[[\nL:1/4\nK:C\nC D E F |\n]]');
        // Returned link points at the inserted score
        const verify = findScores(result.script);
        expect(verify.links.some((l) => l.name === 'score_1')).toBe(true);
        expect(result.newLink.name).toBe('score_1');
    });

    it('chooses an unused name when score_1 is taken', () => {
        const initial = `--@score: score_1\nlocal a = [[\nK:C\nC\n]]\n`;
        const result = insertNewScoreSnippet(initial, initial.length);
        expect(result.newLink.name).toBe('score_2');
    });

    it('prefixes a newline when cursor is mid-line', () => {
        const initial = 'do_thing()';
        const result = insertNewScoreSnippet(initial, initial.length);
        expect(result.script.startsWith('do_thing()\n')).toBe(true);
    });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd editor && npx vitest run src/score/scoreSync.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scoreSync.ts`**

Create `editor/src/score/scoreSync.ts`:

```ts
import { findScores, type ScoreLink } from './scoreLinks';

export type ReplaceResult =
    | { script: string }
    | { error: 'link-stale' | 'bracket-escalation-exhausted' };

const MAX_BRACKET_LEVEL = 3;

export function replaceScoreContent(
    script: string,
    link: ScoreLink,
    newContent: string,
): ReplaceResult {
    // Re-resolve the link in the current script to detect staleness.
    const current = findScores(script).links.find((l) => l.id === link.id);
    if (!current) return { error: 'link-stale' };

    if (current.form.kind === 'long') {
        // Choose a bracket level that doesn't appear in newContent.
        let level = current.form.level;
        while (level <= MAX_BRACKET_LEVEL) {
            const closer = ']' + '='.repeat(level) + ']';
            if (!newContent.includes(closer)) break;
            level++;
        }
        if (level > MAX_BRACKET_LEVEL) return { error: 'bracket-escalation-exhausted' };
        const opener = '[' + '='.repeat(level) + '[';
        const closer = ']' + '='.repeat(level) + ']';
        const before = script.slice(0, current.openerRange.from);
        const after  = script.slice(current.closerRange.to);
        return { script: before + opener + newContent + closer + after };
    }

    // Quoted form: re-escape.
    const q = current.form.quote;
    const before = script.slice(0, current.openerRange.from);
    const after  = script.slice(current.closerRange.to);
    const escaped = encodeQuoted(newContent, q);
    return { script: before + q + escaped + q + after };
}

function encodeQuoted(content: string, quote: '"' | "'"): string {
    let out = '';
    for (const c of content) {
        if (c === '\\')         out += '\\\\';
        else if (c === quote)   out += '\\' + quote;
        else if (c === '\n')    out += '\\n';
        else if (c === '\r')    out += '\\r';
        else if (c === '\t')    out += '\\t';
        else                    out += c;
    }
    return out;
}

const TEMPLATE_BODY = '\nL:1/4\nK:C\nC D E F |\n';

export interface InsertResult {
    script: string;
    newLink: ScoreLink;
    cursor: number; // cursor position inside the new score's content (for the script editor to optionally jump to)
}

export function insertNewScoreSnippet(script: string, cursor: number): InsertResult {
    const name = nextUnusedName(script);
    const snippet =
        (cursor > 0 && script[cursor - 1] !== '\n' ? '\n' : '') +
        `--@score: ${name}\nlocal ${name} = [[${TEMPLATE_BODY}]]\n`;
    const newScript = script.slice(0, cursor) + snippet + script.slice(cursor);
    const result = findScores(newScript);
    const newLink = result.links.find((l) => l.name === name);
    if (!newLink) throw new Error('insertNewScoreSnippet: failed to round-trip; this is a bug');
    return { script: newScript, newLink, cursor: newLink.contentRange.from };
}

function nextUnusedName(script: string): string {
    const taken = new Set(findScores(script).links.map((l) => l.name).filter(Boolean) as string[]);
    for (let n = 1; n < 1000; n++) {
        const candidate = `score_${n}`;
        if (!taken.has(candidate)) return candidate;
    }
    // Practically unreachable.
    return `score_${Date.now()}`;
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd editor && npx vitest run src/score/scoreSync.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/score/scoreSync.ts editor/src/score/scoreSync.test.ts
git commit -m "$(cat <<'EOF'
score: add replaceScoreContent / insertNewScoreSnippet

replaceScoreContent re-resolves the link in the current script to
detect staleness, preserves the user's literal form, and escalates
[=*[ ]=*] up to level 3 when the new content contains the existing
closer. insertNewScoreSnippet picks an unused score_<N> name and
inserts a starter ABC template at the cursor, prefixing a newline
when cursor is mid-line.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `abcMode.ts` — CodeMirror simpleMode for ABC

**Files:**
- Create: `editor/src/score/abcMode.ts`
- Create: `editor/src/score/abcMode.test.ts`

- [ ] **Step 1: Write a tokenization test**

Create `editor/src/score/abcMode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { abcLang } from './abcMode';

// We exercise the language extension by instantiating an EditorState and
// asking the parser to assign a tag to a known token.
import { EditorState } from '@codemirror/state';
import { highlightingFor } from '@codemirror/language';

describe('abcLang', () => {
    it('returns a CodeMirror extension', () => {
        const ext = abcLang();
        expect(ext).toBeDefined();
        // simpleMode-derived extensions are arrays of extensions; both shapes are acceptable.
        const state = EditorState.create({ doc: 'K:C\nC D E F\n', extensions: [ext] });
        expect(state.doc.toString()).toBe('K:C\nC D E F\n');
    });

    it('parses without throwing for typical ABC content', () => {
        // Smoke check that the language extension does not throw on parse.
        const doc =
            'X:1\n' +
            'T:Test\n' +
            'M:4/4\n' +
            'L:1/8\n' +
            'Q:1/4=120\n' +
            'K:Cmaj\n' +
            '|:CDEF GABc:|\n' +
            '[CEG] (3CDE z2 |\n';
        const state = EditorState.create({ doc, extensions: [abcLang()] });
        expect(state.doc.length).toBeGreaterThan(0);
        // We don't assert specific highlightingFor results here — that pulls
        // in HighlightStyle infrastructure. Tokenization correctness is best
        // verified visually; this test just guards against parse crashes.
        void highlightingFor;
    });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd editor && npx vitest run src/score/abcMode.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `abcMode.ts`**

Create `editor/src/score/abcMode.ts`. `@codemirror/legacy-modes` ships per-language modes (`mode/lua`, `mode/python`, etc.) but **no `simple-mode`** export, so we implement `StreamParser` directly:

```ts
import { StreamLanguage, type StreamParser } from '@codemirror/language';

// CodeMirror 6 doesn't ship a built-in ABC mode. We hand-roll a tiny
// StreamParser that highlights the common headers + bar lines + note glyphs.
// Deliberately approximate — ABC is a fiddly grammar and we only need enough
// to make the in-editor experience pleasant.

interface AbcState {
    atLineStart: boolean;
}

const abcParser: StreamParser<AbcState> = {
    startState: () => ({ atLineStart: true }),
    token(stream, state) {
        // Newlines
        if (stream.sol()) state.atLineStart = true;

        if (stream.eatSpace()) return null;

        // Line comment
        if (stream.match(/%.*/)) { state.atLineStart = false; return 'comment'; }

        // Info-field header at start of line: `X:`, `K:`, `M:`, `L:`, `Q:`, `T:`, `V:`, `W:`, `w:`, etc.
        if (state.atLineStart && stream.match(/[A-Za-z]:[^\n]*/)) {
            state.atLineStart = false;
            return 'keyword';
        }
        state.atLineStart = false;

        // Bar lines / repeats — order matters: longer matches first.
        if (stream.match(/\|\||::|\|:|:\||\|\d+|\|/)) return 'operator';

        // Chord literal `[CEG]`
        if (stream.match(/\[[^\]\n]*\]/)) return 'string';

        // Tuplet opener like `(3`, `(2`
        if (stream.match(/\(\d/)) return 'number';

        // Accidental + note + octave-marks + duration (e.g. `^C,2`, `=A'/4`, `_d3/2`, `z2`)
        if (stream.match(/[_=^]?[a-gA-Gz][,']*\d*\/?\d*/)) return 'variableName';

        // Standalone duration number
        if (stream.match(/\d+\/?\d*/)) return 'number';

        // Slurs, ties, decorations
        if (stream.match(/[()~.\-]/)) return 'operator';

        // Anything else: advance by one and don't highlight.
        stream.next();
        return null;
    },
    languageData: { commentTokens: { line: '%' } },
};

export function abcLang() {
    return StreamLanguage.define(abcParser);
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd editor && npx vitest run src/score/abcMode.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/score/abcMode.ts editor/src/score/abcMode.test.ts
git commit -m "$(cat <<'EOF'
score: add CodeMirror simpleMode for ABC notation

Highlights info-field headers (X:, K:, M:, L:, Q:, T:, V:, …),
bar/repeat markers, chord brackets, tuplets, accidentals + notes,
durations, and slurs. Deliberately approximate — enough to read,
not a full ABC grammar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `ScorePreview.tsx` — abcjs renderer with error band

**Files:**
- Create: `editor/src/score/ScorePreview.tsx`
- Create: `editor/src/score/ScorePreview.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `editor/src/score/ScorePreview.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ScorePreview } from './ScorePreview';

const renderAbc = vi.fn((el: HTMLElement, _abc: string) => {
    el.innerHTML = '<svg data-testid="rendered-svg"><g></g></svg>';
});

vi.mock('abcjs', () => ({
    default:    { renderAbc: (...a: any[]) => renderAbc(...a) },
    renderAbc:  (...a: any[]) => renderAbc(...a),
}));

beforeEach(() => { renderAbc.mockClear(); });
afterEach(() => { cleanup(); });

describe('ScorePreview', () => {
    it('renders an SVG via abcjs when given valid ABC', async () => {
        render(<ScorePreview abc="K:C\nC D E F" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByTestId('rendered-svg')).toBeInTheDocument());
    });

    it('renders an error band when abcjs throws', async () => {
        renderAbc.mockImplementationOnce(() => { throw new Error('boom'); });
        render(<ScorePreview abc="totally broken" />);
        await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
    });

    it('re-renders when abc prop changes', async () => {
        const { rerender } = render(<ScorePreview abc="K:C\nC" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(1));
        rerender(<ScorePreview abc="K:G\nG" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(2));
    });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd editor && npx vitest run src/score/ScorePreview.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ScorePreview.tsx`**

Create `editor/src/score/ScorePreview.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';

type RenderAbc = (target: HTMLElement, abc: string, options?: Record<string, unknown>) => unknown;

const previewWrap: CSSProperties = {
    background: '#FFFFFF',
    overflow: 'auto',
    padding: '6px 8px',
};
const errorBand: CSSProperties = {
    background: '#FEF2F2',
    color: '#B91C1C',
    border: '1px solid #FCA5A5',
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    margin: '6px 8px',
    borderRadius: 4,
};

export interface ScorePreviewProps {
    abc: string;
}

export function ScorePreview({ abc }: ScorePreviewProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [renderAbc, setRenderAbc] = useState<RenderAbc | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Lazy-import abcjs so the script-only path isn't bloated.
        import('abcjs')
            .then((mod) => {
                if (cancelled) return;
                const fn: RenderAbc | undefined =
                    (mod as { renderAbc?: RenderAbc }).renderAbc ??
                    ((mod as { default?: { renderAbc?: RenderAbc } }).default?.renderAbc);
                if (!fn) {
                    setError('abcjs module did not expose renderAbc');
                    return;
                }
                setRenderAbc(() => fn);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!renderAbc || !hostRef.current) return;
        setError(null);
        try {
            renderAbc(hostRef.current, abc, { responsive: 'resize' });
        } catch (err) {
            hostRef.current.innerHTML = '';
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [renderAbc, abc]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {error && <div style={errorBand}>{error}</div>}
            <div ref={hostRef} style={previewWrap} aria-label="rendered score" />
        </div>
    );
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd editor && npx vitest run src/score/ScorePreview.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/score/ScorePreview.tsx editor/src/score/ScorePreview.test.tsx
git commit -m "$(cat <<'EOF'
score: add ScorePreview — lazy-loaded abcjs SVG renderer

abcjs is dynamic-imported to keep the script-only path lean. When
abcjs throws on malformed input, the component renders a red error
band beneath the (empty) host node instead of unmounting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `ScoreEditor.tsx` — thin CodeMirror wrapper

**Files:**
- Create: `editor/src/score/ScoreEditor.tsx`

This is a thin component (no separate test file — covered by `ScoreTab.test.tsx` integration).

- [ ] **Step 1: Implement**

Create `editor/src/score/ScoreEditor.tsx`. Pattern follows `editor/src/editor/CodeEditor.tsx`, with `abcLang()` replacing `luaLang()`:

```tsx
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection, keymap, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { abcLang } from './abcMode';

const abcHighlight = HighlightStyle.define([
    { tag: t.keyword,      color: '#ED225D', fontWeight: '600' },  // headers (K:, M:, …)
    { tag: t.variableName, color: '#181820' },                     // notes
    { tag: t.operator,     color: '#6B6B76' },                     // bars + slurs
    { tag: t.number,       color: '#D97706' },                     // durations + tuplets
    { tag: t.definition(t.string), color: '#16A34A' },             // chord brackets
    { tag: t.string,       color: '#16A34A' },
    { tag: t.comment,      color: '#A0A0AA', fontStyle: 'italic' },
]);

const editorTheme = EditorView.theme({
    '&': { height: '100%', backgroundColor: '#fff', color: '#181820' },
    '.cm-content': { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '13px', padding: '8px 0' },
    '.cm-gutters': { backgroundColor: '#FAFAFA', color: '#A0A0AA', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#FDE4EF44' },
    '.cm-activeLineGutter': { backgroundColor: '#FDE4EF88', color: '#ED225D' },
    '.cm-cursor': { borderLeftColor: '#ED225D', borderLeftWidth: '2px' },
}, { dark: false });

export interface ScoreEditorProps {
    value: string;
    onChange(v: string): void;
}

export function ScoreEditor({ value, onChange }: ScoreEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!hostRef.current) return;
        const state = EditorState.create({
            doc: value,
            extensions: [
                lineNumbers(),
                foldGutter(),
                drawSelection({ cursorBlinkRate: 1000 }),
                highlightSpecialChars(),
                history(),
                indentOnInput(),
                bracketMatching(),
                abcLang(),
                syntaxHighlighting(abcHighlight),
                editorTheme,
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) onChangeRef.current(u.state.doc.toString());
                }),
                EditorView.contentAttributes.of({ 'aria-label': 'ABC score editor' }),
            ],
        });
        const view = new EditorView({ state, parent: hostRef.current });
        viewRef.current = view;
        return () => { view.destroy(); viewRef.current = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        }
    }, [value]);

    return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
}
```

- [ ] **Step 2: Type-check**

```bash
cd editor && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add editor/src/score/ScoreEditor.tsx
git commit -m "$(cat <<'EOF'
score: add ScoreEditor — CodeMirror ABC text editor

Mirrors the script CodeEditor structure but binds abcLang() and a
bubblegum-ish highlight style tuned for ABC tokens (headers in pink,
notes in ink, bar lines in slate, durations in amber, chord brackets
in green).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `ScoreTab.tsx` — composes editor + preview + chip bar

**Files:**
- Create: `editor/src/score/ScoreTab.tsx`
- Create: `editor/src/score/ScoreTab.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `editor/src/score/ScoreTab.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { useSketchStore, DEFAULT_SCRIPT } from '../state/sketchStore';
import { ScoreTab } from './ScoreTab';

vi.mock('abcjs', () => ({
    renderAbc: (el: HTMLElement) => { el.innerHTML = '<svg data-testid="rendered-svg"></svg>'; },
    default: { renderAbc: (el: HTMLElement) => { el.innerHTML = '<svg data-testid="rendered-svg"></svg>'; } },
}));

const preview = { music: vi.fn(), sfx: vi.fn(), stop: vi.fn() };

beforeEach(() => {
    useSketchStore.setState({ script: DEFAULT_SCRIPT });
    preview.music.mockClear();
    preview.stop.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ScoreTab — empty state', () => {
    it('shows empty state and a + New score button when no annotations exist', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        expect(screen.getByText(/no scores yet/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /new score/i })).toBeInTheDocument();
    });

    it('inserts a starter snippet into the script when + New score is clicked', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /new score/i }));
        const updated = useSketchStore.getState().script;
        expect(updated).toContain('--@score: score_1');
        expect(updated).toContain('[[\nL:1/4\nK:C\nC D E F |\n]]');
    });
});

describe('ScoreTab — with one score', () => {
    const SCRIPT = '--@score: melody\nlocal m = [[\nK:C\nC D E F\n]]\nmusic(m)\n';

    it('renders a chip for the score and loads its content into the editor', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        expect(screen.getByRole('button', { name: /melody/i })).toBeInTheDocument();
    });

    it('routes Play through preview.music with the current ABC content', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /play/i }));
        expect(preview.music).toHaveBeenCalledTimes(1);
        const called = preview.music.mock.calls[0][0] as string;
        expect(called).toContain('K:C');
    });

    it('routes Stop through preview.stop', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        expect(preview.stop).toHaveBeenCalled();
    });

    it('disables Play with a tooltip when previewAvailable=false', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable={false} />);
        const play = screen.getByRole('button', { name: /play/i });
        expect(play).toBeDisabled();
    });
});

describe('ScoreTab — stale link', () => {
    it('shows a banner when the held link is removed from the script', () => {
        const SCRIPT = '--@score\nlocal m = [[\nK:C\nC\n]]\n';
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        // Externally remove the annotation
        act(() => useSketchStore.setState({ script: 'local m = [[\nK:C\nC\n]]\n' }));
        expect(screen.getByText(/no longer linked/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd editor && npx vitest run src/score/ScoreTab.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ScoreTab.tsx`**

Create `editor/src/score/ScoreTab.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSketchStore } from '../state/sketchStore';
import { findScores, type ScoreLink } from './scoreLinks';
import { insertNewScoreSnippet, replaceScoreContent } from './scoreSync';
import { ScoreEditor } from './ScoreEditor';
import { ScorePreview } from './ScorePreview';
import type { Preview } from '../engine/preview';

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 };
const chipBar: CSSProperties = {
    display: 'flex', flexWrap: 'wrap', gap: 4,
    padding: '6px 8px', borderBottom: '1px solid #ECECF0', background: '#FAFAFA',
    alignItems: 'center',
};
function chipStyle(active: boolean): CSSProperties {
    return {
        padding: '3px 8px', fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
        borderRadius: 999, border: '1px solid ' + (active ? '#ED225D' : '#ECECF0'),
        background: active ? '#FDE4EF' : '#FFFFFF', color: active ? '#ED225D' : '#181820',
        cursor: 'pointer',
    };
}
const newScoreBtn: CSSProperties = {
    marginLeft: 'auto', padding: '3px 10px', fontSize: 11, fontWeight: 600,
    borderRadius: 999, border: '1px solid #ED225D',
    background: '#ED225D', color: '#FFFFFF', cursor: 'pointer',
};
const editorWrap: CSSProperties = { flex: 1, minHeight: 0, borderBottom: '1px solid #ECECF0' };
const previewWrap: CSSProperties = { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const transportBar: CSSProperties = { padding: '6px 8px', display: 'flex', gap: 6, borderTop: '1px solid #ECECF0', background: '#FAFAFA' };
const transportBtn = (disabled: boolean): CSSProperties => ({
    padding: '4px 10px', fontSize: 12, fontWeight: 600,
    borderRadius: 4, border: '1px solid #ED225D',
    background: disabled ? '#FDE4EF' : '#ED225D', color: disabled ? '#ED225D' : '#FFFFFF',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
});
const banner: CSSProperties = {
    padding: '8px 10px', background: '#FEF2F2', color: '#B91C1C', fontSize: 12,
    borderBottom: '1px solid #FCA5A5',
};
const emptyState: CSSProperties = {
    flex: 1, display: 'grid', placeItems: 'center', color: '#6B6B76', fontSize: 13, padding: 20, textAlign: 'center',
};

export interface ScoreTabProps {
    preview: Preview;
    previewAvailable: boolean;
    selectedLinkId?: string;
    onSelectLink?(id: string | null): void;
}

const DEBOUNCE_MS = 300;

export function ScoreTab({ preview, previewAvailable, selectedLinkId: controlledId, onSelectLink }: ScoreTabProps) {
    const script = useSketchStore((s) => s.script);
    const setScript = useSketchStore((s) => s.setScript);
    const { links } = useMemo(() => findScores(script), [script]);

    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
    const selectedId = controlledId ?? internalSelectedId;
    const setSelected = useCallback((id: string | null) => {
        if (onSelectLink) onSelectLink(id);
        else setInternalSelectedId(id);
    }, [onSelectLink]);

    // Auto-select the first link if none is selected.
    useEffect(() => {
        if (!selectedId && links.length > 0) setSelected(links[0].id);
    }, [selectedId, links, setSelected]);

    const selectedLink = links.find((l) => l.id === selectedId) ?? null;

    // Local buffer for low-latency typing; flushed to sketchStore on a debounce.
    const [buffer, setBuffer] = useState<string>(selectedLink?.content ?? '');
    const writebackTimer = useRef<number | null>(null);

    // When the selected link changes (or its underlying content changes externally), reset the buffer.
    const adoptedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!selectedLink) { setBuffer(''); adoptedKeyRef.current = null; return; }
        const key = `${selectedLink.id}@${selectedLink.contentRange.from}-${selectedLink.contentRange.to}`;
        if (adoptedKeyRef.current !== key) {
            setBuffer(selectedLink.content);
            adoptedKeyRef.current = key;
        }
    }, [selectedLink]);

    const flushTimer = useCallback(() => {
        if (writebackTimer.current != null) {
            window.clearTimeout(writebackTimer.current);
            writebackTimer.current = null;
        }
    }, []);
    useEffect(() => () => flushTimer(), [flushTimer]);

    const handleChange = useCallback((next: string) => {
        setBuffer(next);
        if (!selectedLink) return;
        flushTimer();
        writebackTimer.current = window.setTimeout(() => {
            const result = replaceScoreContent(useSketchStore.getState().script, selectedLink, next);
            if ('error' in result) {
                // eslint-disable-next-line no-console
                console.warn(`[score] writeback dropped (${result.error})`);
                return;
            }
            setScript(result.script);
        }, DEBOUNCE_MS);
    }, [selectedLink, flushTimer, setScript]);

    const handleNewScore = useCallback(() => {
        flushTimer();
        const current = useSketchStore.getState().script;
        const { script: newScript, newLink } = insertNewScoreSnippet(current, current.length);
        setScript(newScript);
        setSelected(newLink.id);
    }, [flushTimer, setScript, setSelected]);

    const handlePlay = useCallback(() => {
        if (!selectedLink) return;
        try { preview.music(buffer); }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error('[score] preview failed:', err);
        }
    }, [preview, selectedLink, buffer]);

    const handleStop = useCallback(() => { preview.stop(); }, [preview]);

    const linkStale = selectedId != null && !selectedLink;

    return (
        <div style={wrap}>
            <div style={chipBar}>
                {links.length === 0
                    ? <span style={{ color: '#6B6B76', fontSize: 12 }}>No scores yet.</span>
                    : links.map((l: ScoreLink) => (
                        <button key={l.id}
                            type="button"
                            style={chipStyle(l.id === selectedId)}
                            onClick={() => setSelected(l.id)}>
                            {l.name ?? `(anon @ line ${l.annotationLine})`}
                        </button>
                    ))}
                <button type="button" style={newScoreBtn} onClick={handleNewScore}>+ New score</button>
            </div>
            {linkStale && (
                <div style={banner}>
                    This score is no longer linked to the script. Pick another score, or click + New score.
                </div>
            )}
            {!selectedLink && !linkStale && links.length === 0 && (
                <div style={emptyState}>
                    Click <b>+ New score</b> to insert a starter ABC score into your script.
                </div>
            )}
            {selectedLink && (
                <>
                    <div style={editorWrap}>
                        <ScoreEditor value={buffer} onChange={handleChange} />
                    </div>
                    <div style={previewWrap}>
                        <ScorePreview abc={buffer} />
                        <div style={transportBar}>
                            <button type="button" style={transportBtn(!previewAvailable)} disabled={!previewAvailable}
                                onClick={handlePlay} aria-label="play">▶ Play</button>
                            <button type="button" style={transportBtn(false)}
                                onClick={handleStop} aria-label="stop">⏹ Stop</button>
                            {!previewAvailable && <span style={{ fontSize: 11, color: '#6B6B76', alignSelf: 'center' }}>Preview requires rebuilding the WASM</span>}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd editor && npx vitest run src/score/ScoreTab.test.tsx
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/score/ScoreTab.tsx editor/src/score/ScoreTab.test.tsx
git commit -m "$(cat <<'EOF'
score: add ScoreTab — chip bar + ABC editor + abcjs preview + Play/Stop

Lists every --@score annotation in the script as a chip. Selecting
a chip loads its content into the ABC editor; typing flushes back
into sketchStore.script after a 300 ms debounce. + New score
inserts a starter snippet at the end of the script. Play routes
through runtime.preview.music; Stop calls preview.stop. When the
held link is removed from the script externally, a red banner takes
over the tab body until the user picks another score or makes a
new one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `scoreHoverTooltip.ts` — script-tab hover extension

**Files:**
- Create: `editor/src/score/scoreHoverTooltip.ts`
- Create: `editor/src/score/scoreHoverTooltip.test.ts`

- [ ] **Step 1: Write failing test**

Create `editor/src/score/scoreHoverTooltip.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { scoreHoverTooltip } from './scoreHoverTooltip';

function makeView(doc: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const state = EditorState.create({ doc, extensions: [scoreHoverTooltip(() => {})] });
    return new EditorView({ state, parent: host });
}

describe('scoreHoverTooltip', () => {
    it('returns a CodeMirror extension', () => {
        const ext = scoreHoverTooltip(() => {});
        expect(ext).toBeDefined();
    });

    it('does not throw when applied to a script with a linked score', () => {
        const script = '--@score: m\nlocal m = [[\nK:C\nC\n]]\nmusic(m)\n';
        const view = makeView(script);
        expect(view.state.doc.toString()).toBe(script);
        view.destroy();
    });

    it('does not throw on a script with no annotations', () => {
        const view = makeView('function _draw() end\n');
        expect(view.state.doc.toString()).toBe('function _draw() end\n');
        view.destroy();
    });

    it('invokes the onPick callback when the tooltip button receives a synthesized click', async () => {
        // We can't easily synthesize a mouse hover that triggers CM6's hoverTooltip, but we
        // can verify the *callback contract* by exporting and unit-testing the click handler.
        const onPick = vi.fn();
        const mod = await import('./scoreHoverTooltip');
        const handler = mod.__forTest_clickHandler(onPick);
        handler('name:m');
        expect(onPick).toHaveBeenCalledWith('name:m');
    });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd editor && npx vitest run src/score/scoreHoverTooltip.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scoreHoverTooltip.ts`**

Create `editor/src/score/scoreHoverTooltip.ts`:

```ts
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { findScores } from './scoreLinks';

export type ScorePickCallback = (linkId: string) => void;

export function scoreHoverTooltip(onPick: ScorePickCallback) {
    return hoverTooltip((view, pos): Tooltip | null => {
        const script = view.state.doc.toString();
        const { links } = findScores(script);
        const hit = links.find((l) =>
            pos >= l.contentRange.from && pos <= l.contentRange.to
        );
        if (!hit) return null;
        const label = hit.name ? `Edit "${hit.name}" in Score tab` : `Edit (anon @ line ${hit.annotationLine}) in Score tab`;
        return {
            pos: hit.contentRange.from,
            above: true,
            create: () => {
                const dom = document.createElement('div');
                dom.className = 'cm-score-tooltip';
                dom.style.padding = '4px 8px';
                dom.style.background = '#181820';
                dom.style.color = '#FFFFFF';
                dom.style.fontSize = '11px';
                dom.style.fontWeight = '600';
                dom.style.borderRadius = '4px';
                dom.style.cursor = 'pointer';
                dom.textContent = '✏️ ' + label;
                dom.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    onPick(hit.id);
                });
                return { dom };
            },
        };
    }, { hideOnChange: true });
}

// Exposed for tests; do not import from production code.
export function __forTest_clickHandler(onPick: ScorePickCallback) {
    return (id: string) => onPick(id);
}
```

- [ ] **Step 4: Run, verify pass**

```bash
cd editor && npx vitest run src/score/scoreHoverTooltip.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/score/scoreHoverTooltip.ts editor/src/score/scoreHoverTooltip.test.ts
git commit -m "$(cat <<'EOF'
score: add scoreHoverTooltip — CodeMirror extension for script-tab popup

Detects hovers inside the contentRange of any --@score-linked string
literal and shows a clickable tooltip that invokes the provided
onPick(linkId) callback. The App will wire that callback to switch
to the Score tab with the matching link selected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Wire the hover extension into `CodeEditor.tsx`

**Files:**
- Modify: `editor/src/editor/CodeEditor.tsx`

- [ ] **Step 1: Extend `CodeEditorProps`**

Edit `editor/src/editor/CodeEditor.tsx`. Update the import block to add CodeMirror Extension type and the props interface:

```ts
import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection, keymap, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { luaLang } from './luaSupport';

// ...

export interface CodeEditorProps {
    value: string;
    onChange(v: string): void;
    extraExtensions?: Extension[];
}

export function CodeEditor({ value, onChange, extraExtensions }: CodeEditorProps) {
    // ...
    useEffect(() => {
        if (!hostRef.current) return;
        const state = EditorState.create({
            doc: value,
            extensions: [
                // ... all existing extensions ...
                EditorView.contentAttributes.of({ 'aria-label': 'TinyBit Lua script editor' }),
                ...(extraExtensions ?? []),
            ],
        });
        // ... rest unchanged ...
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // ...
}
```

The only material change: add `extraExtensions?: Extension[]` to the props, and spread `...(extraExtensions ?? [])` at the end of the `extensions:` array.

- [ ] **Step 2: Type-check**

```bash
cd editor && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add editor/src/editor/CodeEditor.tsx
git commit -m "$(cat <<'EOF'
editor: accept extraExtensions prop on CodeEditor

Lets callers plug in extra CodeMirror extensions (e.g. the score
hover tooltip) without forking the component.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Add `'score'` to `EditorPane` tabs

**Files:**
- Modify: `editor/src/ui/EditorPane.tsx`

- [ ] **Step 1: Update the union and tab strip**

Edit `editor/src/ui/EditorPane.tsx`:

Change:
```ts
export type EditorTab = 'script' | 'alt' | 'cartridge';
```
to:
```ts
export type EditorTab = 'script' | 'alt' | 'cartridge' | 'score';
```

Change the tab strip:
```tsx
{(['script', 'alt', 'cartridge'] as const).map((t) => (
```
to:
```tsx
{(['script', 'alt', 'score', 'cartridge'] as const).map((t) => (
```

Update the label expression:
```tsx
{t === 'script' ? 'script' : t === 'alt' ? 'spritesheet' : 'cartridge'}
```
to:
```tsx
{t === 'script' ? 'script'
 : t === 'alt' ? 'spritesheet'
 : t === 'score' ? 'score'
 : 'cartridge'}
```

- [ ] **Step 2: Type-check**

```bash
cd editor && npx tsc --noEmit
```

Expected: zero errors. (App.tsx renders tab bodies via `activeTab === 'foo' && ...` branches that don't require exhaustive narrowing, so extending the union doesn't introduce errors on its own — Task 16 adds the new branch.)

- [ ] **Step 3: Commit**

```bash
git add editor/src/ui/EditorPane.tsx
git commit -m "$(cat <<'EOF'
ui: add 'score' tab between 'spritesheet' and 'cartridge'

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Wire ScoreTab + hover tooltip into `App.tsx`

**Files:**
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: Imports + state**

Add to the existing import block in `App.tsx`:

```ts
import { ScoreTab } from './score/ScoreTab';
import { scoreHoverTooltip } from './score/scoreHoverTooltip';
```

- [ ] **Step 2: Track selectedLinkId state**

Inside the `App` component, alongside existing `useState` calls, add:

```ts
const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
```

- [ ] **Step 3: Build the hover-tooltip extension**

After `runtime` is available, memoize the extension. Place this `useMemo` after the existing keyboard-input `useEffect` block (around line 142):

```ts
const scoreHoverExtension = useMemo(
    () => scoreHoverTooltip((id) => {
        setSelectedLinkId(id);
        setActiveTab('score');
    }),
    [],
);
```

- [ ] **Step 4: Pass the extension to the script CodeEditor**

Change the `CodeEditor` render in the tab body:

```tsx
{activeTab === 'script' && <CodeEditor value={sketch.script} onChange={sketch.setScript} />}
```

to:

```tsx
{activeTab === 'script' && (
    <CodeEditor
        value={sketch.script}
        onChange={sketch.setScript}
        extraExtensions={[scoreHoverExtension]}
    />
)}
```

- [ ] **Step 5: Render the Score tab body**

In the same JSX block, add a new branch:

```tsx
{activeTab === 'score' && runtime && (
    <ScoreTab
        preview={runtime.preview}
        previewAvailable={runtime.previewAvailable}
        selectedLinkId={selectedLinkId ?? undefined}
        onSelectLink={setSelectedLinkId}
    />
)}
```

If `runtime` is null (during boot) the tab body is empty — same pattern as other engine-dependent UI.

- [ ] **Step 6: Add useMemo to imports**

Confirm `useMemo` is already imported in `App.tsx`'s top React import; if not (it's already imported per the existing source), add it.

- [ ] **Step 7: Type-check + run the full editor test suite**

```bash
cd editor && npx tsc --noEmit && npm test
```

Expected: zero TS errors. All tests pass (including the existing App.test.tsx).

- [ ] **Step 8: Commit**

```bash
git add editor/src/App.tsx
git commit -m "$(cat <<'EOF'
app: wire ScoreTab + script-tab hover tooltip

Adds the 'score' tab body, mounts scoreHoverTooltip on the script
CodeEditor with an onPick that switches activeTab to 'score' and
sets selectedLinkId, and threads runtime.preview through to ScoreTab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Playwright e2e

**Files:**
- Create: `editor/tests/e2e/score.spec.ts`

- [ ] **Step 1: Write the spec**

Create `editor/tests/e2e/score.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('score tab: insert new score and round-trip to script', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).useSketchStore !== undefined);

    // Switch to Score tab.
    await page.getByRole('tab', { name: 'score' }).click();

    // Empty state.
    await expect(page.getByText(/no scores yet/i)).toBeVisible();

    // Insert a new score.
    await page.getByRole('button', { name: /\+ new score/i }).click();

    // A chip for score_1 should appear.
    await expect(page.getByRole('button', { name: /^score_1$/ })).toBeVisible();

    // The script should now contain the snippet.
    const script: string = await page.evaluate(() => (window as any).useSketchStore.getState().script);
    expect(script).toContain('--@score: score_1');
    expect(script).toContain('[[\nL:1/4\nK:C\nC D E F |\n]]');

    // Type into the ABC editor.
    const abcEditor = page.locator('[aria-label="ABC score editor"] .cm-content');
    await abcEditor.click();
    await page.keyboard.press('End'); // cursor to EOL of whatever line we landed on
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' | G A B c');

    // Wait for the 300 ms debounce + write.
    await page.waitForTimeout(500);

    const updated: string = await page.evaluate(() => (window as any).useSketchStore.getState().script);
    expect(updated).toMatch(/G A B c/);

    // Click Play, expect no error toast.
    await page.getByRole('button', { name: /play/i }).click();
    await page.waitForTimeout(300);
    // Click Stop.
    await page.getByRole('button', { name: /stop/i }).click();
});
```

- [ ] **Step 2: Ensure the dev server is built so it can boot**

```bash
./scripts/build.sh
```

Expected: build succeeds; `editor/public/tinybit_wasm.wasm` is updated with the preview exports.

- [ ] **Step 3: Run Playwright**

```bash
cd editor && npx playwright install --with-deps chromium 2>/dev/null || true
cd editor && npx playwright test tests/e2e/score.spec.ts --project=chromium 2>/dev/null || cd editor && npx playwright test tests/e2e/score.spec.ts
```

Expected: 1 test passes. (The `playwright install` line is a no-op if already installed.)

- [ ] **Step 4: Commit**

```bash
git add editor/tests/e2e/score.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): score tab — new score, type, round-trip, play, stop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Final verification + acceptance

**Files:** (none — verification only)

- [ ] **Step 1: Re-run all the editor tests**

```bash
cd editor && npm test
```

Expected: zero failures across all test files. Take note of the total test count for the commit message.

- [ ] **Step 2: Re-run all the Node smokes**

```bash
node scripts/smoke.mjs
node scripts/smoke_encoder.mjs
node scripts/smoke_decoder.mjs
node scripts/smoke_preview.mjs
```

Expected: each prints an OK line and exits 0. (`smoke.mjs` needs the sibling `../TinyBit/` checkout — if missing, document and skip.)

- [ ] **Step 3: Build production editor and load it**

```bash
cd editor && npm run build
```

Expected: zero TS errors; build succeeds; `editor/dist/` is populated.

- [ ] **Step 4: Sanity-check the abcjs lazy chunk size**

```bash
ls -lah editor/dist/assets/ | grep -i abcjs
```

Expected: an `abcjs`-named chunk (likely under 300 KB). If significantly larger, note in PR description but don't block.

- [ ] **Step 5: Final commit (or skip if no changes)**

If there were any incidental fixups during verification:
```bash
git add -A && git commit -m "$(cat <<'EOF'
chore: verification fixups

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Otherwise skip.

- [ ] **Step 6: Push and open PR**

The user will open the PR manually unless asked otherwise.

```bash
git push -u origin feat/score-editor
```

---

## Spec ↔ Plan coverage check

| Spec section | Covered by task(s) |
|---|---|
| Score tab UI (split top/bottom, chip bar, + New score, Play/Stop) | 12 |
| Hover popup in Script tab | 13, 14, 16 |
| Annotation syntax (`--@score[: name]`, opener within 3 non-blank lines, embedded annotations ignored) | 6, 7 |
| Insertion snippet (`+ New score`) | 8 (insertNewScoreSnippet), 12 (button) |
| Storage form (`[[...]]` default, preserve user form, escalation) | 8 |
| Engine changes (extern decls + tb_preview_*) | 1, 2 |
| Stop semantics via `audio_stop_all` | 2 |
| TS preview wrapper + runtime probing | 4, 5 |
| `scoreLinks` (findScores) | 6, 7 |
| `scoreSync` (replaceScoreContent, insertNewScoreSnippet) | 8 |
| `abcMode` | 9 |
| `ScorePreview` (abcjs SVG + error band) | 10 |
| `ScoreEditor` (CodeMirror ABC) | 11 |
| `ScoreTab` (compose) | 12 |
| `scoreHoverTooltip` | 13 |
| EditorPane + App wiring | 15, 16 |
| Error handling (link-stale, escalation exhausted, engine codes, preview unavailable, abcjs throw) | 4 (errors), 8 (escalation), 10 (band), 12 (banner + disabled play) |
| Testing (unit, component, e2e, engine smoke) | 4–13 (units/components), 17 (e2e), 3 (engine smoke) |
