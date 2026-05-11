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
