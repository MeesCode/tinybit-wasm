# tinybit_wasm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Rust+WASM wrapper around the unmodified `tinybit` C library, with a minimal browser frontend that uploads a `.tb.png` cartridge and plays it back (video, audio, keyboard).

**Architecture:** Rust crate compiled for `wasm32-wasip1`, statically linking the C engine compiled by wasi-sdk's clang. Raw `extern "C"` exports — no wasm-bindgen. Browser instantiates the `.wasm` directly with a small WASI shim. A Node.js smoke test exercises the full pipeline minus the browser frontend.

**Tech Stack:** Rust 1.95+, `cc` crate, `bindgen`, wasi-sdk-25 (downloaded by `build.rs` or supplied via `WASI_SDK_PATH`), Node.js for the smoke test.

**Spec:** `docs/superpowers/specs/2026-05-10-tinybit-wasm-design.md`

**Working directory for all tasks:** `/home/mees/git/tinybit_projects/tinybit_wasm/`

**Cargo / rustc are at `~/.cargo/bin/`. Subagents should `source ~/.cargo/env` (or run `~/.cargo/bin/cargo`) at the start of any shell that needs cargo.**

---

## Task 1: Project scaffolding

**Files:**
- Create: `tinybit_wasm/Cargo.toml`
- Create: `tinybit_wasm/.cargo/config.toml`
- Create: `tinybit_wasm/rust-toolchain.toml`
- Create: `tinybit_wasm/.gitmodules` (via `git submodule add`)
- Modify: `tinybit_wasm/.gitignore` (already exists from spec commit)
- Create: `tinybit_wasm/src/lib.rs` (placeholder)
- Create: `tinybit_wasm/build.rs` (placeholder)
- Create: `tinybit_wasm/README.md`

- [ ] **Step 1: Add the tinybit submodule**

```bash
cd /home/mees/git/tinybit_projects/tinybit_wasm
git submodule add git@github.com:MeesCode/TinyBit-lib.git src/tinybit
```

Expected: `.gitmodules` created, `src/tinybit/` populated.

- [ ] **Step 2: Verify the submodule has the expected files**

```bash
ls src/tinybit/tinybit.h src/tinybit/CMakeLists.txt src/tinybit/lua/lua.h
```

Expected: all three paths exist (no errors).

- [ ] **Step 3: Write `Cargo.toml`**

```toml
[package]
name = "tinybit_wasm"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
libc = "0.2"

[build-dependencies]
cc = "1.0"
bindgen = "0.69"

[profile.release]
opt-level = "s"
lto = true
strip = true
panic = "abort"

[profile.dev]
panic = "abort"
```

- [ ] **Step 4: Write `.cargo/config.toml` (default target)**

```toml
[build]
target = "wasm32-wasip1"
```

- [ ] **Step 5: Write `rust-toolchain.toml`**

```toml
[toolchain]
channel = "stable"
targets = ["wasm32-wasip1"]
```

This makes `rustup` auto-install the wasm32-wasip1 target the first time anyone builds.

- [ ] **Step 6: Add build artifacts to `.gitignore`**

The existing `.gitignore` already contains `/target`, `/wasi-sdk`, `Cargo.lock`. Append the built artifact path.

```bash
cat >> .gitignore <<'EOF'
/web/tinybit_wasm.wasm
EOF
```

- [ ] **Step 7: Create placeholder `src/lib.rs`**

```rust
// Implementation lives here. Populated by later tasks.
```

- [ ] **Step 8: Create placeholder `build.rs`**

```rust
fn main() {
    // Populated by Task 2/3/4.
    println!("cargo:rerun-if-changed=build.rs");
}
```

- [ ] **Step 9: Write a minimal `README.md`**

```markdown
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
```

- [ ] **Step 10: Verify `cargo check` runs (with the placeholder `lib.rs`)**

```bash
source ~/.cargo/env
cargo check --target wasm32-wasip1
```

Expected: `cargo` may install the target on first run, then succeed with "Finished" (the placeholder lib.rs has no code so check passes).

- [ ] **Step 11: Commit**

```bash
git add Cargo.toml .cargo/ rust-toolchain.toml .gitmodules src/ build.rs README.md .gitignore
git commit -m "scaffold: cargo crate, submodule, default wasm32-wasip1 target"
```

---

## Task 2: build.rs — wasi-sdk acquisition

**Files:**
- Modify: `tinybit_wasm/build.rs`

The first half of `build.rs` discovers wasi-sdk: honors `WASI_SDK_PATH` if set, otherwise downloads `wasi-sdk-25` to `target/wasi-sdk/` once.

- [ ] **Step 1: Replace `build.rs` with the wasi-sdk acquisition logic**

