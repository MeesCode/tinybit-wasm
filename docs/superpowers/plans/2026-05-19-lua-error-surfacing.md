# Lua Error Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Lua load-time and runtime errors (message + line number + stack traceback) from the C engine through the Rust wrapper into the editor's `ConsolePane`.

**Architecture:** New `tinybit_error_cb(const char* message, const char* traceback)` in the C engine — invoked from `tinybit_start` (load path) and `tinybit_loop` (runtime path, with a `luaL_traceback` message handler). Rust copies both strings into read-after buffers exposed via `tb_lua_error_msg_*`, `tb_lua_error_trace_*`, `tb_lua_error_clear`. The editor polls after each `tb_start`/`tb_loop_once`, parses out the line number, and renders a multi-line entry on the `error` source. The C engine's existing `error_screen` restart on runtime error stays exactly as it is — the new callback is additive.

**Tech Stack:** C (engine + Lua 5.4), Rust (wasm32-wasip1), TypeScript (Vite + React editor), Vitest, Node smoke harness.

**Reference spec:** `docs/superpowers/specs/2026-05-19-lua-error-surfacing-design.md`.

---

## File Structure

### C engine (submodule `src/tinybit/`, repo `MeesCode/TinyBit-lib`)

- **Modify:** `tinybit.h` — declare `tinybit_error_cb`.
- **Modify:** `tinybit.c` — `error_func` static, `emit_lua_error` helper, `err_msgh` for runtime, switch load path to `luaL_loadbuffer("script")`, wire both paths to the helper.

### Rust wrapper (parent repo)

- **Modify:** `src/bindings.rs` — declare `tinybit_error_cb` + `ErrorCb` typedef.
- **Modify:** `src/lib.rs` — extend `TinyBitState` with two error buffers; add `error_cb`; register in `tb_init`; add five new `#[no_mangle]` exports.

### Editor (parent repo)

- **Create:** `editor/src/engine/luaError.ts` — `LuaError` type, `parseLuaError`, `formatLuaError`.
- **Create:** `editor/src/engine/luaError.test.ts` — parser unit tests.
- **Modify:** `editor/src/engine/tinybit.ts` — extend `TinybitExports` + `Tinybit` interface; add `takeLuaError()` method.
- **Modify:** `editor/src/engine/frameLoop.ts` — add `onLuaError` callback set; poll after `loopOnce`.
- **Modify:** `editor/src/App.tsx` — subscribe to `onLuaError`, poll after `tb.start()`, route through `consoleAppend('error', …)`.

### Smoke tests (parent repo)

- **Create:** `scripts/smoke_lua_error.mjs` — runtime error end-to-end.
- **Create:** `scripts/smoke_lua_load_error.mjs` — load (syntax) error end-to-end.

### Branches

Both repos: `feat/lua-error-surfacing`.

---

## Task 1: Create feature branches in both repos

**Files:** none (git only).

- [ ] **Step 1: Confirm clean working tree in the parent repo**

```bash
cd /home/mees/git/tinybit-wasm
git status --short
```

Expected: empty output (only the design doc is committed; nothing pending).

- [ ] **Step 2: Confirm clean working tree in the submodule**

```bash
cd /home/mees/git/tinybit-wasm/src/tinybit
git status --short
git branch --show-current
```

