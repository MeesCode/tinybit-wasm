# TinyBit header-in-memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 146-byte cartridge header into `struct TinyBitMemory` at offset 0, shrink `script[]` by 146 to keep total memory size unchanged, mirror the change in the Rust FFI struct, and re-derive the encoder's `SCRIPT_MAX` from the engine constant. Wire format stays identical.

**Architecture:** Two-repo atomic change. Engine submodule (`MeesCode/TinyBit-lib` at `src/tinybit/`) gets a single commit that touches `tinybit.h` (struct + constants) and `cartridge.c` (writes headers into memory; adds defensive NUL terminator). Parent repo (`tinybit-wasm`) gets one commit that bumps the submodule pointer, updates `src/bindings.rs` offset assertions, and switches `SCRIPT_MAX` to a derived expression. Compile-time `offset_of!` assertions in `bindings.rs` are the drift guard.

**Tech Stack:** C (engine, compiled by `cc` and via `build.rs` for wasm32-wasip1), Rust 1.95+ targeting wasm32-wasip1, `cargo test` for unit tests, Node-based smoke tests (`scripts/smoke.mjs`, `scripts/smoke_encoder.mjs`).

**Spec:** `docs/superpowers/specs/2026-05-11-tinybit-header-in-memory-design.md`

---

## File map

**Engine submodule (`src/tinybit/`):**
- Modify: `src/tinybit/tinybit.h` — add `header[TB_HEADER_SIZE]` field at top of `struct TinyBitMemory`, redefine `TB_MEM_SCRIPT_SIZE` to `32 * 1024 - TB_HEADER_SIZE`, remove `TB_MEM_CARTRIDGE_SCRIPT_SIZE`.
- Modify: `src/tinybit/cartridge.c` — remove `static uint8_t header_bytes[]`; `parse_and_log_header` reads from `tinybit_memory->header`; `decode_pixel_load_game` writes header bytes into memory; `cartridge_feed` ensures `script[TB_MEM_SCRIPT_SIZE-1] = '\0'`.

**Parent repo (`tinybit-wasm`):**
- Modify (via submodule bump): `src/tinybit` pointer.
- Modify: `src/bindings.rs` — add `TB_HEADER_SIZE`, redefine `TB_MEM_SCRIPT_SIZE`, add `header` field, update all `offset_of!` assertions.
- Modify: `src/encoder/mod.rs` — `SCRIPT_MAX` derived from `crate::bindings::TB_MEM_SCRIPT_SIZE - 1`.

**No new files. No deletions. No test fixtures need regenerating.**

---

## Working directory & branch policy

All engine work is on the `src/tinybit` submodule's `main` branch (same policy used for the prior `lua_pool_reset` fix). Parent-repo work is on parent `main`. The engine commit must land on `MeesCode/TinyBit-lib` before the parent commit is created — otherwise the parent `git submodule update` can't fetch the new SHA.

If the submodule's `HEAD` is detached when you start, switch to `main` first (`git checkout main` inside `src/tinybit/`).

---

## Task 1: Engine — struct layout in `tinybit.h`

**Files:**
- Modify: `src/tinybit/tinybit.h` (struct definition lines 29–62, constants lines 40–50)

**Goal of this task:** Make the C struct match the new layout. Compiles cleanly with no other changes because `cartridge.c` still owns header bytes in its own static buffer.

- [ ] **Step 1: Switch the submodule to `main` if detached**

```bash
cd src/tinybit
git status   # check if "HEAD detached"
git checkout main
git pull --ff-only origin main
cd ../..
```
Expected: `main` is checked out, fast-forwarded to `origin/main`.

- [ ] **Step 2: Update `TB_MEM_SCRIPT_SIZE` and remove `TB_MEM_CARTRIDGE_SCRIPT_SIZE`**

Edit `src/tinybit/tinybit.h`, replace these two lines (currently lines 43–44):

```c
#define TB_MEM_SCRIPT_SIZE          (32 * 1024) // 32Kb
#define TB_MEM_CARTRIDGE_SCRIPT_SIZE (TB_MEM_SCRIPT_SIZE - TB_HEADER_SIZE) // script bytes that fit alongside header on a cartridge
```

with:

```c
#define TB_MEM_SCRIPT_SIZE          (32 * 1024 - TB_HEADER_SIZE) // 32622 bytes; matches cartridge script payload
```

