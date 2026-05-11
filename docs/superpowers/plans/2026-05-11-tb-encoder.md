# TinyBit cartridge encoder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-browser cartridge encoder to `tinybit_wasm` — produce a `.tb.png` from cover PNG + spritesheet PNG + Lua script + header metadata, downloadable or playable directly via the existing decoder.

**Architecture:** Pure-Rust `encoder/` submodule inside the existing crate; new `tb_enc_*` `extern "C"` exports live in the same `web/tinybit_wasm.wasm` artifact. JS stages inputs into wasm-side staging slots, calls `tb_enc_run`, reads back PNG bytes. Encoded bytes round-trip through `tb_feed_cartridge` for "Play now" with zero new engine code.

**Tech Stack:** Rust 1.95+ → `wasm32-wasip1` (existing toolchain), `png = "0.17"` (new dep, pure-Rust deflate via `miniz_oxide`), unchanged C engine submodule, vanilla JS module in `web/`.

**Spec:** `docs/superpowers/specs/2026-05-11-tb-encoder-design.md`

**Scope of divergences from spec (locked in here):**
- `png = "0.17"` with **default features** (the spec's `default-features = false` would disable encoding — corrected here).
- Buffers >32 KB live inside `EncoderState`, not on the stack: `cover_rgba [u8; 65_536]`, `sprite_rgba [u8; 65_536]`, `canvas [u8; 262_144]`. Public Rust functions take `&mut`-references rather than returning arrays.
- State storage uses the existing crate's `thread_local!` + `RefCell<Option<…>>` pattern, not `static mut`.

---

## File map

**Create:**
- `src/encoder/mod.rs` — entry point `encode()`, `EncError`, `HeaderOpts`, slot constants. ~180 lines.
- `src/encoder/header.rs` — CRC32 + 146-byte header packing. ~100 lines.
- `src/encoder/steg.rs` — low-2-bit byte/spritesheet writers. ~80 lines.
- `src/encoder/image.rs` — PNG decode (128×128 / 256×256 RGBA8) + cover composite + bundled-frame constant. ~140 lines.
- `src/encoder/png_io.rs` — encode 256×256 RGBA8 buffer to PNG byte stream. ~50 lines.
- `assets/cartridge3.png` — binary, copied from `../TinyBit/assets/cartridge3.png` (256×256 RGBA8).
- `web/encoder.js` — `encodeFromForm(els)` + private staging helpers. ~150 lines.
- `web/wasm-runtime.js` — shared wasm boot path used by `index.js` and `encoder.js`. ~80 lines (mostly moved from `index.js`).
- `scripts/fixtures/smoke_cover.png` — 128×128 RGBA checkerboard fixture.
- `scripts/fixtures/smoke_sprite.png` — 128×128 RGBA gradient fixture.
- `scripts/fixtures/smoke_script.lua` — minimal Lua that writes a known pixel.
- `tests/golden_header.bin` — 146-byte regression fixture (captured manually).

**Modify:**
- `src/lib.rs` — add `mod encoder;` and the new `tb_enc_*` exports.
- `Cargo.toml` — add `png = "0.17"` dependency.
- `web/index.html` — add the `<details id="encoder-panel">` form.
- `web/index.js` — extract boot to `wasm-runtime.js`, wire encoder buttons, live usage indicator.
- `scripts/smoke.mjs` — append encoder round-trip case + negative case.
- `README.md` — mention encoder panel; remove "No cartridge export" limitation.

**Unchanged:** `build.rs`, `scripts/build.sh`, `src/bindings.rs`, `src/tinybit/`, `web/wasi-shim.js`, `web/audio-worklet.js`.

---

## Task 0: Setup — asset copy, dependency, baseline green

**Files:**
- Create: `assets/cartridge3.png` (binary copy)
- Modify: `Cargo.toml`

- [ ] **Step 0.1: Confirm worktree state and submodule**

```bash
git status
git rev-parse --abbrev-ref HEAD          # expect feat/tb-encoder
git submodule update --init --recursive  # need src/tinybit/ for the existing build
ls src/tinybit/cartridge.h               # sanity
```

Expected: clean tree on `feat/tb-encoder`, submodule populated.

- [ ] **Step 0.2: Copy the bundled frame asset**

```bash
mkdir -p assets
cp ../../../TinyBit/assets/cartridge3.png assets/cartridge3.png
file assets/cartridge3.png   # must print: PNG image data, 256 x 256, 8-bit/color RGBA
```

Path note: this worktree lives at `<repo>/.worktrees/tb-encoder/`, so the sibling `TinyBit/` checkout sits three directories up.

- [ ] **Step 0.3: Add the `png` crate dependency**

Edit `Cargo.toml`, insert `png = "0.17"` under `[dependencies]`:

```toml
[dependencies]
libc = "0.2"
png = "0.17"
```

Leave `[build-dependencies]`, profiles, and `[lib] crate-type` alone.

- [ ] **Step 0.4: Verify the baseline build still produces a wasm**

```bash
./scripts/build.sh
ls -la web/tinybit_wasm.wasm
```

Expected: `web/tinybit_wasm.wasm` exists (size grew slightly from the added crate). No code changes yet, so the player still behaves identically.

- [ ] **Step 0.5: Verify the existing smoke test still passes**

```bash
node scripts/smoke.mjs
```

Expected: `smoke test passed: …/16384 display pixels non-zero`.

- [ ] **Step 0.6: Commit setup**

```bash
git add Cargo.toml Cargo.lock assets/cartridge3.png
git commit -m "build: add png crate dep, bundle cartridge frame asset"
```

---

## Task 1: `encoder/header.rs` — CRC32 + header packing (TDD)

**Files:**
- Create: `src/encoder/header.rs`
- Create: `src/encoder/mod.rs` (minimal — just `pub mod header;` and re-exports needed by the test)
- Modify: `src/lib.rs` (add `mod encoder;`)

- [ ] **Step 1.1: Create skeleton `src/encoder/mod.rs`**

```rust
//! In-browser cartridge encoder. Pure Rust, no dependence on the C engine.

pub mod header;

pub use header::{pack, HeaderOpts};
```

- [ ] **Step 1.2: Wire the module into `src/lib.rs`**

Add at the very top of `src/lib.rs` (above `mod bindings;`):

```rust
mod encoder;
```

- [ ] **Step 1.3: Write the failing test in `src/encoder/header.rs`**

Create `src/encoder/header.rs` containing only the tests + struct stub:

```rust
//! 146-byte cartridge header + CRC-32 (IEEE 802.3) over the script bytes.

pub struct HeaderOpts<'a> {
    pub title: &'a str,
    pub author: &'a str,
    pub format_version: u16,
    pub flags: u16,
    pub game_version: u16,
    pub package_date: u32,
}

pub const HEADER_SIZE: usize = 146;
pub const TITLE_SIZE: usize = 64;
pub const AUTHOR_SIZE: usize = 64;

pub fn pack(opts: &HeaderOpts, script: &[u8]) -> [u8; HEADER_SIZE] {
    let _ = (opts, script);
    [0; HEADER_SIZE]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Canonical CRC-32 (IEEE 802.3) test vectors.
    #[test]
    fn crc32_canonical_vectors() {
        assert_eq!(crc32(b""), 0x00000000);
        assert_eq!(crc32(b"123456789"), 0xCBF43926);
        assert_eq!(crc32(b"The quick brown fox jumps over the lazy dog"), 0x414FA339);
    }

    #[test]
    fn pack_writes_scalars_le() {
        let opts = HeaderOpts {
            title: "hello",
            author: "me",
            format_version: 1,
            flags: 0x1234,
            game_version: 7,
            package_date: 0xDEADBEEF,
        };
        let script = b"print('hi')\n";
        let hdr = pack(&opts, script);

        // format_version LE at offset 0
        assert_eq!(hdr[0], 1);
        assert_eq!(hdr[1], 0);
        // flags LE at offset 2
        assert_eq!(hdr[2], 0x34);
        assert_eq!(hdr[3], 0x12);
        // script_size LE at offset 4
        let ss = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        assert_eq!(ss, script.len() as u32);
        // checksum at offset 8 = crc32(script)
        let cs = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]);
        assert_eq!(cs, crc32(script));
        // title at offset 12, null-padded, last byte forced 0
        assert_eq!(&hdr[12..17], b"hello");
        assert_eq!(hdr[12 + TITLE_SIZE - 1], 0);
        // author at offset 76
        assert_eq!(&hdr[76..78], b"me");
        assert_eq!(hdr[76 + AUTHOR_SIZE - 1], 0);
        // game_version LE at offset 140
        assert_eq!(u16::from_le_bytes([hdr[140], hdr[141]]), 7);
        // package_date LE at offset 142
        assert_eq!(u32::from_le_bytes([hdr[142], hdr[143], hdr[144], hdr[145]]), 0xDEADBEEF);
    }

    #[test]
    fn pack_truncates_oversize_strings_safely() {
        // Title is 70 ASCII bytes, must be truncated to 63 + NUL.
        let long = "a".repeat(70);
        let opts = HeaderOpts {
            title: &long,
            author: "",
            format_version: 1,
            flags: 0,
            game_version: 1,
            package_date: 0,
        };
        let hdr = pack(&opts, b"");
        // First 63 bytes 'a', byte 63 = NUL.
        assert!(hdr[12..(12 + 63)].iter().all(|&b| b == b'a'));
        assert_eq!(hdr[12 + 63], 0);
    }
}
```

- [ ] **Step 1.4: Run the test — verify FAIL**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::header::tests
```

Expected: `crc32_canonical_vectors` won't even compile (`crc32` undefined). That's the failing state.

- [ ] **Step 1.5: Implement `crc32` and the real `pack`**

Replace the body of `src/encoder/header.rs` (keep the test module unchanged) with:

```rust
//! 146-byte cartridge header + CRC-32 (IEEE 802.3) over the script bytes.

pub struct HeaderOpts<'a> {
    pub title: &'a str,
    pub author: &'a str,
    pub format_version: u16,
    pub flags: u16,
    pub game_version: u16,
    pub package_date: u32,
}

