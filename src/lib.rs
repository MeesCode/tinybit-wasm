mod bindings;

use core::ffi::{c_char, c_int};
use std::cell::RefCell;
use std::sync::OnceLock;
use std::time::Instant;

use bindings::{
    tinybit_audio_queue_cb, tinybit_gamecount_cb, tinybit_gameload_cb, tinybit_get_ticks_ms_cb,
    tinybit_init, tinybit_log_cb, tinybit_poll_input_cb, tinybit_render_cb, TinyBitMemory,
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