Expected: empty output, branch is `main` (detached or attached — either is fine; we'll start a branch from here).

- [ ] **Step 3: Create the engine branch**

```bash
cd /home/mees/git/tinybit-wasm/src/tinybit
git checkout -b feat/lua-error-surfacing
```

- [ ] **Step 4: Create the parent branch**

```bash
cd /home/mees/git/tinybit-wasm
git checkout -b feat/lua-error-surfacing
```

- [ ] **Step 5: Verify both branches**

```bash
git -C /home/mees/git/tinybit-wasm branch --show-current
git -C /home/mees/git/tinybit-wasm/src/tinybit branch --show-current
```

Expected: `feat/lua-error-surfacing` from both.

---

## Task 2: Engine — declare `tinybit_error_cb`

**Files:**
- Modify: `src/tinybit/tinybit.h` (after the `tinybit_gameload_cb` declaration)

- [ ] **Step 1: Add the declaration**

Open `/home/mees/git/tinybit-wasm/src/tinybit/tinybit.h` and add immediately after the `tinybit_gameload_cb` line (currently the last function declaration before `#endif`):

```c
void tinybit_error_cb(void (*error_func_ptr)(const char* message, const char* traceback));
```

- [ ] **Step 2: Sanity-check the header still compiles**

We can't easily compile only the header, but `clang -fsyntax-only` against it works if the host has clang. Skip if clang isn't available; the build in Task 5 will catch syntax errors anyway.

```bash
clang -fsyntax-only -x c /home/mees/git/tinybit-wasm/src/tinybit/tinybit.h 2>&1 | head -5
```

Expected: no output (or warnings only).

---

## Task 3: Engine — implement `emit_lua_error` helper

**Files:**
- Modify: `src/tinybit/tinybit.c`

This task adds the helper and the setter only. The wiring into `tinybit_start` and `tinybit_loop` happens in tasks 4 and 5 so each task is independently reviewable.

- [ ] **Step 1: Add the static and setter**

Open `/home/mees/git/tinybit-wasm/src/tinybit/tinybit.c`. Find the existing `static lua_State* L;` declaration near line 28. Immediately below it, add:

```c
static void (*error_func)(const char* message, const char* traceback) = NULL;
```

Then find the existing `tinybit_log_cb` function (around line 185). Immediately after it (still before `tinybit_get_ticks_ms_cb`), insert:

```c
void tinybit_error_cb(void (*error_func_ptr)(const char* message, const char* traceback)) {
    error_func = error_func_ptr;
}
```

- [ ] **Step 2: Add the `err_msgh` message handler and `emit_lua_error` helper**

Find the static includes near the top of `tinybit.c` (the existing `#include "lua/lauxlib.h"` is on line 21). Just below `static lua_State* L;` and the new `error_func` static, add the helpers:

```c
// Lua message handler used as the msgh arg of the runtime lua_pcall.
// Receives the original error on the stack, returns a string that is
// "<original>\nstack traceback:\n<frames…>".
static int err_msgh(lua_State* l) {
    const char* msg = lua_tostring(l, 1);
    if (!msg) msg = "(non-string error)";
    luaL_traceback(l, l, msg, 1);
    return 1;
}

// Pops the error from the top of the Lua stack and, if error_func is set,
// invokes it. For runtime errors (with_trace != 0), splits the combined
// "msg\nstack traceback:\nframes" string from err_msgh into two parts.
static void emit_lua_error(lua_State* l, int with_trace) {
    const char* raw = lua_tostring(l, -1);
    if (!raw) raw = "(non-string error)";

    if (error_func) {
        if (with_trace) {
            const char* sep = strstr(raw, "\nstack traceback:");
            if (sep) {
                // Copy msg part (raw .. sep) into a stack buffer, NUL-terminated.
                size_t msg_len = (size_t)(sep - raw);
                static char msg_buf[4096];
                if (msg_len >= sizeof(msg_buf)) msg_len = sizeof(msg_buf) - 1;
                memcpy(msg_buf, raw, msg_len);
                msg_buf[msg_len] = '\0';
                // Traceback starts after "\n" — skip the leading newline.
                const char* trace = sep + 1;
                error_func(msg_buf, trace);
            } else {
                error_func(raw, NULL);
            }
        } else {
            error_func(raw, NULL);
        }
    }

    lua_pop(l, 1);
}
```

These go just above the `tinybit_init` function.

- [ ] **Step 3: Verify the build picks up the new symbols**

We'll build at the end of Task 5. For now, just visually re-check the file:

```bash
grep -n "tinybit_error_cb\|emit_lua_error\|err_msgh\|static void (\\*error_func)" /home/mees/git/tinybit-wasm/src/tinybit/tinybit.c
```

Expected: four hits — the static, the helper, the message handler, and the setter.

---

## Task 4: Engine — wire `emit_lua_error` into `tinybit_start` (load path)

**Files:**
- Modify: `src/tinybit/tinybit.c` (the `tinybit_start` function)

- [ ] **Step 1: Replace `luaL_dostring` with `luaL_loadbuffer` + `lua_pcall`**

Find the existing `tinybit_start` function (currently lines 61–71). Replace its body so it reads:

```c
bool tinybit_start() {
    const char* script = (const char*)tinybit_memory->script;
    size_t script_len = strlen(script);

    if (luaL_loadbuffer(L, script, script_len, "script") != LUA_OK
        || lua_pcall(L, 0, 0, 0) != LUA_OK) {
        emit_lua_error(L, /*with_trace=*/0);
        return false; // load or top-level error
    }
    return true;
}
```

Notes for the implementer:
- The chunk name `"script"` is what shows up in Lua error prefixes, replacing the noisy `[string "..."]:`.
- `lua_pcall(L, 0, 0, 0)` returns 0 args and discards them, so there is no result to pop on success — the previous `lua_pop(L, lua_gettop(L))` was defensive against the loader leaving the function on the stack, which `lua_pcall` already handles.
- On failure either step leaves a single error string on the stack; `emit_lua_error` pops it.

- [ ] **Step 2: Visual diff check**

```bash
git -C /home/mees/git/tinybit-wasm/src/tinybit diff tinybit.c | head -40
```

Expected: shows the rewritten `tinybit_start`. No other changes yet.

---

## Task 5: Engine — wire `emit_lua_error` into `tinybit_loop` (runtime path)

**Files:**
- Modify: `src/tinybit/tinybit.c` (the runtime pcall block in `tinybit_loop`)

- [ ] **Step 1: Install the message handler around the runtime pcall**

Find the block in `tinybit_loop` (currently lines 119–131) that reads:

```c
if(sleep_ms == 0 || get_ticks_ms_func() - sleep_start_time >= sleep_ms) {
    sleep_ms = 0;
    lua_getglobal(L, "_draw");
    if (lua_pcall(L, 0, 1, 0) == LUA_OK) {
        lua_pop(L, lua_gettop(L));
    } else {
        lua_pop(L, lua_gettop(L)); // pop error message
        printf("[TinyBit] Lua error");
        audio_stop_all();
        strcpy((char*)tinybit_memory->script, error_screen);
        tinybit_restart();
    }
}
```

Replace it with:

```c
if(sleep_ms == 0 || get_ticks_ms_func() - sleep_start_time >= sleep_ms) {
    sleep_ms = 0;
    lua_pushcfunction(L, err_msgh);
    int msgh_idx = lua_gettop(L);
    lua_getglobal(L, "_draw");
    int status = lua_pcall(L, 0, 1, msgh_idx);
    if (status == LUA_OK) {
        lua_pop(L, 1);        // pop the (unused) result
        lua_remove(L, msgh_idx); // pop the message handler
    } else {
        emit_lua_error(L, /*with_trace=*/1); // pops the error (with traceback)
        lua_remove(L, msgh_idx);             // pop the message handler
        audio_stop_all();
        // error_screen is a hand-written clean script; tinybit_restart()
        // will tinybit_start() it and the new path will not re-fire emit_lua_error.
        strcpy((char*)tinybit_memory->script, error_screen);
        tinybit_restart();
    }
}
```

Notes:
- The msgh must be pushed *below* the function being pcall'd (Lua requires the msgh stack index to be valid before the call args).
- On success `lua_pcall` leaves the return value (here 1 result was requested for symmetry with the existing code); pop it then remove the msgh.
- On failure `lua_pcall` replaces the function-and-args with the (transformed) error string at the same depth. `emit_lua_error` pops it, then we remove the msgh.

- [ ] **Step 2: Sanity-check no stray printf or stack-clearing leftovers**

```bash
grep -n "\\[TinyBit\\] Lua error\\|lua_gettop(L)" /home/mees/git/tinybit-wasm/src/tinybit/tinybit.c
```

Expected: zero hits for `[TinyBit] Lua error`. `lua_gettop(L)` should appear only in benign places (none in the rewritten error paths).

---

## Task 6: Engine — build and commit

**Files:** none beyond what was already modified.

- [ ] **Step 1: Build the full wasm artifact**

```bash
cd /home/mees/git/tinybit-wasm
./scripts/build.sh
```

Expected: completes successfully, produces `editor/public/tinybit_wasm.wasm`. Any C compile error means a typo in Tasks 3-5 — fix and rebuild.

- [ ] **Step 2: Confirm the existing player smoke still passes**

The existing flappy cartridge doesn't error, so the engine should behave identically.

```bash
cd /home/mees/git/tinybit-wasm
node scripts/smoke.mjs
```

Expected: existing pass message — same as before.

- [ ] **Step 3: Commit the engine changes**

```bash
cd /home/mees/git/tinybit-wasm/src/tinybit
git add tinybit.h tinybit.c
git commit -m "$(cat <<'EOF'
add tinybit_error_cb for surfacing Lua errors

Both the load path (tinybit_start) and the runtime path (tinybit_loop)
now route the Lua error string — and a luaL_traceback-formatted stack
for runtime failures — through a new tinybit_error_cb callback, in
addition to the existing on-canvas error_screen restart. tinybit_start
also switches to luaL_loadbuffer with chunk name "script", so error
prefixes read "script:23: …" instead of "[string \"...\"]:23: …".
EOF
)"
```

- [ ] **Step 4: Bump the submodule pointer in the parent**

```bash
cd /home/mees/git/tinybit-wasm
git add src/tinybit
git status --short
```

Expected: `M src/tinybit` (the gitlink advances to the new engine commit). Don't commit yet — bundle with the wrapper changes in Task 12.

---

## Task 7: Rust — add `tinybit_error_cb` binding

**Files:**
- Modify: `src/bindings.rs`

- [ ] **Step 1: Add the callback typedef**

Open `/home/mees/git/tinybit-wasm/src/bindings.rs`. Find the existing typedefs around line 76-82. Add immediately after `pub type LogCb = …;`:

```rust
pub type ErrorCb = unsafe extern "C" fn(message: *const c_char, traceback: *const c_char);
```

- [ ] **Step 2: Add the FFI declaration**

In the same file, find the `extern "C"` block. Add immediately after `pub fn tinybit_log_cb(cb: Option<LogCb>);`:

```rust
pub fn tinybit_error_cb(cb: Option<ErrorCb>);
```

- [ ] **Step 3: Compile-check**

```bash
cd /home/mees/git/tinybit-wasm
cargo check --target wasm32-wasip1
```

Expected: success. `tinybit_error_cb` is declared but not used yet — that's fine (the `dead_code` allow at the top of `bindings.rs` covers it).

---

## Task 8: Rust — extend `TinyBitState` with error buffers

**Files:**
- Modify: `src/lib.rs`

- [ ] **Step 1: Add buffer-size constants**

Open `/home/mees/git/tinybit-wasm/src/lib.rs`. Find `const FEED_BUF_SIZE: usize = 256;` (around line 170). Just below it, add:

```rust
const LUA_ERROR_MSG_CAP:   usize = 4096;
const LUA_ERROR_TRACE_CAP: usize = 16 * 1024;
```

- [ ] **Step 2: Add fields to `TinyBitState`**

Find the `TinyBitState` struct definition (around line 172):

```rust
struct TinyBitState {
    memory: Box<TinyBitMemory>,
    feed_buf: [u8; FEED_BUF_SIZE],
    started: bool,
}
```

Add two fields at the end:

```rust
struct TinyBitState {
    memory: Box<TinyBitMemory>,
    feed_buf: [u8; FEED_BUF_SIZE],
    started: bool,
    lua_error_msg:   Vec<u8>,
    lua_error_trace: Vec<u8>,
}
```

- [ ] **Step 3: Initialize them in `TinyBitState::new`**

Update the existing `impl TinyBitState`'s `new()` to:

```rust
impl TinyBitState {
    fn new() -> Self {
        Self {
            memory: Box::new(unsafe { core::mem::zeroed() }),
            feed_buf: [0; FEED_BUF_SIZE],
            started: false,
            lua_error_msg:   Vec::with_capacity(LUA_ERROR_MSG_CAP),
            lua_error_trace: Vec::with_capacity(LUA_ERROR_TRACE_CAP),
        }
    }
}
```

- [ ] **Step 4: Compile-check**

```bash
cd /home/mees/git/tinybit-wasm
cargo check --target wasm32-wasip1
```

Expected: success.

---

## Task 9: Rust — implement `error_cb` and register it

**Files:**
- Modify: `src/lib.rs`

- [ ] **Step 1: Add the `tinybit_error_cb` to the import list**

At the top of `lib.rs`, find the `use bindings::{ … };` block (line 10). Add `tinybit_error_cb` to the imports:

```rust
use bindings::{
    tinybit_audio_queue_cb, tinybit_error_cb, tinybit_feed_cartridge, tinybit_gamecount_cb,
    tinybit_gameload_cb, tinybit_get_ticks_ms_cb, tinybit_init, tinybit_log_cb, tinybit_loop,
    tinybit_poll_input_cb, tinybit_render_cb, tinybit_start, tinybit_stop, TinyBitMemory,
    TB_BUTTON_COUNT,
};
```

- [ ] **Step 2: Add the callback function**

Find `unsafe extern "C" fn log_cb(...)` (around line 214). Immediately after it, add:

```rust
unsafe extern "C" fn error_cb(message: *const c_char, traceback: *const c_char) {
    STATE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let Some(state) = borrow.as_mut() else { return };
        state.lua_error_msg.clear();
        state.lua_error_trace.clear();
        if !message.is_null() {
            let bytes = core::ffi::CStr::from_ptr(message).to_bytes();
            let take = bytes.len().min(LUA_ERROR_MSG_CAP);
            state.lua_error_msg.extend_from_slice(&bytes[..take]);
        }
        if !traceback.is_null() {
            let bytes = core::ffi::CStr::from_ptr(traceback).to_bytes();
            let take = bytes.len().min(LUA_ERROR_TRACE_CAP);
            state.lua_error_trace.extend_from_slice(&bytes[..take]);
        }
    });
}
```

- [ ] **Step 3: Register the callback in `tb_init`**

Find the `tb_init` function (around line 195). In the `unsafe { … }` block (line 200), add a line after `tinybit_log_cb(Some(log_cb));`:

```rust
tinybit_error_cb(Some(error_cb));
```

- [ ] **Step 4: Compile-check**

```bash
cd /home/mees/git/tinybit-wasm
cargo check --target wasm32-wasip1
```

Expected: success.

---

## Task 10: Rust — expose `tb_lua_error_*` exports

**Files:**
- Modify: `src/lib.rs`

- [ ] **Step 1: Add the five exports**

Find `pub extern "C" fn tb_loop_once()` (around line 291). Immediately after it (and its trailing `}`), add:

```rust
#[no_mangle]
pub extern "C" fn tb_lua_error_msg_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.lua_error_msg.as_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_lua_error_msg_len() -> u32 {
    let mut len: u32 = 0;
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            len = state.lua_error_msg.len() as u32;
        }
    });
    len
}

#[no_mangle]
pub extern "C" fn tb_lua_error_trace_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.lua_error_trace.as_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_lua_error_trace_len() -> u32 {
    let mut len: u32 = 0;
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            len = state.lua_error_trace.len() as u32;
        }
    });
    len
}

#[no_mangle]
pub extern "C" fn tb_lua_error_clear() {
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            state.lua_error_msg.clear();
            state.lua_error_trace.clear();
        }
    });
}
```

- [ ] **Step 2: Build the wasm**

```bash
cd /home/mees/git/tinybit-wasm
./scripts/build.sh
```

Expected: success.

- [ ] **Step 3: Verify the new exports are present in the wasm**

```bash
wasm-objdump -x /home/mees/git/tinybit-wasm/editor/public/tinybit_wasm.wasm 2>/dev/null | grep -i "lua_error\|tb_lua" | head
```

Expected: five lines mentioning `tb_lua_error_msg_ptr`, `tb_lua_error_msg_len`, `tb_lua_error_trace_ptr`, `tb_lua_error_trace_len`, `tb_lua_error_clear`. If `wasm-objdump` isn't installed, fall back to `nm` against the wasm via `node -e 'import("...")…'` — or just trust that the next smoke test will fail loudly if any export is missing.

- [ ] **Step 4: Confirm existing smoke still passes**

```bash
cd /home/mees/git/tinybit-wasm
node scripts/smoke.mjs
node scripts/smoke_encoder.mjs
node scripts/smoke_decoder.mjs
```

Expected: all three pass as before.

---

## Task 11: Smoke — runtime Lua error

**Files:**
- Create: `scripts/smoke_lua_error.mjs`

- [ ] **Step 1: Write the smoke test**

Create `/home/mees/git/tinybit-wasm/scripts/smoke_lua_error.mjs` with the contents below. It reuses the WASI shim pattern from `scripts/smoke_encoder.mjs` (copy it verbatim — `fd_write`, error-tolerant Proxy, etc.) and the in-wasm encoder to build a tiny cartridge whose `_draw` raises an error, then asserts the error surface.

```js
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', 'target', 'wasm32-wasip1', 'release', 'tinybit_wasm.wasm');

if (!existsSync(wasmPath)) {
  console.error(`missing ${wasmPath}; run scripts/build.sh first`);
  process.exit(1);
}

const memoryRef = { value: null };
const dec = new TextDecoder();
const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
function readBytes(ptr, len) { return new Uint8Array(memoryRef.value.buffer, ptr, len); }
function dv() { return new DataView(memoryRef.value.buffer); }

const wasi = {
  fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
    if (fd !== 1 && fd !== 2) return ERRNO_BADF;
    let written = 0; const buffers = [];
    for (let i = 0; i < iovsLen; i++) {
      const base = dv().getUint32(iovsPtr + i * 8, true);
      const len  = dv().getUint32(iovsPtr + i * 8 + 4, true);
      buffers.push(readBytes(base, len)); written += len;
    }
    const merged = Buffer.concat(buffers.map(b => Buffer.from(b)));
    (fd === 1 ? process.stdout : process.stderr).write(dec.decode(merged));
    dv().setUint32(nwrittenPtr, written, true);
    return ERRNO_SUCCESS;
  },
  fd_close: () => ERRNO_BADF, fd_seek: () => ERRNO_BADF, fd_read: () => ERRNO_BADF,
  fd_fdstat_get: () => ERRNO_BADF, fd_fdstat_set_flags: () => ERRNO_BADF,
  fd_prestat_get: () => ERRNO_BADF, fd_prestat_dir_name: () => ERRNO_BADF,
  fd_renumber: () => ERRNO_BADF, path_open: () => ERRNO_BADF,
  environ_get: () => ERRNO_SUCCESS,
  environ_sizes_get(c, s) { dv().setUint32(c, 0, true); dv().setUint32(s, 0, true); return ERRNO_SUCCESS; },
  args_get: () => ERRNO_SUCCESS,
  args_sizes_get(c, s) { dv().setUint32(c, 0, true); dv().setUint32(s, 0, true); return ERRNO_SUCCESS; },
  clock_time_get(_id, _p, ptr) { dv().setBigUint64(ptr, BigInt(Math.floor(performance.now() * 1e6)), true); return ERRNO_SUCCESS; },
  random_get(buf, len) { crypto.getRandomValues(readBytes(buf, len)); return ERRNO_SUCCESS; },
  proc_exit(code) { throw new Error(`proc_exit(${code})`); },
};

const importObject = { wasi_snapshot_preview1: new Proxy(wasi, {
  get(t, k) {
    if (k in t) return t[k];
    return (...a) => { console.error(`unimplemented WASI: ${String(k)}(${a.join(', ')})`); return ERRNO_BADF; };
  },
}) };

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), importObject);
memoryRef.value = instance.exports.memory;
const tb = instance.exports;

tb.tb_init();
if (tb.tb_enc_init() === 0) { console.error('tb_enc_init failed'); process.exit(1); }

// ---- Build a tiny cartridge with an erroring _draw -----------------------
const fixDir = resolve(__dirname, 'fixtures');
const coverBytes  = readFileSync(resolve(fixDir, 'smoke_cover.png'));
const spriteBytes = readFileSync(resolve(fixDir, 'smoke_sprite.png'));
const scriptSrc = `
function _draw()
  error("boom")
end
`.trimStart();
const scriptBytes = new TextEncoder().encode(scriptSrc);

function stage(slot, bytes) {
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    console.error(`stage ${slot} failed`); process.exit(1);
  }
}
stage(0, coverBytes);
stage(1, spriteBytes);
stage(2, scriptBytes);
tb.tb_enc_set_input_len(3, 0);
stage(4, new TextEncoder().encode('luaerr'));
stage(5, new TextEncoder().encode('smoke'));
tb.tb_enc_set_header(1, 0, Math.floor(Date.now() / 1000));
const n = tb.tb_enc_run();
if (n < 0) { console.error(`encode failed: ${n}`); process.exit(1); }
const encoded = new Uint8Array(memoryRef.value.buffer, tb.tb_enc_output_ptr(), n).slice();

// ---- Feed and start ------------------------------------------------------
const feedPtr = tb.tb_feed_buffer_ptr();
for (let i = 0; i < encoded.length; i += 256) {
  const chunk = encoded.subarray(i, Math.min(i + 256, encoded.length));
  new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length).set(chunk);
  if (tb.tb_feed_cartridge(chunk.length) === 0) { console.error(`feed @${i}`); process.exit(1); }
}
if (tb.tb_start() === 0) { console.error('tb_start returned 0'); process.exit(1); }

// _draw hasn't run yet — error buffer should be empty.
if (tb.tb_lua_error_msg_len() !== 0) {
  console.error(`pre-frame error buf non-empty: len=${tb.tb_lua_error_msg_len()}`); process.exit(1);
}

// Run a frame; _draw should error.
tb.tb_loop_once();

function decodeErr() {
  const mlen = tb.tb_lua_error_msg_len();
  const tlen = tb.tb_lua_error_trace_len();
  const msg = mlen ? dec.decode(new Uint8Array(memoryRef.value.buffer, tb.tb_lua_error_msg_ptr(), mlen)) : '';
  const trace = tlen ? dec.decode(new Uint8Array(memoryRef.value.buffer, tb.tb_lua_error_trace_ptr(), tlen)) : '';
  return { msg, trace };
}

const { msg, trace } = decodeErr();
if (!msg.includes('boom')) { console.error(`msg missing 'boom': "${msg}"`); process.exit(1); }
if (!msg.includes('script:')) { console.error(`msg missing 'script:' prefix: "${msg}"`); process.exit(1); }
if (!trace.startsWith('stack traceback:')) { console.error(`trace doesn't start with 'stack traceback:': "${trace}"`); process.exit(1); }
console.log(`smoke_lua_error OK: msg="${msg.trim()}" trace_len=${trace.length}`);

// Engine should now be running the error_screen — display has non-zero pixels.
tb.tb_lua_error_clear();
for (let f = 0; f < 5; f++) tb.tb_loop_once();
const display = new Uint16Array(memoryRef.value.buffer, tb.tb_display_ptr(), 128 * 128);
let nonzero = 0;
for (let i = 0; i < display.length; i++) if (display[i] !== 0) { nonzero++; break; }
if (nonzero === 0) { console.error('error_screen did not produce any non-zero pixels'); process.exit(1); }

// After clear + a clean frame, the error buffer should stay empty (the error_screen is clean).
if (tb.tb_lua_error_msg_len() !== 0) {
  console.error(`post-clear error buf non-empty: len=${tb.tb_lua_error_msg_len()}`); process.exit(1);
}
console.log('smoke_lua_error: error_screen recovery OK');

tb.tb_stop();
```

- [ ] **Step 2: Run it**

```bash
cd /home/mees/git/tinybit-wasm
node scripts/smoke_lua_error.mjs
```

Expected: two `OK` lines, exit 0. If `boom` isn't present, re-check the C-side `emit_lua_error` (Task 3) and the runtime wiring (Task 5). If `script:` isn't in the prefix, the chunk-name change in Task 4 didn't take effect.

---

## Task 12: Smoke — load-time Lua error

**Files:**
- Create: `scripts/smoke_lua_load_error.mjs`

- [ ] **Step 1: Write the load-error smoke test**

Create `/home/mees/git/tinybit-wasm/scripts/smoke_lua_load_error.mjs`. Use the same WASI shim header as `smoke_lua_error.mjs` (copy the entire prelude up through `const tb = instance.exports;`). The body then:

```js
tb.tb_init();
if (tb.tb_enc_init() === 0) { console.error('tb_enc_init failed'); process.exit(1); }

const fixDir = resolve(__dirname, 'fixtures');
const coverBytes  = readFileSync(resolve(fixDir, 'smoke_cover.png'));
const spriteBytes = readFileSync(resolve(fixDir, 'smoke_sprite.png'));
// Syntax error: unclosed paren.
const scriptBytes = new TextEncoder().encode('function _draw(\n');

function stage(slot, bytes) {
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    console.error(`stage ${slot} failed`); process.exit(1);
  }
}
stage(0, coverBytes);
stage(1, spriteBytes);
stage(2, scriptBytes);
tb.tb_enc_set_input_len(3, 0);
stage(4, new TextEncoder().encode('luaload'));
stage(5, new TextEncoder().encode('smoke'));
tb.tb_enc_set_header(1, 0, Math.floor(Date.now() / 1000));
const n = tb.tb_enc_run();
if (n < 0) { console.error(`encode failed: ${n}`); process.exit(1); }
const encoded = new Uint8Array(memoryRef.value.buffer, tb.tb_enc_output_ptr(), n).slice();

