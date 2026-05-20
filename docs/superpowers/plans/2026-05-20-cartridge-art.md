# Cartridge Art Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the exported cartridge's frame artwork with a procedurally-drawn green cartridge that prints the title and author onto the PNG, and shift the cover image to (64, 64).

**Architecture:** Drop the bundled `cartridge3.png` frame. Draw the frame procedurally in Rust from solid axis-aligned rects (plus a 10-pixel rounded-corner mask) directly into the encoder's canvas buffer. Embed a hand-designed 6×8 bitmap font as a Rust const, plus a small font-blitting module. Add a layout helper that scales/truncates title and author to fit fixed regions. Wire all of this between the existing cover composite and the existing steganography passes — steg still writes the low 2 bits of every channel, so the visible art and text are not affected.

**Tech Stack:** Rust (wasm32-wasip1 + host for `cargo test`), `png` crate for the PNG output (already a dep), no new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-20-cartridge-art-design.md`](../specs/2026-05-20-cartridge-art-design.md)

---

## File structure

**New:**
- `src/encoder/font_data.rs` — `pub const FONT_BITMAP: [[u8; 8]; 95]` (95 ASCII glyphs at 6×8, row-major, low 6 bits per row, MSB=leftmost pixel). Hand-designed.
- `src/encoder/font.rs` — `measure()`, `draw()`, plus `pub const GLYPH_W = 6`, `GLYPH_H = 8`.
- `src/encoder/layout.rs` — `fit_title()`, `fit_author()`, plus layout constants (`TITLE_PLATE_MAX_W = 168`, `AUTHOR_LINE_MAX_W = 200`, `TITLE_Y = 31`, `AUTHOR_Y = 206`, `TITLE_COLOR`, `AUTHOR_COLOR`).
- `src/encoder/frame.rs` — `draw_default_frame(canvas)` and primitives `fill_rect`, `stroke_rect`, plus a hardcoded 10×10 corner mask.

**Modified:**
- `src/encoder/mod.rs` — declare new modules; call frame + font drawing in `encode()`.
- `src/encoder/image.rs` — `COVER_Y: 60 → 64`. Remove `BUNDLED_FRAME` const and its tests.
- `src/tinybit/tinybit.h` — `TB_COVER_Y: 60 → 64`. (Submodule edit.)

**Deleted:**
- `assets/cartridge3.png` — replaced by procedural frame drawing.

---

## Task 1: Initialize submodule in worktree

The worktree was created without checking out submodules, so `src/tinybit/` is empty. We need the C engine source available for the engine update later and for the wasm build.

**Files:**
- N/A (git operation)

- [ ] **Step 1: Init the submodule**

Run from the worktree root:

```sh
git submodule update --init --recursive src/tinybit
```

Expected: the command completes and `ls src/tinybit/` shows files (`tinybit.h`, `cartridge.c`, etc.).

- [ ] **Step 2: Verify the constant is at the expected starting value**

Run:

```sh
grep -n "TB_COVER_Y" src/tinybit/tinybit.h
```

Expected output:

```
22:#define TB_COVER_Y 60
```

(Line 22 is the expected location given the current submodule pointer.)

- [ ] **Step 3: Commit (nothing to commit yet — just verify the worktree is clean before starting real work)**

Run:

```sh
git status
```

Expected: the only changes are `M editor/...` etc. that pre-existed at worktree creation. No new files. Do not commit anything yet.

---

## Task 2: Create the font data file

This is a hand-designed 6-wide × 8-tall bitmap font covering ASCII 0x20..0x7E (95 glyphs). Each glyph is 8 bytes (one per row); each byte uses its low 6 bits, with bit 5 = leftmost pixel. Glyph index = `(c as u8) - 0x20`. Unprintable/out-of-range chars are handled by the caller (substituted with `?`).

**Files:**
- Create: `src/encoder/font_data.rs`

- [ ] **Step 1: Write the file**

Create `src/encoder/font_data.rs` with the following exact content:

```rust
//! 6×8 ASCII bitmap font, hand-designed. ASCII 0x20..=0x7E inclusive.
//! Each glyph is 8 bytes (rows). The low 6 bits of each byte are the row's
//! pixels with bit 5 = leftmost. Glyph index = (c as u8) - 0x20.

pub const GLYPH_W: usize = 6;
pub const GLYPH_H: usize = 8;
pub const FIRST_CHAR: u8 = 0x20;
pub const LAST_CHAR: u8 = 0x7E;
pub const GLYPH_COUNT: usize = (LAST_CHAR - FIRST_CHAR + 1) as usize;

