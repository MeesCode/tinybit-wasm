# TinyBit .tb.png upload implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure-Rust in-wasm decoder, exposed via a Toolbar **Open** button and window-level drag-and-drop, that populates the editor's title / author / spritesheet / cover / script fields from an uploaded `.tb.png`.

**Architecture:** New `src/decoder/` module parallel to `src/encoder/`, with its own `tb_dec_*` WASM exports and a `DecoderState` modelled on `EncoderState`. JS-side `editor/src/engine/decoder.ts` adapter mirrors `encoder.ts`. UI: toolbar button + window drag-drop → confirm dialog → decode → batch-load into `sketchStore`. No new dependencies on either side (the `png` crate is already in `Cargo.toml`).

**Tech Stack:** Rust (`png = 0.17`, `wasm32-wasip1`), TypeScript / React 18 / Zustand, Vite, Vitest, Playwright, Node-side WASI shim for smoke tests.

**Spec:** `docs/superpowers/specs/2026-05-11-tb-png-upload-design.md` (commit `925ce03`)

---

## File map

**New files**

- `src/decoder/mod.rs` — `DecError`, `Decoded`, `decode()` entrypoint, integration tests
- `src/decoder/header.rs` — `HeaderParts`, `parse()`, `verify_script_crc()`
- `src/decoder/steg.rs` — `read_byte`, `read_spritesheet_byte`
- `src/decoder/image.rs` — `decode_cartridge_png`, `extract_cover_rgba`, `expand_spritesheet_to_rgba`
- `src/decoder/png_io.rs` — `encode_rgba_128x128`
- `editor/src/engine/decoder.ts` — `makeDecoder`, `DecodeError`, `DecodedCartridge`
- `editor/src/engine/decoder.test.ts` — adapter unit tests
- `editor/src/ui/UploadConfirm.tsx` — modal dialog
- `editor/src/ui/UploadConfirm.test.tsx` — modal unit tests
- `scripts/smoke_decoder.mjs` — Node WASI round-trip smoke
- `editor/tests/e2e/upload.spec.ts` — Playwright upload + re-download round-trip

**Modified files**

- `src/lib.rs` — declare `mod decoder`; add `DecoderState`, `DEC_STATE` thread-local, `tb_dec_*` exports
- `editor/src/engine/runtime.ts` — extend `Runtime` with `dec: Decoder`; wire `makeDecoder`
- `editor/src/state/sketchStore.ts` — add `loadCartridge()` batch action
- `editor/src/state/sketchStore.test.ts` — `loadCartridge` test
- `editor/src/ui/Toolbar.tsx` — add **Open** button + props
- `editor/src/ui/Toolbar.test.tsx` — Open button tests
- `editor/src/App.tsx` — upload handler + drag-drop overlay + glue
- `editor/tests/fixtures/make-fixtures.mjs` — produce `upload-cart.tb.png` fixture used by Playwright (built via the encoder; one-shot script)
- `README.md` — short paragraph on Open / drag-drop

---

## Task 1: Rust decoder — `decoder/header.rs`

**Files:**
- Create: `src/decoder/header.rs`

This file mirrors `src/encoder/header.rs` in reverse: take 146 bytes, produce a `HeaderParts` struct plus a `verify_script_crc(...)` helper.

- [ ] **Step 1: Write the failing test**

Append the file with the tests so the first compile fails (no module, no functions). Create the file with this content:

```rust
//! Parse the 146-byte cartridge header. Inverse of `encoder::header::pack`.

use crate::encoder::header::{crc32, AUTHOR_SIZE, HEADER_SIZE, TITLE_SIZE};

#[derive(Debug, PartialEq, Eq)]
pub struct HeaderParts {
    pub format_version: u16,
    pub flags:          u16,
    pub script_size:    u32,
    pub checksum:       u32,
    pub title:          String,
    pub author:         String,
    pub game_version:   u16,
    pub package_date:   u32,
}

pub fn parse(bytes: &[u8; HEADER_SIZE]) -> HeaderParts {
    let format_version = u16::from_le_bytes([bytes[0], bytes[1]]);
    let flags          = u16::from_le_bytes([bytes[2], bytes[3]]);
    let script_size    = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let checksum       = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);

    let title  = read_nul_terminated(&bytes[12..12 + TITLE_SIZE]);
    let author = read_nul_terminated(&bytes[76..76 + AUTHOR_SIZE]);

    let game_version = u16::from_le_bytes([bytes[140], bytes[141]]);
    let package_date = u32::from_le_bytes([bytes[142], bytes[143], bytes[144], bytes[145]]);

    HeaderParts {
        format_version, flags, script_size, checksum,
        title, author, game_version, package_date,
    }
}

fn read_nul_terminated(field: &[u8]) -> String {
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).into_owned()
}

pub fn verify_script_crc(script: &[u8], expected: u32) -> bool {
    crc32(script) == expected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::header::{pack, HeaderOpts};

    #[test]
    fn parse_round_trips_encoder_pack() {
        let opts = HeaderOpts {
            title: "hello world",
            author: "tester",
            format_version: 1,
            flags: 0xBEEF,
            game_version: 7,
            package_date: 0xDEADBEEF,
        };
        let script = b"function _draw() end\n";
        let packed = pack(&opts, script);
        let parts = parse(&packed);

        assert_eq!(parts.format_version, 1);
        assert_eq!(parts.flags, 0xBEEF);
        assert_eq!(parts.script_size, script.len() as u32);
        assert_eq!(parts.checksum, crc32(script));
        assert_eq!(parts.title, "hello world");
        assert_eq!(parts.author, "tester");
        assert_eq!(parts.game_version, 7);
        assert_eq!(parts.package_date, 0xDEADBEEF);
    }

    #[test]
    fn parse_trims_at_nul_even_with_garbage_after() {
        let mut h = [0xFFu8; HEADER_SIZE];
        // Zero the scalar fields so they parse cleanly.
        h[0..2].copy_from_slice(&1u16.to_le_bytes());
        h[2..4].copy_from_slice(&0u16.to_le_bytes());
        h[4..8].copy_from_slice(&0u32.to_le_bytes());
        h[8..12].copy_from_slice(&0u32.to_le_bytes());
        h[140..142].copy_from_slice(&1u16.to_le_bytes());
        h[142..146].copy_from_slice(&0u32.to_le_bytes());

        // Write "hi\0" into the title field; leave the rest of the field as
        // 0xFF garbage. parse() must stop at the NUL.
        h[12] = b'h';
        h[13] = b'i';
        h[14] = 0;

        let parts = parse(&h);
        assert_eq!(parts.title, "hi");
    }

    #[test]
    fn parse_handles_full_63_byte_title_without_overflow() {
        // Title fills 63 ASCII bytes; byte 63 is NUL by convention.
        let long = "a".repeat(63);
        let opts = HeaderOpts {
            title: &long,
            author: "",
            format_version: 1, flags: 0, game_version: 1, package_date: 0,
        };
        let packed = pack(&opts, b"");
        let parts = parse(&packed);
        assert_eq!(parts.title, long);
    }

    #[test]
    fn verify_script_crc_matches_encoder() {
        let script = b"print('hi')";
        let cs = crc32(script);
        assert!(verify_script_crc(script, cs));
        assert!(!verify_script_crc(script, cs.wrapping_add(1)));
    }
}
```

Also, in `src/lib.rs`, add `mod decoder;` near the existing `mod encoder;` so the new module is reachable. And create the parent module file:

```bash
mkdir -p src/decoder
```

Create `src/decoder/mod.rs` with just:

```rust
//! In-browser cartridge decoder. Pure Rust, no dependence on the C engine.

pub mod header;
```

- [ ] **Step 2: Run tests to verify they fail (or pass — write before you confirm)**

Run: `cargo test --target x86_64-unknown-linux-gnu decoder::header -- --nocapture`
Expected: PASS (this is a self-contained module with its own tests; if anything is off, fix it before committing).

- [ ] **Step 3: Commit**

```bash
git add src/lib.rs src/decoder/mod.rs src/decoder/header.rs
git commit -m "decoder: parse the 146-byte cartridge header"
```

---

## Task 2: Rust decoder — `decoder/steg.rs`

**Files:**
- Create: `src/decoder/steg.rs`
- Modify: `src/decoder/mod.rs` (add `pub mod steg;`)

Inverse of `encoder/steg.rs`. Reads bytes back out of the low 2 bits of an RGBA buffer.

- [ ] **Step 1: Write the file with tests inline**

Create `src/decoder/steg.rs`:

```rust
//! Low-2-bit steganography READERS. Inverse of encoder::steg.

/// Read 1 src byte from 4 dest channels' low 2 bits. Advances cursor by 4.
pub fn read_byte(src: &[u8], cursor: &mut usize) -> u8 {
    let a = src[*cursor]     & 0x3;
    let b = src[*cursor + 1] & 0x3;
    let c = src[*cursor + 2] & 0x3;
    let d = src[*cursor + 3] & 0x3;
    *cursor += 4;
    (a << 6) | (b << 4) | (c << 2) | d
}

/// Read 1 spritesheet byte (top 4 bits only) from 2 dest channels' low 2 bits.
/// Bottom 4 bits of the returned byte are always zero. Advances cursor by 2.
pub fn read_spritesheet_byte(src: &[u8], cursor: &mut usize) -> u8 {
    let a = src[*cursor]     & 0x3;
    let b = src[*cursor + 1] & 0x3;
    *cursor += 2;
    (a << 6) | (b << 4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::steg::{write_bytes, write_spritesheet};

    #[test]
    fn read_byte_round_trips_full_byte_range() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        // The buffer starts with non-zero high bits so we can prove the
        // reader truly ignores them.
        let mut buf = vec![0xF8u8; src.len() * 4];
        let mut wc = 0;
        write_bytes(&mut buf, &mut wc, &src);

        let mut rc = 0;
        for (i, &orig) in src.iter().enumerate() {
            let got = read_byte(&buf, &mut rc);
            assert_eq!(got, orig, "byte {i}: round-trip mismatch");
        }
        assert_eq!(rc, src.len() * 4);
    }

    #[test]
    fn read_spritesheet_byte_recovers_only_top_4_bits() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        let mut buf = vec![0u8; src.len() * 2];
        let mut wc = 0;
        write_spritesheet(&mut buf, &mut wc, &src);

        let mut rc = 0;
        for (i, &orig) in src.iter().enumerate() {
            let got = read_spritesheet_byte(&buf, &mut rc);
            assert_eq!(got, orig & 0xF0, "byte {i}: top-nibble mismatch");
        }
        assert_eq!(rc, src.len() * 2);
    }

    #[test]
    fn cursor_chains_across_calls() {
        let mut buf = vec![0u8; 16];
        let mut wc = 0;
        write_bytes(&mut buf, &mut wc, &[0xAB, 0xCD]);
        write_spritesheet(&mut buf, &mut wc, &[0xEF]);

        let mut rc = 0;
        assert_eq!(read_byte(&buf, &mut rc), 0xAB);
        assert_eq!(read_byte(&buf, &mut rc), 0xCD);
        assert_eq!(read_spritesheet_byte(&buf, &mut rc), 0xE0);
        assert_eq!(rc, wc);
    }
}
```

Update `src/decoder/mod.rs`:

```rust
//! In-browser cartridge decoder. Pure Rust, no dependence on the C engine.

pub mod header;
pub mod steg;
```

- [ ] **Step 2: Run tests**

Run: `cargo test --target x86_64-unknown-linux-gnu decoder::steg`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/decoder/mod.rs src/decoder/steg.rs
git commit -m "decoder: low-2-bit byte and spritesheet readers"
```

---

## Task 3: Rust decoder — `decoder/image.rs`

**Files:**
- Create: `src/decoder/image.rs`
- Modify: `src/decoder/mod.rs` (add `pub mod image;`)

Handles three pure-RGBA operations: decode a 256×256 PNG, crop the visible cover rect, and expand a packed 4-bpc spritesheet to 8-bit RGBA.

- [ ] **Step 1: Write the file with tests inline**

Create `src/decoder/image.rs`:

```rust
//! PNG → RGBA8 decode for the 256×256 cartridge image, plus pixel-level helpers
//! that mirror the encoder's `image.rs` in reverse.