const feedPtr = tb.tb_feed_buffer_ptr();
for (let i = 0; i < encoded.length; i += 256) {
  const chunk = encoded.subarray(i, Math.min(i + 256, encoded.length));
  new Uint8Array(memoryRef.value.buffer, feedPtr, chunk.length).set(chunk);
  if (tb.tb_feed_cartridge(chunk.length) === 0) { console.error(`feed @${i}`); process.exit(1); }
}

const started = tb.tb_start();
if (started !== 0) { console.error(`tb_start should fail for syntax error, got ${started}`); process.exit(1); }

const mlen = tb.tb_lua_error_msg_len();
const tlen = tb.tb_lua_error_trace_len();
if (mlen === 0) { console.error('no error message after failed tb_start'); process.exit(1); }
if (tlen !== 0) { console.error(`load error has unexpected traceback len=${tlen}`); process.exit(1); }
const msg = dec.decode(new Uint8Array(memoryRef.value.buffer, tb.tb_lua_error_msg_ptr(), mlen));
if (!msg.includes('script:')) { console.error(`msg missing 'script:': "${msg}"`); process.exit(1); }
console.log(`smoke_lua_load_error OK: "${msg.trim()}"`);
```

- [ ] **Step 2: Run it**

```bash
cd /home/mees/git/tinybit-wasm
node scripts/smoke_lua_load_error.mjs
```

Expected: an OK line with a message like `script:2: '<name>' expected near '<eof>'` (the exact phrasing comes from Lua 5.4 — don't pin it). If `tb_start` returns 1 instead of 0, the load path in Task 4 didn't wire the failure check.

---

## Task 13: Commit Rust wrapper + submodule bump + smoke tests

**Files:** none beyond what was already changed.

- [ ] **Step 1: Inspect what will be committed**

```bash
cd /home/mees/git/tinybit-wasm
git status --short
```

Expected: `M src/bindings.rs`, `M src/lib.rs`, `M src/tinybit` (the gitlink), `?? scripts/smoke_lua_error.mjs`, `?? scripts/smoke_lua_load_error.mjs`.

- [ ] **Step 2: Stage and commit**

```bash
cd /home/mees/git/tinybit-wasm
git add src/bindings.rs src/lib.rs src/tinybit scripts/smoke_lua_error.mjs scripts/smoke_lua_load_error.mjs
git commit -m "$(cat <<'EOF'
expose Lua error message + traceback to the host