pub const FONT_BITMAP: [[u8; GLYPH_H]; GLYPH_COUNT] = [
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], // 0x20 ' '
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x08, 0x00], // 0x21 '!'
    [0x14, 0x14, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00], // 0x22 '"'
    [0x14, 0x14, 0x3E, 0x14, 0x3E, 0x14, 0x14, 0x00], // 0x23 '#'
    [0x08, 0x1E, 0x28, 0x1C, 0x0A, 0x3C, 0x08, 0x00], // 0x24 '$'
    [0x32, 0x32, 0x04, 0x08, 0x10, 0x26, 0x26, 0x00], // 0x25 '%'
    [0x18, 0x24, 0x24, 0x18, 0x2A, 0x24, 0x1A, 0x00], // 0x26 '&'
    [0x08, 0x08, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00], // 0x27 '''
    [0x04, 0x08, 0x10, 0x10, 0x10, 0x08, 0x04, 0x00], // 0x28 '('
    [0x10, 0x08, 0x04, 0x04, 0x04, 0x08, 0x10, 0x00], // 0x29 ')'
    [0x00, 0x14, 0x08, 0x3E, 0x08, 0x14, 0x00, 0x00], // 0x2A '*'
    [0x00, 0x08, 0x08, 0x3E, 0x08, 0x08, 0x00, 0x00], // 0x2B '+'
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x08, 0x10], // 0x2C ','
    [0x00, 0x00, 0x00, 0x3E, 0x00, 0x00, 0x00, 0x00], // 0x2D '-'
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00], // 0x2E '.'
    [0x02, 0x02, 0x04, 0x08, 0x10, 0x20, 0x20, 0x00], // 0x2F '/'
    [0x1C, 0x22, 0x26, 0x2A, 0x32, 0x22, 0x1C, 0x00], // 0x30 '0'
    [0x08, 0x18, 0x08, 0x08, 0x08, 0x08, 0x1C, 0x00], // 0x31 '1'
    [0x1C, 0x22, 0x02, 0x04, 0x08, 0x10, 0x3E, 0x00], // 0x32 '2'
    [0x3E, 0x04, 0x08, 0x04, 0x02, 0x22, 0x1C, 0x00], // 0x33 '3'
    [0x04, 0x0C, 0x14, 0x24, 0x3E, 0x04, 0x04, 0x00], // 0x34 '4'
    [0x3E, 0x20, 0x3C, 0x02, 0x02, 0x22, 0x1C, 0x00], // 0x35 '5'
    [0x0C, 0x10, 0x20, 0x3C, 0x22, 0x22, 0x1C, 0x00], // 0x36 '6'
    [0x3E, 0x02, 0x04, 0x08, 0x10, 0x10, 0x10, 0x00], // 0x37 '7'
    [0x1C, 0x22, 0x22, 0x1C, 0x22, 0x22, 0x1C, 0x00], // 0x38 '8'
    [0x1C, 0x22, 0x22, 0x1E, 0x02, 0x04, 0x18, 0x00], // 0x39 '9'
    [0x00, 0x00, 0x08, 0x00, 0x08, 0x00, 0x00, 0x00], // 0x3A ':'
    [0x00, 0x00, 0x08, 0x00, 0x08, 0x08, 0x10, 0x00], // 0x3B ';'
    [0x04, 0x08, 0x10, 0x20, 0x10, 0x08, 0x04, 0x00], // 0x3C '<'
    [0x00, 0x00, 0x3E, 0x00, 0x3E, 0x00, 0x00, 0x00], // 0x3D '='
    [0x10, 0x08, 0x04, 0x02, 0x04, 0x08, 0x10, 0x00], // 0x3E '>'
    [0x1C, 0x22, 0x02, 0x04, 0x08, 0x00, 0x08, 0x00], // 0x3F '?'
    [0x1C, 0x22, 0x2E, 0x2A, 0x2E, 0x20, 0x1C, 0x00], // 0x40 '@'
    [0x1C, 0x22, 0x22, 0x3E, 0x22, 0x22, 0x22, 0x00], // 0x41 'A'
    [0x3C, 0x22, 0x22, 0x3C, 0x22, 0x22, 0x3C, 0x00], // 0x42 'B'
    [0x1C, 0x22, 0x20, 0x20, 0x20, 0x22, 0x1C, 0x00], // 0x43 'C'
    [0x3C, 0x22, 0x22, 0x22, 0x22, 0x22, 0x3C, 0x00], // 0x44 'D'
    [0x3E, 0x20, 0x20, 0x3C, 0x20, 0x20, 0x3E, 0x00], // 0x45 'E'
    [0x3E, 0x20, 0x20, 0x3C, 0x20, 0x20, 0x20, 0x00], // 0x46 'F'
    [0x1C, 0x22, 0x20, 0x2E, 0x22, 0x22, 0x1C, 0x00], // 0x47 'G'
    [0x22, 0x22, 0x22, 0x3E, 0x22, 0x22, 0x22, 0x00], // 0x48 'H'
    [0x1C, 0x08, 0x08, 0x08, 0x08, 0x08, 0x1C, 0x00], // 0x49 'I'
    [0x0E, 0x04, 0x04, 0x04, 0x04, 0x24, 0x18, 0x00], // 0x4A 'J'
    [0x22, 0x24, 0x28, 0x30, 0x28, 0x24, 0x22, 0x00], // 0x4B 'K'
    [0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x3E, 0x00], // 0x4C 'L'
    [0x22, 0x36, 0x2A, 0x2A, 0x22, 0x22, 0x22, 0x00], // 0x4D 'M'
    [0x22, 0x22, 0x32, 0x2A, 0x26, 0x22, 0x22, 0x00], // 0x4E 'N'
    [0x1C, 0x22, 0x22, 0x22, 0x22, 0x22, 0x1C, 0x00], // 0x4F 'O'
    [0x3C, 0x22, 0x22, 0x3C, 0x20, 0x20, 0x20, 0x00], // 0x50 'P'
    [0x1C, 0x22, 0x22, 0x22, 0x2A, 0x24, 0x1A, 0x00], // 0x51 'Q'
    [0x3C, 0x22, 0x22, 0x3C, 0x28, 0x24, 0x22, 0x00], // 0x52 'R'
    [0x1C, 0x22, 0x20, 0x1C, 0x02, 0x22, 0x1C, 0x00], // 0x53 'S'
    [0x3E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00], // 0x54 'T'
    [0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x1C, 0x00], // 0x55 'U'
    [0x22, 0x22, 0x22, 0x22, 0x22, 0x14, 0x08, 0x00], // 0x56 'V'
    [0x22, 0x22, 0x22, 0x2A, 0x2A, 0x2A, 0x14, 0x00], // 0x57 'W'
    [0x22, 0x22, 0x14, 0x08, 0x14, 0x22, 0x22, 0x00], // 0x58 'X'
    [0x22, 0x22, 0x22, 0x14, 0x08, 0x08, 0x08, 0x00], // 0x59 'Y'
    [0x3E, 0x02, 0x04, 0x08, 0x10, 0x20, 0x3E, 0x00], // 0x5A 'Z'
    [0x1C, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1C, 0x00], // 0x5B '['
    [0x20, 0x20, 0x10, 0x08, 0x04, 0x02, 0x02, 0x00], // 0x5C '\'
    [0x1C, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1C, 0x00], // 0x5D ']'
    [0x08, 0x14, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00], // 0x5E '^'
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3E, 0x00], // 0x5F '_'
    [0x10, 0x08, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00], // 0x60 '`'
    [0x00, 0x00, 0x1C, 0x02, 0x1E, 0x22, 0x1E, 0x00], // 0x61 'a'
    [0x20, 0x20, 0x3C, 0x22, 0x22, 0x22, 0x3C, 0x00], // 0x62 'b'
    [0x00, 0x00, 0x1C, 0x22, 0x20, 0x22, 0x1C, 0x00], // 0x63 'c'
    [0x02, 0x02, 0x1E, 0x22, 0x22, 0x22, 0x1E, 0x00], // 0x64 'd'
    [0x00, 0x00, 0x1C, 0x22, 0x3E, 0x20, 0x1C, 0x00], // 0x65 'e'
    [0x0C, 0x10, 0x3E, 0x10, 0x10, 0x10, 0x10, 0x00], // 0x66 'f'
    [0x00, 0x00, 0x1E, 0x22, 0x22, 0x1E, 0x02, 0x1C], // 0x67 'g'
    [0x20, 0x20, 0x3C, 0x22, 0x22, 0x22, 0x22, 0x00], // 0x68 'h'
    [0x08, 0x00, 0x18, 0x08, 0x08, 0x08, 0x1C, 0x00], // 0x69 'i'
    [0x04, 0x00, 0x0C, 0x04, 0x04, 0x04, 0x24, 0x18], // 0x6A 'j'
    [0x20, 0x20, 0x24, 0x28, 0x30, 0x28, 0x24, 0x00], // 0x6B 'k'
    [0x18, 0x08, 0x08, 0x08, 0x08, 0x08, 0x1C, 0x00], // 0x6C 'l'
    [0x00, 0x00, 0x34, 0x2A, 0x2A, 0x2A, 0x2A, 0x00], // 0x6D 'm'
    [0x00, 0x00, 0x3C, 0x22, 0x22, 0x22, 0x22, 0x00], // 0x6E 'n'
    [0x00, 0x00, 0x1C, 0x22, 0x22, 0x22, 0x1C, 0x00], // 0x6F 'o'
    [0x00, 0x00, 0x3C, 0x22, 0x22, 0x3C, 0x20, 0x20], // 0x70 'p'
    [0x00, 0x00, 0x1E, 0x22, 0x22, 0x1E, 0x02, 0x02], // 0x71 'q'
    [0x00, 0x00, 0x2C, 0x30, 0x20, 0x20, 0x20, 0x00], // 0x72 'r'
    [0x00, 0x00, 0x1E, 0x20, 0x1C, 0x02, 0x3C, 0x00], // 0x73 's'
    [0x10, 0x10, 0x3E, 0x10, 0x10, 0x10, 0x0E, 0x00], // 0x74 't'
    [0x00, 0x00, 0x22, 0x22, 0x22, 0x22, 0x1E, 0x00], // 0x75 'u'
    [0x00, 0x00, 0x22, 0x22, 0x22, 0x14, 0x08, 0x00], // 0x76 'v'
    [0x00, 0x00, 0x22, 0x22, 0x2A, 0x2A, 0x14, 0x00], // 0x77 'w'
    [0x00, 0x00, 0x22, 0x14, 0x08, 0x14, 0x22, 0x00], // 0x78 'x'
    [0x00, 0x00, 0x22, 0x22, 0x22, 0x1E, 0x02, 0x1C], // 0x79 'y'
    [0x00, 0x00, 0x3E, 0x04, 0x08, 0x10, 0x3E, 0x00], // 0x7A 'z'
    [0x0C, 0x10, 0x10, 0x20, 0x10, 0x10, 0x0C, 0x00], // 0x7B '{'
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00], // 0x7C '|'
    [0x18, 0x04, 0x04, 0x02, 0x04, 0x04, 0x18, 0x00], // 0x7D '}'
    [0x14, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], // 0x7E '~'
];
```

- [ ] **Step 2: Add a sanity test for the data**

Append this `#[cfg(test)]` block to the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyph_count_matches_range() {
        assert_eq!(FONT_BITMAP.len(), GLYPH_COUNT);
        assert_eq!(GLYPH_COUNT, 0x7F - 0x20);
    }

    #[test]
    fn capital_a_pattern() {
        // 'A' is at index 0x41 - 0x20 = 0x21.
        let g = &FONT_BITMAP[0x21];
        // Row 0 is the apex: .###.. (bits 011100 = 0x1C) — letter glyphs are 5 wide
        // in a 6-wide cell, with the rightmost column as inter-glyph spacing.
        assert_eq!(g[0], 0x1C);
        // Row 3 is the crossbar across the 5-wide letter: #####. (0x3E).
        assert_eq!(g[3], 0x3E);
        // Row 7 is the bottom margin.
        assert_eq!(g[7], 0x00);
    }

    #[test]
    fn space_is_blank() {
        let g = &FONT_BITMAP[0];
        for &row in g.iter() {
            assert_eq!(row, 0x00);
        }
    }
}
```

- [ ] **Step 3: Run the tests**

Run:

```sh
cargo test --target x86_64-unknown-linux-gnu --lib font_data
```

Expected: 3 tests pass. (The `--target` flag is needed because `.cargo/config.toml` pins the default target to wasm32-wasip1, which doesn't support `cargo test`.)

- [ ] **Step 4: Wire the module into the encoder**

Add `pub mod font_data;` to `src/encoder/mod.rs`. The exact diff:

```diff
 //! In-browser cartridge encoder. Pure Rust, no dependence on the C engine.

 pub mod header;
 pub mod image;
 pub mod png_io;
 pub mod steg;
