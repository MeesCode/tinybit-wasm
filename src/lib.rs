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