bindings, two read-after buffers, five new exports
(tb_lua_error_{msg,trace}_{ptr,len} + tb_lua_error_clear), and two
node smoke tests covering the runtime and load-time paths. Engine
submodule bumped to the commit adding tinybit_error_cb.
EOF
)"
```

---

## Task 14: Editor — `luaError.ts` parser (TDD)

**Files:**
- Create: `editor/src/engine/luaError.ts`
- Create: `editor/src/engine/luaError.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `/home/mees/git/tinybit-wasm/editor/src/engine/luaError.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseLuaError, formatLuaError } from './luaError';

describe('parseLuaError', () => {
    it('extracts line and stripped message from well-formed prefix', () => {
        const err = parseLuaError('script:23: attempt to index a nil value (global \'foo\')', null);
        expect(err.line).toBe(23);
        expect(err.message).toBe('attempt to index a nil value (global \'foo\')');
        expect(err.rawMessage).toBe('script:23: attempt to index a nil value (global \'foo\')');
        expect(err.traceback).toBeNull();
    });

    it('keeps raw message when prefix is missing', () => {
        const err = parseLuaError('(non-string error)', null);
        expect(err.line).toBeNull();
        expect(err.message).toBe('(non-string error)');
        expect(err.rawMessage).toBe('(non-string error)');
    });

    it('preserves traceback verbatim', () => {
        const tb = 'stack traceback:\n\tscript:23: in function \'_draw\'\n\t[C]: in ?';
        const err = parseLuaError('script:23: boom', tb);
        expect(err.traceback).toBe(tb);
    });
});

describe('formatLuaError', () => {
    it('uses "at line N" when line is known', () => {
        const out = formatLuaError({
            line: 23, message: 'boom', rawMessage: 'script:23: boom', traceback: null,
        });
        expect(out).toBe('Lua error at line 23: boom');
    });

    it('omits "at line N" when line is unknown', () => {
        const out = formatLuaError({
            line: null, message: 'mystery', rawMessage: 'mystery', traceback: null,
        });
        expect(out).toBe('Lua error: mystery');
    });

    it('indents the traceback under the headline', () => {
        const out = formatLuaError({
            line: 23, message: 'boom', rawMessage: 'script:23: boom',
            traceback: 'stack traceback:\n\tscript:23: in function \'_draw\'',
        });
        expect(out).toBe(
            'Lua error at line 23: boom\n' +
            '  stack traceback:\n' +
            '    script:23: in function \'_draw\'',
        );
    });
});
```

