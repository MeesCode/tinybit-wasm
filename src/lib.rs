mod encoder;
mod decoder;
mod bindings;

use core::ffi::{c_char, c_int};
use std::cell::RefCell;
use std::sync::OnceLock;
use std::time::Instant;

use bindings::{
    tinybit_audio_queue_cb, tinybit_feed_cartridge, tinybit_gamecount_cb, tinybit_gameload_cb,
    tinybit_get_ticks_ms_cb, tinybit_init, tinybit_log_cb, tinybit_loop,
    tinybit_lua_memory_used, tinybit_poll_input_cb, tinybit_render_cb, tinybit_start,
    tinybit_stop, TinyBitMemory, TB_BUTTON_COUNT,
};

use encoder::header::HeaderOpts;
use encoder::image::{CART_RGBA_LEN, SCREEN_RGBA_LEN};
use encoder::{
    encode as encoder_encode, EncError, AUTHOR_MAX_UTF8, SCRIPT_MAX, TITLE_MAX_UTF8,
};

use decoder::{decode as decoder_decode, DecError, Decoded, SCRIPT_MAX as DEC_SCRIPT_MAX, PACKED_SPRITE_LEN};

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

// ── Decoder state ────────────────────────────────────────────────────────────

const DEC_INPUT_CAP: usize = 2 * 1024 * 1024;

struct DecoderState {
    input_buf:      Vec<u8>,                            // up to DEC_INPUT_CAP
    canvas:         Box<[u8; CART_RGBA_LEN]>,           // 256×256 RGBA scratch
    packed_sprite:  Box<[u8; PACKED_SPRITE_LEN]>,       // 65_536
    sprite_rgba:    Box<[u8; SCREEN_RGBA_LEN]>,         // 65_536
    cover_rgba:     Box<[u8; SCREEN_RGBA_LEN]>,         // 65_536
    script_buf:     Box<[u8; DEC_SCRIPT_MAX]>,          // 32_621
    sprite_png_out: Vec<u8>,
    cover_png_out:  Vec<u8>,

    title_utf8:     Vec<u8>,
    author_utf8:    Vec<u8>,
    script_len:     u32,
    format_version: u16,
    flags:          u16,
    game_version:   u16,
    package_date:   u32,
    crc_ok:         u8,    // 0/1

    error_msg:      Vec<u8>,
}

impl DecoderState {
    fn new() -> Self {
        Self {
            input_buf:      vec![0; DEC_INPUT_CAP],
            canvas:         Box::new([0; CART_RGBA_LEN]),
            packed_sprite:  Box::new([0; PACKED_SPRITE_LEN]),
            sprite_rgba:    Box::new([0; SCREEN_RGBA_LEN]),
            cover_rgba:     Box::new([0; SCREEN_RGBA_LEN]),
            script_buf:     Box::new([0; DEC_SCRIPT_MAX]),
            sprite_png_out: Vec::with_capacity(64 * 1024),
            cover_png_out:  Vec::with_capacity(64 * 1024),
            title_utf8:     Vec::new(),
            author_utf8:    Vec::new(),
            script_len:     0,
            format_version: 0,
            flags:          0,
            game_version:   0,
            package_date:   0,
            crc_ok:         0,
            error_msg:      Vec::new(),
        }
    }
}

thread_local! {
    static DEC_STATE: RefCell<Option<DecoderState>> = const { RefCell::new(None) };
}

fn store_dec_error(state: &mut DecoderState, err: &DecError) {
    state.error_msg = err.message().into_bytes();
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

#[no_mangle]
pub extern "C" fn tb_lua_mem_used() -> u32 {
    let mut used: u32 = 0;
    STATE.with(|cell| {
        if cell.borrow().is_some() {
            used = unsafe { tinybit_lua_memory_used() } as u32;
        }
    });
    used
}

#[no_mangle]
pub extern "C" fn tb_lua_mem_capacity() -> u32 {
    bindings::TB_MEM_LUA_STATE_SIZE as u32
}

#[no_mangle]
pub extern "C" fn tb_spritesheet_ptr() -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.memory.spritesheet.as_mut_ptr() as *mut u8;
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

// ── Decoder FFI ──────────────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn tb_dec_init() -> u32 {
    DEC_STATE.with(|cell| {
        if cell.borrow().is_some() {
            return 1;
        }
        *cell.borrow_mut() = Some(DecoderState::new());
        1
    })
}

#[no_mangle]
pub extern "C" fn tb_dec_input_ptr() -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    DEC_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.input_buf.as_mut_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_dec_input_cap() -> u32 {
    DEC_INPUT_CAP as u32
}

#[no_mangle]
pub extern "C" fn tb_dec_run(len: u32) -> i32 {
    let mut result: i32 = -1;
    DEC_STATE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let Some(state) = borrow.as_mut() else { return; };

        let len = len as usize;
        if len == 0 || len > state.input_buf.len() {
            store_dec_error(state, &DecError::CartridgePng("zero or oversized input"));
            result = DecError::CartridgePng("zero or oversized input").code();
            return;
        }
        let input_owned: Vec<u8> = state.input_buf[..len].to_vec();

        let canvas_mut:        &mut [u8; CART_RGBA_LEN]       = state.canvas.as_mut();
        let packed_mut:        &mut [u8; PACKED_SPRITE_LEN]   = state.packed_sprite.as_mut();
        let sprite_rgba_mut:   &mut [u8; SCREEN_RGBA_LEN]     = state.sprite_rgba.as_mut();
        let cover_rgba_mut:    &mut [u8; SCREEN_RGBA_LEN]     = state.cover_rgba.as_mut();
        let script_buf_mut:    &mut [u8; DEC_SCRIPT_MAX]      = state.script_buf.as_mut();

        match decoder_decode(
            &input_owned,
            canvas_mut, packed_mut, sprite_rgba_mut, cover_rgba_mut, script_buf_mut,
            &mut state.sprite_png_out, &mut state.cover_png_out,
        ) {
            Ok(Decoded { header, script_len, crc_ok }) => {
                state.error_msg.clear();
                state.title_utf8     = header.title.into_bytes();
                state.author_utf8    = header.author.into_bytes();
                state.script_len     = script_len as u32;
                state.format_version = header.format_version;
                state.flags          = header.flags;
                state.game_version   = header.game_version;
                state.package_date   = header.package_date;
                state.crc_ok         = if crc_ok { 1 } else { 0 };
                result = 0;
            }
            Err(e) => {
                store_dec_error(state, &e);
                result = e.code();
            }
        }
    });
    result
}

