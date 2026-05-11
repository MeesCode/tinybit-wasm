mod encoder;
mod bindings;

use core::ffi::{c_char, c_int};
use std::cell::RefCell;
use std::sync::OnceLock;
use std::time::Instant;

use bindings::{
    tinybit_audio_queue_cb, tinybit_feed_cartridge, tinybit_gamecount_cb, tinybit_gameload_cb,
    tinybit_get_ticks_ms_cb, tinybit_init, tinybit_log_cb, tinybit_loop, tinybit_poll_input_cb,
    tinybit_render_cb, tinybit_start, tinybit_stop, TinyBitMemory, TB_BUTTON_COUNT,
};

use encoder::header::HeaderOpts;
use encoder::image::{CART_RGBA_LEN, SCREEN_RGBA_LEN};
use encoder::{
    encode as encoder_encode, EncError, AUTHOR_MAX_UTF8, SCRIPT_MAX, TITLE_MAX_UTF8,
};

// Slot indices — kept stable, mirrored on the JS side in encoder.js.
const ENC_SLOT_COVER:  u32 = 0;
const ENC_SLOT_SPRITE: u32 = 1;
const ENC_SLOT_SCRIPT: u32 = 2;
const ENC_SLOT_FRAME:  u32 = 3;
const ENC_SLOT_TITLE:  u32 = 4;
const ENC_SLOT_AUTHOR: u32 = 5;

// Slot capacities. Sized for worst-case PNG payloads of the relevant dimensions
// plus headroom. SCRIPT slot fits the SCRIPT_MAX limit exactly.
const COVER_CAP:  usize = 128 * 1024;
const SPRITE_CAP: usize = 128 * 1024;
const SCRIPT_CAP: usize = SCRIPT_MAX;
const FRAME_CAP:  usize = 512 * 1024; // 256x256 worst-case
const TITLE_CAP:  usize = 64;
const AUTHOR_CAP: usize = 64;
const OUTPUT_CAP: usize = 512 * 1024;

struct EncoderState {
    cover_buf:    Vec<u8>,  // capacity COVER_CAP
    sprite_buf:   Vec<u8>,
    script_buf:   Vec<u8>,
    frame_buf:    Vec<u8>,
    title_buf:    Vec<u8>,
    author_buf:   Vec<u8>,

    cover_len:    usize,
    sprite_len:   usize,
    script_len:   usize,
    frame_len:    usize,
    title_len:    usize,
    author_len:   usize,

    game_version: u16,
    flags:        u16,
    package_date: u32,

    cover_rgba:   Box<[u8; SCREEN_RGBA_LEN]>,
    sprite_rgba:  Box<[u8; SCREEN_RGBA_LEN]>,
    canvas:       Box<[u8; CART_RGBA_LEN]>,

    output:       Vec<u8>,
    error_msg:    Vec<u8>,  // UTF-8 bytes of the last error message
}

impl EncoderState {
    fn new() -> Self {
        Self {
            cover_buf:    vec![0; COVER_CAP],
            sprite_buf:   vec![0; SPRITE_CAP],
            script_buf:   vec![0; SCRIPT_CAP],
            frame_buf:    vec![0; FRAME_CAP],
            title_buf:    vec![0; TITLE_CAP],
            author_buf:   vec![0; AUTHOR_CAP],
            cover_len:    0,
            sprite_len:   0,
            script_len:   0,
            frame_len:    0,
            title_len:    0,
            author_len:   0,
            game_version: 1,
            flags:        0,
            package_date: 0,
            cover_rgba:   Box::new([0; SCREEN_RGBA_LEN]),
            sprite_rgba:  Box::new([0; SCREEN_RGBA_LEN]),
            canvas:       Box::new([0; CART_RGBA_LEN]),
            output:       Vec::with_capacity(OUTPUT_CAP),
            error_msg:    Vec::new(),
        }
    }

    fn slot_ptr_cap_len(&mut self, slot: u32) -> Option<(*mut u8, usize, &mut usize)> {
        match slot {
            ENC_SLOT_COVER  => Some((self.cover_buf.as_mut_ptr(),  self.cover_buf.len(),  &mut self.cover_len)),
            ENC_SLOT_SPRITE => Some((self.sprite_buf.as_mut_ptr(), self.sprite_buf.len(), &mut self.sprite_len)),
            ENC_SLOT_SCRIPT => Some((self.script_buf.as_mut_ptr(), self.script_buf.len(), &mut self.script_len)),
            ENC_SLOT_FRAME  => Some((self.frame_buf.as_mut_ptr(),  self.frame_buf.len(),  &mut self.frame_len)),
            ENC_SLOT_TITLE  => Some((self.title_buf.as_mut_ptr(),  self.title_buf.len(),  &mut self.title_len)),
            ENC_SLOT_AUTHOR => Some((self.author_buf.as_mut_ptr(), self.author_buf.len(), &mut self.author_len)),
            _ => None,
        }
    }
}