```rust
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

const WASI_SDK_VERSION: &str = "25";
const WASI_SDK_TARBALL_URL: &str =
    "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-x86_64-linux.tar.gz";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");

    let _sdk = ensure_wasi_sdk();
    // Tasks 3 and 4 add C compilation and bindgen here.
}

fn ensure_wasi_sdk() -> PathBuf {
    if let Ok(p) = env::var("WASI_SDK_PATH") {
        let p = PathBuf::from(p);
        let clang = p.join("bin").join("clang");
        if !clang.exists() {
            panic!(
                "WASI_SDK_PATH={} does not contain bin/clang",
                p.display()
            );
        }
        return p;
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let sdk_dir = manifest.join("target").join("wasi-sdk");
    let clang = sdk_dir.join("bin").join("clang");

    if clang.exists() {
        return sdk_dir;
    }

    download_wasi_sdk(&sdk_dir);

    if !clang.exists() {
        panic!(
            "wasi-sdk download/extract did not produce {}",
            clang.display()
        );
    }
    sdk_dir
}

fn download_wasi_sdk(dest: &Path) {
    println!(
        "cargo:warning=Downloading wasi-sdk-{WASI_SDK_VERSION} to {} (one-time)",
        dest.display()
    );
    std::fs::create_dir_all(dest).expect("create wasi-sdk dir");

    let tarball = dest
        .parent()
        .expect("wasi-sdk dest parent")
        .join("wasi-sdk.tar.gz");

    let curl = Command::new("curl")
        .args([
            "-fL",
            "--retry",
            "3",
            "--retry-delay",
            "2",
            WASI_SDK_TARBALL_URL,
            "-o",
        ])
        .arg(&tarball)
        .status()
        .expect("invoke curl");
    if !curl.success() {
        panic!("curl failed to download wasi-sdk tarball");
    }

    let tar = Command::new("tar")
        .args(["-xzf"])
        .arg(&tarball)
        .args(["-C"])
        .arg(dest)
        .args(["--strip-components=1"])
        .status()
        .expect("invoke tar");
    if !tar.success() {
        panic!("tar failed to extract wasi-sdk");
    }

    let _ = std::fs::remove_file(&tarball);
}
```

- [ ] **Step 2: Run a probe build to trigger the download**

```bash
source ~/.cargo/env
cargo build --target wasm32-wasip1 --release
```

Expected: prints `warning: Downloading wasi-sdk-25 to ...` and (after a few minutes on first run) downloads + extracts. Build itself succeeds (the lib.rs is still empty so no link errors).

- [ ] **Step 3: Verify wasi-sdk is in place**

```bash
ls target/wasi-sdk/bin/clang target/wasi-sdk/share/wasi-sysroot/include/stdio.h
```

Expected: both paths exist.

- [ ] **Step 4: Confirm the second build is fast (no re-download)**

```bash
source ~/.cargo/env
cargo build --target wasm32-wasip1 --release
```

Expected: completes in under 5 seconds (uses the existing `target/wasi-sdk/`).

- [ ] **Step 5: Commit**

```bash
git add build.rs
git commit -m "build: acquire wasi-sdk-25 (env var or one-time download)"
```

---

## Task 3: build.rs — compile C sources via cc-rs

**Files:**
- Modify: `tinybit_wasm/build.rs`

- [ ] **Step 1: Append the C compilation block to `build.rs`**

Insert *after* the `let _sdk = ensure_wasi_sdk();` line (replace `let _sdk` with `let sdk` to actually use it), and before the closing `}` of `main`.

Replace the body of `main()` with:

```rust
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");
    println!("cargo:rerun-if-changed=src/tinybit/tinybit.h");

    let sdk = ensure_wasi_sdk();
    require_submodule();
    compile_c(&sdk);
}
```

Then add the helper functions below `main()` (and *above* `ensure_wasi_sdk`):

```rust
fn require_submodule() {
    let header = PathBuf::from("src/tinybit/tinybit.h");
    if !header.exists() {
        panic!(
            "tinybit submodule missing at src/tinybit/. Run:\n\
             \tgit submodule update --init --recursive"
        );
    }
}

fn compile_c(sdk: &Path) {
    let sysroot = sdk.join("share").join("wasi-sysroot");
    let clang = sdk.join("bin").join("clang");
    let llvm_ar = sdk.join("bin").join("llvm-ar");

    let mut build = cc::Build::new();
    build
        .compiler(&clang)
        .archiver(&llvm_ar)
        .flag(&format!("--sysroot={}", sysroot.display()))
        .flag("--target=wasm32-wasi")
        .flag("-fno-exceptions")
        .define("PNGLE_STATIC_ALLOC", None)
        .define("PNGLE_NO_GAMMA_CORRECTION", None)
        .define("MINIZ_NO_MALLOC", None)
        .include("src/tinybit")
        .include("src/tinybit/lua")
        .include("src/tinybit/pngle")
        .include("src/tinybit/ABC-parser")
        .warnings(false)
        .opt_level(2);

    let core_sources = [
        "tinybit.c",
        "lua_pool.c",
        "cartridge.c",
        "graphics.c",
        "font.c",
        "input.c",
        "audio.c",
        "memory.c",
        "lua_functions.c",
        "pngle/pngle.c",
        "pngle/miniz.c",
        "ABC-parser/abc_parser.c",
    ];
    for src in core_sources {
        build.file(format!("src/tinybit/{}", src));
    }

    let lua_dir = Path::new("src/tinybit/lua");
    for entry in std::fs::read_dir(lua_dir).expect("read lua dir") {
        let entry = entry.expect("lua dir entry");
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("c") {
            build.file(path);
        }
    }

    build.compile("tinybit");
}
```

Final `build.rs` ordering: `use` lines, constants, `main`, `require_submodule`, `compile_c`, `ensure_wasi_sdk`, `download_wasi_sdk`.

- [ ] **Step 2: Trigger a build to compile all C sources**

```bash
source ~/.cargo/env
cargo build --target wasm32-wasip1 --release
```

Expected: cc-rs compiles ~45 C files (Lua sources + tinybit core + pngle + ABC parser), produces `target/wasm32-wasip1/release/build/tinybit_wasm-*/out/libtinybit.a`. May take 1–2 minutes the first time. The Rust crate has no FFI calls yet so the link succeeds with the C objects unused.

- [ ] **Step 3: Verify the static archive was produced**

```bash
find target -name 'libtinybit.a' -ls 2>/dev/null
```

Expected: one or more matches in `target/wasm32-wasip1/release/build/.../out/libtinybit.a`, several MB in size.

- [ ] **Step 4: Touch a C source to verify rebuild happens**

```bash
touch src/tinybit/tinybit.c
source ~/.cargo/env
cargo build --target wasm32-wasip1 --release 2>&1 | head -20
```