pub const HEADER_SIZE: usize = 146;
pub const TITLE_SIZE: usize = 64;
pub const AUTHOR_SIZE: usize = 64;

/// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320).
/// Matches cartridge_io.c::crc32 byte-for-byte.
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    crc ^ 0xFFFF_FFFF
}

/// Pack header per `struct TinyBitHeader` (little-endian, 146 bytes).
/// Title/author truncated to 63 UTF-8 bytes + trailing NUL.
pub fn pack(opts: &HeaderOpts, script: &[u8]) -> [u8; HEADER_SIZE] {
    let mut h = [0u8; HEADER_SIZE];

    h[0..2].copy_from_slice(&opts.format_version.to_le_bytes());
    h[2..4].copy_from_slice(&opts.flags.to_le_bytes());
    h[4..8].copy_from_slice(&(script.len() as u32).to_le_bytes());
    h[8..12].copy_from_slice(&crc32(script).to_le_bytes());

    copy_truncated(&mut h[12..(12 + TITLE_SIZE)], opts.title);
    copy_truncated(&mut h[76..(76 + AUTHOR_SIZE)], opts.author);

    h[140..142].copy_from_slice(&opts.game_version.to_le_bytes());
    h[142..146].copy_from_slice(&opts.package_date.to_le_bytes());
    h
}

/// Copies `src` into `dest` zero-padded; the final byte of `dest` is forced to NUL.
/// If `src` is longer than `dest.len() - 1`, it's truncated at the byte level.
/// (We don't try to be UTF-8 boundary-aware — the wasm export rejects strings
/// longer than 63 UTF-8 bytes before they reach here, so truncation here is
/// a defense-in-depth path for the unit tests.)
fn copy_truncated(dest: &mut [u8], src: &str) {
    let limit = dest.len().saturating_sub(1);
    let n = src.as_bytes().len().min(limit);
    dest[..n].copy_from_slice(&src.as_bytes()[..n]);
    if let Some(last) = dest.last_mut() {
        *last = 0;
    }
    // Bytes between n and last stay 0 from the caller's zero-init.
}
```

- [ ] **Step 1.6: Run tests — verify PASS**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::header::tests
```

Expected: `test result: ok. 3 passed`.

- [ ] **Step 1.7: Commit**

```bash
git add src/encoder/mod.rs src/encoder/header.rs src/lib.rs
git commit -m "encoder: header pack + CRC32 (IEEE 802.3)"
```

---

## Task 2: `encoder/steg.rs` — low-2-bit byte/spritesheet writers (TDD)

**Files:**
- Create: `src/encoder/steg.rs`
- Modify: `src/encoder/mod.rs` (add `pub mod steg;`)

- [ ] **Step 2.1: Register the module**

In `src/encoder/mod.rs`, add below the existing `pub mod header;`:

```rust
pub mod steg;
```

- [ ] **Step 2.2: Write failing tests in `src/encoder/steg.rs`**

```rust
//! Low-2-bit-per-channel steganography writers.
//!
//! Both functions only overwrite the low 2 bits of each destination byte
//! (preserving `dest[i] & 0xfc`), so the visible cover/frame artwork is
//! untouched. Cursor is a single byte-index that advances sequentially
//! through the cartridge buffer.

/// Encode `src` into `dest` at low-2-bits-per-channel: 1 src byte → 4 dest channels.
pub fn write_bytes(_dest: &mut [u8], _cursor: &mut usize, _src: &[u8]) {
    unimplemented!()
}

/// Encode `src` into `dest` carrying only the TOP 4 BITS of each src byte.
/// 1 src byte → 2 dest channels. Mirrors `encode_spritesheet` in cartridge_io.c.
pub fn write_spritesheet(_dest: &mut [u8], _cursor: &mut usize, _src: &[u8]) {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip every 0..=255 source byte through write_bytes + the engine's
    /// low-2-bit decode (`(a&3)<<6 | (b&3)<<4 | (c&3)<<2 | (d&3)<<0`).
    #[test]
    fn write_bytes_round_trips_full_byte_range() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        // Initialise dest with non-zero high bits to ensure we preserve them.
        let mut dest = vec![0xF8u8; src.len() * 4]; // top 6 bits = 0b111110
        let mut cursor = 0;
        write_bytes(&mut dest, &mut cursor, &src);
        assert_eq!(cursor, src.len() * 4);

        for (i, &orig) in src.iter().enumerate() {
            let a = dest[i * 4];
            let b = dest[i * 4 + 1];
            let c = dest[i * 4 + 2];
            let d = dest[i * 4 + 3];
            // High 6 bits preserved.
            assert_eq!(a & 0xfc, 0xF8, "byte {i}: high bits clobbered");
            // Engine decode.
            let decoded = ((a & 3) << 6) | ((b & 3) << 4) | ((c & 3) << 2) | (d & 3);
            assert_eq!(decoded, orig, "byte {i}: round-trip mismatch");
        }
    }

    /// write_spritesheet keeps only top 4 bits and packs 1 src byte into 2 channels.
    /// After decoding the resulting 2 channels back into 1 byte
    /// (`(a&3)<<6 | (b&3)<<4`), we should recover `src[i] & 0xF0`.
    #[test]
    fn write_spritesheet_keeps_only_top_4_bits() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        let mut dest = vec![0u8; src.len() * 2];
        let mut cursor = 0;
        write_spritesheet(&mut dest, &mut cursor, &src);
        assert_eq!(cursor, src.len() * 2);

        for (i, &orig) in src.iter().enumerate() {
            let a = dest[i * 2];
            let b = dest[i * 2 + 1];
            let decoded_high_nibble = ((a & 3) << 6) | ((b & 3) << 4);
            assert_eq!(decoded_high_nibble, orig & 0xF0, "byte {i}: top-nibble mismatch");
        }
    }

    #[test]
    fn cursor_advances_across_separate_calls() {
        let mut dest = vec![0u8; 64];
        let mut cursor = 0;
        write_bytes(&mut dest, &mut cursor, &[0xAB]);
        assert_eq!(cursor, 4);
        write_bytes(&mut dest, &mut cursor, &[0xCD]);
        assert_eq!(cursor, 8);
        write_spritesheet(&mut dest, &mut cursor, &[0xEF]);
        assert_eq!(cursor, 10);
    }
}
```

- [ ] **Step 2.3: Run — verify FAIL**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::steg::tests
```

Expected: `unimplemented` panic, three tests failing.

- [ ] **Step 2.4: Implement both writers**

Replace the bodies in `src/encoder/steg.rs`:

```rust
pub fn write_bytes(dest: &mut [u8], cursor: &mut usize, src: &[u8]) {
    for &byte in src {
        let a = (byte >> 6) & 0x3;
        let b = (byte >> 4) & 0x3;
        let c = (byte >> 2) & 0x3;
        let d = byte & 0x3;
        dest[*cursor]     = (dest[*cursor]     & 0xfc) | a;
        dest[*cursor + 1] = (dest[*cursor + 1] & 0xfc) | b;
        dest[*cursor + 2] = (dest[*cursor + 2] & 0xfc) | c;
        dest[*cursor + 3] = (dest[*cursor + 3] & 0xfc) | d;
        *cursor += 4;
    }
}

pub fn write_spritesheet(dest: &mut [u8], cursor: &mut usize, src: &[u8]) {
    for &byte in src {
        let a = (byte >> 6) & 0x3;
        let b = (byte >> 4) & 0x3;
        dest[*cursor]     = (dest[*cursor]     & 0xfc) | a;
        dest[*cursor + 1] = (dest[*cursor + 1] & 0xfc) | b;
        *cursor += 2;
    }
}
```

- [ ] **Step 2.5: Run — verify PASS**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::steg::tests
```

Expected: 3 passed.

- [ ] **Step 2.6: Commit**

```bash
git add src/encoder/mod.rs src/encoder/steg.rs
git commit -m "encoder: low-2-bit steganography writers"
```

---

## Task 3: `encoder/image.rs` — PNG decode + cover composite (TDD)

**Files:**
- Create: `src/encoder/image.rs`
- Modify: `src/encoder/mod.rs` (add `pub mod image;`)

- [ ] **Step 3.1: Register the module**

In `src/encoder/mod.rs`, add `pub mod image;`.

- [ ] **Step 3.2: Write the tests first**

Create `src/encoder/image.rs`:

```rust
//! PNG → RGBA8 decode with strict size checks, plus cover-onto-frame composite.

use png::{ColorType, Decoder, Transformations};

/// Cover image position in the 256×256 cartridge canvas.
pub const COVER_X: usize = 64;
pub const COVER_Y: usize = 60;
pub const SCREEN_W: usize = 128;
pub const SCREEN_H: usize = 128;
pub const CART_W: usize = 256;
pub const CART_H: usize = 256;
pub const CART_RGBA_LEN: usize = CART_W * CART_H * 4;     // 262_144
pub const SCREEN_RGBA_LEN: usize = SCREEN_W * SCREEN_H * 4; // 65_536

/// Default frame, embedded at compile time.
pub const BUNDLED_FRAME: &[u8] = include_bytes!("../../assets/cartridge3.png");

#[derive(Debug, PartialEq, Eq)]
pub enum ImageError {
    Decode(&'static str),
    WrongSize { got_w: u32, got_h: u32, want_w: u32, want_h: u32 },
}

/// Decode a PNG into a 128×128 RGBA8 buffer (writes into `dest`).
pub fn decode_128x128_rgba(_png_bytes: &[u8], _dest: &mut [u8; SCREEN_RGBA_LEN]) -> Result<(), ImageError> {
    unimplemented!()
}

/// Decode a PNG into a 256×256 RGBA8 buffer (writes into `dest`).
pub fn decode_256x256_rgba(_png_bytes: &[u8], _dest: &mut [u8; CART_RGBA_LEN]) -> Result<(), ImageError> {
    unimplemented!()
}

/// Composite the cover into the 256×256 canvas at (COVER_X, COVER_Y).
/// `canvas` must already contain the frame artwork.
pub fn composite_cover(_canvas: &mut [u8; CART_RGBA_LEN], _cover_rgba: &[u8; SCREEN_RGBA_LEN]) {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal in-memory PNG of given dimensions via the `png` crate,
    /// filled with the byte pattern `(x ^ y) as u8` for R/G/B and 0xFF for A.
    fn make_png(w: u32, h: u32) -> Vec<u8> {
        let mut buf = Vec::new();
        let mut encoder = png::Encoder::new(&mut buf, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        let mut data = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let v = ((x ^ y) as u8);
                data[i] = v;
                data[i + 1] = v;
                data[i + 2] = v;
                data[i + 3] = 0xFF;
            }
        }
        writer.write_image_data(&data).unwrap();
        drop(writer);
        buf
    }

    #[test]
    fn decode_128x128_round_trip() {
        let png = make_png(128, 128);
        let mut out = [0u8; SCREEN_RGBA_LEN];
        decode_128x128_rgba(&png, &mut out).unwrap();
        // Spot-check a few pixels.
        assert_eq!(out[0], 0);          // (0,0) -> 0^0 = 0
        assert_eq!(out[3], 0xFF);       // alpha
        let idx = (5 * 128 + 7) * 4;    // (7,5) -> 7^5 = 2
        assert_eq!(out[idx], 2);
    }

    #[test]
    fn decode_128x128_rejects_wrong_size() {
        let png = make_png(64, 128);
        let mut out = [0u8; SCREEN_RGBA_LEN];
        let err = decode_128x128_rgba(&png, &mut out).unwrap_err();
        assert_eq!(err, ImageError::WrongSize { got_w: 64, got_h: 128, want_w: 128, want_h: 128 });
    }

    #[test]
    fn decode_128x128_rejects_truncated_bytes() {
        let png = make_png(128, 128);
        let truncated = &png[..png.len() / 2];
        let mut out = [0u8; SCREEN_RGBA_LEN];
        let err = decode_128x128_rgba(truncated, &mut out).unwrap_err();
        match err {
            ImageError::Decode(_) => {} // any decode error message is fine
            other => panic!("expected Decode, got {:?}", other),
        }
    }

    #[test]
    fn decode_256x256_round_trip() {
        let png = make_png(256, 256);
        let mut out = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = out.as_mut().try_into().unwrap();
        decode_256x256_rgba(&png, arr).unwrap();
        // Spot-check
        assert_eq!(arr[3], 0xFF);
    }

    #[test]
    fn bundled_frame_is_valid_256x256() {
        let mut buf = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = buf.as_mut().try_into().unwrap();
        decode_256x256_rgba(BUNDLED_FRAME, arr).unwrap();
    }

    #[test]
    fn composite_writes_cover_at_offset_and_leaves_rest_untouched() {
        let mut canvas = vec![0xAAu8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut cover = [0u8; SCREEN_RGBA_LEN];
        for (i, v) in cover.iter_mut().enumerate() {
            *v = (i & 0xFF) as u8;
        }
        composite_cover(arr, &cover);

        // Pixel (0,0) of canvas is outside the cover region (cover starts at (64,60)).
        assert_eq!(arr[0], 0xAA);
        // Pixel (64,60) is top-left of cover region; corresponds to cover (0,0) = 0.
        let canvas_idx = (60 * CART_W + 64) * 4;
        assert_eq!(arr[canvas_idx], 0);
        // Pixel (65,60) -> cover (1,0) -> cover index 4 (=4 mod 256).
        let canvas_idx2 = (60 * CART_W + 65) * 4;
        assert_eq!(arr[canvas_idx2], 4);
    }
}
```

- [ ] **Step 3.3: Run — verify FAIL**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::image::tests
```

Expected: `unimplemented` panics in all six tests.

- [ ] **Step 3.4: Implement decode + composite**

Replace the bodies in `src/encoder/image.rs` (keep the test module):

```rust
fn decode_rgba_exact(png_bytes: &[u8], want_w: u32, want_h: u32, dest: &mut [u8]) -> Result<(), ImageError> {
    let mut decoder = Decoder::new(png_bytes);
    // Expand palette / low-depth grayscale to 8-bit channels. Alpha is added by the
    // decoder when the input lacks one (default 0xFF).
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16 | Transformations::ALPHA);

    let mut reader = decoder.read_info().map_err(|_| ImageError::Decode("read_info"))?;
    let info = reader.info();
    if info.width != want_w || info.height != want_h {
        return Err(ImageError::WrongSize {
            got_w: info.width, got_h: info.height,
            want_w, want_h,
        });
    }
    if info.color_type != ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return Err(ImageError::Decode("not RGBA8 after transformations"));
    }
    let needed = reader.output_buffer_size();
    if needed != dest.len() {
        return Err(ImageError::Decode("size mismatch"));
    }
    reader.next_frame(dest).map_err(|_| ImageError::Decode("next_frame"))?;
    Ok(())
}

pub fn decode_128x128_rgba(png_bytes: &[u8], dest: &mut [u8; SCREEN_RGBA_LEN]) -> Result<(), ImageError> {
    decode_rgba_exact(png_bytes, SCREEN_W as u32, SCREEN_H as u32, dest)
}

pub fn decode_256x256_rgba(png_bytes: &[u8], dest: &mut [u8; CART_RGBA_LEN]) -> Result<(), ImageError> {
    decode_rgba_exact(png_bytes, CART_W as u32, CART_H as u32, dest)
}

pub fn composite_cover(canvas: &mut [u8; CART_RGBA_LEN], cover_rgba: &[u8; SCREEN_RGBA_LEN]) {
    for y in 0..SCREEN_H {
        let dst_row = (COVER_Y + y) * CART_W + COVER_X;
        let src_row = y * SCREEN_W;
        for x in 0..SCREEN_W {
            let d = (dst_row + x) * 4;
            let s = (src_row + x) * 4;
            canvas[d]     = cover_rgba[s];
            canvas[d + 1] = cover_rgba[s + 1];
            canvas[d + 2] = cover_rgba[s + 2];
            canvas[d + 3] = cover_rgba[s + 3];
        }
    }
}
```

- [ ] **Step 3.5: Run — verify PASS**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::image::tests
```

Expected: 6 passed. If `bundled_frame_is_valid_256x256` fails, re-check `assets/cartridge3.png` (Task 0.2).

- [ ] **Step 3.6: Commit**

```bash
git add src/encoder/mod.rs src/encoder/image.rs
git commit -m "encoder: PNG decode + cover-onto-frame composite"
```

---

## Task 4: `encoder/png_io.rs` — final PNG encode (TDD)

**Files:**
- Create: `src/encoder/png_io.rs`
- Modify: `src/encoder/mod.rs` (add `pub mod png_io;`)

- [ ] **Step 4.1: Register the module and write the failing test**

Add `pub mod png_io;` to `src/encoder/mod.rs`. Then create `src/encoder/png_io.rs`:

```rust
//! Encode a 256×256 RGBA8 buffer to a PNG byte stream.

use crate::encoder::image::{CART_H, CART_RGBA_LEN, CART_W};

#[derive(Debug)]
pub enum PngWriteError {
    Encode(&'static str),
}

pub fn encode_rgba(_canvas: &[u8; CART_RGBA_LEN], _out: &mut Vec<u8>) -> Result<(), PngWriteError> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::image::decode_256x256_rgba;

    #[test]
    fn round_trip_via_png_decoder() {
        // Build an RGBA gradient.
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        for y in 0..CART_H {
            for x in 0..CART_W {
                let i = (y * CART_W + x) * 4;
                arr[i] = x as u8;
                arr[i + 1] = y as u8;
                arr[i + 2] = (x ^ y) as u8;
                arr[i + 3] = 0xFF;
            }
        }

        let mut out = Vec::new();
        encode_rgba(arr, &mut out).unwrap();
        assert!(out.len() > 100, "PNG output suspiciously short: {} bytes", out.len());
        // Magic bytes.
        assert_eq!(&out[..8], b"\x89PNG\r\n\x1a\n");

        // Decode and check a pixel.
        let mut back = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let back_arr: &mut [u8; CART_RGBA_LEN] = back.as_mut().try_into().unwrap();
        decode_256x256_rgba(&out, back_arr).unwrap();
        let idx = (123 * CART_W + 45) * 4;
        assert_eq!(back_arr[idx],     45);
        assert_eq!(back_arr[idx + 1], 123);
        assert_eq!(back_arr[idx + 2], (45u32 ^ 123u32) as u8);
        assert_eq!(back_arr[idx + 3], 0xFF);
    }

    #[test]
    fn encode_clears_out_buffer_each_call() {
        let canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &[u8; CART_RGBA_LEN] = canvas.as_ref().try_into().unwrap();
        let mut out = vec![0xAA; 99];
        encode_rgba(arr, &mut out).unwrap();
        // The function should overwrite the buffer, not append to existing junk.
        assert_eq!(&out[..8], b"\x89PNG\r\n\x1a\n");
    }
}
```