use crate::encoder::image::{
    decode_256x256_rgba, CART_RGBA_LEN, CART_W, COVER_X, COVER_Y, ImageError,
    SCREEN_H, SCREEN_RGBA_LEN, SCREEN_W,
};

/// Decode a 256×256 RGBA8 cartridge PNG into a caller-owned buffer.
/// Thin wrapper around the encoder's existing `decode_256x256_rgba`.
pub fn decode_cartridge_png(
    png_bytes: &[u8],
    dest: &mut [u8; CART_RGBA_LEN],
) -> Result<(), ImageError> {
    decode_256x256_rgba(png_bytes, dest)
}

/// Crop the visible cover rect (64,60)–(192,188) into a 128×128 RGBA buffer.
pub fn extract_cover_rgba(
    canvas: &[u8; CART_RGBA_LEN],
    dest: &mut [u8; SCREEN_RGBA_LEN],
) {
    for y in 0..SCREEN_H {
        let src_row = (COVER_Y + y) * CART_W + COVER_X;
        let dst_row = y * SCREEN_W;
        for x in 0..SCREEN_W {
            let s = (src_row + x) * 4;
            let d = (dst_row + x) * 4;
            dest[d]     = canvas[s];
            dest[d + 1] = canvas[s + 1];
            dest[d + 2] = canvas[s + 2];
            dest[d + 3] = canvas[s + 3];
        }
    }
}

