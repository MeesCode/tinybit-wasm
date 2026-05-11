//! Low-2-bit-per-channel steganography writers.
//!
//! Both functions only overwrite the low 2 bits of each destination byte
//! (preserving `dest[i] & 0xfc`), so the visible cover/frame artwork is
//! untouched. Cursor is a single byte-index that advances sequentially
//! through the cartridge buffer.

/// Encode `src` into `dest` at low-2-bits-per-channel: 1 src byte → 4 dest channels.
pub fn write_bytes(dest: &mut [u8], cursor: &mut usize, src: &[u8]) {
    for &byte in src {
        let a = (byte >> 6) & 0x3;
        let b = (byte >> 4) & 0x3;
        let c = (byte >> 2) & 0x3;
        let d = byte & 0x3;
        dest[*cursor]     = (dest[*cursor]     & 0xfc) | a;
        dest[*cursor + 1] = (dest[*cursor + 1] & 0xfc) | b;
        dest[*cursor + 2] = (dest[*cursor + 2] & 0xfc) | c;
        dest[*cursor + 3] = (dest[*cursor + 3] & 0xfc) | d;
        *cursor += 4;
    }
}

/// Encode `src` into `dest` carrying only the TOP 4 BITS of each src byte.
/// 1 src byte → 2 dest channels. Mirrors `encode_spritesheet` in cartridge_io.c.
pub fn write_spritesheet(dest: &mut [u8], cursor: &mut usize, src: &[u8]) {
    for &byte in src {
        let a = (byte >> 6) & 0x3;
        let b = (byte >> 4) & 0x3;
        dest[*cursor]     = (dest[*cursor]     & 0xfc) | a;
        dest[*cursor + 1] = (dest[*cursor + 1] & 0xfc) | b;
        *cursor += 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip every 0..=255 source byte through write_bytes + the engine's
    /// low-2-bit decode (`(a&3)<<6 | (b&3)<<4 | (c&3)<<2 | (d&3)<<0`).
    #[test]
    fn write_bytes_round_trips_full_byte_range() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        // Initialise dest with non-zero high bits to ensure we preserve them.
        let mut dest = vec![0xF8u8; src.len() * 4]; // top 6 bits = 0b111110
        let mut cursor = 0;
        write_bytes(&mut dest, &mut cursor, &src);
        assert_eq!(cursor, src.len() * 4);

        for (i, &orig) in src.iter().enumerate() {
            let a = dest[i * 4];
            let b = dest[i * 4 + 1];
            let c = dest[i * 4 + 2];
            let d = dest[i * 4 + 3];
            // High 6 bits preserved.
            assert_eq!(a & 0xfc, 0xF8, "byte {i}: high bits clobbered");
            // Engine decode.
            let decoded = ((a & 3) << 6) | ((b & 3) << 4) | ((c & 3) << 2) | (d & 3);
            assert_eq!(decoded, orig, "byte {i}: round-trip mismatch");
        }
    }

    /// write_spritesheet keeps only top 4 bits and packs 1 src byte into 2 channels.
    /// After decoding the resulting 2 channels back into 1 byte
    /// (`(a&3)<<6 | (b&3)<<4`), we should recover `src[i] & 0xF0`.
    #[test]
    fn write_spritesheet_keeps_only_top_4_bits() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        let mut dest = vec![0u8; src.len() * 2];
        let mut cursor = 0;
        write_spritesheet(&mut dest, &mut cursor, &src);
        assert_eq!(cursor, src.len() * 2);

        for (i, &orig) in src.iter().enumerate() {
            let a = dest[i * 2];
            let b = dest[i * 2 + 1];
            let decoded_high_nibble = ((a & 3) << 6) | ((b & 3) << 4);
            assert_eq!(decoded_high_nibble, orig & 0xF0, "byte {i}: top-nibble mismatch");
        }
    }

    #[test]
    fn cursor_advances_across_separate_calls() {
        let mut dest = vec![0u8; 64];
        let mut cursor = 0;
        write_bytes(&mut dest, &mut cursor, &[0xAB]);
        assert_eq!(cursor, 4);
        write_bytes(&mut dest, &mut cursor, &[0xCD]);
        assert_eq!(cursor, 8);
        write_spritesheet(&mut dest, &mut cursor, &[0xEF]);
        assert_eq!(cursor, 10);
    }
}
