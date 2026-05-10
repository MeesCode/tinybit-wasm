# tinybit_wasm — Design Spec

**Date:** 2026-05-10
**Status:** Approved (pre-implementation)

## Summary

`tinybit_wasm` is a Rust crate that wraps the existing `tinybit` C library — the same C library used by the sibling `TinyBit` C/SDL2 desktop wrapper — and compiles it to WebAssembly. It ships with a minimal static webpage that lets the user upload a `.tb.png` cartridge file and immediately play the game in the browser, with video, audio, and keyboard input (arrows, A, B, START, SELECT).

The C library is consumed unmodified as a git submodule; all platform glue is written in Rust + a small JS layer.

## Goals

1. The C library (`MeesCode/TinyBit-lib`) is included as a git submodule at `src/tinybit/`. **Zero source modifications.**
2. `cargo build --target wasm32-wasip1 --release` builds the entire artifact, including compiling the C library. No `wasm-bindgen`, no `wasm-pack`. JS-side glue is hand-written.
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
2. **Rust wrapper** (`src/lib.rs`). Owns the `TinyBitMemory` block, registers C callbacks, and exports a small set of `#[no_mangle] extern "C"` functions to JS. Compiles to a `cdylib` for `wasm32-wasip1`. Both Rust and the C engine target `wasm32-wasip1`, so there is no mixed-target linking and the libc surface is consistent.
3. **Web frontend** (`web/`). Plain HTML + ES module JS that loads the `.wasm` directly via `WebAssembly.instantiateStreaming`, drives the rAF loop, blits the display to a canvas, pushes audio frames into an `AudioWorkletNode`, and translates keyboard events into button writes. The only WASM imports are the WASI snapshot preview1 surface, satisfied by `web/wasi-shim.js`.

## Repository Layout

```
tinybit_wasm/
├── Cargo.toml                 # crate-type = ["cdylib"]; no wasm-bindgen
├── build.rs                   # cc-rs + bindgen, driven by wasi-sdk clang
├── src/
│   ├── tinybit/               # git submodule -> MeesCode/TinyBit-lib (untouched)
│   ├── lib.rs                 # raw extern "C" exports + C callback glue
│   └── bindings.rs            # bindgen-generated FFI (output written to OUT_DIR; included via include!)
├── web/
│   ├── index.html             # file input + canvas
│   ├── index.js               # entry: instantiates wasm, uploads, rAF loop, keyboard, audio pump
│   ├── audio-worklet.js       # AudioWorkletProcessor with ring buffer
│   ├── wasi-shim.js           # ~40-line WASI imports satisfier
│   └── tinybit_wasm.wasm      # built artifact, copied here by build script (gitignored)
├── scripts/
│   └── build.sh               # cargo build + copy artifact into web/
├── docs/superpowers/specs/    # design + planning docs
├── README.md
└── .gitignore
```

The `wasi-sdk` itself is downloaded into `target/wasi-sdk/` on first build (or located via the `WASI_SDK_PATH` env var) and is gitignored. The built `.wasm` in `web/` is also gitignored — only source is committed.

## Build Pipeline

`scripts/build.sh` is the single entry point. It runs:

```sh
cargo build --target wasm32-wasip1 --release
cp target/wasm32-wasip1/release/tinybit_wasm.wasm web/tinybit_wasm.wasm
```

Behind that:

1. **`build.rs`** ensures wasi-sdk is available:
   - If `WASI_SDK_PATH` is set, use it.
   - Otherwise, download a pinned wasi-sdk release tarball into `target/wasi-sdk/` and extract.