- [ ] **Step 4.2: Run — verify FAIL**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::png_io::tests
```

Expected: panics from `unimplemented`.

- [ ] **Step 4.3: Implement `encode_rgba`**

Replace the body in `src/encoder/png_io.rs`:

```rust
pub fn encode_rgba(canvas: &[u8; CART_RGBA_LEN], out: &mut Vec<u8>) -> Result<(), PngWriteError> {
    out.clear();
    {
        let mut enc = png::Encoder::new(&mut *out, CART_W as u32, CART_H as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|_| PngWriteError::Encode("write_header"))?;
        writer
            .write_image_data(canvas)
            .map_err(|_| PngWriteError::Encode("write_image_data"))?;
    }
    Ok(())
}
```

- [ ] **Step 4.4: Run — verify PASS**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::png_io::tests
```

Expected: 2 passed.

- [ ] **Step 4.5: Commit**

```bash
git add src/encoder/mod.rs src/encoder/png_io.rs
git commit -m "encoder: PNG write via png crate"
```

---

## Task 5: `encoder/mod.rs` — `EncError` + `encode()` orchestration (TDD)

**Files:**
- Modify: `src/encoder/mod.rs`

This task assembles header, image, steg, and png_io into a single public `encode()` function and defines the unified `EncError` enum.

- [ ] **Step 5.1: Write the failing end-to-end test**

Append to `src/encoder/mod.rs`:

```rust
use crate::encoder::header::{HeaderOpts, HEADER_SIZE};
use crate::encoder::image::{CART_RGBA_LEN, SCREEN_RGBA_LEN};

pub const SCRIPT_MAX: usize = 32_621;       // see spec §"Byte-budget sanity check"
pub const TITLE_MAX_UTF8: usize = 63;
pub const AUTHOR_MAX_UTF8: usize = 63;

#[derive(Debug, PartialEq, Eq)]
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
    pub fn code(&self) -> i32 {
        match self {
            EncError::CoverPng(_)        | EncError::CoverSize  => -1,
            EncError::SpritePng(_)       | EncError::SpriteSize => -2,
            EncError::FramePng(_)        | EncError::FrameSize  => -3,
            EncError::ScriptTooLarge { .. }                     => -4,
            EncError::HeaderStringOverflow                      => -5,
            EncError::PngWrite(_)                               => -6,
        }
    }

    pub fn message(&self) -> String {
        match self {
            EncError::CoverPng(m)  => format!("Cover PNG decode failed: {m}"),
            EncError::CoverSize    => "Cover must be 128x128".to_string(),
            EncError::SpritePng(m) => format!("Spritesheet PNG decode failed: {m}"),
            EncError::SpriteSize   => "Spritesheet must be 128x128".to_string(),
            EncError::FramePng(m)  => format!("Frame override PNG decode failed: {m}"),
            EncError::FrameSize    => "Frame override must be 256x256".to_string(),
            EncError::ScriptTooLarge { script_size, max } =>
                format!("Script too large: {script_size} / {max} bytes"),
            EncError::HeaderStringOverflow =>
                "Title or author exceeds 63 UTF-8 bytes".to_string(),
            EncError::PngWrite(m)  => format!("PNG write failed: {m}"),
        }
    }
}

/// Encode a cartridge.
///
/// `cover_rgba_buf` / `sprite_rgba_buf` / `canvas_buf` are caller-owned scratch
/// buffers (typically members of `EncoderState`) — we don't allocate them so
/// the wasm32 stack stays small.
#[allow(clippy::too_many_arguments)]
pub fn encode(
    cover_png: &[u8],
    spritesheet_png: &[u8],
    script: &[u8],
    frame_override: Option<&[u8]>,
    opts: &HeaderOpts,
    cover_rgba_buf: &mut [u8; SCREEN_RGBA_LEN],
    sprite_rgba_buf: &mut [u8; SCREEN_RGBA_LEN],
    canvas_buf: &mut [u8; CART_RGBA_LEN],
    out: &mut Vec<u8>,
) -> Result<(), EncError> {
    let _ = (cover_png, spritesheet_png, script, frame_override, opts,
             cover_rgba_buf, sprite_rgba_buf, canvas_buf, out);
    Err(EncError::PngWrite("not implemented"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::header::crc32;
    use crate::encoder::image::{
        decode_256x256_rgba, CART_RGBA_LEN, CART_W, COVER_X, COVER_Y, SCREEN_H, SCREEN_RGBA_LEN, SCREEN_W,
    };

    fn make_solid_png(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut buf = Vec::new();
        let mut e = png::Encoder::new(&mut buf, w, h);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut wr = e.write_header().unwrap();
        let data: Vec<u8> = (0..(w * h)).flat_map(|_| rgba.iter().copied()).collect();
        wr.write_image_data(&data).unwrap();
        drop(wr);
        buf
    }

    /// End-to-end: encode → re-decode the produced PNG → reconstruct the embedded
    /// header bytes via the engine's low-2-bit decode logic and assert that they
    /// match what the encoder packed in.
    #[test]
    fn encode_round_trip_recovers_header_and_script_crc() {
        let cover_png  = make_solid_png(128, 128, [10, 20, 30, 0xFF]);
        let sprite_png = make_solid_png(128, 128, [0xF0, 0x00, 0xA0, 0xFF]);
        let script: &[u8] = b"function _draw() end\n";

        let opts = HeaderOpts {
            title: "roundtrip",
            author: "tester",
            format_version: 1,
            flags: 0,
            game_version: 42,
            package_date: 1_700_000_000,
        };

        let mut cover_rgba  = [0u8; SCREEN_RGBA_LEN];
        let mut sprite_rgba = [0u8; SCREEN_RGBA_LEN];
        let mut canvas      = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut out = Vec::new();

        encode(&cover_png, &sprite_png, script, None, &opts,
               &mut cover_rgba, &mut sprite_rgba, canvas_arr, &mut out).unwrap();

        // Re-decode the produced PNG.
        let mut back = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let back_arr: &mut [u8; CART_RGBA_LEN] = back.as_mut().try_into().unwrap();
        decode_256x256_rgba(&out, back_arr).unwrap();

        // Recover the 146 header bytes via low-2-bit decode of the first 146 px.
        let mut hdr = [0u8; HEADER_SIZE];
        for i in 0..HEADER_SIZE {
            let p = i * 4;
            let a = back_arr[p];
            let b = back_arr[p + 1];
            let c = back_arr[p + 2];
            let d = back_arr[p + 3];
            hdr[i] = ((a & 3) << 6) | ((b & 3) << 4) | ((c & 3) << 2) | (d & 3);
        }

        // Verify the CRC32 field matches our local computation.
        let cs = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]);
        assert_eq!(cs, crc32(script));
        // Title.
        assert_eq!(&hdr[12..21], b"roundtrip");
        // game_version & package_date.
        assert_eq!(u16::from_le_bytes([hdr[140], hdr[141]]), 42);
        assert_eq!(u32::from_le_bytes([hdr[142], hdr[143], hdr[144], hdr[145]]), 1_700_000_000);

        // Cover pixel survived (top nibbles).
        let canvas_idx = ((COVER_Y) * CART_W + COVER_X) * 4;
        assert_eq!(back_arr[canvas_idx]     & 0xF0, 10  & 0xF0);
        assert_eq!(back_arr[canvas_idx + 1] & 0xF0, 20  & 0xF0);
        assert_eq!(back_arr[canvas_idx + 2] & 0xF0, 30  & 0xF0);
    }

    #[test]
    fn encode_rejects_oversized_script() {
        let cover_png  = make_solid_png(128, 128, [0, 0, 0, 0xFF]);
        let sprite_png = make_solid_png(128, 128, [0, 0, 0, 0xFF]);
        let big_script = vec![b'x'; SCRIPT_MAX + 1];

        let opts = HeaderOpts {
            title: "", author: "", format_version: 1, flags: 0,
            game_version: 1, package_date: 0,
        };

        let mut cover_rgba  = [0u8; SCREEN_RGBA_LEN];
        let mut sprite_rgba = [0u8; SCREEN_RGBA_LEN];
        let mut canvas      = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut out = Vec::new();

        let err = encode(&cover_png, &sprite_png, &big_script, None, &opts,
                         &mut cover_rgba, &mut sprite_rgba, canvas_arr, &mut out).unwrap_err();
        match err {
            EncError::ScriptTooLarge { script_size, max } => {
                assert_eq!(script_size as usize, SCRIPT_MAX + 1);
                assert_eq!(max as usize, SCRIPT_MAX);
            }
            other => panic!("expected ScriptTooLarge, got {:?}", other),
        }
    }

    #[test]
    fn encode_rejects_wrong_cover_size() {
        let cover_png  = make_solid_png(64, 64, [0, 0, 0, 0xFF]); // wrong size
        let sprite_png = make_solid_png(128, 128, [0, 0, 0, 0xFF]);
        let opts = HeaderOpts {
            title: "", author: "", format_version: 1, flags: 0,
            game_version: 1, package_date: 0,
        };
        let mut cover_rgba  = [0u8; SCREEN_RGBA_LEN];
        let mut sprite_rgba = [0u8; SCREEN_RGBA_LEN];
        let mut canvas      = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut out = Vec::new();

        let err = encode(&cover_png, &sprite_png, b"", None, &opts,
                         &mut cover_rgba, &mut sprite_rgba, canvas_arr, &mut out).unwrap_err();
        assert_eq!(err, EncError::CoverSize);
        assert_eq!(err.code(), -1);
    }

    #[test]
    fn encode_rejects_overlong_title() {
        let cover_png  = make_solid_png(128, 128, [0, 0, 0, 0xFF]);
        let sprite_png = make_solid_png(128, 128, [0, 0, 0, 0xFF]);
        let long = "a".repeat(64); // 64 bytes > 63
        let opts = HeaderOpts {
            title: &long, author: "", format_version: 1, flags: 0,
            game_version: 1, package_date: 0,
        };
        let mut cover_rgba  = [0u8; SCREEN_RGBA_LEN];
        let mut sprite_rgba = [0u8; SCREEN_RGBA_LEN];
        let mut canvas      = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut out = Vec::new();

        let err = encode(&cover_png, &sprite_png, b"", None, &opts,
                         &mut cover_rgba, &mut sprite_rgba, canvas_arr, &mut out).unwrap_err();
        assert_eq!(err, EncError::HeaderStringOverflow);
    }
}
```