/// Expand a packed spritesheet buffer (each byte has its data in the high
/// nibble, courtesy of `read_spritesheet_byte`) into an 8-bit RGBA buffer.
/// One source byte → one dest channel: `b | (b >> 4)` (standard 4→8 bit
/// replicate-high; 0xF0 → 0xFF, 0x00 → 0x00).
///
/// The encoder writes `SCREEN_RGBA_LEN` (65 536) source bytes via
/// `write_spritesheet`; the decoder reads back the same 65 536 bytes via
/// `read_spritesheet_byte`. So the packed buffer is sized to match the RGBA
/// output, not the 32 768 cartridge pixels they're stored across.
pub fn expand_spritesheet(
    packed: &[u8; SCREEN_RGBA_LEN],
    rgba: &mut [u8; SCREEN_RGBA_LEN],
) {
    for (i, &b) in packed.iter().enumerate() {
        rgba[i] = b | (b >> 4);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_solid_256_png(rgba: [u8; 4]) -> Vec<u8> {
        let mut buf = Vec::new();
        let mut e = png::Encoder::new(&mut buf, 256, 256);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut w = e.write_header().unwrap();
        let data: Vec<u8> = (0..256 * 256).flat_map(|_| rgba.iter().copied()).collect();
        w.write_image_data(&data).unwrap();
        drop(w);
        buf
    }

    #[test]
    fn decode_cartridge_png_round_trips_via_encoder_decode() {
        let png = make_solid_256_png([0x11, 0x22, 0x33, 0xFF]);
        let mut buf = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = buf.as_mut().try_into().unwrap();
        decode_cartridge_png(&png, arr).unwrap();
        assert_eq!(arr[0], 0x11);
        assert_eq!(arr[1], 0x22);
        assert_eq!(arr[2], 0x33);
        assert_eq!(arr[3], 0xFF);
    }

    #[test]
    fn extract_cover_returns_visible_rect() {
        let mut canvas = vec![0xAAu8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        for y in 0..SCREEN_H {
            for x in 0..SCREEN_W {
                let p = ((COVER_Y + y) * CART_W + (COVER_X + x)) * 4;
                arr[p]     = x as u8;
                arr[p + 1] = y as u8;
                arr[p + 2] = (x ^ y) as u8;
                arr[p + 3] = 0xFF;
            }
        }
        let mut cover = [0u8; SCREEN_RGBA_LEN];
        extract_cover_rgba(arr, &mut cover);
        assert_eq!(cover[0], 0);
        assert_eq!(cover[3], 0xFF);
        let last = (127 * SCREEN_W + 127) * 4;
        assert_eq!(cover[last], 127);
        assert_eq!(cover[last + 1], 127);
        let mid = (7 * SCREEN_W + 5) * 4;
        assert_eq!(cover[mid + 2], 5u8 ^ 7u8);
    }

    #[test]
    fn expand_spritesheet_replicates_high_nibble() {
        let mut packed = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        for (i, p) in packed.iter_mut().enumerate() {
            *p = ((i & 0x0F) as u8) << 4; // top nibble cycles 0..F
        }
        let parr: &[u8; SCREEN_RGBA_LEN] = packed.as_ref().try_into().unwrap();

        let mut rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let rarr: &mut [u8; SCREEN_RGBA_LEN] = rgba.as_mut().try_into().unwrap();
        expand_spritesheet(parr, rarr);

        for (i, &b) in parr.iter().enumerate() {
            assert_eq!(rarr[i], b | (b >> 4), "channel {i}: bad expansion");
        }
    }

    /// End-to-end: paint a 6-bpc-clean cover into a 256×256 canvas, encode it
    /// to PNG, decode back, crop the visible rect, and assert the high 6 bits
    /// of every channel survived. (Low 2 bits would be steg-overwritten by a
    /// full encode pipeline; here we just exercise the image path.)
    #[test]
    fn cover_survives_round_trip_at_6_bpc() {
        use crate::encoder::png_io::encode_rgba;

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        for y in 0..SCREEN_H {
            for x in 0..SCREEN_W {
                let p = ((COVER_Y + y) * CART_W + (COVER_X + x)) * 4;
                arr[p]     = ((x ^ y) as u8) & 0xFC;
                arr[p + 1] = ((x.wrapping_add(y)) as u8) & 0xFC;
                arr[p + 2] = (x as u8) & 0xFC;
                arr[p + 3] = 0xFF;
            }
        }
        let mut png_out = Vec::new();
        encode_rgba(arr, &mut png_out).unwrap();

        let mut canvas2 = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr2: &mut [u8; CART_RGBA_LEN] = canvas2.as_mut().try_into().unwrap();
        decode_cartridge_png(&png_out, arr2).unwrap();

        let mut cover = [0u8; SCREEN_RGBA_LEN];
        extract_cover_rgba(arr2, &mut cover);

        let p = (4 * SCREEN_W + 3) * 4;
        assert_eq!(cover[p],     (3u8 ^ 4u8) & 0xFC);
        assert_eq!(cover[p + 1], (3u8.wrapping_add(4)) & 0xFC);
        assert_eq!(cover[p + 2], 3u8 & 0xFC);
        assert_eq!(cover[p + 3], 0xFF);
    }
}
```

Also update `src/decoder/mod.rs`:

```rust
//! In-browser cartridge decoder. Pure Rust, no dependence on the C engine.

pub mod header;
pub mod image;
pub mod steg;
```

- [ ] **Step 2: Run tests**

Run: `cargo test --target x86_64-unknown-linux-gnu decoder::image`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/decoder/mod.rs src/decoder/image.rs
git commit -m "decoder: cartridge PNG decode + cover crop + sprite expand"
```

---

## Task 4: Rust decoder — `decoder/png_io.rs`

**Files:**
- Create: `src/decoder/png_io.rs`
- Modify: `src/decoder/mod.rs` (add `pub mod png_io;`)

Re-encode a 128×128 RGBA buffer as a PNG byte stream for the editor's sprite/cover slots. Mirrors `encoder/png_io.rs` but at 128×128 instead of 256×256.

- [ ] **Step 1: Write the file with tests inline**

Create `src/decoder/png_io.rs`:

```rust
//! Encode a 128×128 RGBA8 buffer to a PNG byte stream.

use crate::encoder::image::{SCREEN_H, SCREEN_RGBA_LEN, SCREEN_W};

#[derive(Debug)]
pub enum PngWriteError {
    Encode(&'static str),
}

pub fn encode_rgba_128x128(
    rgba: &[u8; SCREEN_RGBA_LEN],
    out: &mut Vec<u8>,
) -> Result<(), PngWriteError> {
    out.clear();
    {
        let mut enc = png::Encoder::new(&mut *out, SCREEN_W as u32, SCREEN_H as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|_| PngWriteError::Encode("write_header"))?;
        writer
            .write_image_data(rgba)
            .map_err(|_| PngWriteError::Encode("write_image_data"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::image::decode_128x128_rgba;

    #[test]
    fn encode_round_trips_via_png_decoder() {
        let mut rgba = [0u8; SCREEN_RGBA_LEN];
        for y in 0..SCREEN_H {
            for x in 0..SCREEN_W {
                let i = (y * SCREEN_W + x) * 4;
                rgba[i]     = x as u8;
                rgba[i + 1] = y as u8;
                rgba[i + 2] = (x ^ y) as u8;
                rgba[i + 3] = 0xFF;
            }
        }
        let mut out = Vec::new();
        encode_rgba_128x128(&rgba, &mut out).unwrap();
        assert_eq!(&out[..8], b"\x89PNG\r\n\x1a\n");

        let mut back = [0u8; SCREEN_RGBA_LEN];
        decode_128x128_rgba(&out, &mut back).unwrap();
        let idx = (45 * SCREEN_W + 67) * 4;
        assert_eq!(back[idx],     67);
        assert_eq!(back[idx + 1], 45);
        assert_eq!(back[idx + 2], (67u8 ^ 45u8));
        assert_eq!(back[idx + 3], 0xFF);
    }

    #[test]
    fn encode_clears_out_buffer() {
        let rgba = [0u8; SCREEN_RGBA_LEN];
        let mut out = vec![0xAA; 99];
        encode_rgba_128x128(&rgba, &mut out).unwrap();
        assert_eq!(&out[..8], b"\x89PNG\r\n\x1a\n");
    }
}
```

Update `src/decoder/mod.rs`:

```rust
//! In-browser cartridge decoder. Pure Rust, no dependence on the C engine.

pub mod header;
pub mod image;
pub mod png_io;
pub mod steg;
```

- [ ] **Step 2: Run tests**

Run: `cargo test --target x86_64-unknown-linux-gnu decoder::png_io`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/decoder/mod.rs src/decoder/png_io.rs
git commit -m "decoder: encode 128x128 RGBA as PNG bytes"
```

---

## Task 5: Rust decoder — `decoder/mod.rs` (decode() entrypoint + integration tests)

**Files:**
- Modify: `src/decoder/mod.rs`

This pulls everything together: top-level `decode()`, `DecError` with code+message, and an end-to-end test that builds a cartridge with the encoder and asserts that the decoder recovers every field.

- [ ] **Step 1: Replace `src/decoder/mod.rs` with the full implementation**

Overwrite `src/decoder/mod.rs`:

```rust
//! In-browser cartridge decoder. Pure Rust, no dependence on the C engine.

pub mod header;
pub mod image;
pub mod png_io;
pub mod steg;

pub use header::HeaderParts;

use crate::encoder::header::HEADER_SIZE;
use crate::encoder::image::{CART_RGBA_LEN, ImageError, SCREEN_RGBA_LEN};
use crate::encoder::header::crc32;
use crate::decoder::image::{decode_cartridge_png, extract_cover_rgba, expand_spritesheet};
use crate::decoder::png_io::{encode_rgba_128x128, PngWriteError};
use crate::decoder::steg::{read_byte, read_spritesheet_byte};

pub const SCRIPT_MAX: usize = crate::encoder::SCRIPT_MAX; // 32 621
pub const PACKED_SPRITE_LEN: usize = SCREEN_RGBA_LEN;      // 65 536

#[derive(Debug, PartialEq, Eq)]
pub enum DecError {
    CartridgePng(&'static str),
    CartridgeSize,
    HeaderVersionMismatch { found: u16 },
    ScriptOverrun,
    PngWrite(&'static str),
}

impl DecError {
    pub fn code(&self) -> i32 {
        match self {
            DecError::CartridgePng(_)                  => -1,
            DecError::CartridgeSize                    => -2,
            DecError::HeaderVersionMismatch { .. }     => -3,
            DecError::ScriptOverrun                    => -4,
            DecError::PngWrite(_)                      => -5,
        }
    }

    pub fn message(&self) -> String {
        match self {
            DecError::CartridgePng(m)   => format!("Cartridge PNG decode failed: {m}"),
            DecError::CartridgeSize     => "Cartridge must be 256x256".to_string(),
            DecError::HeaderVersionMismatch { found } =>
                format!("Unsupported cartridge format_version {found} (this build supports 1)"),
            DecError::ScriptOverrun =>
                "Script overruns cartridge buffer (no NUL terminator in 32622 bytes)".to_string(),
            DecError::PngWrite(m)       => format!("PNG re-encode failed: {m}"),
        }
    }
}

#[derive(Debug)]
pub struct Decoded {
    pub header:     HeaderParts,
    pub script_len: usize, // bytes in script_buf, excludes trailing NUL
    pub crc_ok:     bool,
}

/// Decode a `.tb.png` cartridge into its constituent fields.
///
/// All output buffers are caller-owned scratch buffers (typically members of
/// `DecoderState` in `lib.rs`). This keeps the wasm32 stack small.
#[allow(clippy::too_many_arguments)]
pub fn decode(
    cartridge_png:   &[u8],
    canvas_buf:      &mut [u8; CART_RGBA_LEN],
    packed_sprite:   &mut [u8; PACKED_SPRITE_LEN],
    sprite_rgba:     &mut [u8; SCREEN_RGBA_LEN],
    cover_rgba:      &mut [u8; SCREEN_RGBA_LEN],
    script_buf:      &mut [u8; SCRIPT_MAX],
    sprite_png_out:  &mut Vec<u8>,
    cover_png_out:   &mut Vec<u8>,
) -> Result<Decoded, DecError> {
    // 1. Decode the cartridge PNG.
    decode_cartridge_png(cartridge_png, canvas_buf).map_err(|e| match e {
        ImageError::WrongSize { .. } => DecError::CartridgeSize,
        ImageError::Decode(m)        => DecError::CartridgePng(m),
    })?;

    let mut cursor: usize = 0;

    // 2. Unpack and parse the 146-byte header.
    let mut header_bytes = [0u8; HEADER_SIZE];
    for h in header_bytes.iter_mut() {
        *h = read_byte(canvas_buf, &mut cursor);
    }
    let header = header::parse(&header_bytes);
    if header.format_version != 1 {
        return Err(DecError::HeaderVersionMismatch { found: header.format_version });
    }

    // 3. Unpack the spritesheet (65 536 source bytes, each from 2 dest channels).
    for p in packed_sprite.iter_mut() {
        *p = read_spritesheet_byte(canvas_buf, &mut cursor);
    }
    expand_spritesheet(packed_sprite, sprite_rgba);

    // 4. Unpack the script. The script region is at most 32 622 bytes
    //    (SCRIPT_MAX + 1 trailing NUL). Read up to that many bytes via
    //    read_byte; the first 0x00 terminates.
    let mut script_len = 0usize;
    loop {
        if script_len > SCRIPT_MAX {
            return Err(DecError::ScriptOverrun);
        }
        let b = read_byte(canvas_buf, &mut cursor);
        if b == 0 {
            break;
        }
        script_buf[script_len] = b;
        script_len += 1;
    }
    // Zero the unused tail of the buffer so the FFI export sees stable bytes.
    for slot in &mut script_buf[script_len..] {
        *slot = 0;
    }

    // 5. CRC check the script (non-fatal; surfaced as crc_ok).
    let crc_ok = crc32(&script_buf[..script_len]) == header.checksum;

    // 6. Crop the cover, re-encode it as a 128×128 PNG.
    extract_cover_rgba(canvas_buf, cover_rgba);
    encode_rgba_128x128(cover_rgba, cover_png_out).map_err(|e| match e {
        PngWriteError::Encode(m) => DecError::PngWrite(m),
    })?;

    // 7. Re-encode the spritesheet as a 128×128 PNG.
    encode_rgba_128x128(sprite_rgba, sprite_png_out).map_err(|e| match e {
        PngWriteError::Encode(m) => DecError::PngWrite(m),
    })?;

    Ok(Decoded { header, script_len, crc_ok })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::{encode as encoder_encode, HeaderOpts};
    use crate::encoder::image::{decode_128x128_rgba, CART_RGBA_LEN, SCREEN_RGBA_LEN};

    fn make_solid_128(rgba: [u8; 4]) -> Vec<u8> {
        let mut buf = Vec::new();
        let mut e = png::Encoder::new(&mut buf, 128, 128);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut w = e.write_header().unwrap();
        let data: Vec<u8> = (0..128 * 128).flat_map(|_| rgba.iter().copied()).collect();
        w.write_image_data(&data).unwrap();
        drop(w);
        buf
    }

    fn run_encode(
        cover_png: &[u8],
        sprite_png: &[u8],
        script: &[u8],
        title: &str,
        author: &str,
        game_version: u16,
        package_date: u32,
    ) -> Vec<u8> {
        let opts = HeaderOpts {
            title, author,
            format_version: 1,
            flags: 0,
            game_version,
            package_date,
        };
        let mut cover_rgba  = [0u8; SCREEN_RGBA_LEN];
        let mut sprite_rgba = [0u8; SCREEN_RGBA_LEN];
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut out = Vec::new();
        encoder_encode(cover_png, sprite_png, script, None, &opts,
                       &mut cover_rgba, &mut sprite_rgba, canvas_arr, &mut out).unwrap();
        out
    }

    #[test]
    fn decode_recovers_all_header_fields_after_encode() {
        let cover  = make_solid_128([0xC0, 0xC4, 0xC8, 0xFF]);
        let sprite = make_solid_128([0xF0, 0xA0, 0x50, 0xFF]);
        let script: &[u8] = b"function _draw() pset(10, 10, 0xFFFF) end\n";

        let cartridge = run_encode(&cover, &sprite, script, "demo", "alice", 7, 1_700_000_000);

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let d = decode(&cartridge, canvas_arr, packed_arr, sprite_arr, cover_arr,
                       script_arr, &mut sprite_png, &mut cover_png).unwrap();

        assert_eq!(d.header.title, "demo");
        assert_eq!(d.header.author, "alice");
        assert_eq!(d.header.format_version, 1);
        assert_eq!(d.header.game_version, 7);
        assert_eq!(d.header.package_date, 1_700_000_000);
        assert_eq!(d.script_len, script.len());
        assert_eq!(&script_arr[..d.script_len], script);
        assert!(d.crc_ok);

        // Re-decode the sprite PNG and check it's a 128×128 RGBA image whose channels
        // all sit at the 4-bpc quantization values of the input solid (0xF0|0x0F=0xFF
        // etc.). The input was [0xF0, 0xA0, 0x50, 0xFF] — after & 0xF0 then 4→8 expand
        // we get [0xFF, 0xAA, 0x55, 0xFF].
        let mut back_sprite = [0u8; SCREEN_RGBA_LEN];
        decode_128x128_rgba(&sprite_png, &mut back_sprite).unwrap();
        assert_eq!(back_sprite[0], 0xFF);
        assert_eq!(back_sprite[1], 0xAA);
        assert_eq!(back_sprite[2], 0x55);
        assert_eq!(back_sprite[3], 0xFF);

        // Re-decode the cover PNG. Cover pixels survived at 6 bpc. Input was
        // [0xC0, 0xC4, 0xC8, 0xFF] — all values are already 6-bpc clean, so they
        // should match exactly.
        let mut back_cover = [0u8; SCREEN_RGBA_LEN];
        decode_128x128_rgba(&cover_png, &mut back_cover).unwrap();
        assert_eq!(back_cover[0], 0xC0);
        assert_eq!(back_cover[1], 0xC4);
        assert_eq!(back_cover[2], 0xC8);
        assert_eq!(back_cover[3], 0xFF);
    }

    #[test]
    fn decode_rejects_wrong_dimensions() {
        let small = make_solid_128([0, 0, 0, 0xFF]); // 128×128, not 256×256

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let err = decode(&small, canvas_arr, packed_arr, sprite_arr, cover_arr,
                         script_arr, &mut sprite_png, &mut cover_png).unwrap_err();
        assert_eq!(err, DecError::CartridgeSize);
        assert_eq!(err.code(), -2);
    }

    /// Build a cartridge whose script bytes don't match the header CRC and
    /// confirm `decode()` succeeds with `crc_ok = false`. We construct the
    /// cartridge from the canvas side (no PNG round-trip), then re-encode
    /// the canvas to PNG so `decode()` sees a real `.tb.png`.
    #[test]
    fn decode_flags_crc_mismatch_as_non_fatal() {
        use crate::encoder::header::{pack, HeaderOpts};
        use crate::encoder::png_io::encode_rgba;
        use crate::encoder::steg::{write_bytes, write_spritesheet};

        // Pack a header that claims the script is "x" (CRC of "x" = 0x8CDC1683),
        // but actually embed "y" into the canvas. CRC will mismatch.
        let opts = HeaderOpts {
            title: "t", author: "",
            format_version: 1, flags: 0, game_version: 1, package_date: 0,
        };
        let header = pack(&opts, b"x");

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut cursor = 0usize;
        write_bytes(canvas_arr, &mut cursor, &header);
        let zero_sprite = [0u8; SCREEN_RGBA_LEN];
        write_spritesheet(canvas_arr, &mut cursor, &zero_sprite);
        write_bytes(canvas_arr, &mut cursor, b"y\0"); // script + NUL

        let mut cartridge = Vec::new();
        encode_rgba(canvas_arr, &mut cartridge).unwrap();

        // Decode it.
        let mut canvas2 = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas2_arr: &mut [u8; CART_RGBA_LEN] = canvas2.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let d = decode(&cartridge, canvas2_arr, packed_arr, sprite_arr, cover_arr,
                       script_arr, &mut sprite_png, &mut cover_png).unwrap();

        assert_eq!(d.script_len, 1);
        assert_eq!(script_arr[0], b'y');
        assert!(!d.crc_ok, "expected crc_ok = false on script/CRC mismatch");
    }

    #[test]
    fn decode_rejects_format_version_other_than_1() {
        use crate::encoder::header::{pack, HeaderOpts};
        use crate::encoder::png_io::encode_rgba;
        use crate::encoder::steg::{write_bytes, write_spritesheet};

        // Forge a header with format_version = 2.
        let opts = HeaderOpts {
            title: "", author: "",
            format_version: 2, flags: 0, game_version: 1, package_date: 0,
        };
        let header = pack(&opts, b"");

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut cursor = 0usize;
        write_bytes(canvas_arr, &mut cursor, &header);
        let zero_sprite = [0u8; SCREEN_RGBA_LEN];
        write_spritesheet(canvas_arr, &mut cursor, &zero_sprite);
        write_bytes(canvas_arr, &mut cursor, &[0u8]); // empty script + NUL

        let mut cartridge = Vec::new();
        encode_rgba(canvas_arr, &mut cartridge).unwrap();

        let mut canvas2 = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas2_arr: &mut [u8; CART_RGBA_LEN] = canvas2.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let err = decode(&cartridge, canvas2_arr, packed_arr, sprite_arr, cover_arr,
                         script_arr, &mut sprite_png, &mut cover_png).unwrap_err();
        assert_eq!(err, DecError::HeaderVersionMismatch { found: 2 });
        assert_eq!(err.code(), -3);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test --target x86_64-unknown-linux-gnu decoder -- --nocapture`
Expected: PASS (all decoder modules + the integration tests).

- [ ] **Step 3: Commit**

```bash
git add src/decoder/mod.rs
git commit -m "decoder: end-to-end decode() entrypoint + integration tests"
```

---

## Task 6: WASM FFI — `tb_dec_*` exports in `src/lib.rs`

**Files:**
- Modify: `src/lib.rs`

Add a `DecoderState` modeled on `EncoderState`, a `DEC_STATE` thread-local, and the full `tb_dec_*` export surface.

- [ ] **Step 1: Add the imports and module declaration**

At the top of `src/lib.rs`, after the existing `mod encoder;` line, add:

```rust
mod decoder;
```

In the existing `use encoder::...` block, append imports needed by the decoder state. Add a new use line just below it:

```rust
use decoder::{decode as decoder_decode, DecError, Decoded, SCRIPT_MAX as DEC_SCRIPT_MAX, PACKED_SPRITE_LEN};
```

(The `SCRIPT_MAX` re-export name collides with the encoder's; alias as `DEC_SCRIPT_MAX`.)

- [ ] **Step 2: Add the `DecoderState` struct + constants**

After the existing `EncoderState` struct/impl block and before its `thread_local!`, append:

```rust
// ── Decoder state ────────────────────────────────────────────────────────────

const DEC_INPUT_CAP: usize = 2 * 1024 * 1024;

struct DecoderState {
    input_buf:      Vec<u8>,                            // up to DEC_INPUT_CAP
    canvas:         Box<[u8; CART_RGBA_LEN]>,           // 256×256 RGBA scratch
    packed_sprite:  Box<[u8; PACKED_SPRITE_LEN]>,       // 65_536
    sprite_rgba:    Box<[u8; SCREEN_RGBA_LEN]>,         // 65_536
    cover_rgba:     Box<[u8; SCREEN_RGBA_LEN]>,         // 65_536
    script_buf:     Box<[u8; DEC_SCRIPT_MAX]>,          // 32_621
    sprite_png_out: Vec<u8>,
    cover_png_out:  Vec<u8>,

    title_utf8:     Vec<u8>,
    author_utf8:    Vec<u8>,
    script_len:     u32,
    format_version: u16,
    flags:          u16,
    game_version:   u16,
    package_date:   u32,
    crc_ok:         u8,    // 0/1

    error_msg:      Vec<u8>,
}

impl DecoderState {
    fn new() -> Self {
        Self {
            input_buf:      vec![0; DEC_INPUT_CAP],
            canvas:         Box::new([0; CART_RGBA_LEN]),
            packed_sprite:  Box::new([0; PACKED_SPRITE_LEN]),
            sprite_rgba:    Box::new([0; SCREEN_RGBA_LEN]),
            cover_rgba:     Box::new([0; SCREEN_RGBA_LEN]),
            script_buf:     Box::new([0; DEC_SCRIPT_MAX]),
            sprite_png_out: Vec::with_capacity(64 * 1024),
            cover_png_out:  Vec::with_capacity(64 * 1024),
            title_utf8:     Vec::new(),
            author_utf8:    Vec::new(),
            script_len:     0,
            format_version: 0,
            flags:          0,
            game_version:   0,
            package_date:   0,
            crc_ok:         0,
            error_msg:      Vec::new(),
        }
    }
}

thread_local! {
    static DEC_STATE: RefCell<Option<DecoderState>> = const { RefCell::new(None) };
}

fn store_dec_error(state: &mut DecoderState, err: &DecError) {
    state.error_msg = err.message().into_bytes();
}
```

- [ ] **Step 3: Add the FFI exports**

At the end of `src/lib.rs`, append:

```rust
// ── Decoder FFI ──────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn tb_dec_init() -> u32 {
    DEC_STATE.with(|cell| {
        if cell.borrow().is_some() {
            return 1;
        }
        *cell.borrow_mut() = Some(DecoderState::new());
        1
    })
}

#[no_mangle]
pub extern "C" fn tb_dec_input_ptr() -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    DEC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.input_buf.as_mut_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_dec_input_cap() -> u32 {
    DEC_INPUT_CAP as u32
}

#[no_mangle]
pub extern "C" fn tb_dec_run(len: u32) -> i32 {
    let mut result: i32 = -1;
    DEC_STATE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let Some(state) = borrow.as_mut() else { return; };

        let len = len as usize;
        if len == 0 || len > state.input_buf.len() {
            store_dec_error(state, &DecError::CartridgePng("zero or oversized input"));
            result = DecError::CartridgePng("zero or oversized input").code();
            return;
        }
        let input_owned: Vec<u8> = state.input_buf[..len].to_vec();

        let canvas_mut:        &mut [u8; CART_RGBA_LEN]       = state.canvas.as_mut();
        let packed_mut:        &mut [u8; PACKED_SPRITE_LEN]   = state.packed_sprite.as_mut();
        let sprite_rgba_mut:   &mut [u8; SCREEN_RGBA_LEN]     = state.sprite_rgba.as_mut();
        let cover_rgba_mut:    &mut [u8; SCREEN_RGBA_LEN]     = state.cover_rgba.as_mut();
        let script_buf_mut:    &mut [u8; DEC_SCRIPT_MAX]      = state.script_buf.as_mut();

        match decoder_decode(
            &input_owned,
            canvas_mut, packed_mut, sprite_rgba_mut, cover_rgba_mut, script_buf_mut,
            &mut state.sprite_png_out, &mut state.cover_png_out,
        ) {
            Ok(Decoded { header, script_len, crc_ok }) => {
                state.error_msg.clear();
                state.title_utf8     = header.title.into_bytes();
                state.author_utf8    = header.author.into_bytes();
                state.script_len     = script_len as u32;
                state.format_version = header.format_version;
                state.flags          = header.flags;
                state.game_version   = header.game_version;
                state.package_date   = header.package_date;
                state.crc_ok         = if crc_ok { 1 } else { 0 };
                result = 0;
            }
            Err(e) => {
                store_dec_error(state, &e);
                result = e.code();
            }
        }
    });
    result
}

#[no_mangle]
pub extern "C" fn tb_dec_sprite_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.sprite_png_out.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_sprite_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.sprite_png_out.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_cover_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.cover_png_out.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_cover_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.cover_png_out.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_script_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.script_buf.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_script_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.script_len; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_title_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.title_utf8.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_title_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.title_utf8.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_author_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.author_utf8.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_author_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.author_utf8.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_meta() -> u64 {
    let mut packed: u64 = 0;
    DEC_STATE.with(|cell| {
        if let Some(s) = cell.borrow().as_ref() {
            packed = (s.format_version as u64)
                   | ((s.flags as u64) << 16)
                   | ((s.game_version as u64) << 32)
                   | ((s.crc_ok as u64) << 48);
        }
    });
    packed
}

#[no_mangle]
pub extern "C" fn tb_dec_package_date() -> u32 {
    let mut v: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { v = s.package_date; }});
    v
}

#[no_mangle]
pub extern "C" fn tb_dec_error_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.error_msg.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_error_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.error_msg.len() as u32; }});
    n
}
```

- [ ] **Step 4: Build for both targets to check the FFI compiles**

Run: `cargo build --target x86_64-unknown-linux-gnu`
Expected: success.

Run: `./scripts/build.sh`
Expected: produces `editor/public/tinybit_wasm.wasm`. The build may take 30–60 s if wasi-sdk needs to download.

- [ ] **Step 5: Run the Rust unit + integration tests one more time**

Run: `cargo test --target x86_64-unknown-linux-gnu`
Expected: PASS (entire suite).

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs
git commit -m "decoder: tb_dec_* FFI exports + DecoderState"
```

