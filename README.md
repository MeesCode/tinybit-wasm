# tinybit_wasm

A Rust + WebAssembly wrapper around the [tinybit](https://github.com/MeesCode/TinyBit-lib) virtual console. Upload a `.tb.png` cartridge in your browser; the game starts playing immediately, with video, audio, and keyboard input.

The C engine (Lua VM, PNG decoder, ABC audio parser) is consumed unmodified as a git submodule. Both Rust and the C engine compile to `wasm32-wasip1` via wasi-sdk; no `wasm-bindgen` or `wasm-pack` are involved.

See `docs/superpowers/specs/2026-05-10-tinybit-wasm-design.md` for the full design and `docs/superpowers/plans/2026-05-10-tinybit-wasm.md` for the implementation plan.

## Prerequisites

- Linux x86_64 host (other hosts: install wasi-sdk-25 manually and set `WASI_SDK_PATH`)
- Rust 1.95+ (the `wasm32-wasip1` target is auto-installed via `rust-toolchain.toml`)
- Node.js 22+ (for the smoke test only)
- `curl` and `tar` on `$PATH` (used by `build.rs` to fetch wasi-sdk on first build)

## Build

```sh
git submodule update --init --recursive
./scripts/build.sh
```

The first build downloads wasi-sdk-25 (~150 MB) into `target/wasi-sdk/`. Subsequent builds reuse it. The output is `web/tinybit_wasm.wasm`.

## Play in a browser

```sh
cd web
python3 -m http.server 8000
# open http://localhost:8000/
```

Pick a `.tb.png` file. Cartridges live in the sibling [`TinyBit/games/`](../TinyBit/games/) directory; if they were created against a different engine version, regenerate them with the desktop wrapper:

```sh
cd ../TinyBit
./build/tinybit -c games/flappy.png games/flappy.lua games/flappy_cover.png games/flappy.tb.png
```

### Create a cartridge

Open the **"Create a cartridge"** panel below the upload picker. Pick a 128x128 cover PNG, a 128x128 spritesheet PNG, a Lua script, and optional header metadata. Hit **Download .tb.png** to save the cartridge, or **Play now** to feed the encoded bytes directly into the engine without leaving the page. The encoder is built into the same `tinybit_wasm.wasm` — no separate tooling required.

### Controls

| Key | TinyBit button |
|---|---|
| Arrow keys | UP/DOWN/LEFT/RIGHT |
| A | A |
| B | B |
| Enter | START |
| Backspace | SELECT |

## Smoke tests

```sh
./scripts/build.sh
node scripts/smoke.mjs          # existing flappy.tb.png regression
node scripts/smoke_encoder.mjs  # encoder round-trip + negative case
```

Loads the built `.wasm` in Node, supplies a 40-line WASI shim, feeds a real `flappy.tb.png` cartridge, runs 60 frames, and asserts the display contains non-zero pixels. This validates the full pipeline end-to-end except for browser-specific bits (canvas blit, audio worklet, keyboard). `smoke_encoder.mjs` encodes a tiny fixture cartridge via the in-wasm encoder, then feeds the bytes back through the decoder and asserts the expected pixel.

## Layout

- `src/tinybit/` — git submodule, C engine, untouched
- `src/lib.rs` — Rust wrapper, raw `extern "C"` exports for JS
- `src/bindings.rs` — hand-written FFI declarations for the C library
- `build.rs` — wasi-sdk discovery + cc-rs C compilation
- `web/` — static frontend (`index.html`, `index.js`, `wasi-shim.js`, `audio-worklet.js`)
- `scripts/build.sh`, `scripts/smoke.mjs`
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

JS reads display/audio by constructing typed-array views over wasm memory at the returned pointers — zero copy. Views are reconstructed each frame to stay valid across `memory.grow`.

## Limitations

- No game-selector UI; this build only plays cartridges uploaded directly. The selector is a feature of the desktop wrapper.
- The browser encoder caps scripts at 32 621 bytes — one less than the desktop encoder's 32 622, to keep the cartridge payload within 65 536 pixels including the trailing NUL.
- Audio plays at the host `AudioContext` sample rate; if the browser refuses 22 kHz, pitch is off (no resampler is included).
- Touch and gamepad input are not supported.
- `os.tmpname()` from Lua is stubbed; cartridges that depend on it will get a no-op temp name.
