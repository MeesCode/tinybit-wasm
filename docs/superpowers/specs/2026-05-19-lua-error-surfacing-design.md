# Lua error surfacing

**Date:** 2026-05-19
**Scope:** Make Lua load-time and runtime errors visible in the editor with the line number, the Lua error message, and a stack traceback. Today the engine catches both kinds of failure, discards the message, and only logs the literal string `"[TinyBit] Lua error"`.

## Motivation

When a cartridge throws (`nil:foo()`, `error("…")`, syntax error, etc.) the editor shows only:

```
[TinyBit] Lua error
```

— no message, no line number, no traceback. The on-canvas `error_screen` confirms _that_ something went wrong but says nothing about _what_. Authoring a cartridge today means switching to a native build to actually read the error, which defeats the purpose of the in-browser editor.

The Lua error string is already on the stack at the point of failure in `tinybit.c` (lines 68 and 125) — it's just popped without ever being read. The fix is plumbing, not new functionality: capture it, run it through `luaL_traceback` for the runtime case, hand it to the host via a new callback, and render it in the existing `ConsolePane`.

## Non-goals

- **Editor gutter markers** on the offending line. The callback payload carries `line` so a future change can show inline markers without touching the engine or wrapper — but the gutter UI itself is out of scope for this spec.
- **Resuming after a runtime error.** Once `lua_pcall` returns non-OK the coroutine is unwound. The current C-side behaviour of `audio_stop_all()` → swap script to `error_screen` → `tinybit_restart()` is preserved verbatim. The new callback is *additive* — it only adds host-visible reporting; canvas behaviour does not change.
- **Lua syntax-error column numbers.** Lua only reports the line.
- **Source maps** or anything that would let cartridge authors split a script across files.

## Decisions

| | |
|---|---|
| Engine callback | New `tinybit_error_cb(void (*)(const char* message, const char* traceback))` in `tinybit.h`, mirroring the existing `tinybit_log_cb` shape. `traceback` is `NULL` for load-time errors (no stack), non-NULL for runtime errors. Distinct from `log_func` so editor prints don't conflate with errors. |
| Chunk name | `tinybit_start` switches from `luaL_dostring` to `luaL_loadbuffer(L, script, len, "script")` followed by `lua_pcall`, so error prefixes read `script:23: …` instead of `[string "function _init()…"]:23: …`. |
| Runtime traceback | The runtime `lua_pcall` in `tinybit_loop` gets a C message handler that calls `luaL_traceback(L, L, msg, 1)`, producing a Lua-formatted multi-frame trace. |
| Engine-state semantics | `FrameLoopState` stays `'running'` after a Lua error — the engine *is* still running (the error screen). The existing `'error'` state remains reserved for fatal wasm traps. |
| Wasm → JS transport | Read-after-call buffers, matching the existing encoder/decoder pattern (`tb_enc_error_ptr/len`). Two buffers — `tb_lua_error_msg_ptr/len` and `tb_lua_error_trace_ptr/len` — plus `tb_lua_error_clear`. JS polls after each `tb_start` and `tb_loop_once`. No new wasm import is added. |
| Console rendering | Single multi-line entry on `ConsolePane`'s `error` source. Format below. |
| Buffer caps | Message buffer 4 KiB, traceback buffer 16 KiB. Lua errors that exceed are truncated with a trailing `…` — they're a debugging aid, not a contract. |
| Engine restart behaviour | Unchanged. `audio_stop_all()` → overwrite `script` with `error_screen` → `tinybit_restart()`. The error callback fires *before* this restart so the host sees the original error, not the (clean) reload of the error screen. |

## Architecture

```
+---------------------------+
|  Lua VM                   |
|   pcall fails -+----------+----- error string on stack
+---------------+|----------+
                v
+---------------------------+        tinybit_error_cb
|  tinybit.c                |   -------------------------->  Rust error_cb
|   captures msg + trace    |                                  copies into
|   then keeps current      |                                  per-thread
|   error_screen restart    |                                  Vec<u8> buffers
+---------------------------+
                                                            +-------------+
                                                            | tb_lua_     |
                                                            |  error_*    |
                                                            |  exports    |
                                                            +------+------+
                                                                   |
                                                            JS reads
                                                            after tb_start /
                                                            tb_loop_once
                                                                   |
                                                                   v
                                                            tinybit.ts emits
                                                            { line, message,
                                                              traceback }
                                                                   |
                                                                   v
                                                            App.tsx →
                                                            consoleAppend('error', …)
```

The traceback returned by `luaL_traceback` looks like:

```
script:23: attempt to index a nil value (global 'foo')
stack traceback:
	[C]: in ?
	script:23: in function '_draw'
	[C]: in ?
```

## Changes

### C engine (`src/tinybit/`)

1. **`tinybit.h`** — declare:
   ```c
   void tinybit_error_cb(void (*error_func_ptr)(const char* message, const char* traceback));
   ```