Expected: cc-rs recompiles (cc emits "compiling" lines for at least `tinybit.c`).

- [ ] **Step 5: Commit**

```bash
git add build.rs
git commit -m "build: compile tinybit C sources via wasi-sdk clang"
```

---

## Task 4: build.rs — bindgen FFI

**Files:**
- Modify: `tinybit_wasm/build.rs`
- Create: `tinybit_wasm/src/bindings.rs`

- [ ] **Step 1: Add `bindgen` invocation to `build.rs`**

Add a call to a new `generate_bindings()` helper from `main()`:

```rust
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");
    println!("cargo:rerun-if-changed=src/tinybit/tinybit.h");

    let sdk = ensure_wasi_sdk();
    require_submodule();
    compile_c(&sdk);
    generate_bindings();
}
```

Add the `generate_bindings` function (placement: after `compile_c`):

```rust
fn generate_bindings() {
    let bindings = bindgen::Builder::default()
        .header("src/tinybit/tinybit.h")
        .clang_arg("-Isrc/tinybit")
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .derive_default(true)
        .generate()
        .expect("bindgen failed");

    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap()).join("bindings.rs");
    bindings
        .write_to_file(&out_path)
        .expect("write bindings.rs");
}
```

- [ ] **Step 2: Create the in-tree shim that re-exports the generated file**

Write `src/bindings.rs`:

```rust
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code)]
include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
```

- [ ] **Step 3: Reference `bindings` from `lib.rs` so the file is compiled**

Replace `src/lib.rs` with:

```rust
mod bindings;
```

- [ ] **Step 4: Build and verify bindings are generated**

```bash
source ~/.cargo/env
cargo build --target wasm32-wasip1 --release
find target -name bindings.rs -path '*/build/*' -ls
```

Expected: a `bindings.rs` exists under `target/wasm32-wasip1/release/build/tinybit_wasm-*/out/bindings.rs` and contains `pub struct TinyBitMemory`, `pub fn tinybit_init`, etc.

- [ ] **Step 5: Spot-check the generated bindings**

```bash
grep -E 'pub (fn tinybit_(init|feed_cartridge|loop|start|stop)|struct TinyBitMemory|const TB_SCREEN_WIDTH)' target/wasm32-wasip1/release/build/tinybit_wasm-*/out/bindings.rs | head -20
```

Expected: matches for `pub fn tinybit_init`, `pub fn tinybit_feed_cartridge`, `pub fn tinybit_loop`, `pub fn tinybit_start`, `pub fn tinybit_stop`, `pub struct TinyBitMemory`, `pub const TB_SCREEN_WIDTH: u32 = 128`.

- [ ] **Step 6: Commit**

```bash
git add build.rs src/lib.rs src/bindings.rs
git commit -m "build: generate Rust FFI bindings from tinybit.h via bindgen"
```

---

## Task 5: Rust wrapper — state, init, callbacks (log + ticks)

**Files:**
- Modify: `tinybit_wasm/src/lib.rs`

- [ ] **Step 1: Replace `src/lib.rs` with the state container, `tb_init`, and the two non-no-op callbacks**

```rust
mod bindings;

use core::ffi::{c_char, c_int};
use std::cell::RefCell;
use std::sync::OnceLock;
use std::time::Instant;

use bindings::{
    tinybit_audio_queue_cb, tinybit_gamecount_cb, tinybit_gameload_cb, tinybit_get_ticks_ms_cb,
    tinybit_init, tinybit_log_cb, tinybit_poll_input_cb, tinybit_render_cb, TinyBitMemory,
};

const FEED_BUF_SIZE: usize = 256;

struct TinyBitState {
    memory: Box<TinyBitMemory>,
    feed_buf: [u8; FEED_BUF_SIZE],
    started: bool,
}

impl TinyBitState {
    fn new() -> Self {
        Self {
            memory: Box::new(unsafe { core::mem::zeroed() }),
            feed_buf: [0; FEED_BUF_SIZE],
            started: false,
        }
    }
}

thread_local! {
    static STATE: RefCell<Option<TinyBitState>> = const { RefCell::new(None) };
}

static START_INSTANT: OnceLock<Instant> = OnceLock::new();

#[no_mangle]
pub extern "C" fn tb_init() {
    START_INSTANT.get_or_init(Instant::now);

    STATE.with(|cell| {
        let mut state = TinyBitState::new();
        unsafe {
            tinybit_init(state.memory.as_mut() as *mut TinyBitMemory);
            tinybit_log_cb(Some(log_cb));
            tinybit_get_ticks_ms_cb(Some(get_ticks_ms_cb));
            tinybit_render_cb(Some(noop_cb));
            tinybit_poll_input_cb(Some(noop_cb));
            tinybit_audio_queue_cb(Some(noop_cb));
            tinybit_gamecount_cb(Some(gamecount_cb));
            tinybit_gameload_cb(Some(gameload_cb));
        }
        *cell.borrow_mut() = Some(state);
    });
}

extern "C" fn log_cb(msg: *const c_char) {
    if msg.is_null() {
        return;
    }
    let cstr = unsafe { core::ffi::CStr::from_ptr(msg) };
    let bytes = cstr.to_bytes();
    if bytes.is_empty() {
        return;
    }
    unsafe {
        libc::write(2, bytes.as_ptr() as *const _, bytes.len());
    }
}

extern "C" fn get_ticks_ms_cb() -> c_int {
    let start = START_INSTANT.get_or_init(Instant::now);
    let elapsed = start.elapsed().as_millis();
    elapsed as c_int
}

extern "C" fn noop_cb() {}

extern "C" fn gamecount_cb() -> c_int {
    0
}

extern "C" fn gameload_cb(_idx: c_int) {}
```