thread_local! {
    static ENC_STATE: RefCell<Option<EncoderState>> = const { RefCell::new(None) };
}

const FEED_BUF_SIZE: usize = 256;

struct TinyBitState {
    memory: Box<TinyBitMemory>,
    feed_buf: [u8; FEED_BUF_SIZE],
    started: bool,
}

impl TinyBitState {
    fn new() -> Self {
        Self {
            memory: Box::new(unsafe { core::mem::zeroed() }),
            feed_buf: [0; FEED_BUF_SIZE],
            started: false,
        }
    }
}

thread_local! {
    static STATE: RefCell<Option<TinyBitState>> = const { RefCell::new(None) };
}

static START_INSTANT: OnceLock<Instant> = OnceLock::new();

#[no_mangle]
pub extern "C" fn tb_init() {
    START_INSTANT.get_or_init(Instant::now);

    STATE.with(|cell| {
        let mut state = TinyBitState::new();
        unsafe {
            tinybit_init(state.memory.as_mut() as *mut TinyBitMemory);
            tinybit_log_cb(Some(log_cb));
            tinybit_get_ticks_ms_cb(Some(get_ticks_ms_cb));
            tinybit_render_cb(Some(noop_cb));
            tinybit_poll_input_cb(Some(noop_cb));
            tinybit_audio_queue_cb(Some(noop_cb));
            tinybit_gamecount_cb(Some(gamecount_cb));
            tinybit_gameload_cb(Some(gameload_cb));
        }
        *cell.borrow_mut() = Some(state);
    });
}

unsafe extern "C" fn log_cb(msg: *const c_char) {
    if msg.is_null() {
        return;
    }
    let cstr = core::ffi::CStr::from_ptr(msg);
    let bytes = cstr.to_bytes();
    if bytes.is_empty() {
        return;
    }
    libc::write(2, bytes.as_ptr() as *const _, bytes.len());
}

unsafe extern "C" fn get_ticks_ms_cb() -> c_int {
    let start = START_INSTANT.get_or_init(Instant::now);
    let elapsed = start.elapsed().as_millis();
    elapsed as c_int
}

unsafe extern "C" fn noop_cb() {}

unsafe extern "C" fn gamecount_cb() -> c_int {
    0
}

unsafe extern "C" fn gameload_cb(_idx: c_int) {}

#[no_mangle]
pub extern "C" fn tb_feed_buffer_ptr() -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.feed_buf.as_mut_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_feed_cartridge(len: u32) -> u32 {
    let len = len as usize;
    if len == 0 || len > FEED_BUF_SIZE {
        return 0;
    }
    let mut ok = false;
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ok = unsafe { tinybit_feed_cartridge(state.feed_buf.as_ptr(), len) };
        }
    });
    if ok { 1 } else { 0 }
}

#[no_mangle]
pub extern "C" fn tb_start() -> u32 {
    let mut ok = false;
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ok = unsafe { tinybit_start() };
            state.started = ok;
        }
    });
    if ok { 1 } else { 0 }
}

#[no_mangle]
pub extern "C" fn tb_stop() {
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if state.started {
                unsafe { tinybit_stop() };
                state.started = false;
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_loop_once() {
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            if state.started {
                unsafe { tinybit_loop() };
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_set_button(idx: u32, pressed: u32) {
    if idx >= TB_BUTTON_COUNT {
        return;
    }
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            state.memory.button_input[idx as usize] = if pressed != 0 { 1 } else { 0 };
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_display_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.memory.display.as_ptr() as *const u8;
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_audio_ptr() -> *const i16 {
    let mut ptr: *const i16 = core::ptr::null();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.memory.audio_buffer.as_ptr();
        }
    });
    ptr
}

// ── Encoder FFI ──────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn tb_enc_init() -> u32 {
    ENC_STATE.with(|cell| {
        if cell.borrow().is_some() {
            return 1;
        }
        *cell.borrow_mut() = Some(EncoderState::new());
        1
    })
}

#[no_mangle]
pub extern "C" fn tb_enc_input_ptr(slot: u32) -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if let Some((p, _, _)) = state.slot_ptr_cap_len(slot) {
                ptr = p;
            }
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_enc_input_cap(slot: u32) -> u32 {
    let mut cap: u32 = 0;
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if let Some((_, c, _)) = state.slot_ptr_cap_len(slot) {
                cap = c as u32;
            }
        }
    });
    cap
}