- [ ] **Step 2: Run the test — should fail (no module yet)**

```bash
cd /home/mees/git/tinybit-wasm/editor
npx vitest run src/engine/luaError.test.ts 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module './luaError'".

- [ ] **Step 3: Implement `luaError.ts`**

Create `/home/mees/git/tinybit-wasm/editor/src/engine/luaError.ts`:

```ts
export interface LuaError {
    line: number | null;
    message: string;
    rawMessage: string;
    traceback: string | null;
}

const PREFIX_RE = /^script:(\d+):\s*/;

export function parseLuaError(rawMessage: string, traceback: string | null): LuaError {
    const m = PREFIX_RE.exec(rawMessage);
    if (m) {
        return {
            line: Number.parseInt(m[1], 10),
            message: rawMessage.slice(m[0].length),
            rawMessage,
            traceback,
        };
    }
    return { line: null, message: rawMessage, rawMessage, traceback };
}

export function formatLuaError(err: LuaError): string {
    const head = err.line !== null
        ? `Lua error at line ${err.line}: ${err.message}`
        : `Lua error: ${err.message}`;
    if (!err.traceback) return head;
    const indented = err.traceback
        .split('\n')
        .map((line) => '  ' + (line.startsWith('\t') ? '  ' + line.slice(1) : line))
        .join('\n');
    return `${head}\n${indented}`;
}
```

- [ ] **Step 4: Run the test — should pass**

```bash
cd /home/mees/git/tinybit-wasm/editor
npx vitest run src/engine/luaError.test.ts 2>&1 | tail -10
```

Expected: 6 passed.

---

## Task 15: Editor — extend `tinybit.ts` with `takeLuaError`

**Files:**
- Modify: `editor/src/engine/tinybit.ts`

- [ ] **Step 1: Extend `TinybitExports`**

Open `/home/mees/git/tinybit-wasm/editor/src/engine/tinybit.ts`. Add to the `TinybitExports` interface (after `tb_audio_ptr`):

```ts
    tb_lua_error_msg_ptr(): number;
    tb_lua_error_msg_len(): number;
    tb_lua_error_trace_ptr(): number;
    tb_lua_error_trace_len(): number;
    tb_lua_error_clear(): void;
