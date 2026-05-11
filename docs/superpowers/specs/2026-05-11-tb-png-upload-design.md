# TinyBit cartridge upload (in-wasm Rust decoder)

**Date:** 2026-05-11
**Scope:** Add a `.tb.png` upload path to the browser editor. The user picks a cartridge from the toolbar or drops it onto the window; the editor populates all five fields (title, author, spritesheet, cover, script) from the cartridge's embedded data. A new in-wasm Rust decoder, parallel to the existing encoder, does the work.

## Motivation

The editor today can author cartridges (encoder lives in-wasm, UI is the Cartridge tab) and download them as `.tb.png`. The opposite direction — *opening* an existing `.tb.png` to edit it — has no path. Without it, every authoring session starts from scratch: the user can't tweak a script in a cartridge a teammate shared, can't iterate on a downloaded cart, can't bisect by editing a known-good baseline.

The cartridge format is reversible: the payload (146-byte header → 32 768-byte spritesheet → script + NUL) lives in the low 2 bits of every RGBA channel, and the cover lives at full bit depth in the visible rect `(64, 60)–(192, 188)`. Everything the editor needs is in the file. We just need to read it back.

We write the decoder in **Rust**, not JS, for the same reasons the encoder is in Rust: the cartridge format spec is already coded against in `src/encoder/` and `src/tinybit/cartridge.c`; duplicating it in TS would put the format in two places. The `png` crate is already a dependency. The result is a single source of truth for the format, host-testable, panic-free under `panic = "abort"`.

## Cartridge format (reference)

Unchanged from the encoder spec (`2026-05-11-tb-encoder-design.md`). For the decoder we care about:

- **Cartridge PNG** is 256×256 RGBA8. Scan order: row-major, top-left to bottom-right.
- **Payload extraction:** each pixel's 4 channels × 2 low-bits = 1 byte of payload. Order: 146 B header, then 32 768 B packed spritesheet, then script bytes terminated by NUL.
- **Header** (146 bytes, little-endian): `format_version u16, flags u16, script_size u32, checksum u32, title[64], author[64], game_version u16, package_date u32`. `checksum` is CRC-32 over the script bytes only (reflected `0xEDB88320`).
- **Spritesheet** packs 1 source byte into 2 dest channels (2 bits each), carrying only the **top 4 bits** of each source byte. Reverse: each pair of dest channels reconstructs one source byte in its top 4 bits; bottom 4 bits are zero.
- **Cover** is composited into the visible rect `(64, 60)–(192, 188)` at full 8-bit RGBA before steganography overwrites the low 2 bits. Cropping the cartridge PNG at that rect recovers the cover with the low 2 bits noise-corrupted (effectively 6 bpc).

## Loss model on round-trip

The decode is **byte-exact for what the cartridge contains**, but the cartridge already lost data on the original encode:

| Field | Stored as | After decode |
|---|---|---|
| Title / Author | UTF-8, zero-padded to 64 bytes | Lossless |
| Script | Raw bytes, NUL-terminated | Lossless |
| Spritesheet | Top 4 bits of each input channel (4 bpc) | 128×128 PNG with each channel quantized to 4 bpc (values `0x00, 0x11, 0x22, …, 0xFF`). Visually identical to what the engine renders. |
| Cover | Full RGBA, **low 2 bits overwritten by steg** | 128×128 PNG at effective 6 bpc — identical to the visible cartridge image. |

Re-encoding without edits is near-lossless: the spritesheet round-trips perfectly (engine already operates at 4 bpc), and the cover re-encode overwrites its own low 2 bits again. No "this file was modified on round-trip" warning needed.

## Decisions