- [ ] **Step 2: Build to verify FFI types match the bindgen output**

```bash
source ~/.cargo/env
cargo build --target wasm32-wasip1 --release
```

Expected: compiles cleanly. If a callback signature mismatches (e.g., bindgen produced a different signature for `tinybit_get_ticks_ms_cb`), the compiler will say so — fix by matching the exact `Option<unsafe extern "C" fn(...)>` type printed by the error.

- [ ] **Step 3: Inspect the produced wasm exports**

```bash
ls -la target/wasm32-wasip1/release/tinybit_wasm.wasm
```

Expected: a `.wasm` file produced (size around 1–2 MB).

- [ ] **Step 4: Verify exports list contains `tb_init`**

```bash
target/wasi-sdk/bin/wasm-ld --version >/dev/null  # ensures sdk in place
target/wasi-sdk/bin/llvm-nm target/wasm32-wasip1/release/tinybit_wasm.wasm 2>&1 | grep ' tb_' | head
```

Expected: line `T tb_init` (and possibly other `tb_*` symbols once later tasks add them). If `llvm-nm` doesn't grok wasm, fall back to `target/wasi-sdk/bin/wasm-objdump -x ... | grep tb_` if available, or skip — Task 6 will fail with a clearer error if exports are missing.

- [ ] **Step 5: Commit**

```bash
git add src/lib.rs
git commit -m "wrapper: tb_init + log/ticks callbacks + state container"
```

---

## Task 6: Rust wrapper — cartridge feed, lifecycle, IO pointers, button input

**Files:**
- Modify: `tinybit_wasm/src/lib.rs`

- [ ] **Step 1: Append cartridge + lifecycle + IO exports to `src/lib.rs`**

Append to the bottom of `src/lib.rs`:

```rust
use bindings::{
    tinybit_feed_cartridge, tinybit_loop, tinybit_start, tinybit_stop, TB_BUTTON_COUNT,
};

#[no_mangle]
pub extern "C" fn tb_feed_buffer_ptr() -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.feed_buf.as_mut_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_feed_cartridge(len: u32) -> u32 {
    let len = len as usize;
    if len == 0 || len > FEED_BUF_SIZE {
        return 0;
    }
    let mut ok = false;
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ok = unsafe {
                tinybit_feed_cartridge(state.feed_buf.as_ptr(), len)
            };
        }
    });
    if ok {
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn tb_start() -> u32 {
    let mut ok = false;
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ok = unsafe { tinybit_start() };
            state.started = ok;
        }
    });
    if ok {
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn tb_stop() {
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if state.started {
                unsafe { tinybit_stop() };
                state.started = false;
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_loop_once() {
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            if state.started {
                unsafe { tinybit_loop() };
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_set_button(idx: u32, pressed: u32) {
    if idx as u32 >= TB_BUTTON_COUNT {
        return;
    }
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            state.memory.button_input[idx as usize] = if pressed != 0 { 1 } else { 0 };
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_display_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.memory.display.as_ptr() as *const u8;
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_audio_ptr() -> *const i16 {
    let mut ptr: *const i16 = core::ptr::null();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.memory.audio_buffer.as_ptr();
        }
    });
    ptr
}
```

- [ ] **Step 2: Build**

```bash
source ~/.cargo/env
cargo build --target wasm32-wasip1 --release
```

Expected: compiles cleanly. If `tinybit_feed_cartridge`'s return type is `bool` vs an integer, bindgen produced `bool` (since the C signature is `bool`). The cast to `if ok { 1 } else { 0 }` handles both.

If the compiler complains about `TB_BUTTON_COUNT` being `u32` vs `i32`, adjust the comparison to use the type that bindgen produced (typically `u32` from `enum`-style consts or `i32` from `#define` consts in this codebase — the bindings file shows which).

- [ ] **Step 3: Verify exports**

```bash
target/wasi-sdk/bin/llvm-nm target/wasm32-wasip1/release/tinybit_wasm.wasm 2>&1 | grep ' T tb_'
```

Expected: lines for `tb_init`, `tb_feed_buffer_ptr`, `tb_feed_cartridge`, `tb_start`, `tb_stop`, `tb_loop_once`, `tb_set_button`, `tb_display_ptr`, `tb_audio_ptr`.

- [ ] **Step 4: Commit**

```bash
git add src/lib.rs
git commit -m "wrapper: cartridge feed, lifecycle, IO pointers, button input"
```

---

## Task 7: Build script

**Files:**
- Create: `tinybit_wasm/scripts/build.sh`

- [ ] **Step 1: Write `scripts/build.sh`**

```bash
mkdir -p scripts web
cat > scripts/build.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi

cargo build --target wasm32-wasip1 --release

mkdir -p web
cp target/wasm32-wasip1/release/tinybit_wasm.wasm web/tinybit_wasm.wasm

echo "Built web/tinybit_wasm.wasm ($(stat -c %s web/tinybit_wasm.wasm) bytes)"
EOF
chmod +x scripts/build.sh
```

- [ ] **Step 2: Run it end-to-end**

```bash
./scripts/build.sh
```

Expected: produces `web/tinybit_wasm.wasm` and prints its size.

- [ ] **Step 3: Commit**

```bash
git add scripts/build.sh
git commit -m "build: scripts/build.sh — single command to produce web/tinybit_wasm.wasm"
```

---

## Task 8: Smoke test (Node.js)

**Files:**
- Create: `tinybit_wasm/scripts/smoke.mjs`

This loads the built wasm, supplies a minimal WASI shim, feeds the real `flappy.tb.png` cartridge, runs 60 frames, and asserts the display contains non-zero pixels.

- [ ] **Step 1: Write `scripts/smoke.mjs`**