- [ ] **Step 5.2: Run — verify FAIL**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder::tests
```

Expected: all four end-to-end tests fail (encode returns `PngWrite("not implemented")`).

- [ ] **Step 5.3: Implement `encode()`**

Replace the `encode()` body in `src/encoder/mod.rs`:

```rust
pub fn encode(
    cover_png: &[u8],
    spritesheet_png: &[u8],
    script: &[u8],
    frame_override: Option<&[u8]>,
    opts: &HeaderOpts,
    cover_rgba_buf: &mut [u8; SCREEN_RGBA_LEN],
    sprite_rgba_buf: &mut [u8; SCREEN_RGBA_LEN],
    canvas_buf: &mut [u8; CART_RGBA_LEN],
    out: &mut Vec<u8>,
) -> Result<(), EncError> {
    use crate::encoder::image::{
        composite_cover, decode_128x128_rgba, decode_256x256_rgba, BUNDLED_FRAME, ImageError,
    };
    use crate::encoder::png_io::{encode_rgba, PngWriteError};
    use crate::encoder::steg;
    use crate::encoder::header::{pack, HEADER_SIZE};

    // 1. Cheap validations first.
    if script.len() > SCRIPT_MAX {
        return Err(EncError::ScriptTooLarge {
            script_size: script.len() as u32,
            max: SCRIPT_MAX as u32,
        });
    }
    if opts.title.as_bytes().len() > TITLE_MAX_UTF8
        || opts.author.as_bytes().len() > AUTHOR_MAX_UTF8
    {
        return Err(EncError::HeaderStringOverflow);
    }

    // 2. Decode input PNGs.
    decode_128x128_rgba(cover_png, cover_rgba_buf).map_err(|e| match e {
        ImageError::WrongSize { .. } => EncError::CoverSize,
        ImageError::Decode(m)        => EncError::CoverPng(m),
    })?;
    decode_128x128_rgba(spritesheet_png, sprite_rgba_buf).map_err(|e| match e {
        ImageError::WrongSize { .. } => EncError::SpriteSize,
        ImageError::Decode(m)        => EncError::SpritePng(m),
    })?;

    // 3. Frame: override or bundled.
    let frame_src: &[u8] = frame_override.unwrap_or(BUNDLED_FRAME);
    decode_256x256_rgba(frame_src, canvas_buf).map_err(|e| match e {
        ImageError::WrongSize { .. } => EncError::FrameSize,
        ImageError::Decode(m)        => EncError::FramePng(m),
    })?;

    // 4. Composite cover onto the visible canvas (high bits).
    composite_cover(canvas_buf, cover_rgba_buf);

    // 5. Pack the 146-byte header (CRC over the script).
    let header = pack(opts, script);

    // 6. Steganography pass through the canvas low-2-bits.
    let mut cursor = 0usize;
    steg::write_bytes(canvas_buf, &mut cursor, &header);
    debug_assert_eq!(cursor, HEADER_SIZE * 4);

    steg::write_spritesheet(canvas_buf, &mut cursor, sprite_rgba_buf);
    debug_assert_eq!(cursor, HEADER_SIZE * 4 + SCREEN_RGBA_LEN * 2);

    steg::write_bytes(canvas_buf, &mut cursor, script);
    // Trailing NUL — matches C encoder's `script_size + 1`.
    steg::write_bytes(canvas_buf, &mut cursor, &[0u8]);
    debug_assert!(cursor <= CART_RGBA_LEN);

    // 7. PNG-encode the result.
    encode_rgba(canvas_buf, out).map_err(|e| match e {
        PngWriteError::Encode(m) => EncError::PngWrite(m),
    })
}
```

- [ ] **Step 5.4: Run — verify PASS**

```bash
cargo test --target x86_64-unknown-linux-gnu --lib encoder
```

Expected: all encoder tests pass (header + steg + image + png_io + mod, roughly 15 tests).

- [ ] **Step 5.5: Commit**

```bash
git add src/encoder/mod.rs
git commit -m "encoder: orchestrate header + image + steg + png_io into encode()"
```

---

## Task 6: WASM exports — `tb_enc_*` in `src/lib.rs`

**Files:**
- Modify: `src/lib.rs`

This task adds the FFI surface JS will use. No new Rust files; everything lands in `lib.rs` (matching the existing flat pattern).

- [ ] **Step 6.1: Add `EncoderState` and slot constants**

Add to `src/lib.rs` near the top, beneath `mod encoder;`:

```rust
use encoder::header::HeaderOpts;
use encoder::image::{CART_RGBA_LEN, SCREEN_RGBA_LEN};
use encoder::{
    encode as encoder_encode, EncError, AUTHOR_MAX_UTF8, SCRIPT_MAX, TITLE_MAX_UTF8,
};

// Slot indices — kept stable, mirrored on the JS side in encoder.js.
const ENC_SLOT_COVER:  u32 = 0;
const ENC_SLOT_SPRITE: u32 = 1;
const ENC_SLOT_SCRIPT: u32 = 2;
const ENC_SLOT_FRAME:  u32 = 3;
const ENC_SLOT_TITLE:  u32 = 4;
const ENC_SLOT_AUTHOR: u32 = 5;
const ENC_SLOT_COUNT:  u32 = 6;

// Slot capacities. Sized for worst-case PNG payloads of the relevant dimensions
// plus headroom. SCRIPT slot fits the SCRIPT_MAX limit exactly.
const COVER_CAP:  usize = 128 * 1024;
const SPRITE_CAP: usize = 128 * 1024;
const SCRIPT_CAP: usize = SCRIPT_MAX;
const FRAME_CAP:  usize = 512 * 1024; // 256x256 worst-case
const TITLE_CAP:  usize = 64;
const AUTHOR_CAP: usize = 64;
const OUTPUT_CAP: usize = 512 * 1024;

struct EncoderState {
    cover_buf:    Vec<u8>,  // capacity COVER_CAP
    sprite_buf:   Vec<u8>,
    script_buf:   Vec<u8>,
    frame_buf:    Vec<u8>,
    title_buf:    Vec<u8>,
    author_buf:   Vec<u8>,

    cover_len:    usize,
    sprite_len:   usize,
    script_len:   usize,
    frame_len:    usize,
    title_len:    usize,
    author_len:   usize,

    game_version: u16,
    flags:        u16,
    package_date: u32,

    cover_rgba:   Box<[u8; SCREEN_RGBA_LEN]>,
    sprite_rgba:  Box<[u8; SCREEN_RGBA_LEN]>,
    canvas:       Box<[u8; CART_RGBA_LEN]>,

    output:       Vec<u8>,
    error_msg:    Vec<u8>,  // UTF-8 bytes of the last error message
}

impl EncoderState {
    fn new() -> Self {
        Self {
            cover_buf:    vec![0; COVER_CAP],
            sprite_buf:   vec![0; SPRITE_CAP],
            script_buf:   vec![0; SCRIPT_CAP],
            frame_buf:    vec![0; FRAME_CAP],
            title_buf:    vec![0; TITLE_CAP],
            author_buf:   vec![0; AUTHOR_CAP],
            cover_len:    0,
            sprite_len:   0,
            script_len:   0,
            frame_len:    0,
            title_len:    0,
            author_len:   0,
            game_version: 1,
            flags:        0,
            package_date: 0,
            cover_rgba:   Box::new([0; SCREEN_RGBA_LEN]),
            sprite_rgba:  Box::new([0; SCREEN_RGBA_LEN]),
            canvas:       Box::new([0; CART_RGBA_LEN]),
            output:       Vec::with_capacity(OUTPUT_CAP),
            error_msg:    Vec::new(),
        }
    }

    fn slot_ptr_cap_len(&mut self, slot: u32) -> Option<(*mut u8, usize, &mut usize)> {
        match slot {
            ENC_SLOT_COVER  => Some((self.cover_buf.as_mut_ptr(),  self.cover_buf.len(),  &mut self.cover_len)),
            ENC_SLOT_SPRITE => Some((self.sprite_buf.as_mut_ptr(), self.sprite_buf.len(), &mut self.sprite_len)),
            ENC_SLOT_SCRIPT => Some((self.script_buf.as_mut_ptr(), self.script_buf.len(), &mut self.script_len)),
            ENC_SLOT_FRAME  => Some((self.frame_buf.as_mut_ptr(),  self.frame_buf.len(),  &mut self.frame_len)),
            ENC_SLOT_TITLE  => Some((self.title_buf.as_mut_ptr(),  self.title_buf.len(),  &mut self.title_len)),
            ENC_SLOT_AUTHOR => Some((self.author_buf.as_mut_ptr(), self.author_buf.len(), &mut self.author_len)),
            _ => None,
        }
    }
}