| | |
|---|---|
| Decoder runtime | New module in the existing `tinybit_wasm` crate, exported via new `tb_dec_*` `extern "C"` functions. Same single `editor/public/tinybit_wasm.wasm` artifact. |
| Side effects | None. The decoder does not touch `tinybit_memory`, `tb_feed_cartridge`, or the player. One concern, one code path. |
| Web UI | Two entry points: **(a)** "Open" button on the Toolbar, between Play and Download; **(b)** window-level drag-and-drop anywhere in the editor. |
| Confirm policy | A confirm dialog appears on **every** upload (per user choice). Cancel drops the file; Replace decodes and populates. |
| Auto-play | None. Upload populates fields only; user clicks Play when ready. |
| Format-version policy | Accept `format_version == 1`. Error on others (`DecError::HeaderVersionMismatch`). |
| CRC mismatch policy | Non-fatal. Surface as a flag (`crc_ok = false`); log a warning in the console pane; populate fields anyway. |
| Module layout | Submodule `src/decoder/{mod.rs, header.rs, steg.rs, image.rs, png_io.rs}`. Each file single-purpose, ≤ ~150 lines, host-testable. Symmetric with `src/encoder/`. |
| Testing | Rust `#[cfg(test)]` on host + new `scripts/smoke_decoder.mjs` doing wasm encode → wasm decode round-trip. TS adapter tests parallel to `encoder.test.ts`. Playwright E2E doing UI-level upload + Download round-trip. |

## Architecture

```
src/
├── lib.rs                # add tb_dec_* exports next to tb_enc_*
├── encoder/              # unchanged
└── decoder/              # NEW, parallel to encoder/
    ├── mod.rs            # decode() entrypoint + wasm-export glue + DecError
    ├── header.rs         # parse 146-byte header → struct + verify CRC32(script)
    ├── steg.rs           # low-2-bit byte / spritesheet readers (inverse of encoder)
    ├── image.rs          # decode 256×256 PNG, crop cover, expand spritesheet 4→8 bpc
    └── png_io.rs         # encode the two reconstructed 128×128 PNGs

editor/src/
├── engine/
│   ├── encoder.ts        # unchanged
│   └── decoder.ts        # NEW, mirrors encoder.ts shape
├── state/sketchStore.ts  # add loadCartridge(parts) batch action
└── ui/
    ├── Toolbar.tsx       # add "Open" button between Play and Download
    ├── App.tsx           # window-level drag-drop wiring + drag-over overlay
    └── UploadConfirm.tsx # NEW, modal confirm dialog
```

**No new dependencies.** The `png` crate is already in `Cargo.toml`. The TS decoder uses only existing primitives (`TextDecoder`, `Uint8Array`).

## Rust decoder pipeline

### `decoder/header.rs`

```rust
pub struct HeaderParts {
    pub format_version: u16,
    pub flags:          u16,
    pub script_size:    u32,
    pub checksum:       u32,
    pub title:          String,   // UTF-8 up to 63 bytes, NUL-trimmed
    pub author:         String,
    pub game_version:   u16,
    pub package_date:   u32,
}

pub fn parse(header_146: &[u8; 146]) -> HeaderParts;
pub fn verify_script_crc(script: &[u8], expected: u32) -> bool;
```

CRC32 reuses the encoder's routine (reflected polynomial `0xEDB88320`) — same constant, separate file is fine; trying to share via a `common/` module is over-abstraction for one function. Title and author are read as 64-byte fields, truncated at the first `\0`, then decoded as UTF-8 lossily (`String::from_utf8_lossy(...).into_owned()`) so a malformed cart still loads with `U+FFFD` characters rather than erroring.

### `decoder/steg.rs`

```rust
pub fn read_byte(src: &[u8], cursor: &mut usize) -> u8;
pub fn read_spritesheet_byte(src: &[u8], cursor: &mut usize) -> u8;
```

Sequential cursor through the 262 144-byte RGBA buffer. `read_byte` reads 4 channels × 2 low-bits → 1 byte (advances cursor by 4). `read_spritesheet_byte` reads 2 channels × 2 low-bits → 1 byte in the top 4 bits (advances cursor by 2). Inverse of `encoder::steg::write_bytes` and `write_spritesheet` respectively.

### `decoder/image.rs`

