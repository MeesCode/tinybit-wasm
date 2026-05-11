# TinyBit cartridge header lives in TinyBitMemory

**Date:** 2026-05-11
**Scope:** Move the 146-byte cartridge header from a file-scope static in `cartridge.c` into a real field of `struct TinyBitMemory`, sized to match the cartridge wire layout. Shrink `script[]` by the same 146 bytes so total memory stays the same. Mirror the change in the Rust FFI struct and re-derive the encoder's script-size cap from the new engine constant.

## Motivation

`struct TinyBitMemory` is the engine's process-wide state, owned by the host (Rust on WASM, C/SDL on desktop) and handed to `tinybit_init`. It already mirrors most of the cartridge wire format: spritesheet, script, etc. The cartridge header is the conspicuous exception — it lives in `static uint8_t header_bytes[TB_HEADER_SIZE]` and `static struct TinyBitHeader header` inside `cartridge.c`. That has three downsides:

1. **Layout mismatch.** `TB_MEM_SCRIPT_SIZE = 32 KB` claims a 32 768-byte script region in memory, but the cartridge only ships `32 768 − 146 = 32 622` script bytes (the header eats 146 bytes of the same 32 KB block on disk). The 146-byte mismatch is documented by `TB_MEM_CARTRIDGE_SCRIPT_SIZE` in `tinybit.h:44` but is a footnote, not a layout invariant.
2. **Header is process-state, not memory-state.** `header_parsed` and the parsed `struct TinyBitHeader` are file-scope statics tied to process lifetime — same family of bug as Issue 1 in `feeback.md` (the `lua_pool` `lua_heap_initialized` flag). Re-init paths have to remember to reset them. Putting the bytes in `TinyBitMemory` means `memory_init()`'s `memset` zeroes them for free.
3. **Host code can't see the header.** Anything that wants to inspect cartridge metadata (a future editor "what game is this?" probe, a future save-state slot, etc.) has to go through `cartridge_header()`. With the bytes in `TinyBitMemory`, the host already has them.

Neither (1) nor (2) is a live bug today — the engine works. This is a layout cleanup that simultaneously closes a small surface for future bugs.

## Non-goals

- **Wire-format change.** `.tb.png` cartridges are bit-for-bit identical before and after this change. `format_version` stays at `1`. No cartridge migration.
- **Issue 2 from `feeback.md`** (desktop C encoder NUL-overflow at the script-size cap). Same problem domain (script-size accounting), different repo (`TinyBit/` desktop wrapper), filed as separate follow-up.
- **Fixing the broken `mem_peek` / `mem_poke` pointer arithmetic** in `src/tinybit/memory.c` (`&tinybit_memory[dst]` is arithmetic on the *struct pointer*, not on bytes). Pre-existing bug; out of scope here.
- **Reshuffling `TinyBitMemory` for true cartridge contiguity** (header → spritesheet → script as one block, with `display` moved out). Considered and rejected in favor of the minimum-disturbance placement.

## Design

### Memory layout

`src/tinybit/tinybit.h`:

```c
#define TB_HEADER_SIZE 146                               // unchanged
#define TB_MEM_SCRIPT_SIZE (32 * 1024 - TB_HEADER_SIZE)  // 32622, was 32768
// TB_MEM_CARTRIDGE_SCRIPT_SIZE: REMOVED — script[] now equals the cartridge script payload.

struct TinyBitMemory {
    uint8_t  header[TB_HEADER_SIZE];                       // NEW, offset 0
    uint16_t spritesheet[TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT];
    uint16_t display[TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT];
    uint8_t  script[TB_MEM_SCRIPT_SIZE];                   // shrunk by 146
    uint8_t  lua_state[TB_MEM_LUA_STATE_SIZE];
    uint8_t  audio_data[TB_MEM_AUDIO_DATA_SIZE];
    uint8_t  pngle_data[TB_MEM_PNGLE_SIZE];
    int16_t  audio_buffer[TB_AUDIO_FRAME_SAMPLES];
    uint8_t  button_input[TB_MEM_BUTTON_INPUT_SIZE];
    uint8_t  user[TB_MEM_USER_SIZE];
};
```

Resulting offsets:

| Field           | Before  | After   | Δ     |
|-----------------|--------:|--------:|------:|
| `header`        | —       | 0       | new   |
| `spritesheet`   | 0       | 146     | +146  |
| `display`       | 32 768  | 32 914  | +146  |
| `script`        | 65 536  | 65 682  | +146  |
| `lua_state`     | 98 304  | 98 304  | 0     |
| `audio_data`    | 360 448 | 360 448 | 0     |
| `pngle_data`    | 372 736 | 372 736 | 0     |
| `audio_buffer`  | 421 888 | 421 888 | 0     |
| `button_input`  | 422 622 | 422 622 | 0     |
| `user`          | 422 630 | 422 630 | 0     |
| `sizeof`        | 432 870 | 432 870 | 0     |