thread_local! {
    static ENC_STATE: RefCell<Option<EncoderState>> = const { RefCell::new(None) };
}
```

- [ ] **Step 6.2: Add the `tb_enc_*` exports**

Append to `src/lib.rs`:

```rust
#[no_mangle]
pub extern "C" fn tb_enc_init() -> u32 {
    ENC_STATE.with(|cell| {
        if cell.borrow().is_some() {
            return 1;
        }
        *cell.borrow_mut() = Some(EncoderState::new());
        1
    })
}

#[no_mangle]
pub extern "C" fn tb_enc_input_ptr(slot: u32) -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if let Some((p, _, _)) = state.slot_ptr_cap_len(slot) {
                ptr = p;
            }
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_enc_input_cap(slot: u32) -> u32 {
    let mut cap: u32 = 0;
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if let Some((_, c, _)) = state.slot_ptr_cap_len(slot) {
                cap = c as u32;
            }
        }
    });
    cap
}

#[no_mangle]
pub extern "C" fn tb_enc_set_input_len(slot: u32, len: u32) -> u32 {
    let mut ok: u32 = 0;
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if let Some((_, cap, slot_len)) = state.slot_ptr_cap_len(slot) {
                if (len as usize) <= cap {
                    *slot_len = len as usize;
                    ok = 1;
                }
            }
        }
    });
    ok
}

#[no_mangle]
pub extern "C" fn tb_enc_set_header(game_version: u32, flags: u32, package_date: u32) -> u32 {
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            state.game_version = (game_version & 0xFFFF) as u16;
            state.flags        = (flags & 0xFFFF) as u16;
            state.package_date = package_date;
            1
        } else {
            0
        }
    })
}

fn store_error(state: &mut EncoderState, err: &EncError) {
    state.error_msg = err.message().into_bytes();
}

#[no_mangle]
pub extern "C" fn tb_enc_run() -> i32 {
    let mut result: i32 = -6; // default = generic failure if state missing
    ENC_STATE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let Some(state) = borrow.as_mut() else {
            return;
        };

        // Pull slot views.
        let cover  = &state.cover_buf [..state.cover_len];
        let sprite = &state.sprite_buf[..state.sprite_len];
        let script = &state.script_buf[..state.script_len];
        let frame_slice = &state.frame_buf[..state.frame_len];
        let frame: Option<&[u8]> = if state.frame_len > 0 { Some(frame_slice) } else { None };

        let title_bytes  = &state.title_buf [..state.title_len];
        let author_bytes = &state.author_buf[..state.author_len];

        // UTF-8 validation. Returning HeaderStringOverflow for non-UTF-8 too is fine —
        // tooltip on the form requires plain text, and this is the closest existing variant.
        let title  = match core::str::from_utf8(title_bytes)  { Ok(s) => s, Err(_) => { store_error(state, &EncError::HeaderStringOverflow); result = -5; return; } };
        let author = match core::str::from_utf8(author_bytes) { Ok(s) => s, Err(_) => { store_error(state, &EncError::HeaderStringOverflow); result = -5; return; } };
        if title.as_bytes().len() > TITLE_MAX_UTF8 || author.as_bytes().len() > AUTHOR_MAX_UTF8 {
            store_error(state, &EncError::HeaderStringOverflow);
            result = -5;
            return;
        }

        let opts = HeaderOpts {
            title, author,
            format_version: 1,
            flags:          state.flags,
            game_version:   state.game_version,
            package_date:   state.package_date,
        };

        // Split the borrows: copy slot data into owned Vec/slices before calling encode().
        // Because the slot buffers and the rgba/canvas buffers live in the same struct,
        // we must shadow them.
        let cover_owned: Vec<u8>  = cover.to_vec();
        let sprite_owned: Vec<u8> = sprite.to_vec();
        let script_owned: Vec<u8> = script.to_vec();
        let frame_owned: Option<Vec<u8>> = frame.map(|f| f.to_vec());

        let cover_rgba_mut:  &mut [u8; SCREEN_RGBA_LEN] = state.cover_rgba.as_mut();
        let sprite_rgba_mut: &mut [u8; SCREEN_RGBA_LEN] = state.sprite_rgba.as_mut();
        let canvas_mut:      &mut [u8; CART_RGBA_LEN]   = state.canvas.as_mut();

        let r = encoder_encode(
            &cover_owned,
            &sprite_owned,
            &script_owned,
            frame_owned.as_deref(),
            &opts,
            cover_rgba_mut,
            sprite_rgba_mut,
            canvas_mut,
            &mut state.output,
        );

        match r {
            Ok(()) => {
                state.error_msg.clear();
                result = state.output.len() as i32;
            }
            Err(e) => {
                store_error(state, &e);
                result = e.code();
            }
        }
    });
    result
}

#[no_mangle]
pub extern "C" fn tb_enc_output_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.output.as_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_enc_error_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.error_msg.as_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_enc_error_len() -> u32 {
    let mut len: u32 = 0;
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            len = state.error_msg.len() as u32;
        }
    });
    len
}
```

- [ ] **Step 6.3: Build for wasm**

```bash
./scripts/build.sh
ls -la web/tinybit_wasm.wasm
```

Expected: build succeeds; wasm size grows by ~30–60 KB. If the build fails with "unresolved import" or "trait `TryFrom` not in scope", you may need a `use core::convert::TryFrom;` or to add `Box::<[u8; N]>` initialisation differently — investigate before continuing.

- [ ] **Step 6.4: Run existing smoke test (still passes — no behavior change for player)**

```bash
node scripts/smoke.mjs
```

Expected: existing test still passes — player path is unchanged.

- [ ] **Step 6.5: Run all host-side unit tests**

```bash
cargo test --target x86_64-unknown-linux-gnu
```

Expected: all encoder tests pass.

- [ ] **Step 6.6: Commit**

```bash
git add src/lib.rs
git commit -m "encoder: wasm FFI exports (tb_enc_*) with staging slots"
```

---

## Task 7: Web integration — runtime extraction, encoder.js, UI

**Files:**
- Create: `web/wasm-runtime.js`
- Create: `web/encoder.js`
- Modify: `web/index.html`
- Modify: `web/index.js`

- [ ] **Step 7.1: Extract the wasm boot path into `web/wasm-runtime.js`**

The current `web/index.js` does its WASI shim setup and `WebAssembly.instantiateStreaming` at the top level. We move those into a module that both `index.js` and `encoder.js` can import.

Create `web/wasm-runtime.js`:

```js
import { makeWasiShim } from './wasi-shim.js';

const memoryRef = { value: null };
const wasi = makeWasiShim(memoryRef);

const wasmInstance = await WebAssembly.instantiateStreaming(
  fetch('./tinybit_wasm.wasm'),
  { wasi_snapshot_preview1: wasi },
);

export const tb = wasmInstance.instance.exports;
memoryRef.value = tb.memory;

export function wasmMemory() {
  return tb.memory;
}

// Re-export memoryRef for any consumer that needs to read after potential growth.
export { memoryRef };
```

- [ ] **Step 7.2: Refactor `web/index.js` to consume `wasm-runtime.js`**

In `web/index.js`:
1. Delete the top-of-file imports / instantiation block (lines that import `makeWasiShim`, declare `memoryRef`, instantiate the wasm, and pull `tb`).
2. Insert at the top of the file:

```js
import { tb, memoryRef } from './wasm-runtime.js';
```

3. Leave everything else (`pumpAudio`, `blitDisplay`, `loadCartridge`, event listeners) untouched — they already reference `tb` and `memoryRef`.

Verify nothing else in the file declares `tb`, `memoryRef`, or `wasi`/`wasm` symbols that conflict.

- [ ] **Step 7.3: Smoke test the refactor in the browser**

```bash
cd web && python3 -m http.server 8000
```

Open `http://localhost:8000/`, upload `../TinyBit/games/flappy.tb.png`, confirm the game still plays. Then stop the server. (No automated test for this step — manual sanity check that the runtime extraction didn't break the player.)

- [ ] **Step 7.4: Add the encoder panel HTML**

Replace `web/index.html` with:

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

    /* encoder panel */
    #encoder-panel { width: 512px; background: #1a1a1a; padding: 8px 12px; border-radius: 4px; }
    #encoder-panel summary { cursor: pointer; user-select: none; }
    #encoder-form fieldset { border: 1px solid #333; margin: 8px 0; padding: 8px 12px; }
    #encoder-form legend { color: #999; padding: 0 6px; }
    #encoder-form label { display: grid; grid-template-columns: 180px 1fr; align-items: center; gap: 8px; margin: 4px 0; }
    #encoder-form input[type=text], #encoder-form input[type=number] { background: #222; color: #ccc; border: 1px solid #333; padding: 2px 4px; }
    #enc-script-usage { font-family: monospace; margin: 4px 0 0 188px; color: #888; }
    #enc-script-usage.over-limit { color: #f66; }
    .enc-actions { display: flex; gap: 8px; margin-top: 8px; }
    .enc-actions button { background: #2a2a2a; color: #ccc; border: 1px solid #444; padding: 4px 12px; cursor: pointer; }
    .enc-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    #enc-status { min-height: 1.2em; color: #ccc; font-family: monospace; margin-top: 4px; }
    #enc-status.error { color: #f66; }
  </style>
</head>
<body>
  <div id="stage">
    <input type="file" id="cart" accept=".png,.tb.png">
    <canvas id="screen" width="128" height="128"></canvas>
    <div id="err"></div>

    <details id="encoder-panel">
      <summary>Create a cartridge</summary>
      <form id="encoder-form">
        <fieldset>
          <legend>Assets</legend>
          <label>Cover (128x128 PNG)        <input type="file" id="enc-cover"  accept="image/png" required></label>
          <label>Spritesheet (128x128 PNG)  <input type="file" id="enc-sprite" accept="image/png" required></label>
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
  </div>
  <script type="module" src="./index.js"></script>
</body>
</html>
```

- [ ] **Step 7.5: Create `web/encoder.js`**

```js
import { tb, memoryRef } from './wasm-runtime.js';

const SLOT = { COVER: 0, SPRITE: 1, SCRIPT: 2, FRAME: 3, TITLE: 4, AUTHOR: 5 };
export const SCRIPT_MAX = 32621;

let initDone = false;
function ensureInit() {
  if (initDone) return;
  if (tb.tb_enc_init() === 0) throw new Error('tb_enc_init returned 0');
  initDone = true;
}

async function stageFile(slot, inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) throw new Error(`${inputEl.id}: no file selected`);
  await stageBytes(slot, new Uint8Array(await file.arrayBuffer()), inputEl.id);
}

