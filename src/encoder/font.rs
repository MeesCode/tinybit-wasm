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

    #[test]
    fn draw_blits_a_glyph_at_position() {
        use crate::encoder::image::{CART_RGBA_LEN, CART_W};

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();

        draw(arr, "A", 10, 10, 1, [0xFF, 0x80, 0x40]);

        // 'A' row 0 is .###.. starting at x=10, y=10. So x=11..13 should be
        // colored, x=10, x=14, x=15 should be untouched (= 0).
        let row_idx = 10 * CART_W;
        // x=10: untouched
        assert_eq!(arr[(row_idx + 10) * 4], 0);
        // x=11..13: colored
        for x in 11..=13 {
            let p = (row_idx + x) * 4;
            assert_eq!(arr[p],     0xFF);
            assert_eq!(arr[p + 1], 0x80);
            assert_eq!(arr[p + 2], 0x40);
            assert_eq!(arr[p + 3], 0xFF);
        }
        // x=14: untouched (row 0 is .###..)
        assert_eq!(arr[(row_idx + 14) * 4], 0);
        // x=15: untouched (right margin column)
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

        // 'A' row 0 is .###..  -> with x=-2, visible cols are at canvas x=0..3 (originally cols 2..5).
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
}
