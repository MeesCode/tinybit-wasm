//! Parse the 146-byte cartridge header. Inverse of `encoder::header::pack`.

use crate::encoder::header::{crc32, AUTHOR_SIZE, HEADER_SIZE, TITLE_SIZE};

#[derive(Debug, PartialEq, Eq)]
pub struct HeaderParts {
    pub format_version: u16,
    pub flags:          u16,
    pub script_size:    u32,
    pub checksum:       u32,
    pub title:          String,
    pub author:         String,
    pub game_version:   u16,
    pub package_date:   u32,
}

pub fn parse(bytes: &[u8; HEADER_SIZE]) -> HeaderParts {
    let format_version = u16::from_le_bytes([bytes[0], bytes[1]]);
    let flags          = u16::from_le_bytes([bytes[2], bytes[3]]);
    let script_size    = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let checksum       = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);

    let title  = read_nul_terminated(&bytes[12..12 + TITLE_SIZE]);
    let author = read_nul_terminated(&bytes[76..76 + AUTHOR_SIZE]);

    let game_version = u16::from_le_bytes([bytes[140], bytes[141]]);
    let package_date = u32::from_le_bytes([bytes[142], bytes[143], bytes[144], bytes[145]]);

    HeaderParts {
        format_version, flags, script_size, checksum,
        title, author, game_version, package_date,
    }
}

fn read_nul_terminated(field: &[u8]) -> String {
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).into_owned()
}

pub fn verify_script_crc(script: &[u8], expected: u32) -> bool {
    crc32(script) == expected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoder::header::{pack, HeaderOpts};

    #[test]
    fn parse_round_trips_encoder_pack() {
        let opts = HeaderOpts {
            title: "hello world",
            author: "tester",
            format_version: 1,
            flags: 0xBEEF,
            game_version: 7,
            package_date: 0xDEADBEEF,
        };
        let script = b"function _draw() end\n";
        let packed = pack(&opts, script);
        let parts = parse(&packed);

        assert_eq!(parts.format_version, 1);
        assert_eq!(parts.flags, 0xBEEF);
        assert_eq!(parts.script_size, script.len() as u32);
        assert_eq!(parts.checksum, crc32(script));
        assert_eq!(parts.title, "hello world");
        assert_eq!(parts.author, "tester");
        assert_eq!(parts.game_version, 7);
        assert_eq!(parts.package_date, 0xDEADBEEF);
    }

    #[test]
    fn parse_trims_at_nul_even_with_garbage_after() {
        let mut h = [0xFFu8; HEADER_SIZE];
        // Zero the scalar fields so they parse cleanly.
        h[0..2].copy_from_slice(&1u16.to_le_bytes());
        h[2..4].copy_from_slice(&0u16.to_le_bytes());
        h[4..8].copy_from_slice(&0u32.to_le_bytes());
        h[8..12].copy_from_slice(&0u32.to_le_bytes());
        h[140..142].copy_from_slice(&1u16.to_le_bytes());
        h[142..146].copy_from_slice(&0u32.to_le_bytes());

        // Write "hi\0" into the title field; leave the rest of the field as
        // 0xFF garbage. parse() must stop at the NUL.
        h[12] = b'h';
        h[13] = b'i';
        h[14] = 0;

        let parts = parse(&h);
        assert_eq!(parts.title, "hi");
    }

    #[test]
    fn parse_handles_full_63_byte_title_without_overflow() {
        // Title fills 63 ASCII bytes; byte 63 is NUL by convention.
        let long = "a".repeat(63);
        let opts = HeaderOpts {
            title: &long,
            author: "",
            format_version: 1, flags: 0, game_version: 1, package_date: 0,
        };
        let packed = pack(&opts, b"");
        let parts = parse(&packed);
        assert_eq!(parts.title, long);
    }

    #[test]
    fn verify_script_crc_matches_encoder() {
        let script = b"print('hi')";
        let cs = crc32(script);
        assert!(verify_script_crc(script, cs));
        assert!(!verify_script_crc(script, cs.wrapping_add(1)));
    }
}
