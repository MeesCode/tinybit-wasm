import { describe, test, expect, vi } from 'vitest';
import { makeTinybit } from './tinybit';

function mockExports() {
    const memBuf = new ArrayBuffer(64 * 1024);
    return {
        memory: { buffer: memBuf } as WebAssembly.Memory,
        tb_init: vi.fn(),
        tb_start: vi.fn(() => 1),
        tb_stop: vi.fn(),
        tb_loop_once: vi.fn(),
        tb_set_button: vi.fn(),
        tb_feed_buffer_ptr: vi.fn(() => 1024),
        tb_feed_cartridge: vi.fn(() => 1),
        tb_display_ptr: vi.fn(() => 2048),
        tb_spritesheet_ptr: vi.fn(() => 8192),
        tb_audio_ptr: vi.fn(() => 4096),
        tb_lua_error_msg_ptr: vi.fn(() => 0),
        tb_lua_error_msg_len: vi.fn(() => 0),
        tb_lua_error_trace_ptr: vi.fn(() => 0),
        tb_lua_error_trace_len: vi.fn(() => 0),
        tb_lua_error_clear: vi.fn(),
    };
}

describe('makeTinybit', () => {
    test('feedCartridge writes chunks of up to 256 bytes and stops on a 0 return', () => {
        const ex = mockExports();
        const tb = makeTinybit(ex);
        const bytes = new Uint8Array(600).map((_, i) => i & 0xff);
        tb.feedCartridge(bytes);
        expect(ex.tb_feed_cartridge).toHaveBeenCalledTimes(3);
        expect(ex.tb_feed_cartridge).toHaveBeenNthCalledWith(1, 256);
        expect(ex.tb_feed_cartridge).toHaveBeenNthCalledWith(2, 256);
        expect(ex.tb_feed_cartridge).toHaveBeenNthCalledWith(3, 88);
    });

    test('feedCartridge throws with the byte offset on a 0 return', () => {
        const ex = mockExports();
        ex.tb_feed_cartridge.mockReturnValueOnce(1).mockReturnValueOnce(0);
        const tb = makeTinybit(ex);
        expect(() => tb.feedCartridge(new Uint8Array(300))).toThrow(/offset 256/);
    });

    test('start throws on a 0 return', () => {
        const ex = mockExports();
        ex.tb_start.mockReturnValue(0);
        const tb = makeTinybit(ex);
        expect(() => tb.start()).toThrow(/Engine failed to start/);
    });

    test('setButton coerces booleans', () => {
        const ex = mockExports();
        const tb = makeTinybit(ex);
        tb.setButton(0, true);  expect(ex.tb_set_button).toHaveBeenLastCalledWith(0, 1);
        tb.setButton(0, false); expect(ex.tb_set_button).toHaveBeenLastCalledWith(0, 0);
    });

    test('displayView is a Uint16Array of 128*128 over wasm memory', () => {
        const ex = mockExports();
        const tb = makeTinybit(ex);
        const v = tb.displayView();
        expect(v).toBeInstanceOf(Uint16Array);
        expect(v.length).toBe(128 * 128);
    });
});