#[no_mangle]
pub extern "C" fn tb_enc_set_input_len(slot: u32, len: u32) -> u32 {
    let mut ok: u32 = 0;
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            if let Some((_, cap, slot_len)) = state.slot_ptr_cap_len(slot) {
                if (len as usize) <= cap {
                    *slot_len = len as usize;
                    ok = 1;
                }
            }
        }
    });
    ok
}

#[no_mangle]
pub extern "C" fn tb_enc_set_header(game_version: u32, flags: u32, package_date: u32) -> u32 {
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            state.game_version = (game_version & 0xFFFF) as u16;
            state.flags        = (flags & 0xFFFF) as u16;
            state.package_date = package_date;
            1
        } else {
            0
        }
    })
}

fn store_error(state: &mut EncoderState, err: &EncError) {
    state.error_msg = err.message().into_bytes();
}

#[no_mangle]
pub extern "C" fn tb_enc_run() -> i32 {
    let mut result: i32 = -6; // default = generic failure if state missing
    ENC_STATE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let Some(state) = borrow.as_mut() else {
            return;
        };

        // Pull slot views.
        let cover  = &state.cover_buf [..state.cover_len];
        let sprite = &state.sprite_buf[..state.sprite_len];
        let script = &state.script_buf[..state.script_len];
        let frame_slice = &state.frame_buf[..state.frame_len];
        let frame: Option<&[u8]> = if state.frame_len > 0 { Some(frame_slice) } else { None };

        let title_bytes  = &state.title_buf [..state.title_len];
        let author_bytes = &state.author_buf[..state.author_len];

        // UTF-8 validation. Returning HeaderStringOverflow for non-UTF-8 too is fine —
        // tooltip on the form requires plain text, and this is the closest existing variant.
        let title  = match core::str::from_utf8(title_bytes)  { Ok(s) => s, Err(_) => { store_error(state, &EncError::HeaderStringOverflow); result = -5; return; } };
        let author = match core::str::from_utf8(author_bytes) { Ok(s) => s, Err(_) => { store_error(state, &EncError::HeaderStringOverflow); result = -5; return; } };
        if title.as_bytes().len() > TITLE_MAX_UTF8 || author.as_bytes().len() > AUTHOR_MAX_UTF8 {
            store_error(state, &EncError::HeaderStringOverflow);
            result = -5;
            return;
        }

        let opts = HeaderOpts {
            title, author,
            format_version: 1,
            flags:          state.flags,
            game_version:   state.game_version,
            package_date:   state.package_date,
        };

        // Split the borrows: copy slot data into owned Vec/slices before calling encode().
        // Because the slot buffers and the rgba/canvas buffers live in the same struct,
        // we must shadow them.
        let cover_owned: Vec<u8>  = cover.to_vec();
        let sprite_owned: Vec<u8> = sprite.to_vec();
        let script_owned: Vec<u8> = script.to_vec();
        let frame_owned: Option<Vec<u8>> = frame.map(|f| f.to_vec());

        let cover_rgba_mut:  &mut [u8; SCREEN_RGBA_LEN] = state.cover_rgba.as_mut();
        let sprite_rgba_mut: &mut [u8; SCREEN_RGBA_LEN] = state.sprite_rgba.as_mut();
        let canvas_mut:      &mut [u8; CART_RGBA_LEN]   = state.canvas.as_mut();

        let r = encoder_encode(
            &cover_owned,
            &sprite_owned,
            &script_owned,
            frame_owned.as_deref(),
            &opts,
            cover_rgba_mut,
            sprite_rgba_mut,
            canvas_mut,
            &mut state.output,
        );

        match r {
            Ok(()) => {
                state.error_msg.clear();
                result = state.output.len() as i32;
            }
            Err(e) => {
                store_error(state, &e);
                result = e.code();
            }
        }
    });
    result
}

#[no_mangle]
pub extern "C" fn tb_enc_output_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.output.as_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_enc_error_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            ptr = state.error_msg.as_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_enc_error_len() -> u32 {
    let mut len: u32 = 0;
    ENC_STATE.with(|cell| {
        if let Some(state) = cell.borrow().as_ref() {
            len = state.error_msg.len() as u32;
        }
    });
    len
}