2. `cc::Build` is configured with:
   - `compiler` = `$WASI_SDK_PATH/bin/clang`
   - flags `--target=wasm32-wasi --sysroot=$WASI_SDK_PATH/share/wasi-sysroot` (matches the Rust target's libc/ABI assumptions)
   - the source list mirroring `src/tinybit/CMakeLists.txt`: `tinybit.c`, `lua_pool.c`, `cartridge.c`, `graphics.c`, `font.c`, `input.c`, `audio.c`, `memory.c`, `lua_functions.c`, `pngle/pngle.c`, `pngle/miniz.c`, `ABC-parser/abc_parser.c`, plus all `lua/*.c`
   - include dirs: `src/tinybit/`, `src/tinybit/lua/`, `src/tinybit/pngle/`, `src/tinybit/ABC-parser/`
   - compile defs: `PNGLE_STATIC_ALLOC`, `PNGLE_NO_GAMMA_CORRECTION`, `MINIZ_NO_MALLOC`
   - The resulting static archive is emitted under `OUT_DIR`.
3. **`bindgen`** runs against `src/tinybit/tinybit.h` and writes Rust FFI declarations to `OUT_DIR/bindings.rs`. `src/bindings.rs` is a one-liner: `include!(concat!(env!("OUT_DIR"), "/bindings.rs"));`.
4. The Rust crate is compiled for `wasm32-wasip1` and linked against the wasi-sdk-produced archive. Output: a single `.wasm` at `target/wasm32-wasip1/release/tinybit_wasm.wasm` containing all of Lua, pngle, the ABC parser, the engine, and the Rust glue.
5. The build script copies that `.wasm` to `web/tinybit_wasm.wasm`.
6. Any static-file dev server (e.g. `python -m http.server` from the `web/` folder) serves the page; the browser loads the `.wasm` via `fetch` + `WebAssembly.instantiateStreaming`.

**Submodule freshness check.** `build.rs` first checks that `src/tinybit/tinybit.h` exists. If not, it errors with: "tinybit submodule missing — run: git submodule update --init --recursive". The build does not silently skip.

**Submodule source list.** The list above mirrors `src/tinybit/CMakeLists.txt` and is hard-coded in `build.rs`. If the submodule grows new sources upstream, `build.rs` is updated by hand. We do not parse CMake.

## Rust Wrapper API

A single `lib.rs` file. Single-threaded WASM, so all state lives in a `thread_local!` `RefCell<TinyBitState>`. Borrows are never held across an FFI call.

```rust
struct TinyBitState {
    memory: Box<TinyBitMemory>,        // ~750 KB, allocated on heap to avoid stack blowup
    feed_buf: [u8; 256],               // staging buffer for cartridge upload
    started: bool,
}
```

### Raw `extern "C"` exports (the JS-facing API)

All exports are declared as `#[no_mangle] pub extern "C" fn`. Primitive args + raw pointers only — no string or slice marshaling, since wasm-bindgen is not in the picture.

| Export                                  | Behavior                                                                                                                                            |
|-----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| `tb_init()`                             | Allocate memory, call `tinybit_init`, register all six C callbacks                                                                                  |
| `tb_feed_buffer_ptr() -> *mut u8`       | Returns pointer to a static 256-byte staging buffer in `TinyBitState`. JS writes cartridge bytes here, then calls `tb_feed_cartridge(len)`          |
| `tb_feed_cartridge(len: u32) -> u32`    | Forwards `len` bytes from the staging buffer to `tinybit_feed_cartridge`. Returns 1 on success, 0 on failure (avoiding `bool` ABI ambiguity)        |
| `tb_start() -> u32`                     | `tinybit_start`; 1/0                                                                                                                                |
| `tb_stop()`                             | `tinybit_stop`; clears `started` flag                                                                                                               |
| `tb_loop_once()`                        | `tinybit_loop` — JS calls this once per `requestAnimationFrame`                                                                                     |
| `tb_set_button(idx: u32, pressed: u32)` | Writes `tb_mem.button_input[idx]` directly                                                                                                          |
| `tb_display_ptr() -> *const u8`         | Pointer to `tb_mem.display` (32 KB RGBA4444 buffer = 128×128 × 2 bytes)                                                                             |
| `tb_audio_ptr() -> *const i16`          | Pointer to `tb_mem.audio_buffer` (367 i16 samples)                                                                                                  |

The 256-byte staging buffer matches the chunk size already used by the desktop C wrapper's `cartridge_io.c`. JS sets up a `Uint8Array` view over wasm memory at `tb_feed_buffer_ptr()`, copies one chunk in, calls `tb_feed_cartridge(chunk_len)`, repeats until the file is consumed.

**Why raw pointers + a fixed staging buffer.** No allocator gymnastics, no JS-side `malloc`/`free`. The staging buffer's pointer is stable across the run; JS only needs to reconstruct the typed-array view if wasm memory grows. Display and audio buffers are read by JS the same way (typed-array view at the returned pointer). Display + audio constants (128, 367, etc.) are duplicated as JS constants in `index.js` rather than queried at runtime, since they never change.

### C callbacks

Plain `extern "C" fn` items registered in `tb_init()`:

| C callback           | Implementation                                                                                                                                    |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| `log_cb(msg)`        | `libc::write(2, ...)` of the C string. wasi-sdk's libc routes fd 2 through `wasi_snapshot_preview1::fd_write`, which `wasi-shim.js` forwards to `console.error`. No custom JS import needed. |
| `get_ticks_ms_cb()`  | Subtract a `std::time::Instant` captured in `tb_init()` from `Instant::now()` and return ms. `wasm32-wasip1` provides a working monotonic clock via `clock_time_get`, also satisfied by the shim. |
| `render_cb()`        | No-op. JS reads display memory after each `tb_loop_once()` returns                                                                                |
| `poll_input_cb()`    | No-op. JS writes button state via `tb_set_button()` directly, between `tb_loop_once()` calls                                                      |
| `audio_queue_cb()`   | No-op. JS reads audio memory after each `tb_loop_once()` returns                                                                                  |
| `gamecount_cb()`     | Returns `0` (no built-in selector in WASM build)                                                                                                  |
| `gameload_cb(_idx)`  | No-op                                                                                                                                             |

Render and audio callbacks could set "frame ready" flags, but JS already calls `loop_once` at frame cadence and reads buffers unconditionally afterward; flags add complexity without benefit.

### Frame contract

What JS does on every `requestAnimationFrame` tick:

1. (Button events handled outside the rAF loop in keydown/keyup, calling `tb_set_button()` directly.)
2. `tb_loop_once()` — runs one tick of `tinybit_loop`, internally invoking the C engine's render/audio/input.
3. Reconstruct `Uint16Array` view over `wasmMemory.buffer` at `tb_display_ptr()`. Expand RGBA4444 → RGBA8888 into a reused `ImageData(128, 128)`. `ctx.putImageData(img, 0, 0)`.
4. Reconstruct `Int16Array` view over `wasmMemory.buffer` at `tb_audio_ptr()`. Copy + scale to a fresh `Float32Array(367)` (sample / 32768). Transfer the buffer to the worklet via `port.postMessage(buf, [buf])`.

The view-reconstruction step is intentional: any wasm memory `grow` invalidates existing JS typed-array views over `wasmMemory.buffer`, so we never cache the view across frames.

### Cartridge feed

`index.js` reads the uploaded `File` as `Uint8Array`, slices it into 256-byte chunks (mirroring `cartridge_io.c`'s loop). For each chunk, JS reconstructs a `Uint8Array` view over wasm memory at `tb_feed_buffer_ptr()`, copies the chunk in, then calls `tb_feed_cartridge(chunk_len)`. A `0` return at any point aborts the load and surfaces an error.

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

1. **Instantiate the wasm module** via `WebAssembly.instantiateStreaming(fetch("./tinybit_wasm.wasm"), { wasi_snapshot_preview1: wasiShim(memoryRef) })`. The shim closes over a `memoryRef` so it can read/write wasm memory once the module is instantiated. After instantiation, set `memoryRef.value = instance.exports.memory`.
2. Cache `tb = instance.exports`, `wasmMemory = instance.exports.memory`, the canvas 2D context, and a reusable `ImageData(128, 128)`.
3. **Lazily initialize audio on first cartridge upload** (browsers require a user gesture):
   - `audioCtx = new AudioContext({ sampleRate: 22000 })`
   - `await audioCtx.audioWorklet.addModule("./audio-worklet.js")`
   - Instantiate `AudioWorkletNode(audioCtx, "tinybit")`, connect to `audioCtx.destination`
4. **File input handler:**
   - Read bytes (`Uint8Array`)
   - If a game is running: `cancelAnimationFrame`, `tb.tb_stop()`
   - `await ensureAudio()`
   - `tb.tb_init()`
   - Loop: for each 256-byte chunk, write into the staging buffer view at `tb.tb_feed_buffer_ptr()` and call `tb.tb_feed_cartridge(chunk_len)`. On a `0` return, show error and bail
   - `tb.tb_start()`; on `0`, show error and bail
   - Start rAF loop
5. **rAF loop:** `tb_loop_once`, blit display, pump audio, schedule next frame.
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
| `fd_read` / `fd_seek` / `fd_close` / `fd_fdstat_get` / `fd_prestat_get` / `fd_prestat_dir_name` / `path_open` | Return `EBADF`. The cartridge is fed via `tb_feed_cartridge`, never via libc file I/O — these should never fire in practice, and a hard error is preferable to silent corruption |

## Errors & Edge Cases

- **Invalid cartridge** (`tb_feed_cartridge` or `tb_start` returns `0`): show "Invalid cartridge" in `#err`; do not start the loop.
- **Re-upload during play:** `cancelAnimationFrame`, `tb.tb_stop()`, then run the upload flow as if fresh.
- **Audio gesture blocked:** if `AudioContext` cannot start, log a warning and continue; game runs silent.
- **Tab visibility:** rAF pauses when backgrounded; the worklet drains its ring buffer to silence; on tab return the engine resumes. Brief audio drift is accepted.
- **Sample-rate mismatch:** if the browser refuses 22 kHz and falls back (typically 48 kHz), log a warning. Pitch will be off; resampling is a non-goal here.
- **Wasm memory growth:** typed-array views over `wasmMemory.buffer` are reconstructed every frame, so growth never causes stale-view bugs.
- **Submodule missing at build time:** `build.rs` errors with a clear message instructing the user to run `git submodule update --init --recursive`.

## Success Criteria

1. `git clone --recursive`, then `./scripts/build.sh`, then any static-file server (e.g. `python -m http.server 8000` from the `web/` folder) serves a working page.
2. Picking `flappy.tb.png` (or `qix.tb.png`, `rocket.tb.png`) from the existing `TinyBit/games/` directory plays the game with both video and audio.
3. Arrow keys, A, B, Enter, Backspace control the game without page-scroll or back-navigation side effects.
4. Picking a second cartridge swaps cleanly without page reload.

## Open Questions / Risks

- **Wasi-sdk binary download in `build.rs`** is convenient but adds a network dependency on first build. Pinning a specific release version + checksum is required. Honoring `WASI_SDK_PATH` lets users (or CI) supply a pre-installed copy.
- **Lua's libc footprint.** Lua's standard library uses many libc surfaces. Most calls go through wasi-sdk's libc → WASI imports, all handled by the shim. If something Lua-side reaches `fd_read` or `path_open` we'll see a clean `EBADF` error rather than a silent failure, and can decide whether to fix the cartridge data path or extend the shim.
- **Sample-rate request honored?** If most browsers no longer honor `{ sampleRate: 22000 }` in 2026, we may need a small linear-interpolation resampler in the worklet. Logging on first run will surface this quickly.
- **`wasm32-wasip1` toolchain availability.** The Rust target name was renamed from `wasm32-wasi` to `wasm32-wasip1` in 2024. CI and contributor environments need `rustup target add wasm32-wasip1`. The README documents this. (`wasm32-wasi` remains as an alias on recent toolchains, but the new name is canonical.)