```rust
pub fn decode_cartridge_png(png_bytes: &[u8]) -> Result<[u8; 262_144], DecError>;
pub fn extract_cover_rgba(src256x256: &[u8; 262_144]) -> [u8; 65_536];
pub fn expand_spritesheet_to_rgba(packed_32768: &[u8]) -> [u8; 65_536];
```

- `decode_cartridge_png` — `png::Decoder` with transformations forcing RGBA8 (palette/grayscale expanded, alpha synthesized as `0xFF` when absent). Strict 256×256 size check, otherwise `DecError::CartridgeSize`.
- `extract_cover_rgba` — copies the visible rect `(64, 60)–(192, 188)` (128×128 RGBA = 65 536 bytes) into a fresh buffer.
- `expand_spritesheet_to_rgba` — for each packed byte `b` (already top-4-bits in the high nibble): emit `b | (b >> 4)`. Standard 4→8 bit expansion; `0xF0 → 0xFF`, `0x00 → 0x00`. This is the cleanest visual match to what the engine renders at its native 4 bpc.

### `decoder/png_io.rs`

```rust
pub fn encode_rgba(buf128x128: &[u8; 65_536], out: &mut Vec<u8>) -> Result<(), DecError>;
```

`png::Encoder`, RGBA8, bit depth 8, default filter. Writes into a caller-supplied `Vec<u8>` (one each for the sprite-PNG and cover-PNG output buffers in `DecoderState`). No per-call allocation churn.

### `decoder/mod.rs`

```rust
pub enum DecError {
    CartridgePng(&'static str),
    CartridgeSize,
    HeaderVersionMismatch { found: u16 },
    ScriptOverrun,
    PngWrite(&'static str),
}

impl DecError {
    pub fn code(&self) -> i32;       // -1..=-5 mapping
    pub fn message(&self) -> String; // user-facing
}

pub struct Decoded {
    pub header:     HeaderParts,
    pub script_len: usize,    // bytes in script_buf, excludes trailing NUL
    pub crc_ok:     bool,     // computed vs header.checksum
}

pub fn decode(
    cartridge_png:  &[u8],
    sprite_png_out: &mut Vec<u8>,
    cover_png_out:  &mut Vec<u8>,
    script_buf:     &mut [u8; 32_621],
) -> Result<Decoded, DecError>;
```

Pipeline:

1. **Decode the cartridge PNG** to a 262 144-byte RGBA buffer (size-checked).
2. **Unpack header bytes** — 146 reads via `steg::read_byte`. Parse with `header::parse`. If `format_version != 1`, fail with `HeaderVersionMismatch`.
3. **Unpack spritesheet** — 32 768 reads via `steg::read_spritesheet_byte` into a scratch `[u8; 32_768]`. Expand to 8-bit RGBA (65 536 bytes). PNG-encode → `sprite_png_out`.
4. **Unpack script** — read bytes via `steg::read_byte` until the first `0x00`. The script region of the cartridge can hold up to 32 622 bytes total (matches the encoder's `script_len ≤ 32 621` plus the trailing NUL). If we read 32 622 bytes without seeing NUL, fail with `ScriptOverrun`. Store the non-NUL bytes in `script_buf`, return `script_len` (≤ 32 621).
5. **Extract cover** — crop visible rect from step 1's RGBA buffer. PNG-encode → `cover_png_out`.
6. **CRC check** — recompute CRC32 over `script_buf[..script_len]`, compare with `header.checksum`, set `crc_ok`.

`crc_ok = false` is **not** an error. Older cartridges or hand-rolled ones may have wrong CRCs; we still want to load them. JS surfaces it as a console warning.

## FFI surface (new wasm exports)

| Export | Purpose |
|---|---|
| `tb_dec_init() -> u32` | Allocate `DecoderState`. Idempotent. Returns 1 on success. |
| `tb_dec_input_ptr() -> *mut u8` | Pointer to the cartridge-PNG staging buffer in wasm memory. |
| `tb_dec_input_cap() -> u32` | Capacity of the staging buffer (2 MiB — comfortable headroom for 256×256 RGBA8 PNGs). |
| `tb_dec_run(len: u32) -> i32` | Run the full decode. Returns 0 on success, or a negative `DecError` code. |
| `tb_dec_sprite_ptr() -> *const u8` / `tb_dec_sprite_len() -> u32` | Reconstructed 128×128 sprite PNG bytes. |
| `tb_dec_cover_ptr() -> *const u8`  / `tb_dec_cover_len() -> u32`  | Reconstructed 128×128 cover PNG bytes. |
| `tb_dec_script_ptr() -> *const u8` / `tb_dec_script_len() -> u32` | Script bytes, **excluding** trailing NUL. |
| `tb_dec_title_ptr() -> *const u8`  / `tb_dec_title_len() -> u32`  | Title UTF-8 bytes (≤ 63), pre-NUL-trimmed. |
| `tb_dec_author_ptr() -> *const u8` / `tb_dec_author_len() -> u32` | Author UTF-8 bytes (≤ 63), pre-NUL-trimmed. |
| `tb_dec_meta() -> u64` | Bit-packed: `format_version (u16) \| flags (u16)<<16 \| game_version (u16)<<32 \| crc_ok (u8)<<48`. |
| `tb_dec_package_date() -> u32` | The 32-bit Unix timestamp from the header. Separate export because it doesn't fit alongside the other three u16s in a single u64. |
| `tb_dec_error_ptr() -> *const u8` / `tb_dec_error_len() -> u32` | UTF-8 error message for the last failed run. |

**Error codes** from `tb_dec_run`:
- `-1` cartridge PNG invalid (decode error from `png` crate)
- `-2` cartridge PNG wrong dimensions (not 256×256)
- `-3` header `format_version` unsupported (we accept `== 1`)
- `-4` script overrun (no NUL within 32 621 bytes)
- `-5` PNG re-encode failure for sprite or cover (safety net)

Every negative return pairs with a UTF-8 message via `tb_dec_error_ptr` / `tb_dec_error_len` — same pattern as the encoder. JS treats `< 0` uniformly: read the message, surface it to the console pane.

**Memory:** single `static mut DecoderState` initialized by `tb_dec_init`, same shape as the encoder's state. Buffers (`Vec<u8>` for sprite/cover output, `[u8; 32_621]` for script, scratch `[u8; 32_768]` for packed spritesheet) reused across decode calls — `Vec`s are cleared, not reallocated.

## End-to-end data flow

```
JS                                          WASM
─────────────────────────────────────       ─────────────────────────────────────
1. User picks/drops a .tb.png file
2. JS sniff: readPngSize(bytes) must
   return 256×256, else show error.
3. <UploadConfirm /> opens. On Cancel,
   abort; on Replace, proceed.
4. ensureDecoderInit() once per page.
5. ptr = tb_dec_input_ptr()           →    (returns offset into wasm mem)
   wasmMem.set(bytes, ptr)
6. rc = tb_dec_run(bytes.length)      →    Decode PNG, validate size + version,
                                            unpack header/sprite/script,
                                            crop+PNG-encode cover and sprite.
   if rc < 0:                                Returns 0 on success.
     read tb_dec_error_* → log
     abort
7. Read seven slices:
     sprite = Uint8Array(mem,
       tb_dec_sprite_ptr(),
       tb_dec_sprite_len()).slice()
     cover  = … (same shape)
     script = TextDecoder.decode(
       Uint8Array(mem,
         tb_dec_script_ptr(),
         tb_dec_script_len()))
     title  = TextDecoder.decode(…)
     author = TextDecoder.decode(…)
     meta   = tb_dec_meta()
8. sketchStore.loadCartridge({
     title, author, sprite, cover, script
   })
9. Console: "Loaded '{title}' by {author}"
   If !crcOk → also log
   "CRC mismatch (script may be corrupted)"
```

All `.slice()` copies happen before the next wasm call so the JS-side buffers survive any later `memory.grow`.

## JS / UI integration

### `editor/src/engine/decoder.ts`

Mirrors `encoder.ts` exactly in shape: typed `DecoderExports` interface, `makeDecoder(ex)` factory returning a `Decoder` with one method `decode(cartridgePng) → DecodedCartridge`.

```ts
export interface DecodedCartridge {
    title:  string;
    author: string;
    sprite: Uint8Array;   // 128×128 PNG bytes
    cover:  Uint8Array;   // 128×128 PNG bytes
    script: string;       // UTF-8 decoded, no trailing NUL
    formatVersion: number;
    gameVersion:   number;
    flags:         number;
    packageDate:   number;
    crcOk:         boolean;
}

export class DecodeError extends Error { code: number; /* … */ }
```

The factory copies via `.slice()` for the four byte arrays and `TextDecoder`-s the three strings before returning, so the result is safe to hold across later wasm calls.

### `editor/src/state/sketchStore.ts`

Add one batch action so all five fields update in a single render tick:

```ts
loadCartridge(parts: {
    title:  string;
    author: string;
    sprite: Uint8Array;
    cover:  Uint8Array;
    script: string;
}): void;
```

Existing per-field setters stay; they're still used by the Cartridge tab and code editor.

### Toolbar — `editor/src/ui/Toolbar.tsx`

A new **Open** button between Play and Download. Click triggers a hidden `<input type="file" accept=".tb.png,image/png">` and pipes the file through the upload handler. `data-testid="open-input"`.

### Drag-and-drop — `editor/src/ui/App.tsx`

Window-level `dragover` (calls `e.preventDefault()` so `drop` fires) and `drop` listeners installed in a `useEffect`. Filter: exactly one file; name ends in `.tb.png` **or** `readPngSize` succeeds with 256×256. Anything else: ignored.

Drag affordance: a full-window overlay (`<div>` with `pointer-events: none`, semi-transparent background, centered "Drop .tb.png to open" text) toggled by `dragenter` / `dragleave` / `drop`. ~30 lines of CSS; no library.

### Confirm dialog — `editor/src/ui/UploadConfirm.tsx`

Tiny portal-mounted modal. Shown on **every** upload attempt (per user choice — no dirty-state check). Two buttons: **Replace** (proceeds with decode) and **Cancel** (drops the file, no state change). The dialog renders the cartridge filename so the user sees which file they're about to load.

### Upload handler flow

```
1. Read file → Uint8Array (await file.arrayBuffer())
2. Sniff: readPngSize(bytes) — must be 256×256, else show
   console error "Not a TinyBit cartridge (expected 256×256 PNG)" and abort.
3. Open <UploadConfirm filename={file.name} /> — await user choice.
   Cancel → abort silently.
4. decoder.decode(bytes)
   - on DecodeError → console.error(message), abort.
5. sketchStore.loadCartridge(parts)
6. Console pane: "Loaded '{title}' by {author}".
   If !parts.crcOk: also console.warn(
     "Loaded with CRC mismatch (script may be corrupted)").
```

## Error handling

| Boundary | Detected by | Surfaced as |
|---|---|---|
| **Pre-decode (JS)** | `readPngSize` returns null or dims ≠ 256×256, or file > 2 MiB (staging cap) | Console pane: `"Not a TinyBit cartridge (expected 256×256 PNG)"`. Wasm not called. |
| **Decoder (Rust)** | `DecError` variants from `decode()` | `tb_dec_run` returns negative code; JS reads UTF-8 message via `tb_dec_error_*` and logs verbatim. |
| **CRC mismatch** | `crc_ok == false` in the success path | Non-fatal. Console pane warns. Fields still populated. |
| **Confirm cancelled** | `<UploadConfirm>` Cancel button | No state change, no message. |

Example messages (verbatim from `DecError::message()`):
- `"Cartridge PNG decode failed: chunk crc mismatch"` (-1)
- `"Cartridge must be 256×256 (got 128×128)"` (-2)
- `"Unsupported cartridge format_version 2 (this build supports 1)"` (-3)
- `"Script overruns cartridge buffer (no NUL terminator in 32621 bytes)"` (-4)
- `"Failed to re-encode sprite PNG: …"` (-5)

**State is reusable across failures.** `decode()` clears its output `Vec`s first; the script buffer is overwritten as it reads. A bad upload doesn't poison the next.

**The decoder never panics on bad input.** Every `?` in the pipeline maps to a `DecError` variant. Crate profile `panic = "abort"` is unchanged.

## Testing strategy

### Rust unit tests (`cargo test --target x86_64-unknown-linux-gnu`)

- **`decoder/header.rs`** — CRC golden vectors shared with the encoder (`""` → 0, `"123456789"` → `0xCBF43926`); round-trip pack/parse equality on synthetic `HeaderParts`.
- **`decoder/steg.rs`** — for every byte `0..=255`: `read_byte` recovers the byte written by `encoder::steg::write_bytes`. For spritesheet: `read_spritesheet_byte` recovers `b & 0xF0` (top 4 bits) after `write_spritesheet`.
- **`decoder/image.rs`** — synthetic 128×128 PNG round-tripped through encoder→decoder; cover crop equals input within the 2-bpc steg mask (high 6 bits exact); spritesheet expand: `expand_spritesheet_to_rgba([0xF0]) == [0xFF]`, `[0x00] == [0x00]`, `[0xA0] == [0xAA]`.
- **`decoder/mod.rs`** — end-to-end: encode a cartridge with the encoder using synthetic inputs (cover + spritesheet + script + headers), feed the resulting PNG bytes to the decoder, assert:
  - parsed `HeaderParts` matches the encoder's `HeaderOpts` exactly;
  - decoded script equals input;
  - `crc_ok == true`;
  - decoded spritesheet bytes (after re-decoding the output sprite PNG) equal `input_spritesheet & 0xF0F0F0F0…` channel-wise;
  - decoded cover bytes (after re-decoding the output cover PNG) equal `input_cover & 0xFCFCFCFC…` channel-wise.

### WASM smoke (`scripts/smoke_decoder.mjs`, new)

1. Load the built `.wasm` under the existing WASI shim used by `smoke_encoder.mjs`.
2. `tb_enc_init` → encode a tiny fixture cartridge (reuse the encoder smoke's fixture path).
3. `tb_dec_init` → stage those bytes → `tb_dec_run(len)` → assert returns 0.
4. Read sprite/cover/script/title/author pointers; assert lengths and decoded content match the encoder's input bytes (sprite/cover compared under the steg masks above; script and strings byte-exact).
5. **Negative case:** truncate the cartridge by 1 000 bytes, assert `tb_dec_run` returns `-1` and the error message mentions PNG decode failure.

### TS adapter tests

- **`engine/decoder.test.ts`** — same fake-exports pattern as `encoder.test.ts`. Verifies the JS adapter:
  - copies via `.slice()` (mutating wasm memory after `decode()` doesn't affect the returned arrays);
  - decodes UTF-8 title/author/script;
  - unpacks `tb_dec_meta()` bitfield into `formatVersion`, `flags`, `gameVersion`, `crcOk`;
  - throws `DecodeError` with the wasm-supplied message on negative return codes.
- **`state/sketchStore.test.ts`** — extend: `loadCartridge(parts)` sets all five fields atomically; per-field setters still work after a load.

### UI tests

- **`ui/Toolbar.test.tsx`** — Open button renders; hidden file input has `accept=".tb.png,image/png"`.
- **`ui/UploadConfirm.test.tsx`** — appears on every upload, renders the filename, Cancel dismisses without firing the callback, Replace fires the callback exactly once.

### Playwright E2E (`tests/upload.spec.ts`, new)

1. Boot the editor.
2. Programmatically upload a fixture `.tb.png` via the Open input.
3. Assert the confirm dialog appears.
4. Click Replace.
5. Assert all five fields populate (title, author, sprite thumb visible, cover thumb visible, script content matches expected).
6. Click Download.
7. Capture the download, feed it back through the same upload flow.
8. Assert title/author/script round-trip byte-exact; sprite/cover round-trip under the steg masks (i.e. visually identical, byte-stable).

### Existing tests

`scripts/smoke.mjs`, `scripts/smoke_encoder.mjs`, all current Vitest/Playwright suites — untouched, must continue passing.

## Build & test plumbing

### `Cargo.toml`

No changes. `png` is already a dependency.

### `build.rs`, `scripts/build.sh`

No changes. Decoder is pure Rust; nothing flows through `cc-rs`.

### Documentation

- `README.md` "Create a cartridge" section: add a short paragraph on opening an existing `.tb.png` (Toolbar **Open** or drag-and-drop), noting that all five editor fields are populated from the cartridge.
- Limitations: note that `format_version != 1` cartridges are rejected.

## Size budget (approximate)

| Area | Lines |
|---|---|
| `src/decoder/*.rs` (5 files) | ~400 |
| `src/lib.rs` (new exports) | ~120 |
| `editor/src/engine/decoder.ts` | ~140 |
| `editor/src/state/sketchStore.ts` (`loadCartridge`) | ~10 |
| `editor/src/ui/Toolbar.tsx` (Open button) | ~25 |
| `editor/src/ui/UploadConfirm.tsx` (new) | ~60 |
| `editor/src/App.tsx` (drag-drop + overlay) | ~40 |
| `editor/src/ui/upload.css` (drag overlay) | ~30 |
| `scripts/smoke_decoder.mjs` (new) | ~100 |
| Rust `#[cfg(test)]` modules | ~200 |
| TS unit/UI tests | ~150 |
| Playwright `tests/upload.spec.ts` | ~80 |
| `README.md` | ~6 edits |

Roughly 1 350 net new lines. Single feature, single PR.

## Out of scope

- **Cartridge format migration.** We accept `format_version == 1` and error on others. Future versions get their own decoder branch in a separate spec.
- **Multi-file / batch upload.** One cartridge at a time.
- **Recovery from corrupted steg.** If the PNG decodes to 256×256 RGBA but the embedded payload is garbage, we return the garbage as best-effort. The CRC mismatch warning is the user's signal. No "deep validation" beyond CRC.
- **Spritesheet/cover "original PNG" recovery.** The cartridge stores the lossy versions; that's what we extract. Documented behavior.
- **Preserving the source filename.** The editor doesn't track a "current file" concept; re-download still derives its filename from the title.
- **Touching the player.** `tb_feed_cartridge` and friends are untouched. The decoder is side-effect-free.
- **Auto-play on upload.** Populates fields only; user clicks Play when ready.

## Risks

- **`tb_dec_meta` bit layout drift.** The Rust packer and the JS unpacker must agree on shift offsets (`format_version` bits 0–15, `flags` 16–31, `game_version` 32–47, `crc_ok` 48). The smoke test asserts an exact round-trip on every field, so any drift surfaces immediately.
- **Confirm dialog UX on first load.** Every upload prompts, including the first one when the editor is empty — slightly noisy. Trade-off was explicitly chosen for predictability over leniency. Easy to relax later by switching to a dirty-state check; the dialog component doesn't need to change.
- **2 MiB staging cap.** A maliciously huge PNG would be rejected pre-decode. 256×256 RGBA8 with default filter compresses to well under 200 KiB in practice; 2 MiB is comfortable headroom.
- **Cartridge with `format_version > 1` in the wild.** None exist today (encoder writes `1`, engine doesn't branch on it). If/when v2 lands, the decoder spec is updated alongside it.

## Follow-ups

- Relax the confirm dialog to dirty-state-only if the always-prompt UX proves noisy.
- Surface the parsed header metadata (game_version, package_date) somewhere in the editor — currently we extract them but don't display them.
- Drag-and-drop hint in the empty-editor state (e.g. "Drop a `.tb.png` here or click Open").