2. **`tinybit.c`** —
   - Add static `void (*error_func)(const char*, const char*) = NULL;` plus the registration setter.
   - Helper `static void emit_lua_error(lua_State* L, int trace)` that:
     - Reads `lua_tostring(L, -1)` into a stack-local buffer.
     - If `trace` is non-zero, also reads the traceback (which the message handler pre-formatted into the same string — see below).
     - If `error_func` is set, invokes it.
     - Pops the error message (preserving current stack-discipline behaviour).
   - `tinybit_start`: change `luaL_dostring(L, script)` into
     ```c
     if (luaL_loadbuffer(L, (char*)tinybit_memory->script, strlen((char*)tinybit_memory->script), "script") != LUA_OK
         || lua_pcall(L, 0, 0, 0) != LUA_OK) {
         emit_lua_error(L, /*trace=*/0);
         return false;
     }
     ```
     (Load errors are reported without a traceback — there is no Lua stack yet.)
   - `tinybit_loop` runtime path: push a small C message handler before `lua_pcall`:
     ```c
     static int err_msgh(lua_State* L) {
         const char* msg = lua_tostring(L, 1);
         if (!msg) msg = "(non-string error)";
         luaL_traceback(L, L, msg, 1);
         return 1;
     }
     ```
     Sequence: push `err_msgh` (record its stack index `msgh_idx`), push the `_draw` global, then `lua_pcall(L, 0, 1, msgh_idx)`. On failure invoke `emit_lua_error(L, /*trace=*/1)`. Pop the message handler from the stack after the call regardless of outcome. The handler returns a single string of the form `<msg>\nstack traceback:\n<frames…>`.

   `emit_lua_error` does the split itself, in C: it scans the stack-top string for the first occurrence of `"\nstack traceback:"`, copies the prefix into a stack-local `msg` buffer and the remainder (skipping the leading newline) into a `trace` buffer, then calls `error_func(msg, trace)`. For the load path (`trace=0`) it calls `error_func(msg, NULL)` and skips the split. `lua_tostring` returning `NULL` (non-string error value) is replaced with the literal `"(non-string error)"` before the callback fires.

3. **`error_screen` restart** stays exactly as it is — the new `emit_lua_error` call happens *before* the existing `strcpy(...)` + `tinybit_restart()`.

4. **Recursion guard:** `tinybit_restart()` calls `tinybit_start()`, which now uses the new path. The error-screen script is hand-written and clean, so the new path will succeed and `emit_lua_error` will not fire. No guard needed, but a code comment notes the assumption.

### Rust wrapper (`src/lib.rs`, `src/bindings.rs`)

1. **`bindings.rs`** — declare the new C function:
   ```rust
   pub fn tinybit_error_cb(
       error_func_ptr: Option<unsafe extern "C" fn(*const c_char, *const c_char)>,
   );
   ```
2. **`State`** gains two fields:
   ```rust
   lua_error_msg:   Vec<u8>,
   lua_error_trace: Vec<u8>,
   ```
3. **`error_cb`** in `lib.rs`:
   ```rust
   unsafe extern "C" fn error_cb(msg: *const c_char, trace: *const c_char) {
       STATE.with(|cell| {
           let Some(state) = cell.borrow_mut().as_mut() else { return };
           state.lua_error_msg.clear();
           state.lua_error_trace.clear();
           if !msg.is_null() {
               let bytes = CStr::from_ptr(msg).to_bytes();
               let take = bytes.len().min(MAX_LUA_ERROR_MSG);
               state.lua_error_msg.extend_from_slice(&bytes[..take]);
           }
           if !trace.is_null() {
               let bytes = CStr::from_ptr(trace).to_bytes();
               let take = bytes.len().min(MAX_LUA_ERROR_TRACE);
               state.lua_error_trace.extend_from_slice(&bytes[..take]);
           }
       });
   }
   ```
   Registered alongside `tinybit_log_cb` in `tb_init`.
4. **New exports**, following the encoder error pattern:
   ```rust
   pub extern "C" fn tb_lua_error_msg_ptr() -> *const u8 { … }
   pub extern "C" fn tb_lua_error_msg_len() -> u32 { … }
   pub extern "C" fn tb_lua_error_trace_ptr() -> *const u8 { … }
   pub extern "C" fn tb_lua_error_trace_len() -> u32 { … }
   pub extern "C" fn tb_lua_error_clear() { /* both bufs */ }
   ```
   Constants: `MAX_LUA_ERROR_MSG = 4096`, `MAX_LUA_ERROR_TRACE = 16384`.

### Editor (`editor/src/engine/`, `editor/src/`)

1. **`tinybit.ts`** — extend the `Tinybit` interface and impl:
   ```ts
   takeLuaError(): { message: string; traceback: string | null } | null;
   ```
   Reads the four pointers/lens; if `msg_len === 0` returns `null`; otherwise copies and `tb_lua_error_clear()`s.