- [ ] **Step 3: Add the `header` field to `struct TinyBitMemory`**

Edit `src/tinybit/tinybit.h`, the `struct TinyBitMemory` block (currently lines 52–62). New version:

```c
struct TinyBitMemory {
    uint8_t  header[TB_HEADER_SIZE];
    uint16_t spritesheet[TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT];
    uint16_t display[TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT];
    uint8_t  script[TB_MEM_SCRIPT_SIZE];
    uint8_t  lua_state[TB_MEM_LUA_STATE_SIZE];
    uint8_t  audio_data[TB_MEM_AUDIO_DATA_SIZE];
    uint8_t  pngle_data[TB_MEM_PNGLE_SIZE];
    int16_t  audio_buffer[TB_AUDIO_FRAME_SAMPLES];
    uint8_t  button_input[TB_MEM_BUTTON_INPUT_SIZE];
    uint8_t  user[TB_MEM_USER_SIZE];
};
```

- [ ] **Step 4: Verify the engine still compiles**

```bash
cd src/tinybit
cc -c -Wall -Wextra -Werror -I. -Ilua cartridge.c -o /tmp/cartridge.o
cc -c -Wall -Wextra -Werror -I. -Ilua tinybit.c -o /tmp/tinybit.o
cd ../..
```
Expected: both compile clean. No warnings. (The existing `cartridge.c` still references `static uint8_t header_bytes[TB_HEADER_SIZE]` — that's fine, it's its own array.)

- [ ] **Step 5: Stage and hold (do NOT commit yet)** — we'll bundle this with Task 2 as one engine commit.

---

## Task 2: Engine — rewire `cartridge.c` to use the new header field

**Files:**
- Modify: `src/tinybit/cartridge.c` (top-of-file static, `parse_and_log_header`, `decode_pixel_load_game`, `cartridge_reset`, `cartridge_feed`)

**Goal of this task:** Cartridge decoder writes header bytes directly into `tinybit_memory->header`; the file-scope `header_bytes[]` static goes away; `cartridge_feed` defends `luaL_dostring` by force-NUL-terminating the script tail.

- [ ] **Step 1: Remove the `header_bytes` static**

Edit `src/tinybit/cartridge.c`, remove this line (currently line 23):

```c
static uint8_t header_bytes[TB_HEADER_SIZE];
```

Leave the parsed-cache static and flag (lines 24–25) untouched:

```c
static struct TinyBitHeader header;
static bool header_parsed = false;
```

- [ ] **Step 2: Rewrite `parse_and_log_header` to read from memory**

Replace the field-read section of `parse_and_log_header` (currently lines 44–54). New version of just the parsing block:

```c
static void parse_and_log_header(void) {
    const uint8_t* h = tinybit_memory->header;
    header.format_version = read_u16_le(&h[0]);
    header.flags          = read_u16_le(&h[2]);
    header.script_size    = read_u32_le(&h[4]);
    header.checksum       = read_u32_le(&h[8]);
    memcpy(header.title,   &h[12], TB_HEADER_TITLE_SIZE);
    memcpy(header.author,  &h[76], TB_HEADER_AUTHOR_SIZE);
    header.title[TB_HEADER_TITLE_SIZE - 1]   = '\0';
    header.author[TB_HEADER_AUTHOR_SIZE - 1] = '\0';
    header.game_version = read_u16_le(&h[140]);
    header.package_date = read_u32_le(&h[142]);

    // … logging block below stays unchanged
```

Keep everything from `if (!log_func) return;` onward (lines 56–75) as it is.

- [ ] **Step 3: Update `decode_pixel_load_game` to write headers into memory**

In `src/tinybit/cartridge.c`, replace the header-write branch (currently lines 86–95). New version of the branch:

```c
    // header (first TB_HEADER_SIZE pixels) — written directly into memory
    if (cartridge_index < TB_HEADER_SIZE) {
        tinybit_memory->header[cartridge_index] = decoded;
        cartridge_index++;
        if (cartridge_index == TB_HEADER_SIZE && !header_parsed) {
            parse_and_log_header();
            header_parsed = true;
        }
        return;
    }
```

Leave the spritesheet / script branches below (lines 97–112) unchanged — the `script_offset < TB_MEM_SCRIPT_SIZE` check now bounds on the new 32 622-byte limit, which is exactly the cartridge script payload size; the trailing NUL pixel from the cartridge gets dropped here and re-applied by `cartridge_feed` (Step 5).

