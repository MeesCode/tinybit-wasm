//! In-browser cartridge decoder. Pure Rust, no dependence on the C engine.

pub mod header;
pub mod image;
pub mod png_io;
pub mod steg;

pub use header::HeaderParts;

use crate::encoder::header::HEADER_SIZE;
use crate::encoder::image::{CART_RGBA_LEN, ImageError, SCREEN_RGBA_LEN};
use crate::encoder::header::crc32;
use crate::decoder::image::{decode_cartridge_png, extract_cover_rgba, expand_spritesheet};
use crate::decoder::png_io::{encode_rgba_128x128, PngWriteError};
use crate::decoder::steg::{read_byte, read_spritesheet_byte};

pub const SCRIPT_MAX: usize = crate::encoder::SCRIPT_MAX; // 32 621
pub const PACKED_SPRITE_LEN: usize = SCREEN_RGBA_LEN;      // 65 536

#[derive(Debug, PartialEq, Eq)]
pub enum DecError {
    CartridgePng(&'static str),
    CartridgeSize,
    HeaderVersionMismatch { found: u16 },
    ScriptOverrun,
    PngWrite(&'static str),
}

impl DecError {
    pub fn code(&self) -> i32 {
        match self {
            DecError::CartridgePng(_)                  => -1,
            DecError::CartridgeSize                    => -2,
            DecError::HeaderVersionMismatch { .. }     => -3,
            DecError::ScriptOverrun                    => -4,
            DecError::PngWrite(_)                      => -5,
        }
    }

    pub fn message(&self) -> String {
        match self {
            DecError::CartridgePng(m)   => format!("Cartridge PNG decode failed: {m}"),
            DecError::CartridgeSize     => "Cartridge must be 256x256".to_string(),
            DecError::HeaderVersionMismatch { found } =>
                format!("Unsupported cartridge format_version {found} (this build supports 1)"),
            DecError::ScriptOverrun =>
                "Script overruns cartridge buffer (no NUL terminator in 32622 bytes)".to_string(),
            DecError::PngWrite(m)       => format!("PNG re-encode failed: {m}"),
        }
    }
}

#[derive(Debug)]
pub struct Decoded {
    pub header:     HeaderParts,
    pub script_len: usize, // bytes in script_buf, excludes trailing NUL
    pub crc_ok:     bool,
}

/// Decode a `.tb.png` cartridge into its constituent fields.
///
/// All output buffers are caller-owned scratch buffers (typically members of
/// `DecoderState` in `lib.rs`). This keeps the wasm32 stack small.
#[allow(clippy::too_many_arguments)]
pub fn decode(
    cartridge_png:   &[u8],
    canvas_buf:      &mut [u8; CART_RGBA_LEN],
    packed_sprite:   &mut [u8; PACKED_SPRITE_LEN],
    sprite_rgba:     &mut [u8; SCREEN_RGBA_LEN],
    cover_rgba:      &mut [u8; SCREEN_RGBA_LEN],
    script_buf:      &mut [u8; SCRIPT_MAX],
    sprite_png_out:  &mut Vec<u8>,
    cover_png_out:   &mut Vec<u8>,
) -> Result<Decoded, DecError> {
    // 1. Decode the cartridge PNG.
    decode_cartridge_png(cartridge_png, canvas_buf).map_err(|e| match e {
        ImageError::WrongSize { .. } => DecError::CartridgeSize,
        ImageError::Decode(m)        => DecError::CartridgePng(m),
    })?;

    let mut cursor: usize = 0;

    // 2. Unpack and parse the 146-byte header.
    let mut header_bytes = [0u8; HEADER_SIZE];
    for h in header_bytes.iter_mut() {
        *h = read_byte(canvas_buf, &mut cursor);
    }
    let header = header::parse(&header_bytes);
    if header.format_version != 1 {
        return Err(DecError::HeaderVersionMismatch { found: header.format_version });
    }

    // 3. Unpack the spritesheet (65 536 source bytes, each from 2 dest channels).
    for p in packed_sprite.iter_mut() {
        *p = read_spritesheet_byte(canvas_buf, &mut cursor);
    }
    expand_spritesheet(packed_sprite, sprite_rgba);

    // 4. Unpack the script. The script region is at most 32 622 bytes
    //    (SCRIPT_MAX + 1 trailing NUL). Read up to that many bytes via
    //    read_byte; the first 0x00 terminates.
    let mut script_len = 0usize;
    loop {
        let b = read_byte(canvas_buf, &mut cursor);
        if b == 0 {
            break;
        }
        if script_len >= SCRIPT_MAX {
            return Err(DecError::ScriptOverrun);
        }
        script_buf[script_len] = b;
        script_len += 1;
    }
    // Zero the unused tail of the buffer so the FFI export sees stable bytes.
    for slot in &mut script_buf[script_len..] {
        *slot = 0;
    }

    // 5. CRC check the script (non-fatal; surfaced as crc_ok).
    let crc_ok = crc32(&script_buf[..script_len]) == header.checksum;

    // 6. Crop the cover, re-encode it as a 128×128 PNG.
    extract_cover_rgba(canvas_buf, cover_rgba);
    encode_rgba_128x128(cover_rgba, cover_png_out).map_err(|e| match e {
        PngWriteError::Encode(m) => DecError::PngWrite(m),
    })?;

    // 7. Re-encode the spritesheet as a 128×128 PNG.
    encode_rgba_128x128(sprite_rgba, sprite_png_out).map_err(|e| match e {
        PngWriteError::Encode(m) => DecError::PngWrite(m),
    })?;

    Ok(Decoded { header, script_len, crc_ok })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::{encode as encoder_encode, HeaderOpts};
    use crate::encoder::image::{decode_128x128_rgba, CART_RGBA_LEN, SCREEN_RGBA_LEN};

    fn make_solid_128(rgba: [u8; 4]) -> Vec<u8> {
        let mut buf = Vec::new();
        let mut e = png::Encoder::new(&mut buf, 128, 128);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut w = e.write_header().unwrap();
        let data: Vec<u8> = (0..128 * 128).flat_map(|_| rgba.iter().copied()).collect();
        w.write_image_data(&data).unwrap();
        drop(w);
        buf
    }

    fn run_encode(
        cover_png: &[u8],
        sprite_png: &[u8],
        script: &[u8],
        title: &str,
        author: &str,
        game_version: u16,
        package_date: u32,
    ) -> Vec<u8> {
        let opts = HeaderOpts {
            title, author,
            format_version: 1,
            flags: 0,
            game_version,
            package_date,
        };
        let mut cover_rgba  = [0u8; SCREEN_RGBA_LEN];
        let mut sprite_rgba = [0u8; SCREEN_RGBA_LEN];
        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut out = Vec::new();
        encoder_encode(cover_png, sprite_png, script, None, &opts,
                       &mut cover_rgba, &mut sprite_rgba, canvas_arr, &mut out).unwrap();
        out
    }

    #[test]
    fn decode_recovers_all_header_fields_after_encode() {
        let cover  = make_solid_128([0xC0, 0xC4, 0xC8, 0xFF]);
        let sprite = make_solid_128([0xF0, 0xA0, 0x50, 0xFF]);
        let script: &[u8] = b"function _draw() pset(10, 10, 0xFFFF) end\n";

        let cartridge = run_encode(&cover, &sprite, script, "demo", "alice", 7, 1_700_000_000);

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let d = decode(&cartridge, canvas_arr, packed_arr, sprite_arr, cover_arr,
                       script_arr, &mut sprite_png, &mut cover_png).unwrap();

        assert_eq!(d.header.title, "demo");
        assert_eq!(d.header.author, "alice");
        assert_eq!(d.header.format_version, 1);
        assert_eq!(d.header.game_version, 7);
        assert_eq!(d.header.package_date, 1_700_000_000);
        assert_eq!(d.script_len, script.len());
        assert_eq!(&script_arr[..d.script_len], script);
        assert!(d.crc_ok);

        // Re-decode the sprite PNG and check it's a 128×128 RGBA image whose channels
        // all sit at the 4-bpc quantization values of the input solid (0xF0|0x0F=0xFF
        // etc.). The input was [0xF0, 0xA0, 0x50, 0xFF] — after & 0xF0 then 4→8 expand
        // we get [0xFF, 0xAA, 0x55, 0xFF].
        let mut back_sprite = [0u8; SCREEN_RGBA_LEN];
        decode_128x128_rgba(&sprite_png, &mut back_sprite).unwrap();
        assert_eq!(back_sprite[0], 0xFF);
        assert_eq!(back_sprite[1], 0xAA);
        assert_eq!(back_sprite[2], 0x55);
        assert_eq!(back_sprite[3], 0xFF);

        // Re-decode the cover PNG. Cover pixels survived at 6 bpc. Input was
        // [0xC0, 0xC4, 0xC8, 0xFF]. The steg pipeline overwrites the low 2 bits of
        // every canvas channel with payload data, so we can only assert the top 6 bits.
        let mut back_cover = [0u8; SCREEN_RGBA_LEN];
        decode_128x128_rgba(&cover_png, &mut back_cover).unwrap();
        assert_eq!(back_cover[0] & 0xFC, 0xC0);
        assert_eq!(back_cover[1] & 0xFC, 0xC4);
        assert_eq!(back_cover[2] & 0xFC, 0xC8);
        assert_eq!(back_cover[3] & 0xFC, 0xFC); // alpha 0xFF → top-6 = 0xFC
    }

    #[test]
    fn decode_rejects_wrong_dimensions() {
        let small = make_solid_128([0, 0, 0, 0xFF]); // 128×128, not 256×256

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let err = decode(&small, canvas_arr, packed_arr, sprite_arr, cover_arr,
                         script_arr, &mut sprite_png, &mut cover_png).unwrap_err();
        assert_eq!(err, DecError::CartridgeSize);
        assert_eq!(err.code(), -2);
    }

    /// Build a cartridge whose script bytes don't match the header CRC and
    /// confirm `decode()` succeeds with `crc_ok = false`. We construct the
    /// cartridge from the canvas side (no PNG round-trip), then re-encode
    /// the canvas to PNG so `decode()` sees a real `.tb.png`.
    #[test]
    fn decode_flags_crc_mismatch_as_non_fatal() {
        use crate::encoder::header::pack;
        use crate::encoder::png_io::encode_rgba;
        use crate::encoder::steg::{write_bytes, write_spritesheet};

        // Pack a header that claims the script is "x" (CRC of "x" = 0x8CDC1683),
        // but actually embed "y" into the canvas. CRC will mismatch.
        let opts = HeaderOpts {
            title: "t", author: "",
            format_version: 1, flags: 0, game_version: 1, package_date: 0,
        };
        let header = pack(&opts, b"x");

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut cursor = 0usize;
        write_bytes(canvas_arr, &mut cursor, &header);
        let zero_sprite = [0u8; SCREEN_RGBA_LEN];
        write_spritesheet(canvas_arr, &mut cursor, &zero_sprite);
        write_bytes(canvas_arr, &mut cursor, b"y\0"); // script + NUL

        let mut cartridge = Vec::new();
        encode_rgba(canvas_arr, &mut cartridge).unwrap();

        // Decode it.
        let mut canvas2 = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas2_arr: &mut [u8; CART_RGBA_LEN] = canvas2.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let d = decode(&cartridge, canvas2_arr, packed_arr, sprite_arr, cover_arr,
                       script_arr, &mut sprite_png, &mut cover_png).unwrap();

        assert_eq!(d.script_len, 1);
        assert_eq!(script_arr[0], b'y');
        assert!(!d.crc_ok, "expected crc_ok = false on script/CRC mismatch");
    }

    #[test]
    fn decode_rejects_format_version_other_than_1() {
        use crate::encoder::header::pack;
        use crate::encoder::png_io::encode_rgba;
        use crate::encoder::steg::{write_bytes, write_spritesheet};

        // Forge a header with format_version = 2.
        let opts = HeaderOpts {
            title: "", author: "",
            format_version: 2, flags: 0, game_version: 1, package_date: 0,
        };
        let header = pack(&opts, b"");

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut cursor = 0usize;
        write_bytes(canvas_arr, &mut cursor, &header);
        let zero_sprite = [0u8; SCREEN_RGBA_LEN];
        write_spritesheet(canvas_arr, &mut cursor, &zero_sprite);
        write_bytes(canvas_arr, &mut cursor, &[0u8]); // empty script + NUL

        let mut cartridge = Vec::new();
        encode_rgba(canvas_arr, &mut cartridge).unwrap();

        let mut canvas2 = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas2_arr: &mut [u8; CART_RGBA_LEN] = canvas2.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let err = decode(&cartridge, canvas2_arr, packed_arr, sprite_arr, cover_arr,
                         script_arr, &mut sprite_png, &mut cover_png).unwrap_err();
        assert_eq!(err, DecError::HeaderVersionMismatch { found: 2 });
        assert_eq!(err.code(), -3);
    }

    #[test]
    fn decode_rejects_script_without_nul_terminator() {
        use crate::encoder::header::pack;
        use crate::encoder::png_io::encode_rgba;
        use crate::encoder::steg::{write_bytes, write_spritesheet};

        let opts = HeaderOpts {
            title: "t", author: "",
            format_version: 1, flags: 0, game_version: 1, package_date: 0,
        };
        let header = pack(&opts, b""); // CRC over empty script — irrelevant here

        let mut canvas = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas_arr: &mut [u8; CART_RGBA_LEN] = canvas.as_mut().try_into().unwrap();
        let mut cursor = 0usize;
        write_bytes(canvas_arr, &mut cursor, &header);
        let zero_sprite = [0u8; SCREEN_RGBA_LEN];
        write_spritesheet(canvas_arr, &mut cursor, &zero_sprite);
        // Fill the entire 32_622-byte script region with non-NUL bytes (0xAA).
        let bogus_script = vec![0xAAu8; SCRIPT_MAX + 1]; // 32_622 bytes, no NUL
        write_bytes(canvas_arr, &mut cursor, &bogus_script);

        let mut cartridge = Vec::new();
        encode_rgba(canvas_arr, &mut cartridge).unwrap();

        let mut canvas2 = vec![0u8; CART_RGBA_LEN].into_boxed_slice();
        let canvas2_arr: &mut [u8; CART_RGBA_LEN] = canvas2.as_mut().try_into().unwrap();
        let mut packed = vec![0u8; PACKED_SPRITE_LEN].into_boxed_slice();
        let packed_arr: &mut [u8; PACKED_SPRITE_LEN] = packed.as_mut().try_into().unwrap();
        let mut sprite_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let sprite_arr: &mut [u8; SCREEN_RGBA_LEN] = sprite_rgba.as_mut().try_into().unwrap();
        let mut cover_rgba = vec![0u8; SCREEN_RGBA_LEN].into_boxed_slice();
        let cover_arr: &mut [u8; SCREEN_RGBA_LEN] = cover_rgba.as_mut().try_into().unwrap();
        let mut script_buf = vec![0u8; SCRIPT_MAX].into_boxed_slice();
        let script_arr: &mut [u8; SCRIPT_MAX] = script_buf.as_mut().try_into().unwrap();
        let mut sprite_png = Vec::new();
        let mut cover_png  = Vec::new();

        let err = decode(&cartridge, canvas2_arr, packed_arr, sprite_arr, cover_arr,
                         script_arr, &mut sprite_png, &mut cover_png).unwrap_err();
        assert_eq!(err, DecError::ScriptOverrun);
        assert_eq!(err.code(), -4);
    }
}