+pub mod font_data;
```

Re-run the tests above to confirm the module is reachable through the crate.

- [ ] **Step 5: Commit**

```sh
git add src/encoder/font_data.rs src/encoder/mod.rs
git commit -m "encoder(art): add 6x8 ASCII bitmap font data"
```

---

## Task 3: Implement `font::measure`

Width-only function — needed by the layout helper for fit-to-region decisions.

**Files:**
- Create: `src/encoder/font.rs`
- Modify: `src/encoder/mod.rs` (declare `pub mod font;`)

- [ ] **Step 1: Add the module skeleton + failing test**

Create `src/encoder/font.rs` with:

```rust
//! Bitmap-font measurement and blitting into the 256×256 RGBA canvas.

use crate::encoder::font_data::{FIRST_CHAR, FONT_BITMAP, GLYPH_H, GLYPH_W, LAST_CHAR};
use crate::encoder::image::{CART_RGBA_LEN, CART_W};

/// Width in pixels of `text` rendered at the given scale (1 or 2). Unknown
/// chars are substituted with '?' and contribute a full glyph width. Spacing
/// between glyphs is implicit in the 6-wide cell (each glyph has its own
/// 1-pixel right margin built into the bitmap).
pub fn measure(text: &str, scale: u8) -> u32 {
    debug_assert!(scale == 1 || scale == 2);
    let n = text.len() as u32;
    n * GLYPH_W as u32 * scale as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measure_basic() {
        assert_eq!(measure("", 1), 0);
        assert_eq!(measure("A", 1), 6);
        assert_eq!(measure("ABC", 1), 18);
        assert_eq!(measure("ABC", 2), 36);
    }

    #[test]
    fn measure_counts_unprintable_as_a_full_glyph_width() {
        // Tab (0x09) is out of range — substituted with ? at draw time, but
        // still takes one glyph cell at measure time.
        assert_eq!(measure("A\tB", 1), 18);
    }
}
```

Add `pub mod font;` to `src/encoder/mod.rs` next to the other declarations:

```diff
 pub mod font_data;
+pub mod font;
```

- [ ] **Step 2: Run the tests**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib font::tests
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src/encoder/font.rs src/encoder/mod.rs
git commit -m "encoder(art): add font::measure for text width"
```

---

## Task 4: Implement `font::draw`

Blits a string into the canvas at a given top-left position and color. Each glyph's set pixels become solid `color`; unset pixels are left alone. Out-of-bounds writes are clipped.

**Files:**
- Modify: `src/encoder/font.rs`

- [ ] **Step 1: Add the failing test**

Append to `src/encoder/font.rs`'s `tests` module:

```rust
    #[test]
    fn draw_blits_a_glyph_at_position() {
        use crate::encoder::image::{CART_RGBA_LEN, CART_W};

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();

        draw(arr, "A", 10, 10, 1, [0xFF, 0x80, 0x40]);

        // 'A' row 0 is .####. starting at x=10, y=10. So x=11..14 should be
        // colored, x=10 and x=15 should be untouched (= 0).
        let row_idx = 10 * CART_W;
        // x=10: untouched
        assert_eq!(arr[(row_idx + 10) * 4], 0);
        // x=11..14: colored
        for x in 11..=14 {
            let p = (row_idx + x) * 4;
            assert_eq!(arr[p],     0xFF);
            assert_eq!(arr[p + 1], 0x80);
            assert_eq!(arr[p + 2], 0x40);
            assert_eq!(arr[p + 3], 0xFF);
        }
        // x=15: untouched
        assert_eq!(arr[(row_idx + 15) * 4], 0);
    }

    #[test]
    fn draw_scales_2x() {
        use crate::encoder::image::{CART_RGBA_LEN, CART_W};
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();

        draw(arr, "A", 10, 10, 2, [0xFF, 0x00, 0x00]);

        // At 2× scale, 'A' row 0's pixel at col 1 maps to canvas (12,10),(13,10),(12,11),(13,11).
        for (x, y) in &[(12, 10), (13, 10), (12, 11), (13, 11)] {
            let p = (y * CART_W + x) * 4;
            assert_eq!(arr[p], 0xFF, "expected red at ({}, {})", x, y);
        }
        // Untouched: (10,10), (11,10).
        for (x, y) in &[(10, 10), (11, 10)] {
            let p = (y * CART_W + x) * 4;
            assert_eq!(arr[p], 0, "expected blank at ({}, {})", x, y);
        }
    }

    #[test]
    fn draw_clips_negative_x() {
        // Drawing at x = -2 with a 6-wide glyph: first 2 columns clipped, rest visible.
        use crate::encoder::image::{CART_RGBA_LEN, CART_W};
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();

        // 'A' row 0 is .####.  -> with x=-2, visible cols are at canvas x=0..3 (originally cols 2..5).
        draw(arr, "A", -2, 0, 1, [0xFF, 0x00, 0x00]);

        // Pixel at canvas (1, 0) corresponds to glyph col 3 of row 0 (= #).
        let p = 1 * 4;
        assert_eq!(arr[p], 0xFF);
    }

    #[test]
    fn draw_substitutes_unknown_chars_with_question_mark() {
        use crate::encoder::image::{CART_RGBA_LEN, CART_W};
        let mut canvas_a = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let mut canvas_b = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let a: &mut [u8; CART_RGBA_LEN] = canvas_a.as_mut().try_into().unwrap();
        let b: &mut [u8; CART_RGBA_LEN] = canvas_b.as_mut().try_into().unwrap();

        // Tab (0x09) is out of range; should render as '?'.
        draw(a, "\t", 0, 0, 1, [0x10, 0x20, 0x30]);
        draw(b, "?", 0, 0, 1, [0x10, 0x20, 0x30]);

        // The full 6×8 region should match byte-for-byte.
        for y in 0..8 {
            for x in 0..6 {
                let p = (y * CART_W + x) * 4;
                assert_eq!(a[p],     b[p],     "RGBA mismatch at ({}, {})", x, y);
                assert_eq!(a[p + 1], b[p + 1]);
                assert_eq!(a[p + 2], b[p + 2]);
                assert_eq!(a[p + 3], b[p + 3]);
            }
        }
    }
```

