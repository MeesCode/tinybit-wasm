//! In-browser cartridge encoder. Pure Rust, no dependence on the C engine.

pub mod header;
pub mod image;
pub mod png_io;
pub mod steg;

pub use header::HeaderOpts;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::header::{crc32, HEADER_SIZE};
    use crate::encoder::image::{
        decode_256x256_rgba, CART_RGBA_LEN, CART_W, COVER_X, COVER_Y, SCREEN_RGBA_LEN,
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