- [ ] **Step 4: Update `cartridge_reset` to drop the `header_bytes` memset**

Edit `cartridge_reset` (currently lines 204–209). New version:

```c
void cartridge_reset(void) {
    cartridge_index = 0;
    header_parsed = false;
    memset(&header, 0, sizeof(header));
    // Header bytes in tinybit_memory->header are zeroed by memory_init()
    // on the next tinybit_init and overwritten by the next cartridge feed.
}
```

- [ ] **Step 5: Add the NUL-terminator guard to `cartridge_feed`**

Replace `cartridge_feed` (currently lines 211–213). New version:

```c
bool cartridge_feed(const uint8_t* buffer, size_t size) {
    int rc = pngle_feed(pngle, buffer, size);
    // Defend luaL_dostring against an over-eager encoder: ensure the
    // script region is always NUL-terminated regardless of what just
    // got written into tinybit_memory->script.
    tinybit_memory->script[TB_MEM_SCRIPT_SIZE - 1] = '\0';
    return rc != -2;
}
```

- [ ] **Step 6: Verify everything compiles**

```bash
cd src/tinybit
cc -c -Wall -Wextra -Werror -I. -Ilua cartridge.c -o /tmp/cartridge.o
cc -c -Wall -Wextra -Werror -I. -Ilua tinybit.c -o /tmp/tinybit.o
cc -c -Wall -Wextra -Werror -I. -Ilua memory.c -o /tmp/memory.o
cc -c -Wall -Wextra -Werror -I. -Ilua lua_pool.c -o /tmp/lua_pool.o
cd ../..
```
Expected: all four translation units compile clean, zero warnings. (`memory.c` and `lua_pool.c` are included to catch any indirect impact on the rest of the engine.)

- [ ] **Step 7: Commit the engine change**

```bash
cd src/tinybit
git add tinybit.h cartridge.c
git commit -m "$(cat <<'EOF'
store cartridge header in TinyBitMemory

Move the 146-byte cartridge header from a file-scope static in
cartridge.c into a real field at offset 0 of struct TinyBitMemory,
and shrink script[] by 146 bytes so total memory size is unchanged.
The wire format is identical; format_version stays at 1.

Adds a defensive NUL-terminator at script[TB_MEM_SCRIPT_SIZE-1] on
every cartridge_feed so luaL_dostring stays safe even if an encoder
writes past the cap (Rust encoder already caps at SCRIPT_MAX = 32621).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
cd ../..
```
Expected: one new commit on submodule `main`, working tree clean.

- [ ] **Step 8: Push the engine commit**

```bash
cd src/tinybit
git push origin main
cd ../..
```
Expected: push succeeds, `origin/main` advanced.

- [ ] **Step 9: Capture the new submodule SHA for the parent commit**

```bash
cd src/tinybit
git rev-parse HEAD
cd ../..
```
Expected: a 40-char SHA. Note it — the parent commit will reference it.

---

## Task 3: Parent repo — verify the failing test (compile-time offset assertion)

**Files:**
- Verify: `src/bindings.rs` (no edits yet)

**Goal of this task:** With the new engine SHA pinned in the submodule, the existing `bindings.rs` offset assertions become wrong. Build the parent crate and observe the failure — this is our pre-test "red" state.

- [ ] **Step 1: Confirm the submodule pointer needs no `git submodule update`**

The previous tasks left `src/tinybit` already at the new SHA in your working tree. From the parent repo:

```bash
git status
```
Expected: shows `modified:   src/tinybit (new commits)` — meaning the parent index still references the OLD SHA, but the working tree is on the NEW SHA. That mismatch is the staged change for Task 6.

- [ ] **Step 2: Run cargo build and confirm offset assertions fail**

```bash
cargo build --target wasm32-wasip1 --release 2>&1 | tail -40
```
Expected: build fails with something like `evaluation of constant value failed` or `assertion failed` referencing one of the `assert!(offset_of!(...))` lines in `src/bindings.rs`. The error pinpoints exactly the layout drift we need to fix.

If instead the build succeeds, **stop and investigate** — that means the engine struct didn't actually change layout, which contradicts the spec.

---

## Task 4: Parent repo — update `bindings.rs` to the new layout

**Files:**
- Modify: `src/bindings.rs`

**Goal of this task:** Bring the Rust mirror of `TinyBitMemory` into sync with the new C struct so the compile-time assertions pass.

