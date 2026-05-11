//! Hand-written FFI bindings for the tinybit C library.
//!
//! Why hand-written: bindgen requires libclang on the host and silently dropped
//! the function declarations on this toolchain combination. The tinybit.h surface
//! is small and stable, so a hand-written equivalent is simpler and avoids the
//! libclang dependency. Layout assertions at the bottom of this file pin the
//! struct layout to the C definition.

#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code)]

use core::ffi::{c_char, c_int};

// --- Public constants (mirror the #defines in tinybit.h) -------------------

pub const TB_SCREEN_WIDTH: usize = 128;
pub const TB_SCREEN_HEIGHT: usize = 128;
pub const TB_AUDIO_SAMPLE_RATE: u32 = 22_000;
pub const TB_AUDIO_FRAME_SAMPLES: usize = 367;
pub const TB_HEADER_SIZE: usize = 146;

pub const TB_MEM_SCRIPT_SIZE: usize = 32 * 1024 - TB_HEADER_SIZE;
pub const TB_MEM_LUA_STATE_SIZE: usize = 256 * 1024;
pub const TB_MEM_AUDIO_DATA_SIZE: usize = 12 * 1024;
pub const TB_MEM_PNGLE_SIZE: usize = 48 * 1024;
pub const TB_MEM_BUTTON_INPUT_SIZE: usize = 8;
pub const TB_MEM_USER_SIZE: usize = 10 * 1024;

// --- TinyBitButton (enum -> c_uint) ----------------------------------------

pub type TinyBitButton = u32;
pub const TB_BUTTON_A: TinyBitButton = 0;
pub const TB_BUTTON_B: TinyBitButton = 1;
pub const TB_BUTTON_UP: TinyBitButton = 2;
pub const TB_BUTTON_DOWN: TinyBitButton = 3;
pub const TB_BUTTON_LEFT: TinyBitButton = 4;
pub const TB_BUTTON_RIGHT: TinyBitButton = 5;
pub const TB_BUTTON_START: TinyBitButton = 6;
pub const TB_BUTTON_SELECT: TinyBitButton = 7;
pub const TB_BUTTON_COUNT: TinyBitButton = 8;

// --- TinyBitMemory (mirrors `struct TinyBitMemory` in tinybit.h) -----------

#[repr(C)]
pub struct TinyBitMemory {
    pub header:       [u8;  TB_HEADER_SIZE],
    pub spritesheet:  [u16; TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT],
    pub display:      [u16; TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT],
    pub script:       [u8;  TB_MEM_SCRIPT_SIZE],
    pub lua_state:    [u8;  TB_MEM_LUA_STATE_SIZE],
    pub audio_data:   [u8;  TB_MEM_AUDIO_DATA_SIZE],
    pub pngle_data:   [u8;  TB_MEM_PNGLE_SIZE],
    pub audio_buffer: [i16; TB_AUDIO_FRAME_SAMPLES],
    pub button_input: [u8;  TB_MEM_BUTTON_INPUT_SIZE],
    pub user:         [u8;  TB_MEM_USER_SIZE],
}

// --- Layout assertions (must match the bindgen-generated offsets) ----------

const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(TinyBitMemory, header)       == 0);
    assert!(offset_of!(TinyBitMemory, spritesheet)  == 146);
    assert!(offset_of!(TinyBitMemory, display)      == 32_914);
    assert!(offset_of!(TinyBitMemory, script)       == 65_682);
    assert!(offset_of!(TinyBitMemory, lua_state)    == 98_304);
    assert!(offset_of!(TinyBitMemory, audio_data)   == 360_448);
    assert!(offset_of!(TinyBitMemory, pngle_data)   == 372_736);
    assert!(offset_of!(TinyBitMemory, audio_buffer) == 421_888);
    assert!(offset_of!(TinyBitMemory, button_input) == 422_622);
    assert!(offset_of!(TinyBitMemory, user)         == 422_630);
    assert!(core::mem::size_of::<TinyBitMemory>()   == 432_870);
};

// --- Callback function pointer types ---------------------------------------

pub type LogCb = unsafe extern "C" fn(msg: *const c_char);
pub type GetTicksMsCb = unsafe extern "C" fn() -> c_int;
pub type RenderCb = unsafe extern "C" fn();
pub type PollInputCb = unsafe extern "C" fn();
pub type AudioQueueCb = unsafe extern "C" fn();
pub type GamecountCb = unsafe extern "C" fn() -> c_int;
pub type GameloadCb = unsafe extern "C" fn(index: c_int);

// --- Foreign function declarations -----------------------------------------

extern "C" {
    pub fn tinybit_init(memory: *mut TinyBitMemory);
    pub fn tinybit_feed_cartridge(cartridge_buffer: *const u8, bytes: usize) -> bool;
    pub fn tinybit_start() -> bool;
    pub fn tinybit_restart() -> bool;
    pub fn tinybit_loop();
    pub fn tinybit_stop();
    pub fn tinybit_sleep(ms: c_int);

    pub fn tinybit_log_cb(cb: Option<LogCb>);
    pub fn tinybit_get_ticks_ms_cb(cb: Option<GetTicksMsCb>);
    pub fn tinybit_render_cb(cb: Option<RenderCb>);
    pub fn tinybit_poll_input_cb(cb: Option<PollInputCb>);
    pub fn tinybit_audio_queue_cb(cb: Option<AudioQueueCb>);
    pub fn tinybit_gamecount_cb(cb: Option<GamecountCb>);
    pub fn tinybit_gameload_cb(cb: Option<GameloadCb>);
}
