# Cartridge Art Redesign — Design

**Date:** 2026-05-20
**Status:** Spec
**Related code:** `src/encoder/image.rs`, `src/encoder/mod.rs`, `assets/cartridge3.png`, `src/decoder/image.rs`, `src/tinybit/tinybit.h`, `src/tinybit/cartridge.c`

## Problem

The exported `.tb.png` cartridge today is the bundled `assets/cartridge3.png` frame with the 128×128 cover composited on top at `(64, 60)`. The title and author the user types in the Cartridge tab are stored in the header (and used by the editor's gallery), but they are **invisible on the exported image**. Two consequences:

- A cartridge file sitting in a folder, a chat, or a sharing site has no human-readable identification — it's an anonymous square.
- The current frame art is functional but doesn't sell the "cartridge" idea; it reads as a generic game asset.

We want the exported PNG to look like an actual labeled retro cartridge, with the title and author printed on it.

## Goal

Replace the export's visual treatment with a redesigned green cartridge that:

1. Has a title plate above the screen window with the cartridge title printed on it.
2. Has the author name printed in small text below the screen window.
3. Keeps the same 256×256 canvas and the same steganographic data layout (header + spritesheet + script in low bits).
4. Looks like the "Option D — palette 1" mockup approved during brainstorming.

The cover image moves from `(64, 60)` to `(64, 64)` — 4 px lower — so the title plate has its own dedicated band above the screen well. This requires changing the engine's `TB_COVER_Y` constant in the submodule.

## Non-goals

- Animated cartridges, multiple cartridge skins, or user-selectable color schemes. One look, replacing the old one.
- Rendering anything other than title + author. No version string, no date, no QR code.
- Free-form text positioning. Title goes on the plate; author goes on the line below the screen. No layout knobs.
- Changing the cartridge size, the steg encoding, the script size cap, or the header format.
- Backwards-compatible decoding of *old* (pre-bump) cartridges in the *new* engine. The launcher's `gamecover()` will simply read from `(64, 64)` for everyone; old cartridges saved under the previous frame will show a small horizontal shift in their thumbnail until they're re-exported. This is an acceptable one-time cost (cartridges in this project are user-authored, not a distributed catalog).

## Visual specification

All coordinates are in the 256×256 canvas, top-left origin, pixel-exact.

| Region | Rect `(x, y, w, h)` | Fill | Notes |
|---|---|---|---|
| Background | `(0, 0, 256, 256)` | `#0d1612` | Solid; visible as a thin margin around the body |
| Body | `(20, 14, 216, 226)` rounded r=10 | `#1d4a3a` (fill), `#0a2218` (3 px stroke) | Cartridge silhouette |
| Title plate | `(40, 24, 176, 30)` | `#e8d56a` (fill), `#0a2218` (2 px stroke) | Title centered in this rect |
| Screen well | `(56, 60, 144, 136)` | `#0a2218` | Dark recess that frames the cover |
| Screen inner border | `(60, 62, 136, 132)` stroke | `#3a7a5c` (1 px) | Thin highlight inside the well |
| **Cover** | `(64, 64, 128, 128)` | (composited) | **Moved from (64, 60). Engine constant updated to match.** |
| Author line | centered, glyph-top `y=206` (8 px tall, occupies rows 206..213) | `#7ab89c` | Format: `-- BY <NAME> --` (two ASCII hyphens each side). Omitted entirely when author is empty. |
| Pin row | 17 rects, `y=222`, `w=6, h=12`, x ∈ {30, 42, 54, …, 222} (step 12) | `#d4a02a` | Decorative gold contacts |

Rounded corners on the body are rasterized into the static frame PNG (no runtime rounding).

### Text rendering

- **Font:** a single embedded bitmap font, 6 px wide × 8 px tall per glyph, ASCII 32..126 (95 glyphs). Stored as a PNG strip 570 × 8 (95 × 6 px columns), grayscale-treated-as-alpha. Embedded into the crate via `include_bytes!`.
- **Title:** drawn at **2× scale** (12 × 16 px per glyph) centered in the title plate. If the rendered width exceeds 168 px (the plate minus 4 px padding each side):
  1. Drop to **1× scale** (6 × 8 px per glyph).
  2. If still > 168 px at 1× scale, truncate the title and append a single ellipsis character (`…`, rendered as three dots `...` since the font is ASCII-only) until it fits.
- **Author:** rendered at **1× scale** centered on the author line, prefixed and suffixed with `-- ` and ` --` (ASCII hyphens; the font has no em-dash glyph). If the full `-- BY NAME --` line exceeds 200 px (the screen-well width plus a small margin), the name is truncated with `...` the same way. Empty author → entire line omitted (no dashes).
- Both lines are uppercased before rendering, since the font carries only one case and uppercase reads better at small sizes. The header still stores the original casing.

### Color budget

The frame uses solid fills only. After the encoder's low-2-bit steganography pass, the visible channel values (top 6 bits) match the intended palette exactly — the low 2 bits of every fill pixel are overwritten by steg data, but the top 6 bits encode the color faithfully. Test assertions verify this with `& 0xFC` masks. The cover region keeps its existing top-4-bits preservation.

## Architecture

The encode pipeline today is:

```
decode cover.png        →  cover_rgba (128×128 RGBA)
decode sprite.png       →  sprite_rgba (128×128 RGBA)
decode bundled frame    →  canvas_buf (256×256 RGBA)
composite_cover(canvas, cover)      # overwrites cover rect
steg::write_bytes(canvas, header)
steg::write_spritesheet(canvas, sprite)
steg::write_bytes(canvas, script + NUL)
encode_rgba(canvas)     →  out PNG
```

The new pipeline interleaves text rendering between `composite_cover` and the steg passes:

```
... (unchanged through composite_cover)
draw_title(canvas, opts.title)       # NEW — overwrites title-plate region
draw_author(canvas, opts.author)     # NEW — overwrites author line
... (steg passes unchanged — low 2 bits go everywhere)
```

The steg passes still write the entire canvas's low 2 bits. Title and author pixels lose their low 2 bits, which is fine: 6 bits per channel is more than enough resolution for two solid colors against a solid background.

### New modules / files

- `assets/cartridge_frame.png` — new 256×256 frame replacing `cartridge3.png`. The old file is deleted in the same commit.
- `assets/font_6x8.png` — bitmap font strip. Single row of 95 glyphs, 6 px × 8 px each, grayscale (alpha-only). Authored by hand and checked into the repo.
- `src/encoder/font.rs` — new module exposing:
  - `pub const FONT_DATA: &[u8] = include_bytes!("../../assets/font_6x8.png");`
  - `pub fn decode_font() -> [u8; 95 * 6 * 8]` — decodes the strip into a flat alpha array at crate init (called from a `static` via `OnceLock` or eager `lazy_static`-style cell). Each glyph is 6 × 8 = 48 bytes.
  - `pub fn measure(text: &str, scale: u8) -> u32` — width in pixels for a given text + scale (1 or 2). Non-renderable chars (`< 0x20` or `> 0x7e`) measure as 0.
  - `pub fn draw(canvas: &mut [u8; CART_RGBA_LEN], text: &str, x: i32, y: i32, scale: u8, color: [u8; 3])` — blits glyphs into the 256×256 RGBA buffer. Alpha from the font multiplies against the destination; we ignore subpixel alpha and treat any non-zero font pixel as "draw the color verbatim" to keep the result palette-clean.
- `src/encoder/layout.rs` — pure layout helpers:
  - `pub fn fit_title(text: &str) -> (String, u8)` — returns `(rendered_text, scale)` after applying the 2×→1×→truncate cascade described above.
  - `pub fn fit_author(text: &str) -> Option<String>` — returns `Some("-- BY NAME --")` after truncation, or `None` for empty input.

### Encoder wiring

`src/encoder/mod.rs::encode` gains two calls between step 4 (composite_cover) and step 5 (pack header):

```rust
let (title_text, scale) = layout::fit_title(opts.title);
let title_width = font::measure(&title_text, scale);
let title_x = (CART_W as i32 - title_width as i32) / 2;
font::draw(canvas_buf, &title_text, title_x, TITLE_Y, scale, TITLE_COLOR);

if let Some(line) = layout::fit_author(opts.author) {
    let w = font::measure(&line, 1);
    let x = (CART_W as i32 - w as i32) / 2;
    font::draw(canvas_buf, &line, x, AUTHOR_Y, 1, AUTHOR_COLOR);
}
```

Constants live in `font.rs` next to the other layout constants:

- `TITLE_Y = 31` — top-left y of the 2×-scale glyph. Plate runs y=24..53; 16-px glyph centered vertically: `(24 + 53 + 1)/2 - 8 = 31`. Glyph occupies rows 31..46.
- `AUTHOR_Y = 206` — top-left y of the 1×-scale glyph. Glyph occupies rows 206..213.
- `TITLE_COLOR = [10, 34, 24]` — matches the dark-green stroke.
- `AUTHOR_COLOR = [122, 184, 156]` — light green that reads on the dark background.

### Engine update

`src/tinybit/tinybit.h`:

```diff
-#define TB_COVER_X 64
-#define TB_COVER_Y 60
+#define TB_COVER_X 64
+#define TB_COVER_Y 64
```

This file lives in the submodule. The change must land on `MeesCode/TinyBit-lib` first; this repo then bumps the submodule pointer to the new commit. The encoder/decoder side reuses the constants exposed via `src/encoder/image.rs::COVER_X / COVER_Y`, so updating those Rust constants to `64` keeps the two halves in sync.

The C engine's `decode_pixel_load_cover` reads the new rect automatically once the constant changes. No other engine code references hardcoded `60`. (Verified: `grep -rn "TB_COVER" src/tinybit/` returns only the macro definitions and the single call site.)

### Decoder update

`src/decoder/image.rs::extract_cover_rgba` already reads via `COVER_X / COVER_Y` constants from `src/encoder/image.rs`. Updating those constants is the only change; the decoder logic itself is unchanged.

## Edge cases

| Case | Behavior |
|---|---|
| Title empty (`""`) | Default `untitled` is substituted upstream by `buildCartridge.ts`. Encoder never sees an empty title. (Still: encoder handles empty by drawing nothing rather than crashing.) |
| Title is 63 bytes of `W` | `measure("WW…W", 2)` ≈ 63 × 12 = 756 px ≫ 168. Drops to scale 1: 63 × 6 = 378 px ≫ 168. Truncates to ~26 chars + `...` to fit. |
| Author is 63 bytes | Similar truncation against the 200 px budget. |
| Title contains lowercase or non-ASCII | Title is uppercased pre-render. Non-ASCII bytes (`> 0x7e`) become `?` glyphs (printed literally). The header still stores the original UTF-8 string. |
| Author is whitespace-only (`"   "`) | Treated as non-empty; renders `-- BY     --`. Trimming is the caller's responsibility — we don't reach into the user's input. |
| Layout overlaps with steg | Steg writes the low 2 bits of every channel. Title/author are drawn into the high 6 bits and are not affected. Rust-side and decoder round-trip tests will catch any mistake here. |

## Testing

### Pure-Rust (`cargo test`, no wasm needed)

- `font::decode_font` succeeds and yields the expected 4560-byte alpha array.
- `font::measure("ABC", 1) == 18` and `font::measure("ABC", 2) == 36`.
- `font::draw` blits a known glyph (e.g. `A`) at `(10, 10)` and the destination shows the expected pixel pattern. Pixels outside the glyph rect are untouched.
- `layout::fit_title`:
  - Short title at 2× scale (returns input unchanged).
  - Mid title falls back to 1× scale (returns input unchanged, scale=1).
  - Long title truncates with `...` and returns scale=1.
- `layout::fit_author`:
  - Empty → `None`.
  - `"alice"` → `Some("-- BY ALICE --")`.
  - 63-char author → `Some("-- BY ALI...RTH --")`-style truncated string under 200 px.
- `encoder::encode` round-trip: encode a cartridge, decode the produced PNG, assert (a) the title-plate region contains the expected solid yellow at the corners (top 6 bits preserved), (b) the cover region's top 4 bits match the input cover, (c) the steg header bytes recover correctly.

### Smoke (`node scripts/smoke_encoder.mjs`)

Update the existing smoke test to write a title like `"Smoke Test"` and an author like `"CI"`, then visually verify the output PNG (drop it into a viewer / commit a golden image under `editor/public/tinybit_wasm.wasm.test/`). Failing the golden check produces a clear diff.

### Editor (`cd editor && npm test`)

`buildCartridge.test.ts` already exercises the encode path with title/author. Existing assertions still hold; one new test confirms that encoding a long title doesn't error.

### Engine (manual)

After the submodule bump, load a new export in the launcher (the gallery in the editor uses the Rust decoder, not the C engine — so to exercise `decode_pixel_load_cover` we run the engine end-to-end via the existing `scripts/smoke.mjs` flow). Verify the launcher shows the cover at the correct 128×128 size when navigating cartridges.

## Rollout

1. PR on `MeesCode/TinyBit-lib`: bump `TB_COVER_Y` from 60 to 64. Merge.
2. PR on this repo:
   - Bump `src/tinybit` submodule pointer.
   - Update `COVER_Y` in `src/encoder/image.rs` to 64.
   - Add `assets/font_6x8.png` and `assets/cartridge_frame.png`; delete `assets/cartridge3.png`; flip `BUNDLED_FRAME` to point to the new file.
   - Add `src/encoder/font.rs` and `src/encoder/layout.rs`; wire into `encode`.
   - Add tests as above; update existing `encode_round_trip_recovers_header_and_script_crc` test to assert the new cover offset.
   - Update CLAUDE.md if any of the listed Things-To-Know change (none expected).
3. Re-export the bundled demo cartridge so its thumbnail aligns with the new offset.
