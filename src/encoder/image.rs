//! PNG → RGBA8 decode with strict size checks, plus cover-onto-frame composite.

use png::{ColorType, Decoder, Transformations};

/// Cover image position in the 256×256 cartridge canvas.
pub const COVER_X: usize = 64;
pub const COVER_Y: usize = 64;
pub const SCREEN_W: usize = 128;
pub const SCREEN_H: usize = 128;
pub const CART_W: usize = 256;
pub const CART_H: usize = 256;
pub const CART_RGBA_LEN: usize = CART_W * CART_H * 4;     // 262_144
pub const SCREEN_RGBA_LEN: usize = SCREEN_W * SCREEN_H * 4; // 65_536

/// Default frame, embedded at compile time. Replace `assets/cartridge_frame.png`
/// (256×256 RGBA) to change the exported cartridge artwork. The encoder
/// composites the cover at (COVER_X, COVER_Y) and renders title/author text
/// over this frame.
pub const BUNDLED_FRAME: &[u8] = include_bytes!("../../assets/cartridge_frame.png");

#[derive(Debug, PartialEq, Eq)]
pub enum ImageError {
    Decode(&'static str),
    WrongSize { got_w: u32, got_h: u32, want_w: u32, want_h: u32 },
}

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

/// Decode a PNG into a 128×128 RGBA8 buffer (writes into `dest`).
pub fn decode_128x128_rgba(png_bytes: &[u8], dest: &mut [u8; SCREEN_RGBA_LEN]) -> Result<(), ImageError> {
    decode_rgba_exact(png_bytes, SCREEN_W as u32, SCREEN_H as u32, dest)
}

/// Decode a PNG into a 256×256 RGBA8 buffer (writes into `dest`).
pub fn decode_256x256_rgba(png_bytes: &[u8], dest: &mut [u8; CART_RGBA_LEN]) -> Result<(), ImageError> {
    decode_rgba_exact(png_bytes, CART_W as u32, CART_H as u32, dest)
}

/// Composite the cover into the 256×256 canvas at (COVER_X, COVER_Y).
/// `canvas` must already contain the frame artwork.
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
                let v = (x ^ y) as u8;
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

        // Pixel (0,0) of canvas is outside the cover region (cover starts at (64,64)).
        assert_eq!(arr[0], 0xAA);
        // Pixel (64, 64) is top-left of cover region; corresponds to cover (0,0) = 0.
        let canvas_idx = (64 * CART_W + 64) * 4;
        assert_eq!(arr[canvas_idx], 0);
        // Pixel (65, 64) -> cover (1,0) -> cover index 4 (=4 mod 256).
        let canvas_idx2 = (64 * CART_W + 65) * 4;
        assert_eq!(arr[canvas_idx2], 4);
    }
}
