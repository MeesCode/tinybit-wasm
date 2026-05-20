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
    let bytes = text.as_bytes();
    let ellipsis = "...";
    let mut end = bytes.len();
    loop {
        let mut candidate = String::with_capacity(end + 3);
        candidate.push_str(&text[..end]);
        candidate.push_str(ellipsis);
        if measure(&candidate, scale) <= max_w {
            return candidate;
        }
        if end == 0 {
            return ellipsis.to_string();
        }
        end -= 1;
        // Snap past UTF-8 continuation bytes so &text[..end] is always a char boundary.
        while end > 0 && (bytes[end] & 0xC0) == 0x80 {
            end -= 1;
        }
    }
}

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
        // Snap past UTF-8 continuation bytes so &up[..end] is always a char boundary.
        while end > 0 && (bytes[end] & 0xC0) == 0x80 {
            end -= 1;
        }
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

    #[test]
    fn fit_title_multibyte_utf8_truncates_without_panicking() {
        // 30 two-byte chars (60 UTF-8 bytes — within the 63-byte HeaderStringOverflow
        // guard). Each char's `measure()` counts it as two glyph cells (one '?' per
        // byte), so total width at 1× = 60 × 6 = 360 px ≫ 168 → truncation path.
        // Before the UTF-8 boundary snap this panicked with "index ... is not a char
        // boundary".
        let multibyte: String = std::iter::repeat('á').take(30).collect();
        assert_eq!(multibyte.len(), 60);
        let (s, scale) = fit_title(&multibyte);
        assert_eq!(scale, 1);
        assert!(s.ends_with("..."));
        assert!(measure(&s, 1) <= TITLE_PLATE_MAX_W);
    }

    #[test]
    fn fit_author_multibyte_utf8_truncates_without_panicking() {
        let multibyte: String = std::iter::repeat('ñ').take(30).collect();
        let s = fit_author(&multibyte).unwrap();
        assert!(s.starts_with("-- BY "));
        assert!(s.ends_with(" --"));
        assert!(measure(&s, 1) <= AUTHOR_LINE_MAX_W);
    }
}