```

- [ ] **Step 2: Extend `Tinybit` interface and impl**

Add to the `Tinybit` interface (after `audioView`):

```ts
    takeLuaError(): { message: string; traceback: string | null } | null;
```

Add to the `makeTinybit` return object (after `audioView`):

```ts
        takeLuaError() {
            const mlen = ex.tb_lua_error_msg_len();
            if (mlen === 0) return null;
            const message = new TextDecoder().decode(
                new Uint8Array(ex.memory.buffer, ex.tb_lua_error_msg_ptr(), mlen),
            );
            const tlen = ex.tb_lua_error_trace_len();
            const traceback = tlen > 0
                ? new TextDecoder().decode(
                    new Uint8Array(ex.memory.buffer, ex.tb_lua_error_trace_ptr(), tlen),
                )
                : null;
            ex.tb_lua_error_clear();
            return { message, traceback };
        },
```

- [ ] **Step 3: Type-check the editor**

```bash
cd /home/mees/git/tinybit-wasm/editor
npx tsc --noEmit
```

Expected: success.

---

## Task 16: Editor — wire `onLuaError` in `frameLoop.ts`

**Files:**
- Modify: `editor/src/engine/frameLoop.ts`

- [ ] **Step 1: Add the parsed error type import and callback shape**

At the top of `/home/mees/git/tinybit-wasm/editor/src/engine/frameLoop.ts`, add:

```ts
import { parseLuaError, type LuaError } from './luaError';
```

Update the `FrameLoop` interface to include:

```ts
    onLuaError(cb: (err: LuaError) => void): () => void;