- [ ] **Step 1: Add `TB_HEADER_SIZE` constant**

Edit `src/bindings.rs`. After the existing `pub const TB_AUDIO_FRAME_SAMPLES: usize = 367;` line, add:

```rust
pub const TB_HEADER_SIZE: usize = 146;
```

- [ ] **Step 2: Redefine `TB_MEM_SCRIPT_SIZE`**

Replace the current line (line 20):

```rust
pub const TB_MEM_SCRIPT_SIZE: usize = 32 * 1024;
```

with:

```rust
pub const TB_MEM_SCRIPT_SIZE: usize = 32 * 1024 - TB_HEADER_SIZE;
```

- [ ] **Step 3: Add `header` field to the struct**

Edit the `struct TinyBitMemory` block (currently lines 42–53). New version:

```rust
#[repr(C)]
pub struct TinyBitMemory {
    pub header:       [u8;  TB_HEADER_SIZE],
    pub spritesheet:  [u16; TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT],
    pub display:      [u16; TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT],
    pub script:       [u8;  TB_MEM_SCRIPT_SIZE],
    pub lua_state:    [u8;  TB_MEM_LUA_STATE_SIZE],
    pub audio_data:   [u8;  TB_MEM_AUDIO_DATA_SIZE],
    pub pngle_data:   [u8;  TB_MEM_PNGLE_SIZE],
    pub audio_buffer: [i16; TB_AUDIO_FRAME_SAMPLES],
    pub button_input: [u8;  TB_MEM_BUTTON_INPUT_SIZE],
    pub user:         [u8;  TB_MEM_USER_SIZE],
}
```

- [ ] **Step 4: Update the offset assertions**

Edit the `const _: () = { … };` block (currently lines 57–69). New version:

```rust
const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(TinyBitMemory, header)       == 0);
    assert!(offset_of!(TinyBitMemory, spritesheet)  == 146);
    assert!(offset_of!(TinyBitMemory, display)      == 32_914);
    assert!(offset_of!(TinyBitMemory, script)       == 65_682);
    assert!(offset_of!(TinyBitMemory, lua_state)    == 98_304);
    assert!(offset_of!(TinyBitMemory, audio_data)   == 360_448);
    assert!(offset_of!(TinyBitMemory, pngle_data)   == 372_736);
    assert!(offset_of!(TinyBitMemory, audio_buffer) == 421_888);
    assert!(offset_of!(TinyBitMemory, button_input) == 422_622);
    assert!(offset_of!(TinyBitMemory, user)         == 422_630);
    assert!(core::mem::size_of::<TinyBitMemory>()   == 432_870);
};
```

(Only the first three offsets change: `spritesheet`, `display`, `script` shift by +146; the new `header` slot occupies offset 0. From `lua_state` onward, the script shrink cancels the header insertion, so every later offset and `size_of` are unchanged.)

- [ ] **Step 5: Rebuild — assertions should now pass**

```bash
cargo build --target wasm32-wasip1 --release 2>&1 | tail -20
```
Expected: build succeeds (`Compiling tinybit_wasm` … `Finished`). No warnings beyond pre-existing ones.

---

## Task 5: Parent repo — derive `SCRIPT_MAX` from the engine constant

**Files:**
- Modify: `src/encoder/mod.rs:12`

**Goal of this task:** Replace the magic literal `32_621` with a derivation from `bindings::TB_MEM_SCRIPT_SIZE` so the relationship documents itself and survives future engine changes. Value stays `32_621`.

- [ ] **Step 1: Update the constant**

Edit `src/encoder/mod.rs`, replace this line (currently line 12):

```rust
pub const SCRIPT_MAX: usize = 32_621;       // see spec §"Byte-budget sanity check"
```

with:

```rust
pub const SCRIPT_MAX: usize = crate::bindings::TB_MEM_SCRIPT_SIZE - 1; // 32621; reserve 1 byte for trailing NUL
```

- [ ] **Step 2: Run all unit tests**

```bash
cargo test --target x86_64-unknown-linux-gnu 2>&1 | tail -30
```
Expected: all encoder tests pass — `encode_round_trip_recovers_header_and_script_crc`, `encode_rejects_oversized_script`, `encode_rejects_wrong_cover_size`, `encode_rejects_overlong_title`. Layout assertions in `bindings.rs` also evaluated; nothing fails.

