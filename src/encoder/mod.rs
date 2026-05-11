//! In-browser cartridge encoder. Pure Rust, no dependence on the C engine.

pub mod header;

pub use header::{pack, HeaderOpts};
