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

The first build downloads wasi-sdk-25 (~150 MB) into `target/wasi-sdk/`. Subsequent builds reuse it. The output is `editor/public/tinybit_wasm.wasm`.

## Run the editor

The browser editor lets you write Lua, upload a 128×128 PNG spritesheet (and optional cover), play in-browser, and download a `.tb.png` cartridge.

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
- `node scripts/smoke.mjs`        — engine-level Node smoke (unchanged)

## Smoke test

```sh
./scripts/build.sh
node scripts/smoke.mjs
```

Loads the built `.wasm` in Node, supplies a 40-line WASI shim, feeds a real `flappy.tb.png` cartridge, runs 60 frames, and asserts the display contains non-zero pixels. This validates the full pipeline end-to-end except for browser-specific bits (canvas blit, audio worklet, keyboard).

## Layout

- `src/tinybit/` — git submodule, C engine, untouched
- `src/lib.rs` — Rust wrapper, raw `extern "C"` exports for JS
- `src/bindings.rs` — hand-written FFI declarations for the C library
- `build.rs` — wasi-sdk discovery + cc-rs C compilation
- `editor/` — Vite + React editor (source under `editor/src/`, production build to `editor/dist/`)
- `editor/public/` — static assets served by Vite, including the built `tinybit_wasm.wasm`
- `scripts/build.sh`, `scripts/dev.sh`, `scripts/smoke.mjs`
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

- No cartridge export until `feat/tb-encoder` merges. The editor's Download button requires `tb_enc_*` WASM exports; until that branch merges the button will return an error. Use the desktop wrapper's `-c` mode in the meantime.
- The editor's Play button also requires `feat/tb-encoder`; until it merges the console logs "Encoder exports missing — rebuild after merging feat/tb-encoder".
- Audio plays at the host `AudioContext` sample rate; if the browser refuses 22 kHz, pitch is off (no resampler is included).
- Touch and gamepad input are not supported.
- `os.tmpname()` from Lua is stubbed; cartridges that depend on it will get a no-op temp name.

## Known environmental requirements

These are one-time setup steps on a fresh Linux machine.

### Playwright system libs

Before running `npm run test:e2e` for the first time, install the system libraries Chromium needs:

```sh
sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libpango-1.0-0 libcairo2 libasound2
cd editor && npx playwright install chromium
```

### Encoder branch dependency

The editor's Play and Download buttons require the WASM build to export `tb_enc_*` symbols from the `feat/tb-encoder` branch. Until that branch merges:

- **Play:** logs "Encoder exports missing — rebuild after merging feat/tb-encoder"; game will not start.
- **Download:** returns an error.

You can still open the editor, write Lua, and inspect the UI without the encoder branch.