- [ ] **Step 2: Run the tests — verify they fail**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib font::tests::draw
```

Expected: 4 tests fail with "function `draw` not found".

- [ ] **Step 3: Implement `draw`**

Add to `src/encoder/font.rs` (above the tests):

```rust
/// Blit `text` into `canvas` at top-left `(x, y)` in canvas coords. Pixels of
/// the glyph that are set get written as solid `color` (alpha = 0xFF). Unset
/// glyph pixels do not touch the canvas. Out-of-bounds pixels are silently
/// clipped. Unknown chars (outside 0x20..=0x7E) are rendered as '?'.
pub fn draw(
    canvas: &mut [u8; CART_RGBA_LEN],
    text: &str,
    x: i32,
    y: i32,
    scale: u8,
    color: [u8; 3],
) {
    debug_assert!(scale == 1 || scale == 2);
    let scale = scale as i32;

    for (i, ch) in text.bytes().enumerate() {
        let glyph_x = x + (i as i32) * GLYPH_W as i32 * scale;
        let idx = if ch >= FIRST_CHAR && ch <= LAST_CHAR {
            (ch - FIRST_CHAR) as usize
        } else {
            (b'?' - FIRST_CHAR) as usize
        };
        let glyph = &FONT_BITMAP[idx];
        draw_glyph(canvas, glyph, glyph_x, y, scale, color);
    }
}

