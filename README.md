# tinybit_wasm

A Rust + WebAssembly wrapper around the [tinybit](https://github.com/MeesCode/TinyBit-lib) virtual console, plus a browser-based editor that lets you write Lua, attach a 128×128 spritesheet, and play the result in-page.

The C engine (Lua VM, PNG decoder, ABC audio parser) is consumed unmodified as a git submodule. Both Rust and the C engine compile to `wasm32-wasip1` via wasi-sdk; no `wasm-bindgen` or `wasm-pack` are involved.

See `docs/superpowers/specs/2026-05-10-tinybit-wasm-design.md` for the player design, `docs/superpowers/specs/2026-05-11-tb-encoder-design.md` for the encoder design, and `docs/superpowers/specs/2026-05-11-editor-ui-design.md` for the browser editor.

## Prerequisites

- Linux x86_64 host (other hosts: install wasi-sdk-25 manually and set `WASI_SDK_PATH`)
- Rust 1.95+ (the `wasm32-wasip1` target is auto-installed via `rust-toolchain.toml`)
- Node.js 22+ (smoke tests + the editor's Vite dev server)
- `curl` and `tar` on `$PATH` (used by `build.rs` to fetch wasi-sdk on first build)

## Build

```sh
git submodule update --init --recursive
./scripts/build.sh
```

The first build downloads wasi-sdk-25 (~150 MB) into `target/wasi-sdk/`. Subsequent builds reuse it. The output is `editor/public/tinybit_wasm.wasm`.

## Run the editor

The browser editor lets you write Lua, attach a 128×128 PNG spritesheet (and optional cover), play in-browser, and download the encoded `.tb.png` cartridge.

```sh
./scripts/dev.sh
# open http://localhost:5173/
```

`scripts/dev.sh` rebuilds the WASM and starts the Vite dev server. To build for production:

```sh
./scripts/build.sh
cd editor && npm run build
# serves from editor/dist/
```

### Create a cartridge

Open the **Cartridge** tab in the editor's left pane. Pick a 128×128 spritesheet PNG and (optionally) a 128×128 cover PNG, and set the title/author. Hit **▶ Play** to encode and run the cartridge in-page, or **⬇ Download** to save the cartridge to disk. The encoder is built into the same `tinybit_wasm.wasm` — no separate tooling required.

### Controls

| Key | TinyBit button |
|---|---|
| Arrow keys | UP/DOWN/LEFT/RIGHT |
| A | A |
| B | B |
| Enter | START |
| Backspace | SELECT |

### Tests

- `cd editor && npm test`         — unit + component tests (Vitest, jsdom)
- `cd editor && npm run test:e2e` — Playwright smoke (boot + encode + play)
- `node scripts/smoke.mjs`        — engine-level Node smoke (player path)
- `node scripts/smoke_encoder.mjs` — engine-level Node smoke (encoder round-trip)

## Smoke tests

```sh
./scripts/build.sh
node scripts/smoke.mjs          # existing flappy.tb.png regression
node scripts/smoke_encoder.mjs  # encoder round-trip + negative case
```

Loads the built `.wasm` in Node, supplies a 40-line WASI shim, feeds a real `flappy.tb.png` cartridge, runs 60 frames, and asserts the display contains non-zero pixels. This validates the full pipeline end-to-end except for browser-specific bits (canvas blit, audio worklet, keyboard). `smoke_encoder.mjs` encodes a tiny fixture cartridge via the in-wasm encoder, then feeds the bytes back through the decoder and asserts the expected pixel.

## Layout

- `src/tinybit/` — git submodule, C engine, untouched
- `src/lib.rs` — Rust wrapper, raw `extern "C"` exports for JS (player + encoder)
- `src/bindings.rs` — hand-written FFI declarations for the C library
- `src/encoder/` — pure-Rust cartridge encoder modules
- `build.rs` — wasi-sdk discovery + cc-rs C compilation
- `editor/` — Vite + React editor (source under `editor/src/`, production build to `editor/dist/`)
- `editor/public/` — static assets served by Vite, including the built `tinybit_wasm.wasm`
- `scripts/build.sh`, `scripts/dev.sh`, `scripts/smoke.mjs`, `scripts/smoke_encoder.mjs`
- `docs/superpowers/specs/`, `docs/superpowers/plans/` — design + implementation docs

## Architecture notes

The C engine uses `setjmp`/`longjmp` (Lua's error handling) and `clock()`. To avoid imposing JS-side runtime helpers for these, `build.rs` passes `-mllvm -wasm-enable-sjlj` (lowers setjmp/longjmp to native WASM EH) and links wasi-sdk's `libsetjmp`, `libwasi-emulated-process-clocks`, and `libwasi-emulated-signal`. The result is a self-contained WASM module that imports only the standard `wasi_snapshot_preview1` surface.

The Rust wrapper exposes a small flat C API to JS:

| Export | Purpose |
|---|---|
| `tb_init()` | Allocate state, register C-side callbacks |
| `tb_feed_buffer_ptr()` | Pointer to a 256-byte staging buffer in wasm memory |
| `tb_feed_cartridge(len)` | Forward `len` bytes from staging to the engine (returns 1/0) |
| `tb_start()`, `tb_stop()`, `tb_loop_once()` | Lifecycle |
| `tb_set_button(idx, pressed)` | Write input state |
| `tb_display_ptr()`, `tb_audio_ptr()` | Pointers into the engine's display + audio buffers |
| `tb_enc_init()`, `tb_enc_input_ptr(slot)`, `tb_enc_set_input_len(slot, len)` | Stage encoder inputs |
| `tb_enc_set_header(...)`, `tb_enc_run()` | Build the cartridge |
| `tb_enc_output_ptr()`, `tb_enc_error_ptr()`, `tb_enc_error_len()` | Read encoder result / error |

JS reads display/audio by constructing typed-array views over wasm memory at the returned pointers — zero copy. Views are reconstructed each frame to stay valid across `memory.grow`.

## Limitations

- Single-sketch playground. No multi-cartridge library, no cloud save, no URL sharing.
- The browser encoder caps scripts at 32 621 bytes, to keep the cartridge payload within 65 536 pixels including the trailing NUL.
- Audio plays at the host `AudioContext` sample rate; if the browser refuses 22 kHz, pitch is off (no resampler is included).
- Touch and gamepad input are not supported.
- `os.tmpname()` from Lua is stubbed; cartridges that depend on it will get a no-op temp name.
- `.tb.png` drag-drop into the editor would play the cartridge but does not yet repopulate the script/sprite — extracting those needs an engine-side decoder export that doesn't exist yet.