```javascript
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', 'web', 'tinybit_wasm.wasm');
const cartPath = resolve(__dirname, '..', '..', 'TinyBit', 'games', 'flappy.tb.png');

if (!existsSync(wasmPath)) {
  console.error(`missing ${wasmPath}; run scripts/build.sh first`);
  process.exit(1);
}
if (!existsSync(cartPath)) {
  console.error(`missing ${cartPath}; expected sibling TinyBit project to exist`);
  process.exit(1);
}

// ---- Minimal WASI snapshot_preview1 shim ----------------------------------
const memoryRef = { value: null };
const dec = new TextDecoder();

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;

function readBytes(ptr, len) {
  return new Uint8Array(memoryRef.value.buffer, ptr, len);
}
function dv() { return new DataView(memoryRef.value.buffer); }

const wasi = {
  fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
    if (fd !== 1 && fd !== 2) return ERRNO_BADF;
    let written = 0;
    const buffers = [];
    for (let i = 0; i < iovsLen; i++) {
      const base = dv().getUint32(iovsPtr + i * 8, true);
      const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
      buffers.push(readBytes(base, len));
      written += len;
    }
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const b of buffers) { merged.set(b, off); off += b.length; }
    const stream = fd === 1 ? process.stdout : process.stderr;
    stream.write(dec.decode(merged));
    dv().setUint32(nwrittenPtr, written, true);
    return ERRNO_SUCCESS;
  },
  fd_close: () => ERRNO_BADF,
  fd_seek: () => ERRNO_BADF,
  fd_read: () => ERRNO_BADF,
  fd_fdstat_get: () => ERRNO_BADF,
  fd_prestat_get: () => ERRNO_BADF,
  fd_prestat_dir_name: () => ERRNO_BADF,
  path_open: () => ERRNO_BADF,
  environ_get: (_envPtr, _envBuf) => ERRNO_SUCCESS,
  environ_sizes_get(countPtr, sizePtr) {
    dv().setUint32(countPtr, 0, true);
    dv().setUint32(sizePtr, 0, true);
    return ERRNO_SUCCESS;
  },
  args_get: () => ERRNO_SUCCESS,
  args_sizes_get(countPtr, sizePtr) {
    dv().setUint32(countPtr, 0, true);
    dv().setUint32(sizePtr, 0, true);
    return ERRNO_SUCCESS;
  },
  clock_time_get(_id, _precision, timePtr) {
    const ns = BigInt(Math.floor(performance.now() * 1e6));
    dv().setBigUint64(timePtr, ns, true);
    return ERRNO_SUCCESS;
  },
  random_get(buf, len) {
    const view = readBytes(buf, len);
    if (globalThis.crypto && crypto.getRandomValues) {
      crypto.getRandomValues(view);
    } else {
      for (let i = 0; i < len; i++) view[i] = (Math.random() * 256) | 0;
    }
    return ERRNO_SUCCESS;
  },
  proc_exit(code) {
    throw new Error(`proc_exit(${code})`);
  },
};

const importObject = { wasi_snapshot_preview1: new Proxy(wasi, {
  get(t, k) {
    if (k in t) return t[k];
    return (...args) => {
      console.error(`unimplemented WASI fn: ${String(k)}(${args.join(', ')})`);
      return ERRNO_BADF;
    };
  },
}) };

// ---- Instantiate ----------------------------------------------------------
const wasmBytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
memoryRef.value = instance.exports.memory;

const tb = instance.exports;

// ---- Run engine -----------------------------------------------------------
tb.tb_init();

const cart = readFileSync(cartPath);
const feedPtr = tb.tb_feed_buffer_ptr();

for (let i = 0; i < cart.length; i += 256) {
  const chunk = cart.subarray(i, Math.min(i + 256, cart.length));
  const view = new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length);
  view.set(chunk);
  const ok = tb.tb_feed_cartridge(chunk.length);
  if (ok === 0) {
    console.error(`tb_feed_cartridge returned 0 at offset ${i}`);
    process.exit(1);
  }
}

if (tb.tb_start() === 0) {
  console.error('tb_start returned 0');
  process.exit(1);
}

for (let frame = 0; frame < 60; frame++) {
  tb.tb_loop_once();
}

const displayPtr = tb.tb_display_ptr();
const display = new Uint16Array(memoryRef.value.buffer, displayPtr, 128 * 128);
let nonzero = 0;
for (let i = 0; i < display.length; i++) if (display[i] !== 0) nonzero++;

if (nonzero === 0) {
  console.error('display all zeros after 60 frames — engine did not render');
  process.exit(1);
}

console.log(`smoke test passed: ${nonzero}/${display.length} display pixels non-zero`);
tb.tb_stop();
```

- [ ] **Step 2: Verify the sibling cartridge exists**

```bash
ls /home/mees/git/tinybit_projects/TinyBit/games/flappy.tb.png
```

Expected: file exists.

- [ ] **Step 3: Run the smoke test**

```bash
./scripts/build.sh
node scripts/smoke.mjs
```

Expected output:

```
smoke test passed: <N>/16384 display pixels non-zero
```

If it prints `unimplemented WASI fn: <name>(...)`: extend the `wasi` object in `scripts/smoke.mjs` with a stub for that function (return `ERRNO_BADF` if it's a file op, success if it's a no-op like `sched_yield`).

If `tb_start` returns 0: re-check the cartridge path; ensure `flappy.tb.png` was committed and is reachable.

