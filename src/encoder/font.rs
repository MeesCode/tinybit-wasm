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