The four leading fields shift by +146; from `lua_state` onward, the script shrink exactly cancels the header insertion, so all later offsets and the total `sizeof` are identical. Total memory size unchanged is the key invariant — it means linear-memory budgets and host-side allocator sizes keep working without further coordination.

### Engine wiring — `src/tinybit/cartridge.c`

The decoder writes header bytes directly into `tinybit_memory->header`; the file-scope `header_bytes[]` static is removed. The parsed `struct TinyBitHeader` cache stays — it's the form callers want and parsing is a one-shot.

```c
// REMOVE: static uint8_t header_bytes[TB_HEADER_SIZE];
static struct TinyBitHeader header;
static bool header_parsed = false;

static void parse_and_log_header(void) {
    const uint8_t* h = tinybit_memory->header;
    header.format_version = read_u16_le(&h[0]);
    header.flags          = read_u16_le(&h[2]);
    header.script_size    = read_u32_le(&h[4]);
    header.checksum       = read_u32_le(&h[8]);
    memcpy(header.title,  &h[12], TB_HEADER_TITLE_SIZE);
    memcpy(header.author, &h[76], TB_HEADER_AUTHOR_SIZE);
    header.title[TB_HEADER_TITLE_SIZE - 1]   = '\0';
    header.author[TB_HEADER_AUTHOR_SIZE - 1] = '\0';
    header.game_version = read_u16_le(&h[140]);
    header.package_date = read_u32_le(&h[142]);
    // …logging unchanged
}

static void decode_pixel_load_game(pngle_t *pngle, uint32_t x, uint32_t y,
                                   uint32_t w, uint32_t h, uint8_t rgba[4]) {
    if (!rgba || !tinybit_memory) return;
    uint8_t decoded = (rgba[0] & 0x3) << 6 | (rgba[1] & 0x3) << 4
                    | (rgba[2] & 0x3) << 2 | (rgba[3] & 0x3) << 0;

    if (cartridge_index < TB_HEADER_SIZE) {
        tinybit_memory->header[cartridge_index] = decoded;
        cartridge_index++;
        if (cartridge_index == TB_HEADER_SIZE && !header_parsed) {
            parse_and_log_header();
            header_parsed = true;
        }
        return;
    }

    size_t payload_index = cartridge_index - TB_HEADER_SIZE;
    size_t spritesheet_bytes = sizeof(tinybit_memory->spritesheet);
    if (payload_index < spritesheet_bytes) {
        ((uint8_t*)tinybit_memory->spritesheet)[payload_index] = decoded;
    } else {
        size_t script_offset = payload_index - spritesheet_bytes;
        if (script_offset < TB_MEM_SCRIPT_SIZE) {
            tinybit_memory->script[script_offset] = decoded;
        }
    }
    cartridge_index++;
}

void cartridge_reset(void) {
    cartridge_index = 0;
    header_parsed = false;
    memset(&header, 0, sizeof(header));
    // Header bytes in tinybit_memory->header are zeroed by memory_init() on
    // the next tinybit_init, and overwritten by the next cartridge feed.
}
```

### NUL-terminator guarantee — `cartridge_feed`

The engine calls `luaL_dostring((char*)tinybit_memory->script)`, which requires a NUL terminator. The cartridge ships `script_size + 1` bytes (the final byte is the NUL), so under the old layout the NUL landed at `script[script_size]` inside a 32 768-byte buffer with headroom. Under the new layout, `script[]` is 32 622 bytes — exactly the cartridge script payload, no headroom for the trailing NUL.

The engine defends itself: at the end of every `cartridge_feed` call, force `tinybit_memory->script[TB_MEM_SCRIPT_SIZE - 1] = '\0'`. This costs 1 byte of effective script payload (max practical script becomes 32 621), which is exactly what the Rust encoder already enforces via `SCRIPT_MAX = 32_621`. The guard is unconditional — it runs after every feed, not just at end-of-stream — so partial feeds and reset states stay safe.

```c
bool cartridge_feed(const uint8_t* buffer, size_t size) {
    int rc = pngle_feed(pngle, buffer, size);
    // Defend luaL_dostring against an over-eager encoder: ensure the script
    // region is always NUL-terminated regardless of what just got written.
    tinybit_memory->script[TB_MEM_SCRIPT_SIZE - 1] = '\0';
    return rc != -2;
}
```

Implication for the encoder: it must continue to cap script size at `TB_MEM_SCRIPT_SIZE - 1 = 32 621` bytes (no change from current Rust encoder behavior). If a non-conforming encoder ever produces a 32 622-byte script, the engine clips the last byte to `\0` — graceful degradation, not a crash.