```

- [ ] **Step 2: Add the callback set and emit after `loopOnce`**

In `makeFrameLoop`, near the existing `errCbs` line, add:

```ts
    const luaErrCbs = new Set<(e: LuaError) => void>();
```

Update the `tick` function to poll for the Lua error after `tb.loopOnce()`:

```ts
    function tick(canvas: HTMLCanvasElement) {
        if (state !== 'running') return;
        try {
            tb.loopOnce();
            const raw = tb.takeLuaError();
            if (raw) {
                const parsed = parseLuaError(raw.message, raw.traceback);
                luaErrCbs.forEach((cb) => cb(parsed));
            }
            blit(canvas);
            pumpAudio();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errCbs.forEach((cb) => cb(msg));
            setState('error');
            return;
        }
        raf = requestAnimationFrame(() => tick(canvas));
    }
```

Add to the returned object (after `onError`):

```ts
        onLuaError(cb) { luaErrCbs.add(cb); return () => luaErrCbs.delete(cb); },
```

- [ ] **Step 3: Type-check**

```bash
cd /home/mees/git/tinybit-wasm/editor
npx tsc --noEmit
```

Expected: success.

---

## Task 17: Editor — wire `onLuaError` in `App.tsx`

**Files:**
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: Import `formatLuaError`**

Open `/home/mees/git/tinybit-wasm/editor/src/App.tsx`. Find the existing imports near the top — add:

```ts
import { formatLuaError } from './engine/luaError';
```

- [ ] **Step 2: Subscribe to `onLuaError` where `onError` is subscribed today**

Find the existing `fl.onError((msg) => consoleAppend('error', msg));` line (around line 103). Immediately after it, add:

```ts
fl.onLuaError((err) => consoleAppend('error', formatLuaError(err)));
```

- [ ] **Step 3: Also poll after `tb.start()`**

Find the place where `tb.start()` is called in the run/play handler (search for `tb.start()` in `App.tsx`). Immediately after the call, add:

```ts
const startErr = runtime!.tinybit.takeLuaError();
if (startErr) consoleAppend('error', formatLuaError(parseLuaError(startErr.message, startErr.traceback)));
```

Add `parseLuaError` to the import line:

```ts
import { formatLuaError, parseLuaError } from './engine/luaError';
```

Notes for the implementer:
- The exact place to insert this depends on which handler currently invokes `tb.start()` — look for `Engine failed to start` to find it. If the throw is wrapped in a try/catch, the polling line should be inside the `try` block immediately after `tb.start()` so it surfaces the *Lua* error (rather than the JS `throw new Error('Engine failed to start')`). If `tb.start()` throws, the catch block already routes through `consoleAppend('error', …)` — but with the new wiring the Lua error is now also available; surface it explicitly so the user sees the actionable text, not the generic "Engine failed to start".

Concrete shape:

```ts
try {
    runtime.tinybit.start();
    // ... existing code
} catch (e) {
    const startErr = runtime.tinybit.takeLuaError();
    if (startErr) consoleAppend('error', formatLuaError(parseLuaError(startErr.message, startErr.traceback)));
    else consoleAppend('error', e instanceof Error ? e.message : String(e));
    return;
}
```

- [ ] **Step 4: Type-check + lint**

```bash
cd /home/mees/git/tinybit-wasm/editor
npx tsc --noEmit
```

Expected: success.

---

## Task 18: Editor — run all editor tests

**Files:** none.

- [ ] **Step 1: Run vitest**

```bash
cd /home/mees/git/tinybit-wasm/editor
npm test -- --run
```

Expected: all pass, including the new `luaError.test.ts`.

- [ ] **Step 2: Run the Playwright smoke**

```bash
cd /home/mees/git/tinybit-wasm/editor
npm run test:e2e
```

Expected: existing scenarios pass — we haven't touched the happy path. If it fails for unrelated reasons (e.g., port conflict), retry once and then investigate.

---

## Task 19: Manual editor verification

**Files:** none — interactive.

- [ ] **Step 1: Boot the dev server**

```bash
cd /home/mees/git/tinybit-wasm
./scripts/dev.sh
```

Wait for `Local: http://localhost:5173/`.