---

## Task 7: Node smoke test — `scripts/smoke_decoder.mjs`

**Files:**
- Create: `scripts/smoke_decoder.mjs`

Exercise the full wasm path end-to-end in Node: encode a fixture cartridge, decode it, and assert every field matches.

- [ ] **Step 1: Create the script**

Create `scripts/smoke_decoder.mjs`:

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

// ---- Minimal WASI snapshot_preview1 shim (copy of smoke_encoder.mjs) -----
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
  fd_seek:  () => ERRNO_BADF,
  fd_read:  () => ERRNO_BADF,
  fd_fdstat_get: () => ERRNO_BADF,
  fd_fdstat_set_flags: () => ERRNO_BADF,
  fd_prestat_get: () => ERRNO_BADF,
  fd_prestat_dir_name: () => ERRNO_BADF,
  fd_renumber: () => ERRNO_BADF,
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
    crypto.getRandomValues(readBytes(buf, len));
    return ERRNO_SUCCESS;
  },
  proc_exit(code) { throw new Error(`proc_exit(${code})`); },
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

const wasmBytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
memoryRef.value = instance.exports.memory;
const tb = instance.exports;

tb.tb_init();
if (tb.tb_enc_init() === 0) { console.error('tb_enc_init returned 0'); process.exit(1); }
if (tb.tb_dec_init() === 0) { console.error('tb_dec_init returned 0'); process.exit(1); }

const fixDir = resolve(__dirname, 'fixtures');
const coverBytes  = readFileSync(resolve(fixDir, 'smoke_cover.png'));
const spriteBytes = readFileSync(resolve(fixDir, 'smoke_sprite.png'));
const scriptBytes = readFileSync(resolve(fixDir, 'smoke_script.lua'));
const titleBytes  = new TextEncoder().encode('smoke');
const authorBytes = new TextEncoder().encode('ci');

function stageEnc(slot, bytes, label) {
  const cap = tb.tb_enc_input_cap(slot);
  if (bytes.length > cap) { console.error(`${label}: ${bytes.length} > cap ${cap}`); process.exit(1); }
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    console.error(`${label}: tb_enc_set_input_len failed`); process.exit(1);
  }
}
function decodeEncError() {
  const len = tb.tb_enc_error_len();
  if (len === 0) return '<empty>';
  const ptr = tb.tb_enc_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}
function decodeDecError() {
  const len = tb.tb_dec_error_len();
  if (len === 0) return '<empty>';
  const ptr = tb.tb_dec_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}

// 1. Encode a cartridge.
console.log('--- decoder smoke: encode source cartridge ---');
stageEnc(0, coverBytes, 'cover');
stageEnc(1, spriteBytes, 'sprite');
stageEnc(2, scriptBytes, 'script');
tb.tb_enc_set_input_len(3, 0);
stageEnc(4, titleBytes, 'title');
stageEnc(5, authorBytes, 'author');
tb.tb_enc_set_header(7, 0xBEEF, 1700000000);
const n = tb.tb_enc_run();
if (n < 0) { console.error(`tb_enc_run failed: ${n} — ${decodeEncError()}`); process.exit(1); }
const encoded = new Uint8Array(memoryRef.value.buffer, tb.tb_enc_output_ptr(), n).slice();
console.log(`encoded ${encoded.length} PNG bytes`);

// 2. Decode it.
console.log('--- decoder smoke: decode round-trip ---');
const inputCap = tb.tb_dec_input_cap();
if (encoded.length > inputCap) { console.error(`encoded ${encoded.length} > cap ${inputCap}`); process.exit(1); }
const inputPtr = tb.tb_dec_input_ptr();
new Uint8Array(memoryRef.value.buffer, inputPtr, encoded.length).set(encoded);
const rc = tb.tb_dec_run(encoded.length);
if (rc !== 0) { console.error(`tb_dec_run failed: ${rc} — ${decodeDecError()}`); process.exit(1); }

const readBytesCopy = (ptr, len) => new Uint8Array(memoryRef.value.buffer, ptr, len).slice();
const td = new TextDecoder();
const title  = td.decode(readBytesCopy(tb.tb_dec_title_ptr(),  tb.tb_dec_title_len()));
const author = td.decode(readBytesCopy(tb.tb_dec_author_ptr(), tb.tb_dec_author_len()));
const script = td.decode(readBytesCopy(tb.tb_dec_script_ptr(), tb.tb_dec_script_len()));
const meta = tb.tb_dec_meta();
const formatVersion = Number(meta & 0xFFFFn);
const flags         = Number((meta >> 16n) & 0xFFFFn);
const gameVersion   = Number((meta >> 32n) & 0xFFFFn);
const crcOk         = Number((meta >> 48n) & 0xFFn) === 1;
const packageDate   = tb.tb_dec_package_date();

