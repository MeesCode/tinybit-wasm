//! Encode a 256×256 RGBA8 buffer to a PNG byte stream.

use crate::encoder::image::{CART_H, CART_RGBA_LEN, CART_W};

#[derive(Debug)]
pub enum PngWriteError {
    Encode(&'static str),
}

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