If display stays all zeros: increase frame count to 120 (some games may delay drawing for a frame), or check the smoke test for off-by-one in the chunk loop.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test: node smoke test exercises full engine pipeline"
```

---

## Task 9: Web frontend — HTML, WASI shim, basic boot

**Files:**
- Create: `tinybit_wasm/web/index.html`
- Create: `tinybit_wasm/web/wasi-shim.js`
- Create: `tinybit_wasm/web/index.js` (minimal boot + canvas blit + upload)

- [ ] **Step 1: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>TinyBit</title>
  <style>
    body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #111; font-family: sans-serif; color: #ccc; }
    #stage { display: grid; gap: 12px; justify-items: center; }
    canvas { width: 512px; height: 512px; image-rendering: pixelated; background: #000; }
    input[type=file] { color: #ccc; }
    #err { color: #f66; min-height: 1.2em; }
  </style>
</head>
<body>
  <div id="stage">
    <input type="file" id="cart" accept=".png,.tb.png">
    <canvas id="screen" width="128" height="128"></canvas>
    <div id="err"></div>
  </div>
  <script type="module" src="./index.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `web/wasi-shim.js`**

```javascript
export function makeWasiShim(memoryRef) {
  const dec = new TextDecoder();
  const dv = () => new DataView(memoryRef.value.buffer);
  const view = (ptr, len) => new Uint8Array(memoryRef.value.buffer, ptr, len);

  const ERRNO_SUCCESS = 0;
  const ERRNO_BADF = 8;

  let stdoutBuf = '';
  let stderrBuf = '';
  function flushLine(buf, fn) {
    const lines = buf.split('\n');
    const tail = lines.pop();
    for (const line of lines) fn(line);
    return tail;
  }

  const shim = {
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      if (fd !== 1 && fd !== 2) return ERRNO_BADF;
      const parts = [];
      let written = 0;
      for (let i = 0; i < iovsLen; i++) {
        const base = dv().getUint32(iovsPtr + i * 8, true);
        const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
        parts.push(view(base, len));
        written += len;
      }
      const total = parts.reduce((n, b) => n + b.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const b of parts) { merged.set(b, off); off += b.length; }
      const text = dec.decode(merged);
      if (fd === 1) {
        stdoutBuf = flushLine(stdoutBuf + text, console.log);
      } else {
        stderrBuf = flushLine(stderrBuf + text, console.error);
      }
      dv().setUint32(nwrittenPtr, written, true);
      return ERRNO_SUCCESS;
    },
    fd_close: () => ERRNO_BADF,
    fd_seek: () => ERRNO_BADF,
    fd_read: () => ERRNO_BADF,
    fd_fdstat_get: () => ERRNO_BADF,
    fd_prestat_get: () => ERRNO_BADF,
    fd_prestat_dir_name: () => ERRNO_BADF,
    path_open: () => ERRNO_BADF,
    environ_get: () => ERRNO_SUCCESS,
    environ_sizes_get(countPtr, sizePtr) {
      dv().setUint32(countPtr, 0, true);
      dv().setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    args_get: () => ERRNO_SUCCESS,
    args_sizes_get(countPtr, sizePtr) {
      dv().setUint32(countPtr, 0, true);
      dv().setUint32(sizePtr, 0, true);
      return ERRNO_SUCCESS;
    },
    clock_time_get(_id, _precision, timePtr) {
      const ns = BigInt(Math.floor(performance.now() * 1e6));
      dv().setBigUint64(timePtr, ns, true);
      return ERRNO_SUCCESS;
    },
    random_get(buf, len) {
      crypto.getRandomValues(view(buf, len));
      return ERRNO_SUCCESS;
    },
    proc_exit(code) {
      throw new Error(`proc_exit(${code})`);
    },
  };

  return new Proxy(shim, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        console.warn(`unimplemented WASI fn: ${String(name)}`, args);
        return ERRNO_BADF;
      };
    },
  });
}
```

- [ ] **Step 3: Write `web/index.js`**

```javascript
import { makeWasiShim } from './wasi-shim.js';

const SCREEN_W = 128;
const SCREEN_H = 128;
const AUDIO_FRAME_SAMPLES = 367;
const FEED_CHUNK = 256;
const BUTTONS = {
  'a': 0, 'A': 0,
  'b': 1, 'B': 1,
  'ArrowUp': 2, 'ArrowDown': 3, 'ArrowLeft': 4, 'ArrowRight': 5,
  'Enter': 6, 'Backspace': 7,
};
const PREVENT_DEFAULT_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace',
]);

const memoryRef = { value: null };
const wasi = makeWasiShim(memoryRef);

const wasm = await WebAssembly.instantiateStreaming(
  fetch('./tinybit_wasm.wasm'),
  { wasi_snapshot_preview1: wasi },
);
const tb = wasm.instance.exports;
memoryRef.value = tb.memory;

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const imageData = ctx.createImageData(SCREEN_W, SCREEN_H);
const errEl = document.getElementById('err');

let rafId = 0;
let running = false;

function showError(msg) {
  errEl.textContent = msg;
  console.error(msg);
}

function clearError() {
  errEl.textContent = '';
}

function blitDisplay() {
  const ptr = tb.tb_display_ptr();
  const display = new Uint16Array(memoryRef.value.buffer, ptr, SCREEN_W * SCREEN_H);
  const out = imageData.data;
  for (let i = 0; i < display.length; i++) {
    const px = display[i];
    const r = px & 0xf0;
    const g = (px & 0x0f) << 4;
    const b = (px >> 8) & 0xf0;
    const a = ((px >> 8) & 0x0f) << 4;
    const di = i * 4;
    out[di + 0] = r;
    out[di + 1] = g;
    out[di + 2] = b;
    out[di + 3] = a;
  }
  ctx.putImageData(imageData, 0, 0);
}

function tick() {
  if (!running) return;
  tb.tb_loop_once();
  blitDisplay();
  // Audio pump added in Task 11.
  rafId = requestAnimationFrame(tick);
}

function stopGame() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (running) {
    tb.tb_stop();
    running = false;
  }
}

