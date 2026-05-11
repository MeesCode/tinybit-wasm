//! 146-byte cartridge header + CRC-32 (IEEE 802.3) over the script bytes.

pub struct HeaderOpts<'a> {
    pub title: &'a str,
    pub author: &'a str,
    pub format_version: u16,
    pub flags: u16,
    pub game_version: u16,
    pub package_date: u32,
}

pub const HEADER_SIZE: usize = 146;
pub const TITLE_SIZE: usize = 64;
pub const AUTHOR_SIZE: usize = 64;

/// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320).
/// Matches cartridge_io.c::crc32 byte-for-byte.
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    crc ^ 0xFFFF_FFFF
}

/// Pack header per `struct TinyBitHeader` (little-endian, 146 bytes).
/// Title/author truncated to 63 UTF-8 bytes + trailing NUL.
pub fn pack(opts: &HeaderOpts, script: &[u8]) -> [u8; HEADER_SIZE] {
    debug_assert!(script.len() <= u32::MAX as usize, "script.len() must fit in u32 — caller enforces ≤ 32 621");
    let mut h = [0u8; HEADER_SIZE];

    h[0..2].copy_from_slice(&opts.format_version.to_le_bytes());
    h[2..4].copy_from_slice(&opts.flags.to_le_bytes());
    h[4..8].copy_from_slice(&(script.len() as u32).to_le_bytes());
    h[8..12].copy_from_slice(&crc32(script).to_le_bytes());

    copy_truncated(&mut h[12..(12 + TITLE_SIZE)], opts.title);
    copy_truncated(&mut h[76..(76 + AUTHOR_SIZE)], opts.author);

    h[140..142].copy_from_slice(&opts.game_version.to_le_bytes());
    h[142..146].copy_from_slice(&opts.package_date.to_le_bytes());
    h
}

/// Copies `src` into `dest` zero-padded; the final byte of `dest` is forced to NUL.
/// If `src` is longer than `dest.len() - 1`, it's truncated at the byte level.
/// (We don't try to be UTF-8 boundary-aware — the wasm export rejects strings
/// longer than 63 UTF-8 bytes before they reach here, so truncation here is
/// a defense-in-depth path for the unit tests.)
fn copy_truncated(dest: &mut [u8], src: &str) {
    let limit = dest.len().saturating_sub(1);
    let n = src.as_bytes().len().min(limit);
    dest[..n].copy_from_slice(&src.as_bytes()[..n]);
    if let Some(last) = dest.last_mut() {
        *last = 0;
    }
    // Bytes between n and last stay 0 from the caller's zero-init.
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Canonical CRC-32 (IEEE 802.3) test vectors.
    #[test]
    fn crc32_canonical_vectors() {
        assert_eq!(crc32(b""), 0x00000000);
        assert_eq!(crc32(b"123456789"), 0xCBF43926);
        assert_eq!(crc32(b"The quick brown fox jumps over the lazy dog"), 0x414FA339);
    }

    #[test]
    fn pack_writes_scalars_le() {
        let opts = HeaderOpts {
            title: "hello",
            author: "me",
            format_version: 1,
            flags: 0x1234,
            game_version: 7,
            package_date: 0xDEADBEEF,
        };
        let script = b"print('hi')\n";
        let hdr = pack(&opts, script);

        // format_version LE at offset 0
        assert_eq!(hdr[0], 1);
        assert_eq!(hdr[1], 0);
        // flags LE at offset 2
        assert_eq!(hdr[2], 0x34);
        assert_eq!(hdr[3], 0x12);
        // script_size LE at offset 4
        let ss = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        assert_eq!(ss, script.len() as u32);
        // checksum at offset 8 = crc32(script)
        let cs = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]);
        assert_eq!(cs, crc32(script));
        // title at offset 12, null-padded, last byte forced 0
        assert_eq!(&hdr[12..17], b"hello");
        assert_eq!(hdr[12 + TITLE_SIZE - 1], 0);
        // author at offset 76
        assert_eq!(&hdr[76..78], b"me");
        assert_eq!(hdr[76 + AUTHOR_SIZE - 1], 0);
        // game_version LE at offset 140
        assert_eq!(u16::from_le_bytes([hdr[140], hdr[141]]), 7);
        // package_date LE at offset 142
        assert_eq!(u32::from_le_bytes([hdr[142], hdr[143], hdr[144], hdr[145]]), 0xDEADBEEF);
    }

    #[test]
    fn pack_truncates_oversize_strings_safely() {
        // Title is 70 ASCII bytes, must be truncated to 63 + NUL.
        let long = "a".repeat(70);
        let opts = HeaderOpts {
            title: &long,
            author: "",
            format_version: 1,
            flags: 0,
            game_version: 1,
            package_date: 0,
        };
        let hdr = pack(&opts, b"");
        // First 63 bytes 'a', byte 63 = NUL.
        assert!(hdr[12..(12 + 63)].iter().all(|&b| b == b'a'));
        assert_eq!(hdr[12 + 63], 0);
    }
}
