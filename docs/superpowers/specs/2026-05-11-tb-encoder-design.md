# TinyBit cartridge encoder (in-wasm Rust)

**Date:** 2026-05-11
**Branch:** `feat/tb-encoder`
**Scope:** Add an in-browser cartridge encoder to `tinybit_wasm` so users can author a `.tb.png` from a cover image, spritesheet, Lua script, and header metadata, then either download the file or play it immediately through the existing decoder.

## Motivation

The existing `tinybit_wasm` crate ships only the player half of the toolchain — cartridges must be authored offline via the desktop wrapper's `tinybit -c …` mode (C + SDL). This forces every casual author through a native build of `TinyBit` just to package assets that the WASM player can already consume. Bringing the encode step into the browser closes that loop: the WASM bundle that already plays cartridges can now also produce them, with zero new infrastructure on the user's end.

We deliberately write the encoder in **Rust**, not C — the C engine intentionally has no encoder dependency (no libpng writer, no SDL_image), and pulling those in would bloat the WASM binary and add new FFI risk. A pure-Rust pipeline using the `png` crate is small, panic-free under `panic = "abort"`, and reuses the same WASI build path the player already uses.

## Cartridge format (reference)

A `.tb.png` is a 256×256 RGBA8 PNG with embedded data hidden via steganography in the low 2 bits of each channel. Documented end-to-end in `src/tinybit/cartridge.c` (decoder) and `…/TinyBit/src/cartridge_io.c` (current C encoder).

- **Pixel scan order:** row-major, top-left to bottom-right. Each pixel's 4 channels × 2 low-bits = 1 byte of payload.
- **Payload layout** in order: 146-byte header, then 32 768 bytes of packed spritesheet data, then up to 32 622 bytes of Lua script (terminated by a NUL).
- **Header** (146 bytes, little-endian): `format_version u16, flags u16, script_size u32, checksum u32, title[64], author[64], game_version u16, package_date u32`. `checksum` is CRC-32 (IEEE 802.3, reflected polynomial `0xEDB88320`) over the script bytes only.
- **Spritesheet encoding** is special: each source byte (one channel of the 128×128 RGBA input) contributes only its top 4 bits, written into 2 dest channels (2 bits each). So 65 536 source bytes → 32 768 destination pixels carrying 32 768 packed bytes. This matches the engine's in-memory 16-bit-per-pixel spritesheet (R-high, G-high, B-high, A-high — 4 bpc).
- **Cover image** is composited at full 8-bit RGBA into the visible rect `(64, 60)–(192, 188)` of the cartridge image. The rest of the visible picture comes from a 256×256 "frame" template.

The decoder feeds raw PNG bytes via `tb_feed_cartridge`. **Any encoder output that produces a valid `.tb.png` byte stream can be fed back through the existing decoder unchanged** — there is no separate "play directly" path on the engine side; that's just the upload path with bytes already in memory.

## Decisions

| | |
|---|---|
| Encoder runtime | Module inside the existing `tinybit_wasm` crate, exported via new `tb_enc_*` `extern "C"` functions. Same single `web/tinybit_wasm.wasm` artifact. |
| Web UI | Collapsible "Create a cartridge" `<details>` panel in `web/index.html`. Four file pickers, four header text fields, Download / Play-now buttons. |
| Input strictness | Cover & spritesheet must be exactly 128×128 PNG; reject otherwise. Frame override (optional) must be 256×256. |
| Frame template | `assets/cartridge3.png` (copied from sibling `TinyBit/assets/`) bundled via `include_bytes!`. Optional user upload overrides it. |
| Script limit | Hard reject when `script.len() > 32 621` (to keep total payload ≤ 65 536 pixels including the trailing NUL). Live "N / 32 621 (X %)" indicator in the UI. |
| Header defaults | All header fields optional. Defaults: `title="untitled", author="", format_version=1, flags=0, game_version=1, package_date=now`. |
| Module layout | Submodule `src/encoder/{mod.rs, header.rs, steg.rs, image.rs, png_io.rs}`. Each file single-purpose, under ~150 lines, host-testable. |
| Testing | Rust `#[cfg(test)]` unit tests on host target + extended `scripts/smoke.mjs` doing a wasm encode → wasm decode round-trip. |