async function loadCartridge(file) {
  clearError();
  stopGame();

  const buf = new Uint8Array(await file.arrayBuffer());

  tb.tb_init();

  const feedPtr = tb.tb_feed_buffer_ptr();
  for (let i = 0; i < buf.length; i += FEED_CHUNK) {
    const end = Math.min(i + FEED_CHUNK, buf.length);
    const chunk = buf.subarray(i, end);
    const stagingView = new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length);
    stagingView.set(chunk);
    if (tb.tb_feed_cartridge(chunk.length) === 0) {
      showError(`Invalid cartridge (failed at offset ${i})`);
      return;
    }
  }

  if (tb.tb_start() === 0) {
    showError('Failed to start cartridge');
    return;
  }

  running = true;
  rafId = requestAnimationFrame(tick);
}

document.getElementById('cart').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await loadCartridge(file);
  } catch (err) {
    showError(`Error loading cartridge: ${err.message}`);
  }
});

window.addEventListener('keydown', (e) => {
  const idx = BUTTONS[e.key];
  if (idx === undefined) return;
  if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
  if (e.repeat) return;
  tb.tb_set_button(idx, 1);
});

window.addEventListener('keyup', (e) => {
  const idx = BUTTONS[e.key];
  if (idx === undefined) return;
  if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
  tb.tb_set_button(idx, 0);
});
```

- [ ] **Step 4: Smoke-test the static files locally**

```bash
./scripts/build.sh
cd web
python -m http.server 8000 &
SERVER_PID=$!
sleep 1
# Just verify the page and wasm are reachable; manual test in a browser comes later.
curl -fsS http://localhost:8000/index.html >/dev/null
curl -fsS -o /tmp/check.wasm http://localhost:8000/tinybit_wasm.wasm
file /tmp/check.wasm
kill $SERVER_PID
cd ..
```

Expected: `index.html` reachable; `/tmp/check.wasm` is `WebAssembly (wasm) binary module ...`.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "web: index.html, wasi-shim.js, index.js (video + upload + keyboard)"
```

---

## Task 10: Web frontend — audio worklet + audio pump

**Files:**
- Create: `tinybit_wasm/web/audio-worklet.js`
- Modify: `tinybit_wasm/web/index.js`

- [ ] **Step 1: Write `web/audio-worklet.js`**

```javascript
class TBProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(22000);
    this.r = 0;
    this.w = 0;
    this.size = 0;
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
        out[i] = 0;
      }
    }
    return true;
  }
}

registerProcessor('tinybit', TBProcessor);
```

- [ ] **Step 2: Add audio init + pump to `web/index.js`**

In `web/index.js`, add the audio state at the top (after the constants):

```javascript
let audioCtx = null;
let workletNode = null;

async function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext({ sampleRate: 22000 });
  if (audioCtx.sampleRate !== 22000) {
    console.warn(
      `AudioContext refused 22000 Hz (got ${audioCtx.sampleRate} Hz); audio pitch may be off`,
    );
  }
  await audioCtx.audioWorklet.addModule('./audio-worklet.js');
  workletNode = new AudioWorkletNode(audioCtx, 'tinybit', { numberOfOutputs: 1, outputChannelCount: [1] });
  workletNode.connect(audioCtx.destination);
}

function pumpAudio() {
  if (!workletNode) return;
  const ptr = tb.tb_audio_ptr();
  const samples = new Int16Array(memoryRef.value.buffer, ptr, AUDIO_FRAME_SAMPLES);
  const f = new Float32Array(AUDIO_FRAME_SAMPLES);
  for (let i = 0; i < AUDIO_FRAME_SAMPLES; i++) {
    f[i] = samples[i] / 32768;
  }
  workletNode.port.postMessage(f.buffer, [f.buffer]);
}
```

Find the `tick()` function and replace its body with:

```javascript
function tick() {
  if (!running) return;
  tb.tb_loop_once();
  blitDisplay();
  pumpAudio();
  rafId = requestAnimationFrame(tick);
}
```