#[no_mangle]
pub extern "C" fn tb_dec_sprite_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.sprite_png_out.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_sprite_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.sprite_png_out.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_cover_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.cover_png_out.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_cover_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.cover_png_out.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_script_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.script_buf.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_script_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.script_len; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_title_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.title_utf8.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_title_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.title_utf8.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_author_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.author_utf8.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_author_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.author_utf8.len() as u32; }});
    n
}

#[no_mangle]
pub extern "C" fn tb_dec_meta() -> u64 {
    let mut packed: u64 = 0;
    DEC_STATE.with(|cell| {
        if let Some(s) = cell.borrow().as_ref() {
            packed = (s.format_version as u64)
                   | ((s.flags as u64) << 16)
                   | ((s.game_version as u64) << 32)
                   | ((s.crc_ok as u64) << 48);
        }
    });
    packed
}

#[no_mangle]
pub extern "C" fn tb_dec_package_date() -> u32 {
    let mut v: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { v = s.package_date; }});
    v
}

#[no_mangle]
pub extern "C" fn tb_dec_error_ptr() -> *const u8 {
    let mut ptr: *const u8 = core::ptr::null();
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { ptr = s.error_msg.as_ptr(); }});
    ptr
}
#[no_mangle]
pub extern "C" fn tb_dec_error_len() -> u32 {
    let mut n: u32 = 0;
    DEC_STATE.with(|cell| { if let Some(s) = cell.borrow().as_ref() { n = s.error_msg.len() as u32; }});
    n
}

// ── Preview FFI ─────────────────────────────────────────────────────────────
//
// Used by the in-editor Score tab to audition a single ABC string through the
// engine without building or loading a cartridge. Reuses the existing audio
// worklet path (audio_buffer + tb_audio_ptr). The script Lua VM is unaffected.

const PREVIEW_BUF_CAP: usize = 32 * 1024;

struct PreviewState {
    buf: Vec<u8>, // capacity = PREVIEW_BUF_CAP + 1 (room for trailing NUL)
}

impl PreviewState {
    fn new() -> Self {
        Self { buf: vec![0; PREVIEW_BUF_CAP + 1] }
    }
}

thread_local! {
    static PREVIEW_STATE: RefCell<Option<PreviewState>> = const { RefCell::new(None) };
}

fn preview_ensure_init() {
    PREVIEW_STATE.with(|cell| {
        if cell.borrow().is_none() {
            *cell.borrow_mut() = Some(PreviewState::new());
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_preview_ptr() -> *mut u8 {
    preview_ensure_init();
    let mut ptr: *mut u8 = core::ptr::null_mut();
    PREVIEW_STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.buf.as_mut_ptr();
        }
    });
    ptr
}

#[no_mangle]
pub extern "C" fn tb_preview_cap() -> u32 {
    PREVIEW_BUF_CAP as u32
}

fn preview_play(channel: c_int, len: u32, repeat: bool) -> i32 {
    let len = len as usize;
    if len > PREVIEW_BUF_CAP {
        return -3; // oversized
    }
    preview_ensure_init();
    let mut result: i32 = -1;
    PREVIEW_STATE.with(|cell| {
        let mut borrow = cell.borrow_mut();
        let Some(state) = borrow.as_mut() else { return; };
        // UTF-8 validate the prefix.
        if core::str::from_utf8(&state.buf[..len]).is_err() {
            result = -4;
            return;
        }
        // Append trailing NUL so it's a valid C string.
        state.buf[len] = 0;
        // Each preview is a self-contained audition: clear both channels
        // first so leftover state from a prior game cartridge or a previous
        // preview can't bleed in. audio_load_abc only resets the target
        // channel, so without this the other channel keeps playing.
        unsafe { bindings::audio_stop_all(); }
        let rc = unsafe {
            bindings::audio_load_abc(
                channel,
                state.buf.as_ptr() as *const core::ffi::c_char,
                bindings::TB_WAVE_SINE,
                repeat,
            )
        };
        // audio_load_abc returns 0 on success, negative on parser failure.
        result = rc;
    });
    result
}

#[no_mangle]
pub extern "C" fn tb_preview_music_play(len: u32) -> i32 {
    preview_play(bindings::TB_CHANNEL_MUSIC, len, true)
}

#[no_mangle]
pub extern "C" fn tb_preview_sfx_play(len: u32) -> i32 {
    preview_play(bindings::TB_CHANNEL_SFX, len, false)
}

#[no_mangle]
pub extern "C" fn tb_preview_stop() {
    unsafe { bindings::audio_stop_all(); }
}

// Drive one frame of audio synthesis. Used by the Score tab's preview pump
// when the main game frame loop isn't running (otherwise process_audio is
// invoked from inside tinybit_loop). Safe to call any number of times.
#[no_mangle]
pub extern "C" fn tb_preview_tick() {
    unsafe { bindings::process_audio(); }
}