## Architecture

```
src/
├── lib.rs            # existing player exports + new tb_enc_* exports
├── bindings.rs       # unchanged
├── tinybit/          # unchanged C engine submodule
└── encoder/
    ├── mod.rs        # encode() entrypoint + wasm-export glue + EncError
    ├── header.rs     # CRC32 + pack 146-byte header
    ├── steg.rs       # low-2-bit byte / spritesheet writers
    ├── image.rs      # decode input PNGs, validate sizes, composite cover
    └── png_io.rs     # encode final 256×256 RGBA8 → PNG bytes
```

**New dependency:** `png = { version = "0.17", default-features = false }`. Pure-Rust deflate (miniz_oxide); builds cleanly under `wasm32-wasip1`. No other dependency changes; `build.rs` unchanged.

**Bundled asset:** `assets/cartridge3.png` committed to this repo and embedded via `include_bytes!("../../assets/cartridge3.png")` in `encoder/image.rs`. Adds a few KB to the wasm; ensures cartridges look "official" without requiring the sibling `TinyBit` checkout at build time.

## FFI surface (new wasm exports)

| Export | Purpose |
|---|---|
| `tb_enc_init() -> u32` | Allocate the encoder state (input slots + output buffer). Returns 1 on success. Idempotent: safe to call once per page. |
| `tb_enc_input_ptr(slot: u32) -> *mut u8` | Pointer to one of the input staging buffers in wasm memory. |
| `tb_enc_input_cap(slot: u32) -> u32` | Capacity of that slot, so JS can validate before writing. |
| `tb_enc_set_input_len(slot: u32, len: u32)` | Tell the encoder how many bytes are in the slot. `len = 0` means "no input" for that slot. |
| `tb_enc_set_header(game_version: u32, flags: u32, package_date: u32) -> u32` | Stage the three scalar header fields. Title and author come through slots 4 & 5 via the same staging mechanism. Returns 1 if accepted. |
| `tb_enc_run() -> i32` | Run the full encode. Returns output PNG byte length on success, or a negative `EncError` code. |
| `tb_enc_output_ptr() -> *const u8` | Pointer to the encoded PNG bytes in wasm memory after `tb_enc_run`. |
| `tb_enc_error_ptr() -> *const u8` / `tb_enc_error_len() -> u32` | UTF-8 error message for the last failed run. |

**Slot enum** (stable, documented in `encoder/mod.rs`): `0 = cover PNG`, `1 = spritesheet PNG`, `2 = script bytes`, `3 = optional frame override PNG`, `4 = title UTF-8 bytes (≤ 63)`, `5 = author UTF-8 bytes (≤ 63)`. Title/author go through the same `tb_enc_input_ptr` / `tb_enc_set_input_len` machinery as the other inputs — uniform FFI, one staging code path on the JS side.

**Error codes** from `tb_enc_run`:
- `-1` cover PNG invalid / wrong size
- `-2` spritesheet PNG invalid / wrong size
- `-3` frame override PNG invalid / wrong size
- `-4` script too large (> 32 621 bytes)
- `-5` header string overflow (title or author > 63 UTF-8 bytes — caught at run, after JS staged them in slots 4 & 5)
- `-6` output PNG encode failure (safety net)

Every negative return is paired with a UTF-8 message via `tb_enc_error_ptr` / `tb_enc_error_len`. The JS side treats `< 0` uniformly: read the message, show it in `#enc-status`.

## End-to-end data flow

```
JS                                          WASM
─────────────────────────────────────       ─────────────────────────────────────
1. File pickers + form gather inputs
2. For each non-empty input (cover/sprite/script/frame/title/author):
     ptr = tb_enc_input_ptr(slot)      →    (returns offset into wasm mem)
     wasmMem.set(bytes, ptr)
     tb_enc_set_input_len(slot, len)
3. tb_enc_set_header(                  →    Stores scalar header fields.
     game_version, flags, package_date)
4. n = tb_enc_run()                    →    Decode PNGs, validate sizes, build
                                            65 536-byte payload, composite cover
   if n < 0:                                onto frame, apply steganography,
     show tb_enc_error_*                    encode 256×256 RGBA8 → PNG bytes.
   else:                                    Returns len.
5a. Download path:
     pngBytes = wasmMem.slice(
         tb_enc_output_ptr(),
         tb_enc_output_ptr() + n)
     trigger Blob download

5b. Play-now path:
     reuse tb_feed_cartridge(pngBytes)
     (existing decoder API — bytes round-trip through the same engine)
```

