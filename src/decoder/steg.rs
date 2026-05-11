//! Low-2-bit steganography READERS. Inverse of encoder::steg.

/// Read 1 src byte from 4 dest channels' low 2 bits. Advances cursor by 4.
pub fn read_byte(src: &[u8], cursor: &mut usize) -> u8 {
    let a = src[*cursor]     & 0x3;
    let b = src[*cursor + 1] & 0x3;
    let c = src[*cursor + 2] & 0x3;
    let d = src[*cursor + 3] & 0x3;
    *cursor += 4;
    (a << 6) | (b << 4) | (c << 2) | d
}

/// Read 1 spritesheet byte (top 4 bits only) from 2 dest channels' low 2 bits.
/// Bottom 4 bits of the returned byte are always zero. Advances cursor by 2.
pub fn read_spritesheet_byte(src: &[u8], cursor: &mut usize) -> u8 {
    let a = src[*cursor]     & 0x3;
    let b = src[*cursor + 1] & 0x3;
    *cursor += 2;
    (a << 6) | (b << 4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::steg::{write_bytes, write_spritesheet};

    #[test]
    fn read_byte_round_trips_full_byte_range() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        // The buffer starts with non-zero high bits so we can prove the
        // reader truly ignores them.
        let mut buf = vec![0xF8u8; src.len() * 4];
        let mut wc = 0;
        write_bytes(&mut buf, &mut wc, &src);

        let mut rc = 0;
        for (i, &orig) in src.iter().enumerate() {
            let got = read_byte(&buf, &mut rc);
            assert_eq!(got, orig, "byte {i}: round-trip mismatch");
        }
        assert_eq!(rc, src.len() * 4);
    }

    #[test]
    fn read_spritesheet_byte_recovers_only_top_4_bits() {
        let src: Vec<u8> = (0u32..256).map(|x| x as u8).collect();
        let mut buf = vec![0u8; src.len() * 2];
        let mut wc = 0;
        write_spritesheet(&mut buf, &mut wc, &src);

        let mut rc = 0;
        for (i, &orig) in src.iter().enumerate() {
            let got = read_spritesheet_byte(&buf, &mut rc);
            assert_eq!(got, orig & 0xF0, "byte {i}: top-nibble mismatch");
        }
        assert_eq!(rc, src.len() * 2);
    }

    #[test]
    fn cursor_chains_across_calls() {
        let mut buf = vec![0u8; 16];
        let mut wc = 0;
        write_bytes(&mut buf, &mut wc, &[0xAB, 0xCD]);
        write_spritesheet(&mut buf, &mut wc, &[0xEF]);

        let mut rc = 0;
        assert_eq!(read_byte(&buf, &mut rc), 0xAB);
        assert_eq!(read_byte(&buf, &mut rc), 0xCD);
        assert_eq!(read_spritesheet_byte(&buf, &mut rc), 0xE0);
        assert_eq!(rc, wc);
    }
}