if (title !== 'smoke')   { console.error(`title mismatch: ${title}`); process.exit(1); }
if (author !== 'ci')     { console.error(`author mismatch: ${author}`); process.exit(1); }
if (script !== new TextDecoder().decode(scriptBytes)) {
  console.error('script byte mismatch'); process.exit(1);
}
if (formatVersion !== 1)      { console.error(`format_version ${formatVersion} != 1`); process.exit(1); }
if (flags !== 0xBEEF)         { console.error(`flags ${flags.toString(16)} != BEEF`); process.exit(1); }
if (gameVersion !== 7)        { console.error(`game_version ${gameVersion} != 7`); process.exit(1); }
if (packageDate !== 1700000000) { console.error(`package_date ${packageDate}`); process.exit(1); }
if (!crcOk)                   { console.error('crc_ok = false on a fresh round-trip'); process.exit(1); }

const spriteLen = tb.tb_dec_sprite_len();
const coverLen  = tb.tb_dec_cover_len();
if (spriteLen < 200) { console.error(`sprite PNG too short: ${spriteLen}`); process.exit(1); }
if (coverLen  < 200) { console.error(`cover PNG too short: ${coverLen}`); process.exit(1); }
const spritePng = readBytesCopy(tb.tb_dec_sprite_ptr(), spriteLen);
const coverPng  = readBytesCopy(tb.tb_dec_cover_ptr(),  coverLen);
const magic = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
if (!magic(spritePng)) { console.error('sprite PNG missing magic'); process.exit(1); }
if (!magic(coverPng))  { console.error('cover PNG missing magic');  process.exit(1); }

console.log('decoder round-trip OK: title/author/script/header/PNG outputs match');

// 3. Negative case: truncated input → decode error.
console.log('--- decoder smoke: negative case ---');
const truncated = encoded.subarray(0, Math.max(100, encoded.length - 1000));
new Uint8Array(memoryRef.value.buffer, inputPtr, truncated.length).set(truncated);
const rc2 = tb.tb_dec_run(truncated.length);
if (rc2 >= 0) { console.error(`expected negative rc on truncated input, got ${rc2}`); process.exit(1); }
console.log(`decoder negative case OK: rc=${rc2} (${decodeDecError()})`);
```

Make it executable:

```bash
chmod +x scripts/smoke_decoder.mjs
```

- [ ] **Step 2: Run it**

Run: `node scripts/smoke_decoder.mjs`
Expected: prints "decoder round-trip OK", "decoder negative case OK"; exit code 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke_decoder.mjs
git commit -m "smoke: encoder→decoder wasm round-trip in Node"
```

---

## Task 8: TS adapter — `editor/src/engine/decoder.ts` (+ test)

**Files:**
- Create: `editor/src/engine/decoder.ts`
- Create: `editor/src/engine/decoder.test.ts`

JS-side mirror of `encoder.ts`. Reads pointers from wasm memory, copies via `.slice()`, decodes UTF-8 strings, unpacks the bitfield.

- [ ] **Step 1: Create `decoder.ts`**

Create `editor/src/engine/decoder.ts`:

```ts
export interface DecoderExports {
    memory: WebAssembly.Memory;
    tb_dec_init(): number;
    tb_dec_input_ptr(): number;
    tb_dec_input_cap(): number;
    tb_dec_run(len: number): number;
    tb_dec_sprite_ptr(): number;
    tb_dec_sprite_len(): number;
    tb_dec_cover_ptr(): number;
    tb_dec_cover_len(): number;
    tb_dec_script_ptr(): number;
    tb_dec_script_len(): number;
    tb_dec_title_ptr(): number;
    tb_dec_title_len(): number;
    tb_dec_author_ptr(): number;
    tb_dec_author_len(): number;
    tb_dec_meta(): bigint;
    tb_dec_package_date(): number;
    tb_dec_error_ptr(): number;
    tb_dec_error_len(): number;
}

export interface DecodedCartridge {
    title:  string;
    author: string;
    sprite: Uint8Array;
    cover:  Uint8Array;
    script: string;
    formatVersion: number;
    gameVersion:   number;
    flags:         number;
    packageDate:   number;
    crcOk:         boolean;
}

export class DecodeError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.name = 'DecodeError';
    }
}

export interface Decoder {
    decode(cartridgePng: Uint8Array): DecodedCartridge;
}

export function makeDecoder(ex: DecoderExports): Decoder {
    let initialized = false;

    function ensureInit() {
        if (!initialized) {
            if (ex.tb_dec_init() !== 1) throw new DecodeError(0, 'Decoder failed to initialize');
            initialized = true;
        }
    }

    function readErrorMessage(): string {
        const ptr = ex.tb_dec_error_ptr();
        const len = ex.tb_dec_error_len();
        if (len === 0) return 'unknown decoder error';
        return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len));
    }

    function readBytes(ptr: number, len: number): Uint8Array {
        return new Uint8Array(ex.memory.buffer, ptr, len).slice();
    }

    function readString(ptr: number, len: number): string {
        if (len === 0) return '';
        return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len));
    }

    return {
        decode(cartridgePng) {
            ensureInit();
            const cap = ex.tb_dec_input_cap();
            if (cartridgePng.length > cap) {
                throw new DecodeError(0, `Cartridge too large: ${cartridgePng.length} > ${cap} bytes`);
            }
            const ptr = ex.tb_dec_input_ptr();
            new Uint8Array(ex.memory.buffer, ptr, cartridgePng.length).set(cartridgePng);

            const rc = ex.tb_dec_run(cartridgePng.length);
            if (rc !== 0) throw new DecodeError(rc, readErrorMessage());

            const sprite = readBytes(ex.tb_dec_sprite_ptr(), ex.tb_dec_sprite_len());
            const cover  = readBytes(ex.tb_dec_cover_ptr(),  ex.tb_dec_cover_len());
            const script = readString(ex.tb_dec_script_ptr(), ex.tb_dec_script_len());
            const title  = readString(ex.tb_dec_title_ptr(),  ex.tb_dec_title_len());
            const author = readString(ex.tb_dec_author_ptr(), ex.tb_dec_author_len());

            const meta = ex.tb_dec_meta();
            const formatVersion = Number(meta & 0xFFFFn);
            const flags         = Number((meta >> 16n) & 0xFFFFn);
            const gameVersion   = Number((meta >> 32n) & 0xFFFFn);
            const crcOk         = Number((meta >> 48n) & 0xFFn) === 1;
            const packageDate   = ex.tb_dec_package_date();

            return {
                title, author, sprite, cover, script,
                formatVersion, gameVersion, flags, packageDate, crcOk,
            };
        },
    };
}
```

- [ ] **Step 2: Create `decoder.test.ts`**

Create `editor/src/engine/decoder.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { makeDecoder, DecodeError } from './decoder';

function mockExports() {
    const memBuf = new ArrayBuffer(256 * 1024);
    const u8 = new Uint8Array(memBuf);
    const SPRITE_PTR = 0x1000, SPRITE_LEN = 4;
    const COVER_PTR  = 0x2000, COVER_LEN  = 4;
    const SCRIPT_PTR = 0x3000;
    const TITLE_PTR  = 0x4000;
    const AUTHOR_PTR = 0x5000;
    const ERR_PTR    = 0x6000;
    const INPUT_PTR  = 0x10000;

    const spriteBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic prefix
    const coverBytes  = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
    const scriptStr   = 'print("hi")';
    const titleStr    = 'roundtrip';
    const authorStr   = 'tester';
    const errStr      = 'mock error';

    u8.set(spriteBytes, SPRITE_PTR);
    u8.set(coverBytes,  COVER_PTR);
    u8.set(new TextEncoder().encode(scriptStr), SCRIPT_PTR);
    u8.set(new TextEncoder().encode(titleStr),  TITLE_PTR);
    u8.set(new TextEncoder().encode(authorStr), AUTHOR_PTR);
    u8.set(new TextEncoder().encode(errStr),    ERR_PTR);

    // bitfield: format=1, flags=0xBEEF, game_version=7, crc_ok=1
    const meta = 1n | (0xBEEFn << 16n) | (7n << 32n) | (1n << 48n);

    return {
        recordedInputLen: 0,
        ex: {
            memory: { buffer: memBuf } as WebAssembly.Memory,
            tb_dec_init: vi.fn(() => 1),
            tb_dec_input_ptr: vi.fn(() => INPUT_PTR),
            tb_dec_input_cap: vi.fn(() => 2 * 1024 * 1024),
            tb_dec_run: vi.fn((_len: number) => 0),
            tb_dec_sprite_ptr: vi.fn(() => SPRITE_PTR), tb_dec_sprite_len: vi.fn(() => SPRITE_LEN),
            tb_dec_cover_ptr:  vi.fn(() => COVER_PTR),  tb_dec_cover_len:  vi.fn(() => COVER_LEN),
            tb_dec_script_ptr: vi.fn(() => SCRIPT_PTR), tb_dec_script_len: vi.fn(() => scriptStr.length),
            tb_dec_title_ptr:  vi.fn(() => TITLE_PTR),  tb_dec_title_len:  vi.fn(() => titleStr.length),
            tb_dec_author_ptr: vi.fn(() => AUTHOR_PTR), tb_dec_author_len: vi.fn(() => authorStr.length),
            tb_dec_meta: vi.fn(() => meta),
            tb_dec_package_date: vi.fn(() => 0xDEADBEEF),
            tb_dec_error_ptr: vi.fn(() => ERR_PTR),
            tb_dec_error_len: vi.fn(() => errStr.length),
        },
        SPRITE_PTR, COVER_PTR, INPUT_PTR, scriptStr, titleStr, authorStr,
    };
}

describe('decoder', () => {
    test('decode reads all fields and returns copies of byte arrays', () => {
        const m = mockExports();
        const d = makeDecoder(m.ex);

        const fakeCart = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0xAA, 0xBB]);
        const result = d.decode(fakeCart);

        // Input staged correctly.
        expect(m.ex.tb_dec_run).toHaveBeenCalledWith(fakeCart.length);

        // Output fields.
        expect(result.title).toBe(m.titleStr);
        expect(result.author).toBe(m.authorStr);
        expect(result.script).toBe(m.scriptStr);
        expect(Array.from(result.sprite)).toEqual([0x89, 0x50, 0x4E, 0x47]);
        expect(Array.from(result.cover)).toEqual([0x89, 0x50, 0x4E, 0x47]);
        expect(result.formatVersion).toBe(1);
        expect(result.flags).toBe(0xBEEF);
        expect(result.gameVersion).toBe(7);
        expect(result.packageDate).toBe(0xDEADBEEF);
        expect(result.crcOk).toBe(true);

        // Output arrays are copies, not views into wasm memory.
        const u8 = new Uint8Array(m.ex.memory.buffer);
        u8[m.SPRITE_PTR] = 0xFF;
        expect(result.sprite[0]).toBe(0x89);
    });

    test('decode throws DecodeError when tb_dec_run is negative', () => {
        const m = mockExports();
        m.ex.tb_dec_run.mockReturnValue(-2);
        const d = makeDecoder(m.ex);
        let caught: DecodeError | undefined;
        try {
            d.decode(new Uint8Array([0]));
        } catch (e) {
            caught = e as DecodeError;
        }
        expect(caught).toBeInstanceOf(DecodeError);
        expect(caught!.code).toBe(-2);
        expect(caught!.message).toContain('mock error');
    });

    test('decode rejects oversized input before staging', () => {
        const m = mockExports();
        m.ex.tb_dec_input_cap.mockReturnValue(8);
        const d = makeDecoder(m.ex);
        expect(() => d.decode(new Uint8Array(100))).toThrow(/too large/i);
        expect(m.ex.tb_dec_run).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run the test**

Run: `cd editor && npm test -- decoder`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add editor/src/engine/decoder.ts editor/src/engine/decoder.test.ts
git commit -m "decoder(js): TS adapter mirroring the encoder adapter"
```

