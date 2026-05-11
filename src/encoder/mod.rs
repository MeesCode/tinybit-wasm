//! In-browser cartridge encoder. Pure Rust, no dependence on the C engine.

pub mod header;
pub mod image;
pub mod steg;

pub use header::{pack, HeaderOpts};