- [ ] **Step 2: In the browser, paste a runtime-erroring script and play it**

In the **script** tab, replace the contents with:

```lua
function _draw()
  error("boom")
end
```

Click **▶ Play**. Open the **console** tab.

Expected on the `error` source: a multi-line entry starting `Lua error at line 2: boom`, followed by an indented `stack traceback:` block.

On the canvas: the engine's error screen renders (same as today).

- [ ] **Step 3: Paste a syntax-erroring script and play it**

Replace the script with:

```lua
function _draw(
```

Click **▶ Play**.

Expected: a `Lua error at line N: …` entry on the `error` source (where N points to the unfinished line; Lua 5.4 reports the EOF position). No canvas update (the engine never started).

- [ ] **Step 4: Stop the dev server**

`Ctrl-C` in the dev server terminal.

---

## Task 20: Final commit + sanity sweep

**Files:** none beyond what was already changed.

- [ ] **Step 1: Inspect status in both repos**

```bash
git -C /home/mees/git/tinybit-wasm status --short
git -C /home/mees/git/tinybit-wasm/src/tinybit status --short
```

Expected: parent has `M editor/src/App.tsx`, `M editor/src/engine/frameLoop.ts`, `M editor/src/engine/tinybit.ts`, `?? editor/src/engine/luaError.test.ts`, `?? editor/src/engine/luaError.ts`. Submodule should be clean.

- [ ] **Step 2: Commit the editor changes**

```bash
cd /home/mees/git/tinybit-wasm
git add editor/src/engine/luaError.ts editor/src/engine/luaError.test.ts \
        editor/src/engine/tinybit.ts editor/src/engine/frameLoop.ts \
        editor/src/App.tsx
git commit -m "$(cat <<'EOF'
editor: render Lua load + runtime errors in the console

Polls the new tb_lua_error_* exports after tb_start and each
tb_loop_once, parses the "script:NN:" prefix into a structured
LuaError, and routes it through consoleAppend('error', …) with the
traceback indented under the headline. Existing engineState stays
'running' on Lua errors — the engine continues into its in-canvas
error_screen.
EOF
)"
```

- [ ] **Step 3: Re-run the full smoke suite from a clean build**

```bash
cd /home/mees/git/tinybit-wasm
./scripts/build.sh
node scripts/smoke.mjs
node scripts/smoke_encoder.mjs
node scripts/smoke_decoder.mjs
node scripts/smoke_lua_error.mjs
node scripts/smoke_lua_load_error.mjs
```

Expected: all five pass.

- [ ] **Step 4: Report**

Summary line to the user: "Done. Engine + wrapper + editor all on `feat/lua-error-surfacing`; X commits in the parent, Y in the submodule, all smoke tests pass." Do not push or open a PR unless the user asks.

---

## Notes for the implementer

- **Don't push.** The user will push or PR when ready.
- **Don't amend.** Each task that says "commit" should produce a fresh commit. There are three commit points: engine (Task 6), wrapper + submodule + smoke (Task 13), editor (Task 20). Total = 3 parent commits + 1 submodule commit.
- **If a smoke test fails**, the message will usually tell you exactly which assertion failed. Don't add error handling to mask it — the assertion is the contract. Fix the C or Rust code, rebuild, re-run.
- **The C engine doesn't need a Lua test harness** beyond the wasm smoke tests. Building wasm + running the smoke tests exercises every line of the new C code.