**Play-now is free**: the encoded bytes are just standard PNG bytes the existing decoder already accepts. No new engine code.

**Memory:** all encoder buffers live in a single `static mut EncoderState` initialized by `tb_enc_init`. Same pattern the player uses with `tinybit_memory`. One encoder session at a time — the UI is modal.

## Rust encoder pipeline

### `encoder/header.rs`

```rust
pub struct HeaderOpts<'a> {
    pub title: &'a str,        // ≤ 63 bytes UTF-8
    pub author: &'a str,       // ≤ 63 bytes UTF-8
    pub format_version: u16,
    pub flags: u16,
    pub game_version: u16,
    pub package_date: u32,
}

pub fn pack(opts: &HeaderOpts, script: &[u8]) -> [u8; 146];
```

- CRC32 reflected polynomial `0xEDB88320`, byte-for-byte match with `cartridge_io.c::crc32`.
- Layout matches `struct TinyBitHeader` exactly.
- Title/author zero-padded; last byte forced to `\0` (mirrors decoder's `header.title[63] = '\0'`).
- Pure function, no I/O. Unit-testable against golden vectors generated from the C encoder.

### `encoder/image.rs`

```rust
pub fn decode_128x128_rgba(png_bytes: &[u8]) -> Result<[u8; 65_536], EncError>;
pub fn decode_256x256_rgba(png_bytes: &[u8]) -> Result<[u8; 262_144], EncError>;
pub const BUNDLED_FRAME: &[u8] = include_bytes!("../../assets/cartridge3.png");

pub fn build_base_buffer(
    cover_rgba: &[u8; 65_536],
    frame_override: Option<&[u8]>,
) -> Result<[u8; 262_144], EncError>;
```

- `png::Decoder` with transformations that force RGBA8 output (palette/grayscale expanded, alpha synthesized as `0xFF` when absent).
- Strict size check; mismatched dimensions return the matching `EncError` variant.
- `build_base_buffer` blits the cover into `(64, 60)–(192, 188)` at full 8-bit RGBA; steganography overwrites the low 2 bits later.

### `encoder/steg.rs`

```rust
/// 1 source byte → 4 dest channels, each carrying 2 bits.
/// Mirrors cartridge_io.c::encode_bytes exactly.
pub fn write_bytes(dest: &mut [u8], cursor: &mut usize, src: &[u8]);

/// 1 source byte → 2 dest channels, carrying only the TOP 4 bits of `src`.
/// Mirrors cartridge_io.c::encode_spritesheet exactly.
pub fn write_spritesheet(dest: &mut [u8], cursor: &mut usize, src: &[u8]);
```

- Both preserve `dest[i] & 0xfc`. Only the low 2 bits are touched, leaving cover and frame artwork visually intact.
- `cursor` is a shared byte index into the 262 144-byte RGBA buffer; advanced sequentially through header → spritesheet → script.
- Pure, deterministic, byte-exact comparable to the C output.

### `encoder/png_io.rs`

```rust
pub fn encode_rgba(buf256x256: &[u8; 262_144], out: &mut Vec<u8>) -> Result<(), EncError>;
```

- `png::Encoder`, RGBA8, bit depth 8, default filter. `pngle` (the engine's decoder) is filter-agnostic.
- Writes into a caller-supplied `Vec<u8>` (the encoder state's output buffer). No per-call allocation churn.

### `encoder/mod.rs`

```rust
pub enum EncError {
    CoverPng(&'static str),
    CoverSize,
    SpritePng(&'static str),
    SpriteSize,
    FramePng(&'static str),
    FrameSize,
    ScriptTooLarge { script_size: u32, max: u32 },
    HeaderStringOverflow,
    PngWrite(&'static str),
}

impl EncError {
    pub fn code(&self) -> i32;       // -1..=-6 mapping
    pub fn message(&self) -> String; // user-facing
}

pub fn encode(
    cover_png: &[u8],
    spritesheet_png: &[u8],
    script: &[u8],
    frame_override: Option<&[u8]>,
    opts: &HeaderOpts,
    out: &mut Vec<u8>,
) -> Result<(), EncError>;
```

`encode()` runs:

1. **Validate script size** — `script.len() ≤ 32 621`. Early-out before decoding PNGs.
2. **Decode the three (or two) input PNGs** with strict size validation.
3. **Build base buffer** — frame → composite cover at `(64, 60)`.
4. **Pack the 146-byte header** including CRC32 over `script`.
5. **Steganography pass** — single cursor through the RGBA buffer:
   - `steg::write_bytes(buf, &mut cursor, &header)` → 146 px.
   - `steg::write_spritesheet(buf, &mut cursor, &spritesheet_rgba)` → 32 768 px.
   - `steg::write_bytes(buf, &mut cursor, script_with_nul)` → `script.len() + 1` px.
6. **PNG encode** — `png_io::encode_rgba(buf, out)`.

### Byte-budget sanity check

- Header: 146 px
- Spritesheet: 65 536 src bytes × 2 channels/byte = 131 072 channels = 32 768 px
- Script + NUL: up to `script_len + 1` px
- Total: `146 + 32 768 + script_len + 1 = 32 915 + script_len` px ≤ 65 536

Solving: `script_len ≤ 32 621`. Both the Rust and C encoders enforce this cap. (Originally a Rust-only safety margin — the C encoder allowed 32 622 and overflowed the cartridge buffer by 1 pixel; that was fixed in TinyBit commit `9334286` alongside the header-in-memory engine change.)

## Web UI & JS integration

### HTML (new section in `web/index.html`)

```html
<details id="encoder-panel">
  <summary>Create a cartridge</summary>
  <form id="encoder-form">
    <fieldset>
      <legend>Assets</legend>
      <label>Cover (128×128 PNG)        <input type="file" id="enc-cover"  accept="image/png" required></label>
      <label>Spritesheet (128×128 PNG)  <input type="file" id="enc-sprite" accept="image/png" required></label>
      <label>Script (.lua)              <input type="file" id="enc-script" accept=".lua,text/plain" required></label>
      <label>Frame template (optional)  <input type="file" id="enc-frame"  accept="image/png"></label>
      <p id="enc-script-usage" hidden></p>
    </fieldset>

    <fieldset>
      <legend>Header</legend>
      <label>Title         <input type="text"   id="enc-title"        maxlength="63" placeholder="untitled"></label>
      <label>Author        <input type="text"   id="enc-author"       maxlength="63"></label>
      <label>Game version  <input type="number" id="enc-game-version" min="0" max="65535" value="1"></label>
      <label>Flags (hex)   <input type="text"   id="enc-flags"        value="0x0000" pattern="0x[0-9A-Fa-f]{1,4}"></label>
    </fieldset>

    <div class="enc-actions">
      <button type="button" id="enc-download">Download .tb.png</button>
      <button type="button" id="enc-play">Play now</button>
    </div>
    <p id="enc-status" role="status" aria-live="polite"></p>
  </form>
</details>
```

### JS module: `web/encoder.js`

A small ES module imported from `index.js`. Public entry point:

```js
import { wasm, wasmMemory } from './wasm-runtime.js';

const SLOT = { COVER: 0, SPRITE: 1, SCRIPT: 2, FRAME: 3, TITLE: 4, AUTHOR: 5 };

export async function encodeFromForm(formEls) {
    ensureEncoderInit();

    await stageFile(SLOT.COVER,  formEls.cover);
    await stageFile(SLOT.SPRITE, formEls.sprite);
    await stageFile(SLOT.SCRIPT, formEls.script);
    if (formEls.frame.files[0]) await stageFile(SLOT.FRAME, formEls.frame);
    else                        wasm.tb_enc_set_input_len(SLOT.FRAME, 0);

    stageString(SLOT.TITLE,  formEls.title.value  || 'untitled');
    stageString(SLOT.AUTHOR, formEls.author.value || '');
    wasm.tb_enc_set_header(
        parseInt(formEls.gameVersion.value, 10) || 1,
        parseInt(formEls.flags.value, 16)       || 0,
        Math.floor(Date.now() / 1000),
    );

    const n = wasm.tb_enc_run();
    if (n < 0) throw new Error(readErrorMessage());

    const ptr = wasm.tb_enc_output_ptr();
    return new Uint8Array(wasmMemory().buffer, ptr, n).slice();
}
```

Private helpers: `ensureEncoderInit()`, `stageFile(slot, inputEl)`, `stageString(slot, str)` (UTF-8 encode then stage), `readErrorMessage()`. The returned `Uint8Array` is a **copy** (`.slice()`) so it survives any subsequent `memory.grow`.

### Wasm-runtime extraction

`index.js` currently owns the wasm instance and `WebAssembly.Memory`. To share with `encoder.js` cleanly, extract that boot path into `web/wasm-runtime.js`:

- Constructs the WASI shim, instantiates the module, exposes `wasm`, `wasmMemory()`, and the existing `tb_*` exports.
- Imported by both `index.js` (player) and `encoder.js` (new). No behavioural change to the player.

### Button wiring (in `index.js`)

- **Download button**: `encodeFromForm(els)` → `triggerDownload(bytes, "<sanitized-title>.tb.png")`. Blob → object URL → temporary `<a download>` click → `URL.revokeObjectURL`.
- **Play now button**: `encodeFromForm(els)` → existing `feedAndStart(bytes)` helper (same 5-line helper the upload picker already calls). Zero new engine code.

Both buttons set `#enc-status` to "Encoding…" beforehand, then to the success / error message after.

### Live script-size indicator

`change` listener on `#enc-script`:

```js
encScript.addEventListener('change', async () => {
    const f = encScript.files[0];
    if (!f) { usageEl.hidden = true; return; }
    const max = 32_621;
    const pct = Math.floor(f.size / max * 100);
    usageEl.hidden = false;
    usageEl.textContent = `${f.size.toLocaleString()} / ${max.toLocaleString()} bytes (${pct} %)`;
    usageEl.classList.toggle('over-limit', f.size > max);
});
```

`.over-limit` flips the text red; both buttons are disabled when over-limit. The wasm also enforces the same limit (`-4`) as defense-in-depth.

### Filename sanitization

`<title>.tb.png`, with `<title>` sanitized to `[A-Za-z0-9._-]` (other chars → `_`), falling back to `cartridge` if empty.

### Styling

Minimal CSS appended to the existing stylesheet (or new `web/encoder.css`): 2-column form grid, monospace usage indicator, red `.over-limit`, subtle separator above the player upload section.

## Error handling

| Boundary | Detected by | Surfaced as |
|---|---|---|
| **Form-level (pre-encode)** | JS validators: missing required file, script > 32 621 bytes, bad hex in flags | Inline message in `#enc-status`; encode button stays disabled. Wasm not called. |
| **Encoder-level (during encode)** | Rust `EncError` from `encode()` | `tb_enc_run` returns negative code; JS reads UTF-8 message via `tb_enc_error_ptr` / `tb_enc_error_len` and shows it verbatim. |
| **PNG re-decode (Play-now path)** | Existing engine's `tb_feed_cartridge` returns 0 | Existing error path in `index.js` already shows "Failed to load cartridge". No new code. |

Example user-facing messages (verbatim from `EncError::message()`):
- `"Cover must be 128×128 (got 64×64)"`
- `"Spritesheet PNG decode failed: chunk crc mismatch"`
- `"Script too large: 33 000 / 32 621 bytes"`
- `"Title is too long (max 63 UTF-8 bytes)"`

**The encoder never panics on bad input.** Every `?` in the pipeline maps to an `EncError` variant. Existing crate profile `panic = "abort"` is unchanged.

**State is reusable across failures.** `encode()` writes `out.clear()` first; internal scratch is overwritten unconditionally. The user can fix one input and click Encode again without reloading.

## Build & test plumbing

### `Cargo.toml`

```toml
[dependencies]
libc = "0.2"
png = { version = "0.17", default-features = false }
```

### `build.rs`, `scripts/build.sh`

Unchanged. The encoder is pure Rust; nothing flows through `cc-rs`. wasi-sdk discovery is unaffected. Output is the same `web/tinybit_wasm.wasm`, slightly larger (~30–60 KB after LTO + strip).

### `scripts/smoke.mjs` — round-trip case

After the existing flappy.tb.png test:

1. **Fixtures** in `scripts/fixtures/`:
   - `smoke_cover.png` — 128×128 RGBA checkerboard.
   - `smoke_sprite.png` — 128×128 RGBA gradient.
   - `smoke_script.lua` — minimal script that calls `pset(10, 10, 0xFFFF)` in `_draw()`.
2. **Flow**:
   - `tb_enc_init`. Stage the three fixture files into slots 0, 1, 2. Stage UTF-8 `"smoke"` / `"ci"` into slots 4, 5. Set frame slot 3 length to 0 (use bundled frame). Call `tb_enc_set_header(1, 0, Math.floor(Date.now()/1000))`.
   - `n = tb_enc_run()` — assert `n > 0`.
   - Copy `n` bytes out of `tb_enc_output_ptr()` into a JS `Uint8Array`.
   - Reset player (`tb_stop` + re-init), feed those bytes via `tb_feed_buffer_ptr` / `tb_feed_cartridge`, `tb_start`, run 60 frames.
   - Assert `display[10 * 128 + 10] == 0xFFFF`. Proves: encoder → decoder round-trip + script execution.
3. **Negative case**: stage a 64×64 cover PNG into slot 0, assert `tb_enc_run() == -1` and that the error message contains "128×128".

### Rust unit tests

`cargo test --target x86_64-unknown-linux-gnu` runs:

- `header.rs`: golden vector against `tests/golden_header.bin` (captured from one C encoder run); canonical CRC-32 vectors (`""` → 0, `"123456789"` → `0xCBF43926`).
- `steg.rs`: `write_bytes` round-trip across the full 256-value byte range; `write_spritesheet` asserting only top 4 bits survive.
- `image.rs`: synthetic 128×128 PNG built in-test with the `png` crate, round-trip equality; 64×64 PNG → `EncError::CoverSize`; truncated bytes → `EncError::CoverPng(_)`.
- `mod.rs`: end-to-end — call `encode()` with synthetic inputs, re-parse resulting PNG, recover embedded header bytes, assert exact round-trip and script-CRC match.

### Documentation

- README "Play in a browser" section: mention the new "Create a cartridge" panel and that authored cartridges can be downloaded or played immediately.
- README "Limitations" section: remove the `"No cartridge export"` bullet. Add a brief note about the 32 621-byte script-size cap.

## Size budget (approximate)

| Area | Lines |
|---|---|
| `src/encoder/*.rs` (5 files) | ~500 |
| `src/lib.rs` (new exports) | ~80 |
| `Cargo.toml` | +1 |
| `assets/cartridge3.png` | binary asset |
| `web/index.html` | ~60 |
| `web/encoder.js` | ~150 |
| `web/wasm-runtime.js` (extracted) | ~80 (mostly moved, not new) |
| `web/index.js` | ~20 (delete moved code, add wiring) |
| `web/encoder.css` | ~50 |
| `scripts/smoke.mjs` (extended) | +80 |
| `scripts/fixtures/*` | 3 small fixture files |
| Rust `#[cfg(test)]` modules | ~250 |
| `tests/golden_header.bin` | binary fixture |
| `README.md` | ~6 edits |

Roughly 1 100 net new lines of Rust + JS plus tests and fixtures. Single feature, single PR.

## Out of scope

- Native CLI binary. The Rust encoder is callable from a host-side test target, but no `bin` target ships. If desired later, factor into a workspace crate (the "both" option deferred at brainstorm time).
- Image resizing. Cover and spritesheet must be exactly 128×128. Authors prep assets.
- Format-versioning logic. We write `format_version = 1` and never branch on it. Future format changes would land in a separate spec.
- Audio asset packing. There is no audio asset on the cartridge; audio is parsed from Lua-provided ABC strings at runtime by the engine.
- Game-selector / multi-cartridge bundles. The encoder produces exactly one cartridge per run.
