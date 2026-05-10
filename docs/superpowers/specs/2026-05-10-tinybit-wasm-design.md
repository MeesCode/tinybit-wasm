# tinybit_wasm — Design Spec

**Date:** 2026-05-10
**Status:** Approved (pre-implementation)

## Summary

`tinybit_wasm` is a Rust crate that wraps the existing `tinybit` C library — the same C library used by the sibling `TinyBit` C/SDL2 desktop wrapper — and compiles it to WebAssembly. It ships with a minimal static webpage that lets the user upload a `.tb.png` cartridge file and immediately play the game in the browser, with video, audio, and keyboard input (arrows, A, B, START, SELECT).

The C library is consumed unmodified as a git submodule; all platform glue is written in Rust + a small JS layer.

## Goals

1. The C library (`MeesCode/TinyBit-lib`) is included as a git submodule at `src/tinybit/`. **Zero source modifications.**
2. `cargo build --target wasm32-unknown-unknown --release` (and the equivalent `wasm-pack build --target web`) builds the entire artifact, including compiling the C library.
3. A `web/index.html` page provides:
   - A file input that accepts a `.tb.png` cartridge
   - On selection, the cartridge is fed into the engine and play starts immediately
   - 128×128 video output rendered to a scaled canvas
   - Audio output through Web Audio API
   - Keyboard input: arrows, A, B, Enter (START), Backspace (SELECT)
4. A second cartridge can be uploaded without page reload; the running game stops cleanly and the new game starts.

## Non-Goals

The following are deferred and explicitly out of scope:

- The built-in game-selector UI (the C library's `gamecount` / `gameload` callbacks; that mode is a feature of the desktop wrapper)
- Cartridge export / `-c` mode / interactive cartridge builder
- Touch input or gamepad support
- Resampling when the host `AudioContext` cannot honor a 22 kHz sample rate (warning logged, game runs anyway with pitch shift)
- Persistent storage of recently played cartridges
- Pause/resume controls, fullscreen, mobile-friendly layout
- Tests beyond a smoke build (the C library is unchanged from upstream and proven; the Rust wrapper is glue)

## Architecture Overview

Three layers, top-to-bottom:

1. **C engine** (`src/tinybit/`, submodule, untouched). Pure C99: Lua VM, pngle PNG decoder, ABC audio parser, graphics/audio/input modules. Exposes the API in `tinybit.h`.
2. **Rust wrapper** (`src/lib.rs`). Owns the `TinyBitMemory` block, registers C callbacks, and exports a small `#[wasm_bindgen]` surface to JS. Compiles to a `cdylib` for `wasm32-unknown-unknown`.
3. **Web frontend** (`web/`). Plain HTML + ES module JS that imports the wasm-pack bundle, drives the rAF loop, blits the display to a canvas, pushes audio frames into an `AudioWorkletNode`, and translates keyboard events into button writes.

## Repository Layout

```
tinybit_wasm/
├── Cargo.toml                 # crate-type = ["cdylib"]; deps: wasm-bindgen, js-sys, web-sys
├── build.rs                   # cc-rs + bindgen, driven by wasi-sdk clang
├── src/
│   ├── tinybit/               # git submodule -> MeesCode/TinyBit-lib (untouched)
│   ├── lib.rs                 # wasm-bindgen exports + callback glue
│   └── bindings.rs            # bindgen-generated FFI (output written to OUT_DIR; included via include!)
├── web/
│   ├── index.html             # file input + canvas
│   ├── index.js               # entry: uploads, rAF loop, keyboard, audio pump
│   ├── audio-worklet.js       # AudioWorkletProcessor with ring buffer
│   └── wasi-shim.js           # ~40-line WASI imports satisfier
├── docs/superpowers/specs/    # design + planning docs
├── README.md
└── .gitignore
```

The `wasi-sdk` itself is downloaded into `target/wasi-sdk/` on first build (or located via the `WASI_SDK_PATH` env var) and is gitignored.

## Build Pipeline

`cargo build --target wasm32-unknown-unknown --release`:

1. **`build.rs`** ensures wasi-sdk is available:
   - If `WASI_SDK_PATH` is set, use it.
   - Otherwise, download a pinned wasi-sdk release tarball into `target/wasi-sdk/` and extract.
2. `cc::Build` is configured with:
   - `compiler` = `$WASI_SDK_PATH/bin/clang`
   - flags `--target=wasm32-wasi --sysroot=$WASI_SDK_PATH/share/wasi-sysroot`
   - the source list mirroring `src/tinybit/CMakeLists.txt`: `tinybit.c`, `lua_pool.c`, `cartridge.c`, `graphics.c`, `font.c`, `input.c`, `audio.c`, `memory.c`, `lua_functions.c`, `pngle/pngle.c`, `pngle/miniz.c`, `ABC-parser/abc_parser.c`, plus all `lua/*.c`
   - include dirs: `src/tinybit/`, `src/tinybit/lua/`, `src/tinybit/pngle/`, `src/tinybit/ABC-parser/`
   - compile defs: `PNGLE_STATIC_ALLOC`, `PNGLE_NO_GAMMA_CORRECTION`, `MINIZ_NO_MALLOC`
   - The resulting static archive is emitted under `OUT_DIR`.
3. **`bindgen`** runs against `src/tinybit/tinybit.h` and writes Rust FFI declarations to `OUT_DIR/bindings.rs`. `src/bindings.rs` is a one-liner: `include!(concat!(env!("OUT_DIR"), "/bindings.rs"));`.
4. The Rust crate is compiled for `wasm32-unknown-unknown` (the wasm-bindgen target); cargo links the wasi-sdk-produced archive in.
5. `wasm-pack build --target web` wraps cargo, runs `wasm-bindgen-cli`, and emits `pkg/tinybit_wasm.js` plus `pkg/tinybit_wasm_bg.wasm`.
6. The `web/` folder is shipped as-is; serving any static-file dev server (e.g. `python -m http.server`) over `tinybit_wasm/` makes `web/index.html` load `../pkg/tinybit_wasm.js`.

**Submodule freshness check.** `build.rs` first checks that `src/tinybit/tinybit.h` exists. If not, it errors with: "tinybit submodule missing — run: git submodule update --init --recursive". The build does not silently skip.

**Submodule source list.** The list above mirrors `src/tinybit/CMakeLists.txt` and is hard-coded in `build.rs`. If the submodule grows new sources upstream, `build.rs` is updated by hand. We do not parse CMake.

## Rust Wrapper API

A single `lib.rs` file. Single-threaded WASM, so all state lives in a `thread_local!` `RefCell<TinyBitState>`. Borrows are never held across an FFI call.

```rust
struct TinyBitState {
    memory: Box<TinyBitMemory>,        // ~750 KB, allocated on heap to avoid stack blowup
    started: bool,
}
```

### `#[wasm_bindgen]` exports (the JS-facing API)

| Export                                 | Behavior                                                                                          |
|----------------------------------------|---------------------------------------------------------------------------------------------------|
| `init()`                               | Allocate memory, call `tinybit_init`, register all six C callbacks                                |
| `feed_cartridge(bytes: &[u8]) -> bool` | Wraps `tinybit_feed_cartridge`. Called repeatedly with chunks; returns C return value             |
| `start() -> bool`                      | `tinybit_start`                                                                                   |
| `stop()`                               | `tinybit_stop`; clears `started` flag                                                             |
| `loop_once()`                          | `tinybit_loop` — JS calls this once per `requestAnimationFrame`                                   |
| `set_button(idx: u8, pressed: bool)`   | Writes `tb_mem.button_input[idx]` directly                                                        |
| `display_ptr() -> *const u8`           | Pointer to `tb_mem.display` (32 KB RGBA4444 buffer)                                               |
| `display_byte_len() -> usize`          | Byte length of display buffer                                                                     |
| `audio_ptr() -> *const i16`            | Pointer to `tb_mem.audio_buffer` (367 i16 samples)                                                |
| `audio_sample_count() -> usize`        | `367` (constant; helper for JS)                                                                   |

**Why pointers + flags instead of `Vec`-returning getters.** Each frame transfers 32 KB of display + 734 B of audio. Returning `Vec<u8>` from `#[wasm_bindgen]` allocates and copies. Pointer exports let JS construct a typed-array view (`Uint16Array` / `Int16Array`) directly over wasm memory — zero copy. This is the wasm-bindgen-recommended pattern for high-frequency interop.

### C callbacks

Plain `extern "C" fn` items registered in `init()`:

| C callback           | Implementation                                                                                                                                    |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| `log_cb(msg)`        | `web_sys::console::log_1` with the C string converted via `CStr::from_ptr`                                                                        |
| `get_ticks_ms_cb()`  | `js_sys::Date::now()` minus a stored start time recorded in `init()`                                                                              |
| `render_cb()`        | No-op. JS reads display memory after each `loop_once()` returns                                                                                   |
| `poll_input_cb()`    | No-op. JS writes button state via `set_button()` directly, between `loop_once()` calls                                                            |
| `audio_queue_cb()`   | No-op. JS reads audio memory after each `loop_once()` returns                                                                                     |
| `gamecount_cb()`     | Returns `0` (no built-in selector in WASM build)                                                                                                  |
| `gameload_cb(_idx)`  | No-op                                                                                                                                             |

Render and audio callbacks could set "frame ready" flags, but JS already calls `loop_once` at frame cadence and reads buffers unconditionally afterward; flags add complexity without benefit.

### Frame contract

What JS does on every `requestAnimationFrame` tick:

1. (Button events handled outside the rAF loop in keydown/keyup, calling `set_button()` directly.)
2. `loop_once()` — runs one tick of `tinybit_loop`, internally invoking the C engine's render/audio/input.
3. Reconstruct `Uint16Array` view over `wasmMemory.buffer` at `display_ptr()`. Expand RGBA4444 → RGBA8888 into a reused `ImageData(128, 128)`. `ctx.putImageData(img, 0, 0)`.
4. Reconstruct `Int16Array` view over `wasmMemory.buffer` at `audio_ptr()`. Copy + scale to a fresh `Float32Array(367)` (sample / 32768). Transfer the buffer to the worklet via `port.postMessage(buf, [buf])`.

The view-reconstruction step is intentional: any wasm memory `grow` invalidates existing JS typed-array views over `wasmMemory.buffer`, so we never cache the view across frames.

### Cartridge feed

`index.js` reads the uploaded `File` as `Uint8Array`, slices it into 256-byte chunks (mirroring `cartridge_io.c`'s loop), and calls `feed_cartridge()` per chunk before `start()`. A `false` return at any point aborts the load and surfaces an error.

## Web Frontend

### `web/index.html`

```html
<!doctype html>
<title>TinyBit</title>
<style>
  body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #111; font-family: sans-serif; color: #ccc; }
  #stage { display: grid; gap: 12px; }
  canvas { width: 512px; height: 512px; image-rendering: pixelated; background: #000; }
  input[type=file] { color: #ccc; }
  #err { color: #f66; min-height: 1.2em; }
</style>
<div id="stage">
  <input type="file" id="cart" accept=".png,.tb.png">
  <canvas id="screen" width="128" height="128"></canvas>
  <div id="err"></div>
</div>
<script type="module" src="./index.js"></script>
```

The canvas is 128×128 native, scaled to 512×512 via CSS with `image-rendering: pixelated` for crisp pixels.

### `web/index.js`

Responsibilities:

1. Import the wasm-pack bundle: `import init, * as tb from "../pkg/tinybit_wasm.js"; const w = await init({ ...wasiImports });` — passing the WASI shim as imports for the wasi_snapshot_preview1 module.
2. Cache `wasmMemory = w.memory`, the canvas 2D context, and a reusable `ImageData(128, 128)`.
3. **Lazily initialize audio on first cartridge upload** (browsers require a user gesture):
   - `audioCtx = new AudioContext({ sampleRate: 22000 })`
   - `await audioCtx.audioWorklet.addModule("./audio-worklet.js")`
   - Instantiate `AudioWorkletNode(audioCtx, "tinybit")`, connect to `audioCtx.destination`
4. **File input handler:**
   - Read bytes
   - If a game is running: `cancelAnimationFrame`, `tb.stop()`
   - `await ensureAudio()`
   - `tb.init()`
   - Loop: feed 256-byte chunks via `tb.feed_cartridge`; on `false`, show error and bail
   - `tb.start()`; on `false`, show error and bail
   - Start rAF loop
5. **rAF loop:** `loop_once`, blit display, pump audio, schedule next frame.
6. **Keyboard:** `keydown`/`keyup` on `window` map to button indices. `e.preventDefault()` for arrow keys (page-scroll suppression) and Backspace (browser back-navigation suppression).

### Key mapping

Mirrors the SDL2 wrapper (see `TinyBit/src/platform.c`):

| Key           | TinyBit button | Index |
|---------------|----------------|-------|
| `a` / `A`     | A              | 0     |
| `b` / `B`     | B              | 1     |
| `ArrowUp`     | UP             | 2     |
| `ArrowDown`   | DOWN           | 3     |
| `ArrowLeft`   | LEFT           | 4     |
| `ArrowRight`  | RIGHT          | 5     |
| `Enter`       | START          | 6     |
| `Backspace`   | SELECT         | 7     |

### `web/audio-worklet.js`

```js
class TBProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(22000); // ~1s ring buffer
    this.r = 0; this.w = 0; this.size = 0;
    this.port.onmessage = ({ data }) => {
      const a = new Float32Array(data);
      for (let i = 0; i < a.length; i++) {
        if (this.size < this.buf.length) {
          this.buf[this.w] = a[i];
          this.w = (this.w + 1) % this.buf.length;
          this.size++;
        }
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.size > 0) {
        out[i] = this.buf[this.r];
        this.r = (this.r + 1) % this.buf.length;
        this.size--;
      } else {
        out[i] = 0;       // underrun → silence (rare)
      }
    }
    return true;
  }
}
registerProcessor("tinybit", TBProcessor);
```

Mono (1 channel; matches `desired.channels = 1` in `platform.c`). The ring buffer holds ~1 s; rAF jitter up to that window does not drop audio. Underruns yield silence (no clicks).

### `web/wasi-shim.js`

Provides the `wasi_snapshot_preview1` import object that wasi-sdk's libc emits. Approximate surface (~40 lines total):

| WASI function       | Implementation                                                                            |
|---------------------|-------------------------------------------------------------------------------------------|
| `fd_write`          | For fd 1 / 2: decode UTF-8 from wasm memory and `console.log` / `console.error`. Else `EBADF` |
| `proc_exit(code)`   | `throw new Error("proc_exit: " + code)` — surfaces a Lua `os.exit()` instead of hanging   |
| `clock_time_get`    | Backed by `performance.now()` (monotonic clock) and `Date.now()` (realtime clock)         |
| `random_get`        | `crypto.getRandomValues` into the wasm memory range                                       |
| `environ_get` / `environ_sizes_get` | Empty environment                                                         |
| `fd_read` / `fd_seek` / `fd_close` / `fd_fdstat_get` / `fd_prestat_get` / `fd_prestat_dir_name` / `path_open` | Return `EBADF`. The cartridge is fed via `feed_cartridge`, never via libc file I/O — these should never fire in practice, and a hard error is preferable to silent corruption |

## Errors & Edge Cases

- **Invalid cartridge** (`feed_cartridge` or `start` returns `false`): show "Invalid cartridge" in `#err`; do not start the loop.
- **Re-upload during play:** `cancelAnimationFrame`, `tb.stop()`, then run the upload flow as if fresh.
- **Audio gesture blocked:** if `AudioContext` cannot start, log a warning and continue; game runs silent.
- **Tab visibility:** rAF pauses when backgrounded; the worklet drains its ring buffer to silence; on tab return the engine resumes. Brief audio drift is accepted.
- **Sample-rate mismatch:** if the browser refuses 22 kHz and falls back (typically 48 kHz), log a warning. Pitch will be off; resampling is a non-goal here.
- **Wasm memory growth:** typed-array views over `wasmMemory.buffer` are reconstructed every frame, so growth never causes stale-view bugs.
- **Submodule missing at build time:** `build.rs` errors with a clear message instructing the user to run `git submodule update --init --recursive`.

## Success Criteria

1. `git clone --recursive`, then `wasm-pack build --target web`, then any static-file server over `tinybit_wasm/` serves a working page.
2. Picking `flappy.tb.png` (or `qix.tb.png`, `rocket.tb.png`) from the existing `TinyBit/games/` directory plays the game with both video and audio.
3. Arrow keys, A, B, Enter, Backspace control the game without page-scroll or back-navigation side effects.
4. Picking a second cartridge swaps cleanly without page reload.

## Open Questions / Risks

- **Mixed-target linking.** The Rust crate compiles for `wasm32-unknown-unknown` (required by wasm-bindgen) while the C objects are produced by wasi-sdk for `wasm32-wasi`. Both are wasm32 and lld is generally happy to link them, with WASI imports satisfied by `wasi-shim.js` at instantiation time. If linking fails or produces bad imports, the fallback is to compile the C with `--target=wasm32-unknown-unknown` against a `wasi-libc` sysroot built without WASI ABI assumptions (more work; deferred until needed).
- **Wasi-sdk binary download in `build.rs`** is convenient but adds a network dependency on first build. Pinning a specific release version + checksum is required. Honoring `WASI_SDK_PATH` lets users (or CI) supply a pre-installed copy.
- **Lua's libc footprint.** Lua's standard library uses many libc surfaces. Most calls go through wasi-sdk's libc → WASI imports, all handled by the shim. If something Lua-side reaches `fd_read` or `path_open` we'll see a clean `EBADF` error rather than a silent failure, and can decide whether to fix the cartridge data path or extend the shim.
- **Sample-rate request honored?** If most browsers no longer honor `{ sampleRate: 22000 }` in 2026, we may need a small linear-interpolation resampler in the worklet. Logging on first run will surface this quickly.