2. **`frameLoop.ts`** —
   - Add `onLuaError(cb: (err: LuaError) => void): () => void`.
   - After `tb.loopOnce()` (and after `tb_start` in `App.tsx` — see below), call `tb.takeLuaError()`; if non-null, parse, invoke callbacks.
   - Do **not** transition `FrameLoopState`. The engine keeps running into the error screen.
3. **Error parser** in `editor/src/engine/luaError.ts` (new file):
   ```ts
   export interface LuaError {
       line: number | null;   // parsed from the "script:NN:" prefix; null if absent
       message: string;        // the message with the "script:NN: " prefix stripped
       rawMessage: string;     // the full Lua message as emitted, for fallback display
       traceback: string | null; // raw traceback as emitted, with "stack traceback:\n" prefix stripped
   }
   export function parseLuaError(message: string, traceback: string | null): LuaError;
   ```
   Parser strips the leading `script:NN:` (regex `^script:(\d+):\s*`) and any `[string "…"]:` noise from traceback frames in case `luaL_traceback` falls back to them (e.g., for built-in standard-lib lookups).
4. **`App.tsx`** —
   - Subscribe to `fl.onLuaError(err => consoleAppend('error', formatLuaError(err)))`.
   - After `tb.start()` (the `Play` button path in `runCartridge`), call `tb.takeLuaError()` once; if present, emit through the same path.
   - `formatLuaError` produces e.g.:
     ```
     Lua error at line 23: attempt to index a nil value (global 'foo')
       stack traceback:
         script:23: in function '_draw'
     ```
     If `line` is `null`, the first line drops `at line N`.

### Smoke tests (`scripts/`)

- **`scripts/smoke_lua_error.mjs`** (new) — encode a tiny cartridge whose `_draw` calls `error("boom")`. Boot, run one frame, then call `tb_lua_error_msg_len()`. Assert non-zero, read the message, assert it contains `boom` and `:1:`-ish line marker. Run a second frame and confirm the engine recovered into the error_screen (display has non-zero pixels — the same check `scripts/smoke.mjs` already does).
- **`scripts/smoke_lua_load_error.mjs`** (new) — encode a cartridge whose script is `function _draw( -- broken syntax`. Boot, call `tb_start`, assert it returns `0`, assert the lua error buffer contains `script:` and a syntax-error fragment.

### Editor tests

- **`editor/src/engine/luaError.test.ts`** — pure-function unit test for `parseLuaError`. Covers: well-formed `script:23: foo`, no prefix (`(non-string error)`), traceback splitting, fallback when neither matches.
- **`editor/tests/play.spec.ts`** (existing Playwright file, extended) — paste `function _draw() error("boom") end`, click Play, assert the console contains "Lua error" and "boom" within ~1 s.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Engine submodule diverges from upstream. | The C-side change is small and localised to `tinybit.c` + the new declaration in `tinybit.h`. Document the new callback in the submodule's README so future merges treat it as part of the public API. |
| Traceback strings include literal tab characters and embedded newlines. | The console pane already renders newlines (existing `print()` output goes through `log_cb`). Tabs render as whitespace. No special handling required. |
| Recursion: error-screen script itself errors → infinite re-fire. | The `error_screen` script is hardcoded in `lua_scripts.h`; treat it as part of the engine contract. A code comment in `tinybit.c` documents the assumption. |
| Truncation hides relevant traceback frames. | 16 KiB holds ~150 frames at typical Lua formatting. Cartridges are 32 KiB scripts; pathological recursion depth would already crash the wasm stack first. |
| `print()` and errors are no longer indistinguishable in the console. | Intentional — `print()` stays on the `engine` source (via `log_cb` → stderr), errors land on the `error` source (red). The user asked for this separation implicitly via "currently I can only see *that* there is an error". |

## Out-of-scope follow-ups

- **Gutter markers.** The `LuaError.line` field is the only data needed; a future change subscribes to `fl.onLuaError` in the script-tab component and adds a marker at `line` with `message` as a tooltip. No engine or wrapper change required at that point.
- **Click-to-jump from the console.** If the console grows clickable entries, the same `LuaError` payload can move the editor caret.
- **Surfacing the underlying error source for `error_screen` itself.** Today only one error is reported — the original. If the error_screen itself errored we'd silently fall through to a blank canvas. Acceptable for now; covered by the "error_screen is part of the engine contract" assumption.

## Acceptance criteria

A cartridge with `function _draw() error("boom") end`, run via the editor's Play button, produces a console entry on the `error` source containing both `boom` and the line number, within one frame of the failure. The canvas continues to render (showing the `error_screen`). A cartridge with a syntax error produces a console entry on the `error` source identifying the failing line before any frame ticks.