---

## Task 9: Wire decoder into `editor/src/engine/runtime.ts`

**Files:**
- Modify: `editor/src/engine/runtime.ts`

Extend `Runtime` with `dec: Decoder` and `decoderAvailable: boolean`, parallel to the existing encoder fields.

- [ ] **Step 1: Update the file**

Replace `editor/src/engine/runtime.ts` with:

```ts
import { makeWasiShim, type MemoryRef, type WasiSinks } from './wasiShim';
import { makeTinybit, type Tinybit, type TinybitExports } from './tinybit';
import { makeEncoder, type Encoder, type EncoderExports } from './encoder';
import { makeDecoder, type Decoder, type DecoderExports } from './decoder';

export interface Runtime {
    wasm: WebAssembly.Instance;
    memory: WebAssembly.Memory;
    tb: Tinybit;
    enc: Encoder;
    encoderAvailable: boolean;
    dec: Decoder;
    decoderAvailable: boolean;
}

const WASM_URL = './tinybit_wasm.wasm';
let runtimePromise: Promise<Runtime> | null = null;

export function getRuntime(sinks: WasiSinks): Promise<Runtime> {
    if (!runtimePromise) runtimePromise = bootRuntime(sinks);
    return runtimePromise;
}

async function bootRuntime(sinks: WasiSinks): Promise<Runtime> {
    const memoryRef: MemoryRef = { value: null as unknown as WebAssembly.Memory };
    const shim = makeWasiShim(memoryRef, sinks);
    const wasm = await WebAssembly.instantiateStreaming(
        fetch(WASM_URL),
        { wasi_snapshot_preview1: shim },
    );
    const exports = wasm.instance.exports as unknown as
        TinybitExports & Partial<EncoderExports> & Partial<DecoderExports>;
    memoryRef.value = exports.memory;

    const tb = makeTinybit(exports);

    const encoderAvailable =
        typeof exports.tb_enc_init === 'function' &&
        typeof exports.tb_enc_run === 'function';
    const enc: Encoder = encoderAvailable
        ? makeEncoder(exports as unknown as EncoderExports)
        : { encode() { throw new Error('Encoder exports not present in WASM build — rebuild after merging feat/tb-encoder.'); } };

    const decoderAvailable =
        typeof exports.tb_dec_init === 'function' &&
        typeof exports.tb_dec_run === 'function';
    const dec: Decoder = decoderAvailable
        ? makeDecoder(exports as unknown as DecoderExports)
        : { decode() { throw new Error('Decoder exports not present in WASM build — rebuild after merging feat/tb-decoder.'); } };

    return {
        wasm: wasm.instance, memory: exports.memory, tb,
        enc, encoderAvailable, dec, decoderAvailable,
    };
}

export function resetRuntimeForTests(): void {
    runtimePromise = null;
}
```

- [ ] **Step 2: Run the editor tests to make sure nothing else broke**

Run: `cd editor && npm test`
Expected: PASS (full suite — encoder, decoder, store, UI tests).

- [ ] **Step 3: Commit**

```bash
git add editor/src/engine/runtime.ts
git commit -m "runtime: expose decoder alongside encoder"
```

---

## Task 10: Store — `loadCartridge()` action

**Files:**
- Modify: `editor/src/state/sketchStore.ts`
- Modify: `editor/src/state/sketchStore.test.ts`

Add a batch action that sets title, author, sprite, cover, and script in a single `set` call (one render tick).

- [ ] **Step 1: Write the failing test**

Append to `editor/src/state/sketchStore.test.ts` (inside the `describe('sketchStore', () => { ... })`):

```ts
    test('loadCartridge sets all five fields atomically', () => {
        const sprite = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const cover  = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
        useSketchStore.getState().loadCartridge({
            title:  'demo',
            author: 'alice',
            sprite,
            cover,
            script: 'function _draw() end',
        });
        const s = useSketchStore.getState();
        expect(s.title).toBe('demo');
        expect(s.author).toBe('alice');
        expect(s.sprite).toBe(sprite);
        expect(s.cover).toBe(cover);
        expect(s.script).toBe('function _draw() end');
    });
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd editor && npm test -- sketchStore`
Expected: FAIL — `loadCartridge is not a function`.

- [ ] **Step 3: Add the action**

Edit `editor/src/state/sketchStore.ts`. Inside the `SketchState` interface, add:

```ts
    loadCartridge(parts: { title: string; author: string; sprite: Uint8Array; cover: Uint8Array; script: string }): void;
```

And in the `useSketchStore` store body, add (after `setAuthor`):

```ts
    loadCartridge: (parts) => set({
        title:  parts.title,
        author: parts.author,
        sprite: parts.sprite,
        cover:  parts.cover,
        script: parts.script,
    }),
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd editor && npm test -- sketchStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/sketchStore.ts editor/src/state/sketchStore.test.ts
git commit -m "store: loadCartridge batch action for cartridge upload"
```

---

## Task 11: UI — `UploadConfirm.tsx` modal (+ test)

**Files:**
- Create: `editor/src/ui/UploadConfirm.tsx`
- Create: `editor/src/ui/UploadConfirm.test.tsx`

A small modal rendered into `document.body` via `createPortal`. Shows the filename, has Replace / Cancel buttons.

- [ ] **Step 1: Create the test (TDD)**

Create `editor/src/ui/UploadConfirm.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadConfirm } from './UploadConfirm';

describe('UploadConfirm', () => {
    test('renders the filename and two buttons', () => {
        render(<UploadConfirm filename="cool-game.tb.png" onReplace={() => {}} onCancel={() => {}} />);
        expect(screen.getByText(/cool-game\.tb\.png/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    test('Replace fires onReplace exactly once and not onCancel', async () => {
        const onReplace = vi.fn();
        const onCancel  = vi.fn();
        render(<UploadConfirm filename="x.tb.png" onReplace={onReplace} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /replace/i }));
        expect(onReplace).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();
    });

    test('Cancel fires onCancel exactly once and not onReplace', async () => {
        const onReplace = vi.fn();
        const onCancel  = vi.fn();
        render(<UploadConfirm filename="x.tb.png" onReplace={onReplace} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onReplace).not.toHaveBeenCalled();
    });

    test('Escape key fires onCancel', async () => {
        const onReplace = vi.fn();
        const onCancel  = vi.fn();
        render(<UploadConfirm filename="x.tb.png" onReplace={onReplace} onCancel={onCancel} />);
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd editor && npm test -- UploadConfirm`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `editor/src/ui/UploadConfirm.tsx`:

```tsx
import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(24, 24, 32, 0.45)',
    display: 'grid', placeItems: 'center', zIndex: 9999,
};
const dialogStyle: CSSProperties = {
    background: '#FFFFFF', borderRadius: 10, padding: '20px 24px',
    minWidth: 320, maxWidth: 480, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    fontSize: 14, color: '#181820',
};
const titleStyle: CSSProperties = { fontWeight: 700, fontSize: 16, marginBottom: 8 };
const bodyStyle:  CSSProperties = { color: '#6B6B76', marginBottom: 16, lineHeight: 1.5 };
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const btnBase: CSSProperties = {
    padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    border: '1px solid #ECECF0', cursor: 'pointer',
};
const cancelStyle:  CSSProperties = { ...btnBase, background: '#F1F1F4', color: '#181820' };
const replaceStyle: CSSProperties = { ...btnBase, background: '#ED225D', color: '#FFFFFF', borderColor: '#ED225D' };

export interface UploadConfirmProps {
    filename: string;
    onReplace(): void;
    onCancel(): void;
}

export function UploadConfirm({ filename, onReplace, onCancel }: UploadConfirmProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    return createPortal(
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Replace cartridge?">
            <div style={dialogStyle}>
                <div style={titleStyle}>Replace cartridge?</div>
                <div style={bodyStyle}>
                    Loading <code>{filename}</code> will replace the current title, author,
                    spritesheet, cover, and script in the editor.
                </div>
                <div style={actionsStyle}>
                    <button type="button" style={cancelStyle}  onClick={onCancel}>Cancel</button>
                    <button type="button" style={replaceStyle} onClick={onReplace} autoFocus>Replace</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd editor && npm test -- UploadConfirm`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/UploadConfirm.tsx editor/src/ui/UploadConfirm.test.tsx
git commit -m "ui: UploadConfirm modal for cartridge replace prompt"
```

---

## Task 12: Toolbar — **Open** button (+ test)

**Files:**
- Modify: `editor/src/ui/Toolbar.tsx`
- Modify: `editor/src/ui/Toolbar.test.tsx`

Add an "Open" button between Play and Download. It calls `onOpen()` which the App wires to a hidden file input click.

- [ ] **Step 1: Write the failing test**

In `editor/src/ui/Toolbar.test.tsx`, replace the first test and append a new one:

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
    test('renders brand and four buttons', () => {
        render(<Toolbar engineState="idle" canPlay onPlay={() => {}} onStop={() => {}} onDownload={() => {}} onOpen={() => {}} />);
        expect(screen.getByText(/tinybit/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /play/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /stop/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /open/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    });

    test('Play is disabled when canPlay is false', () => {
        render(<Toolbar engineState="idle" canPlay={false} onPlay={() => {}} onStop={() => {}} onDownload={() => {}} onOpen={() => {}} />);
        expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
    });

    test('clicking Play, Open, Download fires their callbacks', async () => {
        const onPlay = vi.fn();
        const onOpen = vi.fn();
        const onDownload = vi.fn();
        render(<Toolbar engineState="idle" canPlay onPlay={onPlay} onStop={() => {}} onDownload={onDownload} onOpen={onOpen} />);
        await userEvent.click(screen.getByRole('button', { name: /play/i }));
        await userEvent.click(screen.getByRole('button', { name: /open/i }));
        await userEvent.click(screen.getByRole('button', { name: /download/i }));
        expect(onPlay).toHaveBeenCalledOnce();
        expect(onOpen).toHaveBeenCalledOnce();
        expect(onDownload).toHaveBeenCalledOnce();
    });

    test('shows a Crashed pill in error state with click-to-reset', async () => {
        const onReset = vi.fn();
        render(<Toolbar engineState="error" canPlay onPlay={() => {}} onStop={() => {}} onDownload={() => {}} onOpen={() => {}} onResetEngine={onReset} />);
        const pill = screen.getByText(/crashed/i);
        await userEvent.click(pill);
        expect(onReset).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd editor && npm test -- Toolbar`
Expected: FAIL — `onOpen` missing / Open button not found.

- [ ] **Step 3: Update Toolbar.tsx**

Edit `editor/src/ui/Toolbar.tsx`. Modify the `ToolbarProps` interface to add `onOpen()` and add the button. The styling matches the Stop button (neutral fill). Full file:

```tsx
import type { CSSProperties } from 'react';
import { PlayButton } from './PlayButton';
import { DownloadButton } from './DownloadButton';

export type EngineState = 'idle' | 'running' | 'error';

export interface ToolbarProps {
    engineState: EngineState;
    canPlay: boolean;
    onPlay():   void;
    onStop():   void;
    onOpen():   void;
    onDownload(): void;
    onResetEngine?(): void;
}

const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    background: '#FFFFFF',
    borderBottom: '1px solid #ECECF0',
    flexShrink: 0,
};

const brandStyle: CSSProperties = {
    fontWeight: 800,
    fontSize: 16,
    letterSpacing: 0.3,
    color: '#ED225D',
    marginRight: 8,
};

const neutralStyle: CSSProperties = {
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 13,
    background: '#F1F1F4',
    color: '#181820',
    border: '1px solid #ECECF0',
};

const pillStyle: CSSProperties = {
    marginLeft: 'auto',
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
};

export function Toolbar(p: ToolbarProps) {
    const running = p.engineState === 'running';
    const crashed = p.engineState === 'error';
    return (
        <div style={barStyle}>
            <span style={brandStyle}>tinybit</span>
            <PlayButton running={running} disabled={!p.canPlay} onClick={p.onPlay} />
            <button type="button" onClick={p.onStop} disabled={!running} style={{ ...neutralStyle, opacity: running ? 1 : 0.4 }} aria-label="Stop">
                ■ Stop
            </button>
            <button type="button" onClick={p.onOpen} style={neutralStyle} aria-label="Open">
                📂 Open
            </button>
            <DownloadButton disabled={!p.canPlay} onClick={p.onDownload} />
            <span style={{
                ...pillStyle,
                background: crashed ? '#FEE2E2' : running ? '#DCFCE7' : '#F1F1F4',
                color:      crashed ? '#DC2626' : running ? '#166534' : '#6B6B76',
                cursor:     crashed ? 'pointer' : 'default',
            }}
                  onClick={crashed ? p.onResetEngine : undefined}>
                {crashed ? 'Crashed — click to reset' : running ? 'Running' : 'Idle'}
            </span>
        </div>
    );
}
```

(The 📂 emoji glyph matches the visual language used by Download's ⬇ — they're decorative; the `aria-label="Open"` is what tests and screen readers match.)

- [ ] **Step 4: Run the test to confirm pass**

Run: `cd editor && npm test -- Toolbar`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/Toolbar.tsx editor/src/ui/Toolbar.test.tsx
git commit -m "ui: add Open button to the Toolbar"
```

---

## Task 13: App — upload handler + drag-drop overlay

**Files:**
- Modify: `editor/src/App.tsx`

Wire everything together: hidden file input triggered by the Open button, window-level drag/drop with overlay, sniff → confirm → decode → load.

- [ ] **Step 1: Add the handler + drag state and overlay UI**

Replace `editor/src/App.tsx` with the full file below.

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSketchStore } from './state/sketchStore';
import { useConsoleStore } from './state/consoleStore';
import { loadSketch, saveSketchDebounced } from './state/persist';
import { getRuntime, type Runtime } from './engine/runtime';
import { makeFrameLoop, type FrameLoop, type FrameLoopState } from './engine/frameLoop';
import { BUTTONS, PREVENT_DEFAULT_KEYS } from './engine/tinybit';
import { EncodeError } from './engine/encoder';
import { DecodeError } from './engine/decoder';
import { readPngSize } from './lib/png';
import { getPlaceholderCover, getPlaceholderSprite } from './engine/placeholders';
import { Toolbar } from './ui/Toolbar';
import { EditorPane, type EditorTab } from './ui/EditorPane';
import { CodeEditor } from './editor/CodeEditor';
import { CartridgeTab } from './ui/CartridgeTab';
import { AltEditorTab } from './ui/AltEditorTab';
import { CanvasPane, type CanvasHandle } from './ui/CanvasPane';
import { ConsolePane } from './ui/ConsolePane';
import { AppSplit } from './ui/PanelSplitter';
import { UploadConfirm } from './ui/UploadConfirm';

const appStyle = { display: 'flex', flexDirection: 'column' as const, height: '100%' };

const dropOverlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9998,
    background: 'rgba(237, 34, 93, 0.18)',
    display: 'grid', placeItems: 'center',
    pointerEvents: 'none',
    color: '#FFFFFF', fontSize: 20, fontWeight: 700, letterSpacing: 0.5,
    textShadow: '0 1px 2px rgba(0,0,0,0.35)',
};

interface PendingUpload {
    bytes: Uint8Array;
    filename: string;
}

export function App() {
    const sketch = useSketchStore();
    const consoleAppend = useConsoleStore((s) => s.append);
    const [activeTab, setActiveTab] = useState<EditorTab>('script');
    const [engineState, setEngineState] = useState<FrameLoopState>('idle');
    const [runtime, setRuntime] = useState<Runtime | null>(null);
    const [bootError, setBootError] = useState<string | null>(null);
    const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragDepthRef = useRef(0);
    const frameLoopRef = useRef<FrameLoop | null>(null);
    const canvasRef = useRef<CanvasHandle | null>(null);
    const openInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const stored = loadSketch();
        if (stored) {
            sketch.setScript(stored.script);
            sketch.setTitle(stored.title);
            sketch.setAuthor(stored.author);
            sketch.setSprite(stored.sprite);
            sketch.setCover(stored.cover);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        saveSketchDebounced(
            { script: sketch.script, sprite: sketch.sprite, cover: sketch.cover, title: sketch.title, author: sketch.author },
            (msg) => consoleAppend('warn', msg),
        );
    }, [sketch.script, sketch.sprite, sketch.cover, sketch.title, sketch.author, consoleAppend]);

    useEffect(() => {
        let cancelled = false;
        getRuntime({
            stdout: (line) => consoleAppend('engine', line),
            stderr: (line) => consoleAppend('engine', line),
        })
            .then((rt) => {
                if (cancelled) return;
                setRuntime(rt);
                if (!rt.encoderAvailable) consoleAppend('warn', 'Encoder exports missing — rebuild after merging feat/tb-encoder.');
                if (!rt.decoderAvailable) consoleAppend('warn', 'Decoder exports missing — rebuild after merging feat/tb-decoder.');
                const fl = makeFrameLoop(rt.tb);
                fl.onStateChange(setEngineState);
                fl.onError((msg) => consoleAppend('error', msg));
                frameLoopRef.current = fl;
            })
            .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                if (!cancelled) setBootError(msg);
                consoleAppend('error', `Engine boot failed: ${msg}`);
            });
        return () => { cancelled = true; };
    }, [consoleAppend]);

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            const rt = runtime; if (!rt) return;
            const idx = BUTTONS[e.key]; if (idx === undefined) return;
            if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
            if (e.repeat) return;
            rt.tb.setButton(idx, true);
        };
        const up = (e: KeyboardEvent) => {
            const rt = runtime; if (!rt) return;
            const idx = BUTTONS[e.key]; if (idx === undefined) return;
            if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
            rt.tb.setButton(idx, false);
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [runtime]);

    // Upload pipeline ────────────────────────────────────────────────────────

    const acceptFile = useCallback(async (file: File) => {
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const size = readPngSize(bytes);
            if (!size || size.width !== 256 || size.height !== 256) {
                consoleAppend('error',
                    size
                        ? `Not a TinyBit cartridge (expected 256×256 PNG, got ${size.width}×${size.height})`
                        : 'Not a TinyBit cartridge (expected 256×256 PNG)');
                return;
            }
            setPendingUpload({ bytes, filename: file.name });
        } catch (err) {
            consoleAppend('error', err instanceof Error ? err.message : String(err));
        }
    }, [consoleAppend]);

    const handleConfirmReplace = useCallback(() => {
        const pu = pendingUpload;
        setPendingUpload(null);
        if (!pu || !runtime || !runtime.decoderAvailable) {
            if (pu) consoleAppend('error', 'Decoder not available in this WASM build.');
            return;
        }
        try {
            const result = runtime.dec.decode(pu.bytes);
            sketch.loadCartridge({
                title:  result.title,
                author: result.author,
                sprite: result.sprite,
                cover:  result.cover,
                script: result.script,
            });
            consoleAppend('info', `Loaded '${result.title || 'untitled'}' by ${result.author || '<unknown>'}`);
            if (!result.crcOk) {
                consoleAppend('warn', 'Loaded with CRC mismatch (script may be corrupted)');
            }
        } catch (err) {
            if (err instanceof DecodeError) consoleAppend('error', `Decode failed (${err.code}): ${err.message}`);
            else consoleAppend('error', err instanceof Error ? err.message : String(err));
        }
    }, [pendingUpload, runtime, sketch, consoleAppend]);

    const handleConfirmCancel = useCallback(() => {
        setPendingUpload(null);
    }, []);

    const handleOpenClick = useCallback(() => {
        openInputRef.current?.click();
    }, []);

    const onOpenInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = ''; // allow re-picking the same file
        if (f) void acceptFile(f);
    }, [acceptFile]);

    // Drag-and-drop wiring ───────────────────────────────────────────────────

    useEffect(() => {
        const onDragEnter = (e: DragEvent) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            dragDepthRef.current += 1;
            setIsDragging(true);
        };
        const onDragOver = (e: DragEvent) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        };
        const onDragLeave = (e: DragEvent) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setIsDragging(false);
        };
        const onDrop = (e: DragEvent) => {
            if (!e.dataTransfer) return;
            e.preventDefault();
            dragDepthRef.current = 0;
            setIsDragging(false);
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                void acceptFile(files[0]);
            }
        };
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover',  onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop',      onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover',  onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop',      onDrop);
        };
    }, [acceptFile]);

    // Encode / play / download ───────────────────────────────────────────────

    const buildCartridge = useCallback(async (): Promise<Uint8Array | null> => {
        if (!runtime || !runtime.encoderAvailable) {
            consoleAppend('error', 'Encoder not available in this WASM build.');
            return null;
        }
        const sprite = sketch.sprite ?? await getPlaceholderSprite();
        const cover  = sketch.cover  ?? await getPlaceholderCover();
        try {
            return runtime.enc.encode({
                script: new TextEncoder().encode(sketch.script),
                sprite,
                cover,
                title:  sketch.title  || 'untitled',
                author: sketch.author || '',
            });
        } catch (err) {
            if (err instanceof EncodeError) consoleAppend('error', `Encode failed (${err.code}): ${err.message}`);
            else consoleAppend('error', String(err));
            return null;
        }
    }, [runtime, sketch.script, sketch.sprite, sketch.cover, sketch.title, sketch.author, consoleAppend]);

    const handlePlay = useCallback(async () => {
        const rt = runtime; const fl = frameLoopRef.current; const canvas = canvasRef.current?.getCanvas();
        if (!rt || !fl || !canvas) return;
        fl.stop();
        const bytes = await buildCartridge();
        if (!bytes) return;
        try {
            rt.tb.init();
            rt.tb.feedCartridge(bytes);
            rt.tb.start();
            await fl.start(canvas);
        } catch (err) {
            consoleAppend('error', err instanceof Error ? err.message : String(err));
        }
    }, [runtime, buildCartridge, consoleAppend]);

    const handleStop = useCallback(() => {
        frameLoopRef.current?.stop();
        runtime?.tb.stop();
    }, [runtime]);

    const handleDownload = useCallback(async () => {
        const bytes = await buildCartridge();
        if (!bytes) return;
        const safe = (sketch.title || 'cartridge').replace(/[^A-Za-z0-9._-]+/g, '_') || 'cartridge';
        const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safe}.tb.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, [buildCartridge, sketch.title]);

    const handleResetEngine = useCallback(() => {
        if (!runtime) return;
        runtime.tb.stop();
        setEngineState('idle');
    }, [runtime]);

    const canPlay = useMemo(() => runtime !== null && sketch.script.trim().length > 0, [runtime, sketch.script]);

    if (bootError) {
        return (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 40 }}>
                <div>
                    <h2 style={{ color: '#DC2626' }}>Failed to load engine</h2>
                    <p style={{ color: '#6B6B76' }}>{bootError}</p>
                    <button type="button" style={{ padding: '6px 14px', borderRadius: 6, background: '#ED225D', color: '#fff' }} onClick={() => location.reload()}>Reload</button>
                </div>
            </div>
        );
    }

    return (
        <div style={appStyle}>
            <Toolbar
                engineState={engineState}
                canPlay={canPlay}
                onPlay={handlePlay}
                onStop={handleStop}
                onOpen={handleOpenClick}
                onDownload={handleDownload}
                onResetEngine={handleResetEngine}
            />
            <input
                ref={openInputRef}
                data-testid="open-input"
                type="file"
                accept=".png,image/png"
                style={{ display: 'none' }}
                onChange={onOpenInputChange}
            />
            <AppSplit
                left={
                    <EditorPane active={activeTab} onChange={setActiveTab}>
                        {activeTab === 'script' && <CodeEditor value={sketch.script} onChange={sketch.setScript} />}
                        {activeTab === 'alt' && <AltEditorTab />}
                        {activeTab === 'cartridge' && <CartridgeTab />}
                    </EditorPane>
                }
                rightTop={<CanvasPane ref={canvasRef} />}
                rightBottom={<ConsolePane />}
            />
            {isDragging && <div style={dropOverlayStyle}>Drop .tb.png to open</div>}
            {pendingUpload && (
                <UploadConfirm
                    filename={pendingUpload.filename}
                    onReplace={handleConfirmReplace}
                    onCancel={handleConfirmCancel}
                />
            )}
        </div>
    );
}
```