### Rust mirror — `src/bindings.rs`

The hand-written Rust mirror of `TinyBitMemory` must match the new C layout exactly. Compile-time `offset_of!` assertions catch drift.

```rust
pub const TB_HEADER_SIZE: usize = 146;                              // NEW
pub const TB_MEM_SCRIPT_SIZE: usize = 32 * 1024 - TB_HEADER_SIZE;   // 32622

#[repr(C)]
pub struct TinyBitMemory {
    pub header:       [u8;  TB_HEADER_SIZE],                        // NEW, offset 0
    pub spritesheet:  [u16; TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT],
    pub display:      [u16; TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT],
    pub script:       [u8;  TB_MEM_SCRIPT_SIZE],                    // 32622
    pub lua_state:    [u8;  TB_MEM_LUA_STATE_SIZE],
    pub audio_data:   [u8;  TB_MEM_AUDIO_DATA_SIZE],
    pub pngle_data:   [u8;  TB_MEM_PNGLE_SIZE],
    pub audio_buffer: [i16; TB_AUDIO_FRAME_SAMPLES],
    pub button_input: [u8;  TB_MEM_BUTTON_INPUT_SIZE],
    pub user:         [u8;  TB_MEM_USER_SIZE],
}

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

### Encoder — `src/encoder/mod.rs`

`SCRIPT_MAX` keeps its value (`32 621`) but switches from a magic literal to a derivation from the engine constant, so the relationship survives a future engine change:

```rust
// Was: pub const SCRIPT_MAX: usize = 32_621;
pub const SCRIPT_MAX: usize = crate::bindings::TB_MEM_SCRIPT_SIZE - 1;
```

No other encoder changes. The existing tests (`encode_round_trip_recovers_header_and_script_crc`, `encode_rejects_oversized_script`, etc.) keep passing — they reference `SCRIPT_MAX` symbolically.

### Cross-repo coordination

This change spans two repos:

1. **`MeesCode/TinyBit-lib`** (engine, vendored as `src/tinybit/` submodule). Land first. Branch `main`.
2. **`tinybit-wasm`** (this repo). After the engine SHA is published, bump the submodule pointer and bundle the `bindings.rs` + `encoder/mod.rs` changes in the same parent commit. They must move atomically: a parent-repo commit that bumps the submodule without updating `bindings.rs` will fail the compile-time offset assertions.

### Testing strategy

1. **Compile-time offset assertions** (in `bindings.rs`) — primary drift guard. Any disagreement between Rust struct and C struct fails the build.
2. **`cargo test --workspace`** — exercises encoder round-trip, which feeds a produced cartridge back through the decode path; if the new in-memory header layout is wrong the round-trip's header recovery assertions fail.
3. **`scripts/smoke.mjs`** — feeds a real flappy cartridge through the WASM build end-to-end. Existing test, expected to keep passing.
4. **`scripts/smoke_encoder.mjs`** — encoder round-trip in WASM. Existing test, expected to keep passing. Implicitly exercises the new auto-NUL terminator at the tail of `cartridge_feed`.
5. **Manual sanity check.** `cargo build --target wasm32-wasip1 --release` builds with no warnings. Load a cartridge in the browser; confirm the title is still logged correctly (proves `parse_and_log_header` reads from the right buffer).

No new automated test for the NUL-terminator guard specifically — it's a one-line defensive write that's structurally impossible to mis-trigger and is incidentally exercised by every cartridge feed.

## Rollout

Single non-staged change in each repo. No feature flag, no migration. Existing cartridges keep working unchanged because the wire format is identical.

## Risks

- **Hidden consumers of `tinybit_memory->script`'s old size.** Any code that hard-codes `32 768` or assumes 146 bytes of trailing slack inside `script[]` will now see different behavior. Search across the engine submodule turns up no such consumers — `script[]` is read by `luaL_dostring` (NUL-bounded) and written by `decode_pixel_load_game` (now bounded by `TB_MEM_SCRIPT_SIZE`).
- **Rust bindings drift.** Mitigated by the compile-time offset assertions; any mismatch fails the build before anything ships.
- **Future cartridges with a 32 622-byte script.** Engine clips the last byte to `\0`. Lua sees a truncated script. Not silent — the Rust encoder still rejects such scripts; this is purely a safety net for malicious or buggy third-party encoders.

## Follow-ups

- Patch the desktop C encoder's pixel-buffer overflow (Issue 2 in `feeback.md`) so it lines up with the Rust encoder's 32 621-byte cap.
- Optional: rip out the broken `mem_peek` / `mem_poke` implementation in `memory.c` or fix the pointer arithmetic. Not blocking this change.
