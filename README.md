# tinybit_wasm

Rust + WebAssembly wrapper around the [tinybit](https://github.com/MeesCode/TinyBit-lib) virtual console. Compiles the unmodified C engine to WASM via wasi-sdk and ships a static webpage that plays `.tb.png` cartridges in the browser.

See `docs/superpowers/specs/2026-05-10-tinybit-wasm-design.md` for the full design.

## Prerequisites

- Rust 1.95+ with the `wasm32-wasip1` target (auto-installed by `rust-toolchain.toml`)
- Linux x86_64 host (other hosts: set `WASI_SDK_PATH` to a manually-installed wasi-sdk)
- Node.js 22+ for the smoke test
- `curl` and `tar` on `$PATH` (used by `build.rs` to fetch wasi-sdk on first build)

## Build

```sh
git submodule update --init --recursive
./scripts/build.sh
```

## Run in a browser

```sh
cd web && python -m http.server 8000
# open http://localhost:8000/
```

## Smoke test

```sh
node scripts/smoke.mjs
```