- [ ] **Step 2: Run the editor test suite**

Run: `cd editor && npm test`
Expected: PASS (entire suite still green — including `App.test.tsx`).

- [ ] **Step 3: Manual sanity (skipped in agentic mode, do it anyway if dev server is convenient)**

Optional: run `cd editor && npm run dev` and verify that picking a `.tb.png` via the Open button shows the confirm dialog and loads the fields. Skip if no display available.

- [ ] **Step 4: Commit**

```bash
git add editor/src/App.tsx
git commit -m "app: wire .tb.png upload via Open button + drag-and-drop"
```

---

## Task 14: Playwright E2E — `editor/tests/e2e/upload.spec.ts`

**Files:**
- Modify: `editor/tests/fixtures/make-fixtures.mjs` (generate a `.tb.png` fixture by piping through the encoder script)
- Create: `editor/tests/fixtures/upload-cart.tb.png` (generated artifact)
- Create: `editor/tests/e2e/upload.spec.ts`

A full UI-level round trip: programmatically upload a fixture cartridge, click Replace in the dialog, assert all five fields populate, then click Download and check the produced bytes parse as a 256×256 PNG.

- [ ] **Step 1: Extend the fixture generator**

The existing `make-fixtures.mjs` writes `sprite-128.png` and `cover-128.png`. We additionally need a `.tb.png` cartridge fixture for the upload test. Generating one with embedded steg is non-trivial in vanilla JS — but the WASM build can do it. Use the smoke_encoder approach.

Create a sibling script `editor/tests/fixtures/make-cart-fixture.mjs` that loads the built wasm and produces `upload-cart.tb.png`:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '..', '..', '..', 'target', 'wasm32-wasip1', 'release', 'tinybit_wasm.wasm');
if (!existsSync(wasmPath)) {
    console.error(`missing ${wasmPath}; run scripts/build.sh first`);
    process.exit(1);
}

const memoryRef = { value: null };
const dec = new TextDecoder();
const ERRNO_BADF = 8, ERRNO_SUCCESS = 0;
function dv() { return new DataView(memoryRef.value.buffer); }
function bytes(p, l) { return new Uint8Array(memoryRef.value.buffer, p, l); }
const wasi = {
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
        if (fd !== 1 && fd !== 2) return ERRNO_BADF;
        let written = 0;
        const bufs = [];
        for (let i = 0; i < iovsLen; i++) {
            const base = dv().getUint32(iovsPtr + i * 8, true);
            const len = dv().getUint32(iovsPtr + i * 8 + 4, true);
            bufs.push(bytes(base, len)); written += len;
        }
        const merged = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
        let off = 0; for (const b of bufs) { merged.set(b, off); off += b.length; }
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
    clock_time_get(_i, _p, t) { dv().setBigUint64(t, BigInt(Math.floor(performance.now() * 1e6)), true); return ERRNO_SUCCESS; },
    random_get(buf, len) { crypto.getRandomValues(bytes(buf, len)); return ERRNO_SUCCESS; },
    proc_exit(code) { throw new Error(`proc_exit(${code})`); },
};
const importObject = { wasi_snapshot_preview1: new Proxy(wasi, {
    get(t, k) { return k in t ? t[k] : (...a) => { console.error(`unimplemented WASI fn: ${String(k)}(${a.join(', ')})`); return ERRNO_BADF; }; },
})};

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), importObject);
memoryRef.value = instance.exports.memory;
const tb = instance.exports;
tb.tb_init();
if (tb.tb_enc_init() === 0) { console.error('tb_enc_init failed'); process.exit(1); }

const cover  = readFileSync(resolve(__dirname, 'cover-128.png'));
const sprite = readFileSync(resolve(__dirname, 'sprite-128.png'));
const script = new TextEncoder().encode('function _draw()\n  pset(10, 10, 0xFFFF)\nend\n');
const title  = new TextEncoder().encode('upload-fixture');
const author = new TextEncoder().encode('e2e');

function stage(slot, b) {
    const ptr = tb.tb_enc_input_ptr(slot);
    new Uint8Array(memoryRef.value.buffer, ptr, b.length).set(b);
    if (tb.tb_enc_set_input_len(slot, b.length) === 0) { console.error(`stage failed ${slot}`); process.exit(1); }
}
stage(0, cover);
stage(1, sprite);
stage(2, script);
tb.tb_enc_set_input_len(3, 0);
stage(4, title);
stage(5, author);
tb.tb_enc_set_header(1, 0, 1700000000);
const n = tb.tb_enc_run();
if (n < 0) { console.error(`tb_enc_run failed: ${n}`); process.exit(1); }
const out = new Uint8Array(memoryRef.value.buffer, tb.tb_enc_output_ptr(), n).slice();
writeFileSync(resolve(__dirname, 'upload-cart.tb.png'), out);
console.log(`wrote upload-cart.tb.png (${out.length} bytes)`);
```

Make it executable and run it:

```bash
chmod +x editor/tests/fixtures/make-cart-fixture.mjs
./scripts/build.sh
node editor/tests/fixtures/make-cart-fixture.mjs
```

- [ ] **Step 2: Verify the fixture lives in the repo**

Run: `ls -la editor/tests/fixtures/upload-cart.tb.png`
Expected: a file present (a few hundred bytes to ~20 KB).

- [ ] **Step 3: Create the Playwright spec**

Create `editor/tests/e2e/upload.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH    = join(__dirname, '..', '..', 'public', 'tinybit_wasm.wasm');
const CART_FIXTURE = join(__dirname, '..', 'fixtures', 'upload-cart.tb.png');

test.describe('cartridge upload', () => {
    test.beforeEach(async () => {
        test.skip(!existsSync(WASM_PATH), 'WASM not built — run scripts/build.sh first');
        test.skip(!existsSync(CART_FIXTURE), 'Cartridge fixture missing — run editor/tests/fixtures/make-cart-fixture.mjs');
    });

    test('open + replace populates all five fields and round-trips download', async ({ page }) => {
        await page.goto('/');

        // Trigger the hidden file input via the Open button → setInputFiles.
        // Since the input is hidden (display:none), we set files directly via testid.
        await page.getByTestId('open-input').setInputFiles(CART_FIXTURE);

        // Confirm dialog appears with the filename.
        await expect(page.getByText('upload-cart.tb.png')).toBeVisible();
        await page.getByRole('button', { name: /replace/i }).click();

        // Console pane logs the loaded title/author.
        await expect(page.getByText(/Loaded 'upload-fixture' by e2e/)).toBeVisible({ timeout: 5_000 });

        // Switch to Cartridge tab; fields should reflect the upload.
        await page.getByRole('tab', { name: /cartridge/i }).click();
        await expect(page.getByLabel(/^title$/i)).toHaveValue('upload-fixture');
        await expect(page.getByLabel(/^author$/i)).toHaveValue('e2e');

        // Switch to script tab and verify the script was loaded.
        await page.getByRole('tab', { name: /script\.lua/i }).click();
        await expect(page.locator('.cm-content')).toContainText('pset(10, 10, 0xFFFF)');

        // Download the cartridge and confirm we get bytes back.
        const dlPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: /download/i }).click();
        const dl = await dlPromise;
        expect(dl.suggestedFilename()).toMatch(/upload-fixture\.tb\.png$/);
    });

    test('uploading a non-256×256 PNG is rejected before the confirm dialog', async ({ page }) => {
        await page.goto('/');
        // sprite-128.png is 128×128 — should be rejected as a cartridge.
        await page.getByTestId('open-input').setInputFiles(join(__dirname, '..', 'fixtures', 'sprite-128.png'));
        await expect(page.getByText(/expected 256×256/i)).toBeVisible({ timeout: 5_000 });
        // No confirm dialog should appear.
        await expect(page.getByRole('button', { name: /replace/i })).toHaveCount(0);
    });
});
```

- [ ] **Step 4: Run the e2e suite**

Run: `cd editor && npm run test:e2e`
Expected: PASS (both upload tests, plus the existing smoke tests).

- [ ] **Step 5: Commit**

```bash
git add editor/tests/fixtures/make-cart-fixture.mjs editor/tests/fixtures/upload-cart.tb.png editor/tests/e2e/upload.spec.ts
git commit -m "test(e2e): cartridge upload round-trip via Playwright"
```

---

## Task 15: README — short note on Open / drag-drop

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Find the existing "Create a cartridge" section in `README.md` and update it. The current text is:

```
### Create a cartridge

Open the **Cartridge** tab in the editor's left pane. Pick a 128×128 spritesheet PNG and (optionally) a 128×128 cover PNG, and set the title/author. Hit **▶ Play** to encode and run the cartridge in-page, or **⬇ Download** to save the cartridge to disk. The encoder is built into the same `tinybit_wasm.wasm` — no separate tooling required.
```

Replace it with:

```
### Create a cartridge

Open the **Cartridge** tab in the editor's left pane. Pick a 128×128 spritesheet PNG and (optionally) a 128×128 cover PNG, and set the title/author. Hit **▶ Play** to encode and run the cartridge in-page, or **⬇ Download** to save the cartridge to disk. The encoder is built into the same `tinybit_wasm.wasm` — no separate tooling required.

### Open an existing cartridge

Click **📂 Open** in the toolbar (or drag a `.tb.png` anywhere onto the editor window). After confirming the replace prompt, the title, author, spritesheet, cover, and script are extracted from the cartridge and loaded into the editor. The decoder rejects non-256×256 PNGs and cartridges whose `format_version` isn't 1.

Round-tripping is near-lossless: cartridges only store the top 4 bits per spritesheet channel and the top 6 bits per cover channel, so what comes out of decode is what the original encode stored — re-encoding without edits is a no-op modulo `package_date`.
```

Also find the **Tests** subsection and add `smoke_decoder.mjs`:

```
- `node scripts/smoke_decoder.mjs` — engine-level Node smoke (decoder round-trip + truncation)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README mentions cartridge upload (Open / drag-drop)"
```

---

## Final verification

After all tasks are complete, run the full verification gauntlet:

- [ ] **Rust tests**

Run: `cargo test --target x86_64-unknown-linux-gnu`
Expected: ALL PASS.

- [ ] **WASM build**

Run: `./scripts/build.sh`
Expected: produces `editor/public/tinybit_wasm.wasm`.

- [ ] **Engine smoke (existing)**

Run: `node scripts/smoke.mjs`
Expected: passes (cartridge feed + 60 frames + non-zero pixels).

- [ ] **Encoder smoke (existing)**

Run: `node scripts/smoke_encoder.mjs`
Expected: passes (round-trip + negative case).

- [ ] **Decoder smoke (new)**

Run: `node scripts/smoke_decoder.mjs`
Expected: passes (round-trip + truncation).

- [ ] **Editor unit + UI tests**

Run: `cd editor && npm test`
Expected: ALL PASS.

- [ ] **Editor e2e tests**

Run: `cd editor && npm run test:e2e`
Expected: ALL PASS (smoke + upload).

Once all green, the feature is ready to ship.
