import { describe, test, expect, vi } from 'vitest';
import { makeDecoder, DecodeError } from './decoder';

function mockExports() {
    const memBuf = new ArrayBuffer(256 * 1024);
    const u8 = new Uint8Array(memBuf);
    const SPRITE_PTR = 0x1000, SPRITE_LEN = 4;
    const COVER_PTR  = 0x2000, COVER_LEN  = 4;
    const SCRIPT_PTR = 0x3000;
    const TITLE_PTR  = 0x4000;
    const AUTHOR_PTR = 0x5000;
    const ERR_PTR    = 0x6000;
    const INPUT_PTR  = 0x10000;

    const spriteBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG magic prefix
    const coverBytes  = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
    const scriptStr   = 'print("hi")';
    const titleStr    = 'roundtrip';
    const authorStr   = 'tester';
    const errStr      = 'mock error';

    u8.set(spriteBytes, SPRITE_PTR);
    u8.set(coverBytes,  COVER_PTR);
    u8.set(new TextEncoder().encode(scriptStr), SCRIPT_PTR);
    u8.set(new TextEncoder().encode(titleStr),  TITLE_PTR);
    u8.set(new TextEncoder().encode(authorStr), AUTHOR_PTR);
    u8.set(new TextEncoder().encode(errStr),    ERR_PTR);

    // bitfield: format=1, flags=0xBEEF, game_version=7, crc_ok=1
    const meta = 1n | (0xBEEFn << 16n) | (7n << 32n) | (1n << 48n);

    return {
        recordedInputLen: 0,
        ex: {
            memory: { buffer: memBuf } as WebAssembly.Memory,
            tb_dec_init: vi.fn(() => 1),
            tb_dec_input_ptr: vi.fn(() => INPUT_PTR),
            tb_dec_input_cap: vi.fn(() => 2 * 1024 * 1024),
            tb_dec_run: vi.fn((_len: number) => 0),
            tb_dec_sprite_ptr: vi.fn(() => SPRITE_PTR), tb_dec_sprite_len: vi.fn(() => SPRITE_LEN),
            tb_dec_cover_ptr:  vi.fn(() => COVER_PTR),  tb_dec_cover_len:  vi.fn(() => COVER_LEN),
            tb_dec_script_ptr: vi.fn(() => SCRIPT_PTR), tb_dec_script_len: vi.fn(() => scriptStr.length),
            tb_dec_title_ptr:  vi.fn(() => TITLE_PTR),  tb_dec_title_len:  vi.fn(() => titleStr.length),
            tb_dec_author_ptr: vi.fn(() => AUTHOR_PTR), tb_dec_author_len: vi.fn(() => authorStr.length),
            tb_dec_meta: vi.fn(() => meta),
            tb_dec_package_date: vi.fn(() => 0xDEADBEEF),
            tb_dec_error_ptr: vi.fn(() => ERR_PTR),
            tb_dec_error_len: vi.fn(() => errStr.length),
        },
        SPRITE_PTR, COVER_PTR, INPUT_PTR, scriptStr, titleStr, authorStr,
    };
}

describe('decoder', () => {
    test('decode reads all fields and returns copies of byte arrays', () => {
        const m = mockExports();
        const d = makeDecoder(m.ex);

        const fakeCart = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0xAA, 0xBB]);
        const result = d.decode(fakeCart);

        // Input staged correctly.
        expect(m.ex.tb_dec_run).toHaveBeenCalledWith(fakeCart.length);

        // Output fields.
        expect(result.title).toBe(m.titleStr);
        expect(result.author).toBe(m.authorStr);
        expect(result.script).toBe(m.scriptStr);
        expect(Array.from(result.sprite)).toEqual([0x89, 0x50, 0x4E, 0x47]);
        expect(Array.from(result.cover)).toEqual([0x89, 0x50, 0x4E, 0x47]);
        expect(result.formatVersion).toBe(1);
        expect(result.flags).toBe(0xBEEF);
        expect(result.gameVersion).toBe(7);
        expect(result.packageDate).toBe(0xDEADBEEF);
        expect(result.crcOk).toBe(true);

        // Output arrays are copies, not views into wasm memory.
        const u8 = new Uint8Array(m.ex.memory.buffer);
        u8[m.SPRITE_PTR] = 0xFF;
        expect(result.sprite[0]).toBe(0x89);
    });

    test('decode throws DecodeError when tb_dec_run is negative', () => {
        const m = mockExports();
        m.ex.tb_dec_run.mockReturnValue(-2);
        const d = makeDecoder(m.ex);
        let caught: DecodeError | undefined;
        try {
            d.decode(new Uint8Array([0]));
        } catch (e) {
            caught = e as DecodeError;
        }
        expect(caught).toBeInstanceOf(DecodeError);
        expect(caught!.code).toBe(-2);
        expect(caught!.message).toContain('mock error');
    });

    test('decode rejects oversized input before staging', () => {
        const m = mockExports();
        m.ex.tb_dec_input_cap.mockReturnValue(8);
        const d = makeDecoder(m.ex);
        expect(() => d.decode(new Uint8Array(100))).toThrow(/too large/i);
        expect(m.ex.tb_dec_run).not.toHaveBeenCalled();
    });
});