fn draw_glyph(
    canvas: &mut [u8; CART_RGBA_LEN],
    glyph: &[u8; GLYPH_H],
    x: i32,
    y: i32,
    scale: i32,
    color: [u8; 3],
) {
    for (row, &bits) in glyph.iter().enumerate() {
        for col in 0..GLYPH_W as i32 {
            // bit 5 = leftmost pixel
            let bit = (bits >> (5 - col)) & 1;
            if bit == 0 { continue; }
            for sy in 0..scale {
                for sx in 0..scale {
                    let cx = x + col * scale + sx;
                    let cy = y + (row as i32) * scale + sy;
                    if cx < 0 || cy < 0 { continue; }
                    if cx >= CART_W as i32 { continue; }
                    if cy >= CART_W as i32 { continue; } // CART_H == CART_W == 256
                    let p = ((cy as usize) * CART_W + (cx as usize)) * 4;
                    canvas[p]     = color[0];
                    canvas[p + 1] = color[1];
                    canvas[p + 2] = color[2];
                    canvas[p + 3] = 0xFF;
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib font::tests
```

Expected: all 6 font tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/encoder/font.rs
git commit -m "encoder(art): add font::draw for glyph blitting with clipping"
```

---

## Task 5: Implement `layout::fit_title`

Returns `(rendered_text, scale)` after applying the 2×→1×→ellipsis-truncate cascade. Always uppercases the text.

**Files:**
- Create: `src/encoder/layout.rs`
- Modify: `src/encoder/mod.rs`

- [ ] **Step 1: Create the file with constants + failing tests**

Create `src/encoder/layout.rs` with:

```rust
//! Text-layout helpers for the cartridge title plate and author line.
//! Pure functions — no canvas mutation.

use crate::encoder::font::measure;

/// Title plate is 176 px wide minus 4 px padding each side.
pub const TITLE_PLATE_MAX_W: u32 = 168;
/// Author line is centered under the screen, allowed to use the screen-well width + a bit.
pub const AUTHOR_LINE_MAX_W: u32 = 200;
/// Top y of the 2×-scale title glyph row. (Plate is y=24..53; centered: (24+53+1)/2 - 8 = 31.)
pub const TITLE_Y: i32 = 31;
/// Top y of the 1×-scale author glyph row.
pub const AUTHOR_Y: i32 = 206;
/// Dark green that contrasts with the yellow title plate.
pub const TITLE_COLOR: [u8; 3] = [10, 34, 24];
/// Light green that reads on the dark background below the screen.
pub const AUTHOR_COLOR: [u8; 3] = [122, 184, 156];

/// Fit a title to the plate. Returns the rendered text (already uppercase,
/// possibly truncated) and the scale (1 or 2) to render at.
pub fn fit_title(text: &str) -> (String, u8) {
    let up: String = text.to_ascii_uppercase();
    if measure(&up, 2) <= TITLE_PLATE_MAX_W {
        return (up, 2);
    }
    if measure(&up, 1) <= TITLE_PLATE_MAX_W {
        return (up, 1);
    }
    (truncate_to_fit(&up, TITLE_PLATE_MAX_W, 1), 1)
}

/// Iteratively drop the last char and append "..." until the result fits.
fn truncate_to_fit(text: &str, max_w: u32, scale: u8) -> String {
    // Greedy: take the longest prefix such that prefix + "..." fits.
    let bytes = text.as_bytes();
    let ellipsis = "...";
    // Start from the longest possible prefix and shrink.
    let mut end = bytes.len();
    loop {
        let mut candidate = String::with_capacity(end + 3);
        candidate.push_str(&text[..end]);
        candidate.push_str(ellipsis);
        if measure(&candidate, scale) <= max_w {
            return candidate;
        }
        if end == 0 {
            // Even just "..." doesn't fit — should never happen with our budgets,
            // but fall back to bare ellipsis.
            return ellipsis.to_string();
        }
        end -= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_title_short_uses_2x() {
        let (s, scale) = fit_title("My Game");
        assert_eq!(s, "MY GAME");
        assert_eq!(scale, 2);
    }

    #[test]
    fn fit_title_medium_falls_back_to_1x() {
        // 14 chars × 12 px (2x) = 168 — that exactly fits. 15 chars × 12 = 180, doesn't.
        let (s, scale) = fit_title("123456789012345"); // 15 chars
        assert_eq!(s, "123456789012345");
        assert_eq!(scale, 1);
    }

    #[test]
    fn fit_title_long_truncates_with_ellipsis() {
        // 30 chars at 1x = 180 px > 168. Should truncate with "..." to fit.
        let long = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"; // 30 chars
        let (s, scale) = fit_title(long);
        assert_eq!(scale, 1);
        assert!(s.ends_with("..."));
        assert!(measure(&s, 1) <= TITLE_PLATE_MAX_W);
        // We kept *some* leading characters.
        assert!(s.starts_with("ABCDEFG"));
    }

    #[test]
    fn fit_title_uppercases_lowercase_input() {
        let (s, _) = fit_title("hello");
        assert_eq!(s, "HELLO");
    }
}
```

Add `pub mod layout;` to `src/encoder/mod.rs`:

```diff
 pub mod font_data;
 pub mod font;
+pub mod layout;
```

- [ ] **Step 2: Run the tests**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib layout::tests::fit_title
```

Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src/encoder/layout.rs src/encoder/mod.rs
git commit -m "encoder(art): add layout::fit_title with 2x/1x/truncate cascade"
```

---

## Task 6: Implement `layout::fit_author`

Returns `Some("-- BY NAME --")` after truncation, or `None` for empty input.

**Files:**
- Modify: `src/encoder/layout.rs`

- [ ] **Step 1: Add failing tests**

Append to `src/encoder/layout.rs`'s `tests` module:

```rust
    #[test]
    fn fit_author_empty_returns_none() {
        assert!(fit_author("").is_none());
    }

    #[test]
    fn fit_author_short_renders_decoration() {
        let s = fit_author("alice").unwrap();
        assert_eq!(s, "-- BY ALICE --");
    }

    #[test]
    fn fit_author_long_truncates_with_ellipsis() {
        let long = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 chars
        // "-- BY ABC...XYZ --" — the inner truncation keeps the line ≤ 200 px.
        let s = fit_author(long).unwrap();
        assert!(s.starts_with("-- BY "));
        assert!(s.ends_with(" --"));
        assert!(measure(&s, 1) <= AUTHOR_LINE_MAX_W);
    }

    #[test]
    fn fit_author_whitespace_only_is_not_empty() {
        let s = fit_author("   ").unwrap();
        // The user gets back what they typed (uppercased / unchanged for whitespace).
        assert_eq!(s, "-- BY     --");
    }
```

- [ ] **Step 2: Run the tests — verify they fail**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib layout::tests::fit_author
```

Expected: 4 tests fail with "function `fit_author` not found".

- [ ] **Step 3: Implement `fit_author`**

Add to `src/encoder/layout.rs` (above `#[cfg(test)]`):

```rust
/// Format the author line. Returns `None` when `text` is empty (so callers can
/// skip drawing entirely). Non-empty input is uppercased and wrapped with
/// `-- BY ... --`. If the result exceeds AUTHOR_LINE_MAX_W, only the name part
/// is truncated with `...` until the whole line fits.
pub fn fit_author(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    let up = text.to_ascii_uppercase();

    let try_line = |name: &str| -> String {
        let mut s = String::with_capacity(name.len() + 10);
        s.push_str("-- BY ");
        s.push_str(name);
        s.push_str(" --");
        s
    };

    let full = try_line(&up);
    if measure(&full, 1) <= AUTHOR_LINE_MAX_W {
        return Some(full);
    }

    // Truncate the name part with ellipsis, keeping the "-- BY " / " --" wrappers.
    // Find the largest prefix of `up` such that the wrapped+ellipsised line fits.
    let bytes = up.as_bytes();
    let mut end = bytes.len();
    loop {
        let truncated = format!("{}...", &up[..end]);
        let line = try_line(&truncated);
        if measure(&line, 1) <= AUTHOR_LINE_MAX_W {
            return Some(line);
        }
        if end == 0 {
            return Some(try_line("..."));
        }
        end -= 1;
    }
}
```

- [ ] **Step 4: Run the tests**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib layout::tests
```

Expected: all 8 layout tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/encoder/layout.rs
git commit -m "encoder(art): add layout::fit_author with empty-omit + ellipsis"
```

---

## Task 7: Implement `frame::fill_rect` and `frame::stroke_rect`

Primitive drawing helpers. Solid colors only. Coordinates are clipped to the canvas.

**Files:**
- Create: `src/encoder/frame.rs`
- Modify: `src/encoder/mod.rs`

- [ ] **Step 1: Create the module + failing test**

Create `src/encoder/frame.rs` with:

```rust
//! Procedural drawing of the default cartridge frame onto the 256×256 RGBA canvas.

use crate::encoder::image::{CART_H, CART_RGBA_LEN, CART_W};

/// Fill an axis-aligned rectangle with a solid RGB color (alpha = 0xFF).
/// Coordinates are clipped to the canvas; zero/negative width or height is a no-op.
pub fn fill_rect(
    canvas: &mut [u8; CART_RGBA_LEN],
    x: i32, y: i32, w: i32, h: i32,
    color: [u8; 3],
) {
    if w <= 0 || h <= 0 { return; }
    let x0 = x.max(0) as usize;
    let y0 = y.max(0) as usize;
    let x1 = (x + w).clamp(0, CART_W as i32) as usize;
    let y1 = (y + h).clamp(0, CART_H as i32) as usize;
    if x0 >= x1 || y0 >= y1 { return; }
    for cy in y0..y1 {
        let row = cy * CART_W;
        for cx in x0..x1 {
            let p = (row + cx) * 4;
            canvas[p]     = color[0];
            canvas[p + 1] = color[1];
            canvas[p + 2] = color[2];
            canvas[p + 3] = 0xFF;
        }
    }
}

/// Draw a 1-pixel-thick stroke around the rect (x, y, w, h). The stroke sits
/// inside the rect (i.e. uses x..x+w and y..y+h as the outer bounds).
pub fn stroke_rect(
    canvas: &mut [u8; CART_RGBA_LEN],
    x: i32, y: i32, w: i32, h: i32, thickness: i32,
    color: [u8; 3],
) {
    if w <= 0 || h <= 0 || thickness <= 0 { return; }
    // Top
    fill_rect(canvas, x, y, w, thickness, color);
    // Bottom
    fill_rect(canvas, x, y + h - thickness, w, thickness, color);
    // Left
    fill_rect(canvas, x, y, thickness, h, color);
    // Right
    fill_rect(canvas, x + w - thickness, y, thickness, h, color);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_rect_writes_only_inside_bounds() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        fill_rect(arr, 10, 20, 5, 3, [0x11, 0x22, 0x33]);

        // Inside the rect: (10..15, 20..23) is filled.
        for cy in 20..23 {
            for cx in 10..15 {
                let p = (cy * CART_W + cx) * 4;
                assert_eq!(arr[p], 0x11);
                assert_eq!(arr[p + 1], 0x22);
                assert_eq!(arr[p + 2], 0x33);
                assert_eq!(arr[p + 3], 0xFF);
            }
        }
        // Just outside on the right: (15, 20) untouched.
        let p = (20 * CART_W + 15) * 4;
        assert_eq!(arr[p], 0);
        // Just outside below: (10, 23) untouched.
        let p2 = (23 * CART_W + 10) * 4;
        assert_eq!(arr[p2], 0);
    }

    #[test]
    fn fill_rect_clips_to_canvas() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        // Off-canvas rect — must not panic and must not write anything.
        fill_rect(arr, -10, -10, 5, 5, [0xFF, 0, 0]);
        // Crosses right edge — only the in-bounds part is written.
        fill_rect(arr, 254, 100, 10, 1, [0xFF, 0, 0]);
        let p254 = (100 * CART_W + 254) * 4;
        let p255 = (100 * CART_W + 255) * 4;
        assert_eq!(arr[p254], 0xFF);
        assert_eq!(arr[p255], 0xFF);
    }

    #[test]
    fn stroke_rect_draws_just_the_border() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        stroke_rect(arr, 50, 50, 10, 10, 1, [0xAB, 0xCD, 0xEF]);

        // Border pixel.
        let pb = (50 * CART_W + 50) * 4;
        assert_eq!(arr[pb], 0xAB);
        // Interior pixel (51, 51) is NOT part of the stroke.
        let pi = (51 * CART_W + 51) * 4;
        assert_eq!(arr[pi], 0);
        // Bottom-right corner of the stroke (59, 59) IS drawn.
        let pbr = (59 * CART_W + 59) * 4;
        assert_eq!(arr[pbr], 0xAB);
    }
}
```

Add `pub mod frame;` to `src/encoder/mod.rs`:

```diff
 pub mod font_data;
 pub mod font;
 pub mod layout;
+pub mod frame;
```

- [ ] **Step 2: Run the tests**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib frame::tests
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```sh
git add src/encoder/frame.rs src/encoder/mod.rs
git commit -m "encoder(art): add frame::fill_rect and stroke_rect primitives"
```

---

## Task 8: Implement `frame::draw_default_frame`

Paints the entire cartridge frame (background, body with rounded corners, title plate, screen well, inner border, pin row) into the canvas. Caller composites the cover and draws text on top afterwards.

The rounded-corner approach: hardcode a 10×10 corner mask. For each of the four body corners, set body-edge pixels where the mask says "outside the corner radius" back to the background color. The mask is the same for all four corners (mirrored at the call sites by indexing).

**Files:**
- Modify: `src/encoder/frame.rs`

- [ ] **Step 1: Add failing test**

Append to the `tests` module in `src/encoder/frame.rs`:

```rust
    #[test]
    fn draw_default_frame_fills_background_color() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Top-left corner is *outside* the body — must be the background color #0d1612.
        let p = 0;
        assert_eq!(arr[p],     0x0d);
        assert_eq!(arr[p + 1], 0x16);
        assert_eq!(arr[p + 2], 0x12);
        assert_eq!(arr[p + 3], 0xFF);
    }

    #[test]
    fn draw_default_frame_paints_title_plate_yellow() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Center of the title plate: (128, 39) must be the plate fill #e8d56a.
        let p = (39 * CART_W + 128) * 4;
        assert_eq!(arr[p],     0xe8);
        assert_eq!(arr[p + 1], 0xd5);
        assert_eq!(arr[p + 2], 0x6a);
    }

    #[test]
    fn draw_default_frame_paints_screen_well_dark() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // (57, 61) is inside the screen well (56..200, 60..196) but outside the
        // inner border (60..196, 62..194), so it must be #0a2218.
        let p = (61 * CART_W + 57) * 4;
        assert_eq!(arr[p],     0x0a);
        assert_eq!(arr[p + 1], 0x22);
        assert_eq!(arr[p + 2], 0x18);
    }

    #[test]
    fn draw_default_frame_rounds_body_corners() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Body top-left corner pixel (20, 14) — outside the 10-px radius arc, so
        // it should be the *background* color, not the body color.
        let p = (14 * CART_W + 20) * 4;
        assert_eq!(arr[p],     0x0d, "expected background at corner");
        assert_eq!(arr[p + 1], 0x16);
        assert_eq!(arr[p + 2], 0x12);
        // A pixel well inside the body — (100, 100) is far from any corner mask
        // or sub-region — should be the body fill #1d4a3a.
        let q = (100 * CART_W + 100) * 4;
        assert_eq!(arr[q],     0x1d);
        assert_eq!(arr[q + 1], 0x4a);
        assert_eq!(arr[q + 2], 0x3a);
    }

    #[test]
    fn draw_default_frame_pin_row_present() {
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        draw_default_frame(arr);
        // Center of the first pin (x=30..36, y=222..234) → (32, 225).
        let p = (225 * CART_W + 32) * 4;
        assert_eq!(arr[p],     0xd4);
        assert_eq!(arr[p + 1], 0xa0);
        assert_eq!(arr[p + 2], 0x2a);
    }
```

- [ ] **Step 2: Run the tests — verify they fail**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib frame::tests::draw_default_frame
```

Expected: 5 tests fail with "function `draw_default_frame` not found".

- [ ] **Step 3: Implement `draw_default_frame`**

Add to `src/encoder/frame.rs` (above `#[cfg(test)]`):

```rust
const COLOR_BG:        [u8; 3] = [0x0d, 0x16, 0x12];
const COLOR_BODY:      [u8; 3] = [0x1d, 0x4a, 0x3a];
const COLOR_BODY_EDGE: [u8; 3] = [0x0a, 0x22, 0x18];
const COLOR_PLATE:     [u8; 3] = [0xe8, 0xd5, 0x6a];
const COLOR_WELL:      [u8; 3] = [0x0a, 0x22, 0x18];
const COLOR_INNER:     [u8; 3] = [0x3a, 0x7a, 0x5c];
const COLOR_PIN:       [u8; 3] = [0xd4, 0xa0, 0x2a];

// 10×10 quarter-circle mask. `1` = inside the rounded body (keep), `0` = outside
// (revert to background). Generated from the discrete formula
//     inside iff (x + 0.5)² + (y + 0.5)² <= r²   with r = 10.
// Indexed [y][x], with (0,0) at the corner. Symmetric — same mask is used at all
// four corners with appropriate axis flips at the call site.
const CORNER_MASK: [[u8; 10]; 10] = [
    [0, 0, 0, 0, 0, 0, 0, 1, 1, 1],
    [0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

/// Paint a single pin at (x, y) of width 6, height 12.
fn paint_pin(canvas: &mut [u8; CART_RGBA_LEN], x: i32) {
    fill_rect(canvas, x, 222, 6, 12, COLOR_PIN);
}

/// Apply the corner mask. (cx, cy) is the canvas pixel that corresponds to the
/// mask's (0, 0) cell. `flip_x` / `flip_y` mirror the mask index axes.
fn apply_corner_mask(
    canvas: &mut [u8; CART_RGBA_LEN],
    cx: i32, cy: i32,
    flip_x: bool, flip_y: bool,
) {
    for my in 0..10 {
        for mx in 0..10 {
            let bit = CORNER_MASK[my][mx];
            if bit != 0 { continue; }
            let dx = if flip_x { 9 - mx as i32 } else { mx as i32 };
            let dy = if flip_y { 9 - my as i32 } else { my as i32 };
            let px = cx + dx;
            let py = cy + dy;
            fill_rect(canvas, px, py, 1, 1, COLOR_BG);
        }
    }
}

/// Paint the full default cartridge frame into the canvas. After this returns,
/// the caller composites the cover and draws title/author text on top.
pub fn draw_default_frame(canvas: &mut [u8; CART_RGBA_LEN]) {
    // 1. Solid background everywhere.
    fill_rect(canvas, 0, 0, CART_W as i32, CART_H as i32, COLOR_BG);

    // 2. Body fill (20, 14, 216, 226).
    fill_rect(canvas, 20, 14, 216, 226, COLOR_BODY);
    // 3. Body stroke (3 px, inside the rect).
    stroke_rect(canvas, 20, 14, 216, 226, 3, COLOR_BODY_EDGE);
    // 4. Knock out the four corners back to background.
    apply_corner_mask(canvas,  20,  14, false, false); // top-left
    apply_corner_mask(canvas, 226,  14, true,  false); // top-right (cx = x+w-10)
    apply_corner_mask(canvas,  20, 230, false, true ); // bottom-left
    apply_corner_mask(canvas, 226, 230, true,  true ); // bottom-right

    // 5. Title plate (40, 24, 176, 30) with 2-px dark border.
    fill_rect(canvas, 40, 24, 176, 30, COLOR_PLATE);
    stroke_rect(canvas, 40, 24, 176, 30, 2, COLOR_BODY_EDGE);

    // 6. Screen well (56, 60, 144, 136) and the 1-px inner highlight.
    fill_rect(canvas, 56, 60, 144, 136, COLOR_WELL);
    stroke_rect(canvas, 60, 62, 136, 132, 1, COLOR_INNER);

    // 7. Pin row — 17 pins, x ∈ {30, 42, …, 222}, step 12, w=6, h=12, y=222.
    for i in 0..17 {
        paint_pin(canvas, 30 + i * 12);
    }
}
```

- [ ] **Step 4: Run the tests**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib frame::tests
```

Expected: all 8 frame tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/encoder/frame.rs
git commit -m "encoder(art): add draw_default_frame procedural cartridge artwork"
```

---

## Task 9: Update `image.rs` — bump COVER_Y, remove bundled frame

The encoder still needs `decode_256x256_rgba` for the `frame_override` slot (user-provided frame PNG), but no longer needs the `BUNDLED_FRAME` const or its associated test.

**Files:**
- Modify: `src/encoder/image.rs`

- [ ] **Step 1: Bump the constant**

In `src/encoder/image.rs`, change:

```diff
-pub const COVER_Y: usize = 60;
+pub const COVER_Y: usize = 64;
```

- [ ] **Step 2: Remove the bundled-frame const and its test**

In `src/encoder/image.rs`, delete these lines:

```rust
/// Default frame, embedded at compile time.
pub const BUNDLED_FRAME: &[u8] = include_bytes!("../../assets/cartridge3.png");
```

And delete the test that exercises it:

```rust
    #[test]
    fn bundled_frame_is_valid_256x256() {
        let mut buf = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = buf.as_mut().try_into().unwrap();
        decode_256x256_rgba(BUNDLED_FRAME, arr).unwrap();
    }
```

- [ ] **Step 3: Update the composite test that uses absolute coords**

The test `composite_writes_cover_at_offset_and_leaves_rest_untouched` checks coordinates derived from `COVER_X` / `COVER_Y`. Verify it still passes — it should, because it uses the constants symbolically. If it hardcodes `60` anywhere, update to `64`.

Run:

```sh
grep -n "60" src/encoder/image.rs
```

If only `// Pixel (64,60)` style comments appear, edit those comments to say `(64, 64)`:

```diff
-        // Pixel (64,60) is top-left of cover region; corresponds to cover (0,0) = 0.
+        // Pixel (64, 64) is top-left of cover region; corresponds to cover (0,0) = 0.
-        // Pixel (65,60) -> cover (1,0) -> cover index 4 (=4 mod 256).
+        // Pixel (65, 64) -> cover (1,0) -> cover index 4 (=4 mod 256).
```

- [ ] **Step 4: Run the image tests**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib encoder::image
```

Expected: all remaining image tests pass (bundled-frame test is gone; composite test still passes since coords reference the constants).

- [ ] **Step 5: Commit**

```sh
git add src/encoder/image.rs
git commit -m "encoder(art): bump COVER_Y 60->64, drop bundled-frame asset"
```

---

## Task 10: Delete the old frame asset

**Files:**
- Delete: `assets/cartridge3.png`

- [ ] **Step 1: Remove the file**

```sh
git rm assets/cartridge3.png
```

- [ ] **Step 2: Verify nothing else references it**

```sh
grep -rn "cartridge3" src/ editor/src/ scripts/ assets/ 2>/dev/null
```

Expected: no output. (The `BUNDLED_FRAME` reference was already removed in Task 9.)

- [ ] **Step 3: Commit**

```sh
git commit -m "encoder(art): remove old cartridge3.png frame asset"
```

---

## Task 11: Wire the new pipeline into `encode()`

Call `frame::draw_default_frame` in place of decoding `BUNDLED_FRAME`, and add the title + author rendering between the cover composite and the steg passes.

**Files:**
- Modify: `src/encoder/mod.rs`

- [ ] **Step 1: Update the encode pipeline**

In `src/encoder/mod.rs`, replace the existing step 3 (frame decode) and add the new text-drawing block between the existing step 4 (composite_cover) and step 5 (pack header). The full replacement of the relevant section:

```rust
    // 2. Decode input PNGs.
    decode_128x128_rgba(cover_png, cover_rgba_buf).map_err(|e| match e {
        ImageError::WrongSize { .. } => EncError::CoverSize,
        ImageError::Decode(m)        => EncError::CoverPng(m),
    })?;
    decode_128x128_rgba(spritesheet_png, sprite_rgba_buf).map_err(|e| match e {
        ImageError::WrongSize { .. } => EncError::SpriteSize,
        ImageError::Decode(m)        => EncError::SpritePng(m),
    })?;

    // 3. Frame: user override decodes a PNG into the canvas; otherwise we draw
    //    the procedural default frame.
    match frame_override {
        Some(bytes) => {
            decode_256x256_rgba(bytes, canvas_buf).map_err(|e| match e {
                ImageError::WrongSize { .. } => EncError::FrameSize,
                ImageError::Decode(m)        => EncError::FramePng(m),
            })?;
        }
        None => {
            crate::encoder::frame::draw_default_frame(canvas_buf);
        }
    }

    // 4. Composite cover onto the visible canvas (high bits).
    composite_cover(canvas_buf, cover_rgba_buf);

    // 4b. Render the title plate text and the author line.
    {
        use crate::encoder::font::{measure, draw};
        use crate::encoder::layout::{
            fit_title, fit_author, TITLE_Y, AUTHOR_Y, TITLE_COLOR, AUTHOR_COLOR,
        };
        use crate::encoder::image::CART_W;

        let (title_text, title_scale) = fit_title(opts.title);
        let title_w = measure(&title_text, title_scale);
        let title_x = (CART_W as i32 - title_w as i32) / 2;
        draw(canvas_buf, &title_text, title_x, TITLE_Y, title_scale, TITLE_COLOR);

        if let Some(author_line) = fit_author(opts.author) {
            let aw = measure(&author_line, 1);
            let ax = (CART_W as i32 - aw as i32) / 2;
            draw(canvas_buf, &author_line, ax, AUTHOR_Y, 1, AUTHOR_COLOR);
        }
    }
```

Also remove the now-unused `BUNDLED_FRAME` from the `use` line at the top of `encode()`. Change:

```diff
-    use crate::encoder::image::{
-        composite_cover, decode_128x128_rgba, decode_256x256_rgba, BUNDLED_FRAME, ImageError,
-    };
+    use crate::encoder::image::{
+        composite_cover, decode_128x128_rgba, decode_256x256_rgba, ImageError,
+    };
```

The line `let frame_src: &[u8] = frame_override.unwrap_or(BUNDLED_FRAME);` is gone — replaced by the new `match` block above.

- [ ] **Step 2: Run a single existing test to validate the wiring compiles**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib encoder::tests::encode_rejects_oversized_script
```

Expected: PASS. (This test doesn't touch the frame; it just confirms that the encoder still compiles + runs.)

- [ ] **Step 3: Commit**

```sh
git add src/encoder/mod.rs
git commit -m "encoder(art): wire draw_default_frame + title/author into encode()"
```

---

## Task 12: Update the round-trip encoder test for the new layout

The existing test `encode_round_trip_recovers_header_and_script_crc` verifies the cover pixel at `(COVER_X, COVER_Y)`. With `COVER_Y` now 64, the assertion location moves automatically (it reads through the constant). But the test passes the title `"roundtrip"`, which will now be rendered onto the title-plate region — we need to assert that the title plate has the expected yellow fill at a location that's NOT overdrawn by glyphs (e.g., the corners of the plate).

**Files:**
- Modify: `src/encoder/mod.rs` (the `tests` module)

- [ ] **Step 1: Add title-plate and author-line spot checks**

In the `encode_round_trip_recovers_header_and_script_crc` test in `src/encoder/mod.rs`, after the existing cover-pixel assertions (the three `assert_eq!(back_arr[canvas_idx + N] & 0xF0, ...)` lines), add:

```rust
        // Title plate's top-left interior corner (just inside the 2-px dark border).
        // Plate is (40, 24, 176, 30); inside the border starts at (42, 26).
        // After steg the low 2 bits are clobbered, so compare against the top 6 bits
        // of the plate color #e8d56a.
        let plate_idx = (26 * crate::encoder::image::CART_W + 42) * 4;
        assert_eq!(back_arr[plate_idx]     & 0xFC, 0xe8 & 0xFC);
        assert_eq!(back_arr[plate_idx + 1] & 0xFC, 0xd5 & 0xFC);
        assert_eq!(back_arr[plate_idx + 2] & 0xFC, 0x6a & 0xFC);

        // Cover offset moved from (64, 60) to (64, 64) — sanity check that the
        // pixel at the *old* offset (60) is now the dark screen-well color, not
        // the cover's top-left (which is at y=64).
        let old_y_idx = (60 * crate::encoder::image::CART_W + 64) * 4;
        // Screen well is #0a2218 with top 6 bits = 0x08, 0x20, 0x18.
        assert_eq!(back_arr[old_y_idx]     & 0xFC, 0x0a & 0xFC);
        assert_eq!(back_arr[old_y_idx + 1] & 0xFC, 0x22 & 0xFC);
        assert_eq!(back_arr[old_y_idx + 2] & 0xFC, 0x18 & 0xFC);
```

- [ ] **Step 2: Run the round-trip test**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib encoder::tests::encode_round_trip
```

Expected: PASS.

- [ ] **Step 3: Run the *whole* encoder test suite**

```sh
cargo test --target x86_64-unknown-linux-gnu --lib encoder
```

Expected: all encoder tests pass (round-trip + oversize-script + wrong-cover-size + overlong-title).

- [ ] **Step 4: Commit**

```sh
git add src/encoder/mod.rs
git commit -m "encoder(art): assert new title-plate + cover-offset in round-trip test"
```

---

## Task 13: Bump the C engine's `TB_COVER_Y`

**Note on the submodule policy:** `CLAUDE.md` says "The submodule at `src/tinybit/` is intentionally not modified. Bug fixes belong upstream in TinyBit-lib." For this change the user has explicitly authorized modifying the submodule because moving the cover position is one of the project's defining design choices, not a bug fix. A local branch is committed in the submodule and the parent points at it; an upstream PR is listed as a follow-up below.

The submodule is checked out from Task 1. Modify the engine's header file in-place, commit *inside* the submodule, then bump the submodule pointer in the parent repo.

**Files:**
- Modify: `src/tinybit/tinybit.h`

- [ ] **Step 1: Update the constant**

In `src/tinybit/tinybit.h`, change:

```diff
-#define TB_COVER_Y 60
+#define TB_COVER_Y 64
```

`TB_COVER_X` stays at `64`.

- [ ] **Step 2: Verify no other engine file hardcodes the old value**

```sh
grep -rn "TB_COVER\|\\b60\\b" src/tinybit/ | grep -i "cover\|y"
```

Expected: the only hit referencing cover Y is `tinybit.h:22` (now `64`). The match in `cartridge.c` uses `TB_COVER_Y` symbolically — not affected.

- [ ] **Step 3: Commit *inside* the submodule**

```sh
cd src/tinybit
git checkout -b cover-y-64
git commit -am "header: bump TB_COVER_Y 60 -> 64 for new cartridge label layout"
cd ../..
```

(`-am` stages the modified `tinybit.h` and commits in one shot.)

- [ ] **Step 4: Bump the submodule pointer in the parent**

```sh
git add src/tinybit
git commit -m "submodule: bump tinybit to cover-y-64 for new cartridge label layout"
```

(The author can later push the `cover-y-64` branch upstream to `MeesCode/TinyBit-lib` and update the submodule pointer to the upstream commit hash. That's a follow-up; for the implementation in this worktree the local commit is sufficient.)

---

## Task 14: Build the wasm and run the encoder smoke test

End-to-end verification: the encoder now produces a PNG that opens correctly and (visually) shows the new cartridge layout.

**Files:**
- N/A (build artifacts only)

- [ ] **Step 1: Build the wasm**

```sh
./scripts/build.sh
```

Expected: build succeeds, output reports `editor/public/tinybit_wasm.wasm` was updated. (First run may download wasi-sdk-25; subsequent runs are fast.)

- [ ] **Step 2: Run the encoder smoke test**

```sh
node scripts/smoke_encoder.mjs
```

Expected: PASS. The script encodes a cartridge and re-decodes it; with the new wiring the round-trip should still hold.

- [ ] **Step 3: Visually verify (manual)**

Open the produced PNG (the smoke script logs the output path, or run `./scripts/dev.sh` and use the editor to download a cartridge) and confirm:

- The cartridge silhouette is green with rounded corners
- A yellow title plate sits above the cover with the title text on it
- The author line sits between the cover and the pin row
- The pin row has 17 gold rectangles along the bottom
- The cover image is positioned correctly (no horizontal/vertical drift relative to the screen well)

If anything looks off, capture the PNG and stop; we'll iterate on `frame.rs` before merging.

- [ ] **Step 4: Commit**

Nothing to commit (the `.wasm` binary lives in `editor/public/` and is regenerated by `scripts/build.sh` — typically gitignored; verify with `git status` and skip if it shows up).

If `editor/public/tinybit_wasm.wasm` is tracked and updated, commit it:

```sh
git add editor/public/tinybit_wasm.wasm
git commit -m "build: refresh wasm with new cartridge art encoder"
```

Otherwise this task ends without a commit.

---

## Task 15: Run the full test suites

Final regression sweep.

- [ ] **Step 1: Rust host tests**

```sh
cargo test --target x86_64-unknown-linux-gnu
```

Expected: all pass.

- [ ] **Step 2: Editor unit tests**

```sh
cd editor && npm test -- --run
```

Expected: all pass. (Some tests load the wasm; the previously rebuilt `editor/public/tinybit_wasm.wasm` is what they use.)

- [ ] **Step 3: Engine smoke (requires sibling TinyBit checkout per CLAUDE.md)**

```sh
node scripts/smoke.mjs
```

Expected: PASS if `../TinyBit/flappy.tb.png` exists. Skip with note in the task summary otherwise.

- [ ] **Step 4: Final commit / no-op**

If any of the above produced fixes (e.g. an editor test asserts a stale offset or pixel value), fix the test inline. Commit message:

```sh
git commit -m "test: align editor + engine tests with new cartridge layout"
```

---

## Out of scope / follow-ups

- Pushing the `cover-y-64` branch to `MeesCode/TinyBit-lib` upstream and pointing the submodule at the merged-upstream commit. Track separately.
- Re-exporting the bundled demo cartridge (`editor/public/*demo*.tb.png` if present) so its launcher thumbnail aligns with the new offset.
- Tightening glyph designs / kerning. The hand-designed font is functional but not artisanal; iterate visually after the first end-to-end render lands.