In `loadCartridge`, after `clearError()` and `stopGame()`, add `await ensureAudio()` (catch errors so a denied audio gesture doesn't break video):

```javascript
async function loadCartridge(file) {
  clearError();
  stopGame();

  try {
    await ensureAudio();
  } catch (err) {
    console.warn('audio init failed; running silent:', err);
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  // ... rest unchanged
}
```

- [ ] **Step 3: Re-serve and verify the worklet file is reachable**

```bash
cd web
python -m http.server 8000 &
SERVER_PID=$!
sleep 1
curl -fsS http://localhost:8000/audio-worklet.js | head -3
kill $SERVER_PID
cd ..
```

Expected: first three lines of the worklet print.

- [ ] **Step 4: Commit**

```bash
git add web/audio-worklet.js web/index.js
git commit -m "web: audio worklet + per-frame audio pump"
```

---

## Task 11: Manual browser verification + finalize README

**Files:**
- Modify: `tinybit_wasm/README.md`

This task is the human-in-the-loop end-to-end verification: build, serve, open the page, upload `flappy.tb.png`, confirm the bird flaps with arrow input and audio plays.

- [ ] **Step 1: Build and serve**

```bash
./scripts/build.sh
cd web && python -m http.server 8000
```

- [ ] **Step 2: In a browser at `http://localhost:8000/`, upload `TinyBit/games/flappy.tb.png`**

Expected:
- A 128×128 (rendered at 512×512) game appears in the canvas
- Audio plays
- Arrow keys, A, B, Enter, Backspace control the game
- Page does not scroll on arrow press
- Browser does not navigate back on Backspace
- Uploading a second cartridge (e.g. `qix.tb.png`) swaps the game without reload

If audio is silent: check the browser console for "AudioContext refused 22000 Hz" warning. If pitch sounds wrong, that's the expected behavior (resampling is non-goal).

If the canvas stays black: check the console for `unimplemented WASI fn: ...` warnings — extend `web/wasi-shim.js` (and `scripts/smoke.mjs`) with stubs for any missing imports.

- [ ] **Step 3: Stop the server and finalize the README**

Replace the body of `README.md` with the polished version:

```markdown
# tinybit_wasm

A Rust + WebAssembly wrapper around the [tinybit](https://github.com/MeesCode/TinyBit-lib) virtual console. Upload a `.tb.png` cartridge in your browser; the game starts playing immediately, with video, audio, and keyboard input.

The C engine (Lua VM, PNG decoder, ABC audio parser) is consumed unmodified as a git submodule. Both Rust and C compile to `wasm32-wasip1` via wasi-sdk; no `wasm-bindgen` or `wasm-pack` are involved.

## Prerequisites

- Linux x86_64 (other hosts: install wasi-sdk manually and set `WASI_SDK_PATH`)
- Rust 1.95+ (the `wasm32-wasip1` target is auto-installed via `rust-toolchain.toml`)
- Node.js 22+ (for the smoke test only)
- `curl`, `tar` (used by `build.rs` to fetch wasi-sdk on first build)

## Build

```sh
git submodule update --init --recursive
./scripts/build.sh
```

The first build downloads wasi-sdk-25 (~150 MB) into `target/wasi-sdk/`. Subsequent builds reuse it.

The output is `web/tinybit_wasm.wasm`.

## Play in a browser

```sh
cd web
python -m http.server 8000
# open http://localhost:8000/
```

Pick a `.tb.png` file from the sibling [`TinyBit/games/`](../TinyBit/games/) directory.

### Controls

| Key | TinyBit button |
|---|---|
| Arrow keys | UP/DOWN/LEFT/RIGHT |
| A | A |
| B | B |
| Enter | START |
| Backspace | SELECT |

## Smoke test

```sh
./scripts/build.sh
node scripts/smoke.mjs
```

Loads the built `.wasm` in Node, feeds a real `flappy.tb.png` cartridge, runs 60 frames, and asserts the display contains non-zero pixels.

## Layout

- `src/tinybit/` — git submodule, C engine, untouched
- `src/lib.rs` — Rust wrapper exporting `tb_*` functions for JS
- `build.rs` — wasi-sdk discovery, C compilation, bindgen
- `web/` — static frontend (`index.html`, `index.js`, `wasi-shim.js`, `audio-worklet.js`)
- `scripts/build.sh`, `scripts/smoke.mjs`
- `docs/superpowers/specs/`, `docs/superpowers/plans/` — design + implementation docs

## Limitations

- No game-selector UI; this build only plays cartridges uploaded directly. The selector is a feature of the desktop wrapper.
- No cartridge export. Use the desktop wrapper's `-c` mode to author cartridges.
- Audio plays at the host `AudioContext` sample rate; if the browser refuses 22 kHz, pitch is off (no resampler is included).
- Touch and gamepad input are not supported.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — build, run, smoke test, layout, limitations"
```

---

## Self-Review Checklist (run after writing the plan)

Already-completed during plan authoring:

- **Spec coverage:**
  - [x] Submodule consumed unmodified — Task 1 step 1
  - [x] `cargo build --target wasm32-wasip1` builds everything — Tasks 2, 3, 4
  - [x] No wasm-bindgen / wasm-pack — confirmed via `Cargo.toml` deps in Task 1
  - [x] Raw `extern "C"` exports — Tasks 5, 6
  - [x] Static feed buffer — Tasks 5, 6 (`feed_buf`, `tb_feed_buffer_ptr`)
  - [x] Display + audio pointers, return-as-pointer pattern — Task 6
  - [x] Key mapping arrows + A + B + Enter + Backspace — Task 9 (`BUTTONS`)
  - [x] Audio worklet, 22 kHz mono, 1-sec ring buffer — Task 10
  - [x] WASI shim covering `fd_write`/`proc_exit`/`clock_time_get`/`random_get`/`environ_*`/`args_*` — Task 9
  - [x] Re-upload swaps game without reload — Task 9 (`stopGame()` in `loadCartridge`)
  - [x] Submodule freshness check — Task 3 (`require_submodule()`)
  - [x] Smoke test loads real cartridge — Task 8
- **Placeholder scan:** No "TBD" / "TODO" / "implement later" / "similar to Task N" — verified
- **Type consistency:** `tb_feed_cartridge`/`tb_start`/`tb_set_button` use `u32` consistently across Rust + JS; `BUTTONS` indices match `enum TinyBitButton` order (A=0, B=1, UP=2, DOWN=3, LEFT=4, RIGHT=5, START=6, SELECT=7).

---

## Execution Notes for Subagents

- Always `source ~/.cargo/env` (or run `~/.cargo/bin/cargo` directly) at the start of any shell that needs cargo.
- The wasi-sdk download in Task 2 is ~150 MB and may take several minutes on first run — expected.
- If a task fails: do not "fix" subsequent tasks to work around the failure. Stop and report.
- The `bindgen` crate's exact output for `enum TinyBitButton` (specifically `TB_BUTTON_COUNT`) may be `u32` or `i32` depending on version; adjust the comparison in `tb_set_button` to match the produced type.
- The `tinybit_*_cb` setter signatures use `Option<unsafe extern "C" fn(...)>`. If the compiler complains the inner `fn` should be `unsafe extern "C"` rather than `extern "C"`, prefix the declarations in Task 5 (`log_cb`, `get_ticks_ms_cb`, `noop_cb`, `gamecount_cb`, `gameload_cb`) with `unsafe`.
