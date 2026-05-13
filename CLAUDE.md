# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Rust + WebAssembly wrapper around the [TinyBit](https://github.com/MeesCode/TinyBit-lib) virtual console (a C engine: Lua VM, PNG decoder, ABC audio parser), plus a Vite/React browser editor for authoring Lua "cartridges" with a 128×128 spritesheet. The C engine is consumed unmodified as a submodule at `src/tinybit/`.

The whole crate compiles to a single `wasm32-wasip1` module. **No `wasm-bindgen` / `wasm-pack`** — JS interacts via raw `extern "C"` exports and reads engine memory by constructing typed-array views over `WebAssembly.Memory` at returned pointers (zero-copy; views must be reconstructed after `memory.grow`).

## Build / dev / test commands

First-time setup:
```sh
git submodule update --init --recursive   # required — src/tinybit/ is a submodule
./scripts/build.sh                         # downloads wasi-sdk-25 (~150 MB) into target/wasi-sdk/ on first run
```

| Command | Purpose |
|---|---|
| `./scripts/build.sh` | `cargo build --target wasm32-wasip1 --release`, copies output to `editor/public/tinybit_wasm.wasm` |
| `./scripts/dev.sh` | Rebuilds wasm, then `npm run dev` in `editor/` (Vite at :5173) |
| `./scripts/prod.sh` | Rebuilds wasm, `npm run build`, then `npm run preview` (:4173) |
| `cd editor && npm test` | Vitest unit/component tests (jsdom) |
| `cd editor && npm run test:watch` | Vitest watch mode |
| `cd editor && npm run test:e2e` | Playwright e2e (auto-spawns dev server) |
| `cd editor && npx vitest run path/to/file.test.ts` | Single test file |
| `cd editor && npx vitest run -t "test name"` | Single test by name |
| `node scripts/smoke.mjs` | Engine smoke (player). **Requires sibling `../TinyBit/` checkout** for `flappy.tb.png` |
| `node scripts/smoke_encoder.mjs` | Encoder round-trip |
| `node scripts/smoke_decoder.mjs` | Decoder round-trip + truncation |
| `cargo test` | Pure-Rust unit tests for `src/encoder/`, `src/decoder/` — `build.rs` skips C compilation when not targeting wasm32, so this runs on the host without wasi-sdk |

`.cargo/config.toml` pins the default cargo target to `wasm32-wasip1`. For host-target cargo commands (e.g. `cargo test`), pass `--target x86_64-unknown-linux-gnu` if the default trips up tooling.

## Architecture

### The wasm module (Rust crate, `src/`)

- `src/tinybit/` — C engine submodule, untouched.
- `src/bindings.rs` — hand-written FFI declarations for the C engine.
- `src/lib.rs` — three thread-local states (`STATE` for the player, `ENC_STATE` for the encoder, `DEC_STATE` for the decoder), plus the flat `tb_*` / `tb_enc_*` / `tb_dec_*` `extern "C"` exports JS calls.
- `src/encoder/`, `src/decoder/` — pure-Rust cartridge codec (PNG I/O + steganography in the low bits of a 256×256 RGBA canvas + header). Independently unit-testable on the host.
- `build.rs` — auto-downloads wasi-sdk-25 if `WASI_SDK_PATH` is unset (cached in `target/wasi-sdk/`), then drives `cc-rs` to compile the C engine with two non-obvious flags: `-fwasm-exceptions` + `-mllvm -wasm-enable-sjlj` (lowers Lua's `setjmp`/`longjmp` to native WASM EH so no JS-side sjlj shim is needed). Links wasi-sdk's `libsetjmp`, `libwasi-emulated-process-clocks`, `libwasi-emulated-signal`. Result: the wasm imports only standard `wasi_snapshot_preview1`.

### JS ↔ wasm FFI shape

JS staging buffers and outputs live inside the wasm module itself. Pattern: JS calls `tb_*_ptr()` to get a pointer into wasm memory, writes input bytes there via a `Uint8Array` view, calls a `tb_*_run()` to process, then reads output the same way. This avoids `wasm-bindgen` glue entirely.

Key player exports: `tb_init`, `tb_feed_buffer_ptr` (256-byte staging), `tb_feed_cartridge(len)`, `tb_start`/`tb_stop`/`tb_loop_once`, `tb_set_button`, `tb_display_ptr`, `tb_audio_ptr`, `tb_spritesheet_ptr`.

The encoder accepts inputs by **slot index** (`COVER=0, SPRITE=1, SCRIPT=2, FRAME=3, TITLE=4, AUTHOR=5`) — slot indices must stay in sync with `editor/src/engine/encoder.ts`. Decoder has its own input pointer and a packed metadata getter `tb_dec_meta()` (format_version | flags | game_version | crc_ok bit-packed into a u64).

### The editor (`editor/`, Vite + React + Zustand)

- `editor/src/engine/` — TS wrappers around the wasm exports. `runtime.ts` boots the module with a hand-written 40-line WASI shim (`wasiShim.ts`); `tinybit.ts`/`encoder.ts`/`decoder.ts` are typed facades over the FFI; `frameLoop.ts` drives `tb_loop_once`; `spritesheet.ts` live-mirrors edited pixels into engine memory when running; `audioWorklet.ts` pulls from `tb_audio_ptr`.
- `editor/src/state/` — Zustand stores: `sketchStore` (script + sprite + cover + title/author), `consoleStore` (log lines), `spriteEditorStore` (pixel editor state). `persist.ts` debounces to `localStorage`.
- `editor/src/sprite/` — built-in pixel editor (tools, color palette, undo history, viewport, custom PNG encode/decode for the spritesheet round-trip).
- `editor/src/editor/` — CodeMirror-based Lua script editor.
- `editor/src/ui/` — toolbar, panes, tabs (script / sprite / cartridge metadata).
- `editor/public/tinybit_wasm.wasm` — build output, served by Vite. **Do not edit by hand**; `scripts/build.sh` regenerates it.

### Round-trip lossiness

Cartridge encoding keeps only the **top 4 bits per spritesheet channel** and **top 6 bits per cover channel**. Decoding a freshly-encoded cartridge will not yield byte-identical pixels to the original PNG inputs — but a decode-then-re-encode cycle is a no-op modulo the `package_date` field. Tests in `src/encoder/` and `src/decoder/` assume this.

## Things to know before touching this code

- The submodule at `src/tinybit/` is intentionally not modified. Bug fixes belong upstream in TinyBit-lib.
- `tb_init()` must be called before `tb_feed_cartridge`, which must be called (in 256-byte chunks via the staging buffer) before `tb_start`. The browser runtime in `editor/src/engine/tinybit.ts` already handles this sequencing.
- Encoder/decoder are *optional* exports — `runtime.ts` probes for `tb_enc_init` / `tb_dec_init` and gracefully degrades. If you add new FFI functions, mirror this pattern rather than hard-importing.
- Browser script size cap is 32 621 bytes (fits the 65 536-pixel cartridge payload minus header and trailing NUL); enforced both Rust-side (`SCRIPT_MAX`) and editor-side.
- Audio uses the host `AudioContext` sample rate; engine generates 22 kHz, so non-22 kHz contexts play back at wrong pitch (no resampler).

## Design docs

`docs/superpowers/specs/` holds the authoritative design docs for big features (`tinybit-wasm-design`, `tb-encoder-design`, `tb-png-upload-design`, `editor-ui-design`, `spritesheet-editor-design`, `tinybit-header-in-memory-design`). `docs/superpowers/plans/` holds the per-feature implementation plans. When changing behavior in those areas, update the matching spec.