function stageBytes(slot, bytes, label) {
  const cap = tb.tb_enc_input_cap(slot);
  if (bytes.length > cap) {
    throw new Error(`${label}: ${bytes.length} bytes exceeds slot capacity ${cap}`);
  }
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    throw new Error(`${label}: tb_enc_set_input_len rejected length ${bytes.length}`);
  }
}

function stageString(slot, str, label) {
  const bytes = new TextEncoder().encode(str);
  stageBytes(slot, bytes, label);
}

function readErrorMessage() {
  const len = tb.tb_enc_error_len();
  if (len === 0) return 'unknown encoder error';
  const ptr = tb.tb_enc_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}

export async function encodeFromForm(els) {
  ensureInit();

  await stageFile(SLOT.COVER,  els.cover);
  await stageFile(SLOT.SPRITE, els.sprite);
  await stageFile(SLOT.SCRIPT, els.script);
  if (els.frame.files && els.frame.files[0]) {
    await stageFile(SLOT.FRAME, els.frame);
  } else {
    tb.tb_enc_set_input_len(SLOT.FRAME, 0);
  }

  stageString(SLOT.TITLE,  els.title.value  || 'untitled', 'title');
  stageString(SLOT.AUTHOR, els.author.value || '',         'author');

  const gameVersion = parseInt(els.gameVersion.value, 10);
  const flagsStr = (els.flags.value || '0x0000').replace(/^0x/i, '');
  const flags = parseInt(flagsStr, 16);
  if (Number.isNaN(gameVersion) || gameVersion < 0 || gameVersion > 65535) {
    throw new Error('game version must be an integer 0..65535');
  }
  if (Number.isNaN(flags) || flags < 0 || flags > 0xFFFF) {
    throw new Error('flags must be a 16-bit hex value (e.g. 0x0000)');
  }

  tb.tb_enc_set_header(gameVersion, flags, Math.floor(Date.now() / 1000));

  const n = tb.tb_enc_run();
  if (n < 0) throw new Error(readErrorMessage());

  const ptr = tb.tb_enc_output_ptr();
  return new Uint8Array(memoryRef.value.buffer, ptr, n).slice();
}

export function sanitizeFilename(title) {
  const cleaned = (title || '').replace(/[^A-Za-z0-9._-]/g, '_');
  return (cleaned || 'cartridge') + '.tb.png';
}
```

- [ ] **Step 7.6: Wire encoder buttons + script-usage indicator in `web/index.js`**

Append to `web/index.js`:

```js
import { encodeFromForm, sanitizeFilename, SCRIPT_MAX } from './encoder.js';

const els = {
  cover:       document.getElementById('enc-cover'),
  sprite:      document.getElementById('enc-sprite'),
  script:      document.getElementById('enc-script'),
  frame:       document.getElementById('enc-frame'),
  title:       document.getElementById('enc-title'),
  author:      document.getElementById('enc-author'),
  gameVersion: document.getElementById('enc-game-version'),
  flags:       document.getElementById('enc-flags'),
  downloadBtn: document.getElementById('enc-download'),
  playBtn:     document.getElementById('enc-play'),
  status:      document.getElementById('enc-status'),
  usage:       document.getElementById('enc-script-usage'),
};

function setStatus(msg, isError) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', !!isError);
}

function updateScriptUsage() {
  const f = els.script.files && els.script.files[0];
  if (!f) { els.usage.hidden = true; return; }
  const pct = Math.floor(f.size / SCRIPT_MAX * 100);
  els.usage.hidden = false;
  els.usage.textContent = `${f.size.toLocaleString()} / ${SCRIPT_MAX.toLocaleString()} bytes (${pct} %)`;
  const over = f.size > SCRIPT_MAX;
  els.usage.classList.toggle('over-limit', over);
  els.downloadBtn.disabled = over;
  els.playBtn.disabled     = over;
}
els.script.addEventListener('change', updateScriptUsage);

async function runEncodeAnd(action) {
  setStatus('Encoding…', false);
  try {
    const bytes = await encodeFromForm(els);
    await action(bytes);
  } catch (err) {
    setStatus(err.message, true);
  }
}