If `cargo test` requires the host target to be different on this machine, run `cargo test` without `--target` (it defaults to host).

---

## Task 6: WASM smoke tests

**Files:** (none modified — running existing scripts)

**Goal of this task:** Build the final WASM artifact and confirm both end-to-end Node smoke tests still pass.

- [ ] **Step 1: Build the WASM artifact**

```bash
./scripts/build.sh 2>&1 | tail -10
```
Expected: prints `Built editor/public/tinybit_wasm.wasm (<size> bytes)`. The size will be roughly equal to the prior build (within a few hundred bytes) — total memory unchanged means the C struct's footprint is unchanged.

- [ ] **Step 2: Run the player smoke test**

```bash
node scripts/smoke.mjs 2>&1 | tail -30
```
Expected: existing assertions all pass. Exit code 0. The test loads a real cartridge, runs frames, and validates output. This exercises the new header-write-into-memory path (every cartridge feed parses the header).

- [ ] **Step 3: Run the encoder smoke test**

```bash
node scripts/smoke_encoder.mjs 2>&1 | tail -30
```
Expected: all assertions pass. Exit code 0. This implicitly verifies the new auto-NUL terminator in `cartridge_feed` — the encoder produces a cartridge that's then fed back through the decoder.

If either smoke test fails, **stop and investigate** — do not commit the parent change with broken smoke tests.

---

## Task 7: Parent repo — commit the atomic change

**Files:**
- Stage: `src/tinybit` (submodule pointer), `src/bindings.rs`, `src/encoder/mod.rs`

**Goal of this task:** Single parent-repo commit that moves the submodule pointer and updates the Rust mirror together. Anything in between would fail to compile.

- [ ] **Step 1: Stage exactly the files involved**

```bash
git add src/tinybit src/bindings.rs src/encoder/mod.rs
git status
```
Expected: three staged entries (the submodule pointer counts as one). No other unrelated changes staged.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
store cartridge header in TinyBitMemory

Engine submodule bump: cartridge header is now a real field of
struct TinyBitMemory (offset 0); script[] shrinks by 146 bytes to
keep total memory size unchanged. Wire format is identical.

Parent-repo mirror:
- src/bindings.rs adds the header field and updates the four
  offset assertions that shift (spritesheet, display, script,
  plus the new header at 0). Later offsets and size_of are
  unchanged because the script shrink cancels the header.
- src/encoder/mod.rs SCRIPT_MAX is now derived from
  bindings::TB_MEM_SCRIPT_SIZE - 1 instead of a magic literal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git status
```
Expected: one new commit on parent `main`, working tree clean.

- [ ] **Step 3: Final verification**

```bash
cargo build --target wasm32-wasip1 --release 2>&1 | tail -5
cargo test 2>&1 | tail -5
node scripts/smoke.mjs 2>&1 | tail -3
node scripts/smoke_encoder.mjs 2>&1 | tail -3
```
Expected: all four green. The parent-repo state is now complete and consistent with the new engine.

- [ ] **Step 4: Stop here. Do NOT push the parent commit automatically.**

The user reviews the final commit and pushes when ready (matches the prior workflow on Issue 1, where the user explicitly asked for the push).

---

## Self-review checklist (already applied; listed here for traceability)

- **Spec coverage:** Every item in `docs/superpowers/specs/2026-05-11-tinybit-header-in-memory-design.md` is implemented: struct change (Task 1), cartridge.c rewiring (Task 2), NUL guard (Task 2 step 5), bindings.rs mirror (Task 4), SCRIPT_MAX derivation (Task 5), smoke tests (Task 6), atomic parent commit (Task 7). Out-of-scope items (Issue 2 desktop encoder, `mem_peek` repair, contiguous-cartridge-data substruct) are explicitly not in any task — they belong to future specs.
- **Placeholder scan:** No "TBD" / "TODO" / "handle edge cases" / "similar to Task N" anywhere; every code block is concrete.
- **Type consistency:** `TB_HEADER_SIZE` is 146 throughout (engine `#define`, Rust `pub const`). `TB_MEM_SCRIPT_SIZE` is `32 * 1024 - TB_HEADER_SIZE` = 32 622 in both engine and Rust. Field name `header` matches in both.
- **No premature pushing:** The engine commit pushes (Task 2 step 8) because the parent needs the SHA visible on `origin/main`. The parent commit does NOT push — user reviews first.
