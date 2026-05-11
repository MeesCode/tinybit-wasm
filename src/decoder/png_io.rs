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