els.downloadBtn.addEventListener('click', () => runEncodeAnd((bytes) => {
  const blob = new Blob([bytes], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(els.title.value);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus(`Encoded ${bytes.length.toLocaleString()} bytes → ${a.download}`, false);
}));

els.playBtn.addEventListener('click', () => runEncodeAnd(async (bytes) => {
  setStatus(`Encoded ${bytes.length.toLocaleString()} bytes — starting…`, false);
  // Reuse the existing upload-style flow: feed the bytes through tb_feed_cartridge.
  await loadCartridgeBytes(bytes);
  setStatus('Playing the encoded cartridge.', false);
}));
```

- [ ] **Step 7.7: Add `loadCartridgeBytes` helper so Play-now reuses the existing pipeline**

Inside `web/index.js`, locate the existing `loadCartridge(file)` function. Extract its body (after the `arrayBuffer()` call) into a sibling function so both code paths share the same logic. Replace the existing function with:

```js
async function loadCartridgeBytes(buf) {
  clearError();
  stopGame();

  try {
    await ensureAudio();
  } catch (err) {
    console.warn('audio init failed; running silent:', err);
  }

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

async function loadCartridge(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  await loadCartridgeBytes(buf);
}
```

Confirm the existing `#cart` `change` listener still calls `loadCartridge(file)` — that path remains identical.

- [ ] **Step 7.8: Manual browser sanity check**

```bash
cd web && python3 -m http.server 8000
```

Open `http://localhost:8000/`. Confirm:
1. Existing upload picker still plays `flappy.tb.png`.
2. Expanding "Create a cartridge" reveals the form with all fields and both buttons.
3. Selecting a script file updates `#enc-script-usage` with a "N / 32 621 bytes (X %)" line.

Stop the server. (Encoding itself isn't tested here — that's the job of Task 8.)

- [ ] **Step 7.9: Commit**

```bash
git add web/wasm-runtime.js web/encoder.js web/index.html web/index.js
git commit -m "web: encoder panel + JS module + wasm-runtime extraction"
```

---

## Task 8: Smoke test — encode→decode round-trip + negative case

**Files:**
- Create: `scripts/fixtures/smoke_cover.png`
- Create: `scripts/fixtures/smoke_sprite.png`
- Create: `scripts/fixtures/smoke_script.lua`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 8.1: Generate the fixture images**

The existing test runs in Node; we'll use Node + the `png` crate's wire compatibility by writing a tiny one-shot generator. Add a helper script and run it once:

Create `scripts/gen_smoke_fixtures.mjs`:

```js
#!/usr/bin/env node
// One-shot: writes 128x128 RGBA fixtures used by smoke.mjs.
// Re-run only if the fixtures are missing or you want to regenerate them.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const fixDir = resolve(here, 'fixtures');
if (!existsSync(fixDir)) mkdirSync(fixDir, { recursive: true });

// Minimal RGBA PNG writer (no filtering — type 0 = None per row).
function writePng(path, w, h, makePixel) {
  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter type
    for (let x = 0; x < w; x++) {
      const { r, g, b, a } = makePixel(x, y);
      const i = y * (1 + w * 4) + 1 + x * 4;
      raw[i]     = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  // CRC-32 (IEEE 802.3), Buffer-based.
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
      }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8]  = 8;       // bit depth
  ihdr[9]  = 6;       // RGBA
  ihdr[10] = 0;       // compression
  ihdr[11] = 0;       // filter
  ihdr[12] = 0;       // interlace

  const idat = zlib.deflateSync(raw);

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

writePng(resolve(fixDir, 'smoke_cover.png'), 128, 128, (x, y) => {
  const c = ((x >> 3) ^ (y >> 3)) & 1 ? 0xFF : 0x33;
  return { r: c, g: c, b: c, a: 0xFF };
});

writePng(resolve(fixDir, 'smoke_sprite.png'), 128, 128, (x, y) => {
  return { r: x * 2, g: y * 2, b: ((x + y) & 0xFF), a: 0xFF };
});

// Tiny 64x64 PNG for the negative case.
writePng(resolve(fixDir, 'smoke_cover_64.png'), 64, 64, () => ({ r: 0, g: 0, b: 0, a: 0xFF }));

console.log('fixtures generated');
```

Run it:

```bash
chmod +x scripts/gen_smoke_fixtures.mjs
node scripts/gen_smoke_fixtures.mjs
file scripts/fixtures/smoke_cover.png  # must say: PNG image data, 128 x 128, ...
```

- [ ] **Step 8.2: Create `scripts/fixtures/smoke_script.lua`**

```lua
function _draw()
  pset(10, 10, 0xFFFF)
end
```

Verify with `wc -c scripts/fixtures/smoke_script.lua` — should be ~36 bytes.

- [ ] **Step 8.3: Extend `scripts/smoke.mjs`**

Append (do not replace) to `scripts/smoke.mjs` — keep everything that comes before the trailing `tb.tb_stop();` line. Right after the existing `tb.tb_stop();` line, add:

```js
// ---- Encoder round-trip ---------------------------------------------------

console.log('--- encoder round-trip ---');

const fixDir = resolve(__dirname, 'fixtures');
const coverBytes  = readFileSync(resolve(fixDir, 'smoke_cover.png'));
const spriteBytes = readFileSync(resolve(fixDir, 'smoke_sprite.png'));
const scriptBytes = readFileSync(resolve(fixDir, 'smoke_script.lua'));
const titleBytes  = new TextEncoder().encode('smoke');
const authorBytes = new TextEncoder().encode('ci');

if (tb.tb_enc_init() === 0) {
  console.error('tb_enc_init returned 0');
  process.exit(1);
}

function stage(slot, bytes, label) {
  const cap = tb.tb_enc_input_cap(slot);
  if (bytes.length > cap) {
    console.error(`${label}: ${bytes.length} > cap ${cap}`);
    process.exit(1);
  }
  const ptr = tb.tb_enc_input_ptr(slot);
  new Uint8Array(memoryRef.value.buffer, ptr, bytes.length).set(bytes);
  if (tb.tb_enc_set_input_len(slot, bytes.length) === 0) {
    console.error(`${label}: tb_enc_set_input_len failed`);
    process.exit(1);
  }
}

function decodeError() {
  const len = tb.tb_enc_error_len();
  if (len === 0) return '<empty>';
  const ptr = tb.tb_enc_error_ptr();
  return new TextDecoder().decode(new Uint8Array(memoryRef.value.buffer, ptr, len));
}

stage(0, coverBytes,  'cover');
stage(1, spriteBytes, 'sprite');
stage(2, scriptBytes, 'script');
tb.tb_enc_set_input_len(3, 0); // no frame override
stage(4, titleBytes,  'title');
stage(5, authorBytes, 'author');
tb.tb_enc_set_header(1, 0, Math.floor(Date.now() / 1000));

const n = tb.tb_enc_run();
if (n < 0) {
  console.error(`tb_enc_run failed: ${n} — ${decodeError()}`);
  process.exit(1);
}
console.log(`encoded ${n} PNG bytes`);

const outPtr = tb.tb_enc_output_ptr();
const encoded = new Uint8Array(memoryRef.value.buffer, outPtr, n).slice();

// Round-trip: feed encoded bytes through the decoder, run, assert pixel.
tb.tb_init();
const feedPtr2 = tb.tb_feed_buffer_ptr();
for (let i = 0; i < encoded.length; i += 256) {
  const chunk = encoded.subarray(i, Math.min(i + 256, encoded.length));
  const view = new Uint8Array(memoryRef.value.buffer, feedPtr2, chunk.length);
  view.set(chunk);
  if (tb.tb_feed_cartridge(chunk.length) === 0) {
    console.error(`round-trip feed failed at offset ${i}`);
    process.exit(1);
  }
}
if (tb.tb_start() === 0) {
  console.error('round-trip tb_start returned 0');
  process.exit(1);
}
for (let f = 0; f < 60; f++) tb.tb_loop_once();

const displayPtr2 = tb.tb_display_ptr();
const display2 = new Uint16Array(memoryRef.value.buffer, displayPtr2, 128 * 128);
const target = display2[10 * 128 + 10];
if (target !== 0xFFFF) {
  console.error(`round-trip pixel mismatch at (10,10): got 0x${target.toString(16)}, want 0xFFFF`);
  process.exit(1);
}
console.log('encoder round-trip OK: pixel (10,10) = 0xFFFF after 60 frames');
tb.tb_stop();

// ---- Encoder negative case ------------------------------------------------

console.log('--- encoder negative case ---');
const smallCover = readFileSync(resolve(fixDir, 'smoke_cover_64.png'));
stage(0, smallCover, 'cover_64');
// keep slots 1..5 from the previous successful run
const neg = tb.tb_enc_run();
if (neg !== -1) {
  console.error(`expected -1 from wrong-size cover, got ${neg}`);
  process.exit(1);
}
const msg = decodeError();
if (!msg.includes('128')) {
  console.error(`error message did not mention 128: '${msg}'`);
  process.exit(1);
}
console.log(`encoder negative case OK: ${neg} (${msg})`);
```

- [ ] **Step 8.4: Build + run the full smoke test**

```bash
./scripts/build.sh
node scripts/smoke.mjs
```

Expected, in order:
```
[TinyBit] Cartridge header: ...
smoke test passed: …/16384 display pixels non-zero
--- encoder round-trip ---
encoded N PNG bytes
[TinyBit] Cartridge header: ...    (the round-trip cartridge logs its own header)
encoder round-trip OK: pixel (10,10) = 0xFFFF after 60 frames
--- encoder negative case ---
encoder negative case OK: -1 (Cover must be 128x128)
```

- [ ] **Step 8.5: Run all host-side unit tests one final time**

```bash
cargo test --target x86_64-unknown-linux-gnu
```

Expected: all tests still pass.

- [ ] **Step 8.6: Commit**

```bash
git add scripts/gen_smoke_fixtures.mjs scripts/fixtures scripts/smoke.mjs
git commit -m "test: smoke encoder round-trip + size-mismatch negative case"
```

---

## Task 9: README — document the encoder

**Files:**
- Modify: `README.md`

- [ ] **Step 9.1: Update the "Play in a browser" section**

In `README.md`, after the existing paragraph that begins "Pick a `.tb.png` file…", insert:

```markdown
### Create a cartridge

Open the **"Create a cartridge"** panel below the upload picker. Pick a 128x128 cover PNG, a 128x128 spritesheet PNG, a Lua script, and optional header metadata. Hit **Download .tb.png** to save the cartridge, or **Play now** to feed the encoded bytes directly into the engine without leaving the page. The encoder is built into the same `tinybit_wasm.wasm` — no separate tooling required.
```

- [ ] **Step 9.2: Update the "Limitations" section**

Remove the line:

```
- No cartridge export. Use the desktop wrapper's `-c` mode to author cartridges.
```

Add (in its place):

```
- The browser encoder caps scripts at 32 621 bytes — one less than the desktop encoder's 32 622, to keep the cartridge payload within 65 536 pixels including the trailing NUL.
```

- [ ] **Step 9.3: Commit**

```bash
git add README.md
git commit -m "docs: README — browser cartridge encoder usage and limits"
```

---

## Task 10: Final verification + branch handoff

- [ ] **Step 10.1: Run the full test matrix**

```bash
cargo test --target x86_64-unknown-linux-gnu
./scripts/build.sh
node scripts/smoke.mjs
```

Expected: all tests pass (Rust + Node smoke + Node encoder round-trip + negative).

- [ ] **Step 10.2: Manual browser end-to-end**

```bash
cd web && python3 -m http.server 8000
```

Open `http://localhost:8000/`:
1. Upload `../TinyBit/games/flappy.tb.png` and confirm it plays.
2. Stop the game (refresh the page).
3. Expand "Create a cartridge". Use the smoke fixtures: select `scripts/fixtures/smoke_cover.png` as cover, `scripts/fixtures/smoke_sprite.png` as spritesheet, `scripts/fixtures/smoke_script.lua` as script. Enter a title.
4. Click **Download .tb.png** — confirm a file downloads with the sanitized title in its name.
5. Click **Play now** — the canvas should change (pixel at (10,10) becomes white).
6. Try selecting a non-128×128 cover and clicking Download — `#enc-status` should show "Cover must be 128x128".

Stop the server.

- [ ] **Step 10.3: Verify the branch is ready**

```bash
git status                 # clean
git log --oneline main..   # expect ~9 commits, one per task
```

The branch `feat/tb-encoder` in `.worktrees/tb-encoder` is complete. Hand off to the finishing-a-development-branch skill (or simply report ready for merge — see project conventions).

---

## Self-review notes

- **Spec coverage:** Tasks 1–5 cover the Rust pipeline (header / steg / image / png_io / orchestration); Task 6 covers the FFI; Task 7 covers the JS/HTML; Task 8 covers the round-trip smoke test; Task 9 covers docs; Task 10 covers final verification. All spec sections (Cartridge format reference, FFI surface, Data flow, Rust encoder pipeline, Web UI, Error handling, Build & test plumbing, Documentation) map to at least one task.

- **Decisions and divergences noted:** `png = "0.17"` (not `default-features = false`); buffers passed by `&mut` reference rather than returned; `thread_local!` + `RefCell` instead of `static mut`. These three are called out in the plan header so the implementer doesn't second-guess them.

- **TDD discipline:** Tasks 1–5 each have an explicit "write the failing test → run → verify FAIL → implement → run → verify PASS" cycle. Task 6 deviates because the wasm-export wiring is hard to unit-test cleanly at this layer — its real test is the smoke round-trip in Task 8.

- **Type consistency:** `HeaderOpts` field names, slot constants (`ENC_SLOT_*`), and FFI export names are introduced in Task 1 / Task 6 and reused unchanged in Tasks 7 and 8.

- **No placeholders found.**
