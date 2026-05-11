import { describe, test, expect, vi } from 'vitest';
import { makeEncoder, EncodeError, SLOT } from './encoder';

function mockExports(outputBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])) {
    const memBuf = new ArrayBuffer(128 * 1024);
    const inputs: Record<number, Uint8Array> = {};
    const inputPtrs: Record<number, number> = {
        [SLOT.COVER]: 0x1000, [SLOT.SPRITE]: 0x2000, [SLOT.SCRIPT]: 0x3000,
        [SLOT.FRAME]: 0x4000, [SLOT.TITLE]: 0x5000, [SLOT.AUTHOR]: 0x5100,
    };
    const inputCaps: Record<number, number> = {
        [SLOT.COVER]: 64 * 1024, [SLOT.SPRITE]: 64 * 1024, [SLOT.SCRIPT]: 64 * 1024,
        [SLOT.FRAME]: 128 * 1024, [SLOT.TITLE]: 64, [SLOT.AUTHOR]: 64,
    };
    const errMsg = new TextEncoder().encode('mock error');
    new Uint8Array(memBuf).set(errMsg, 0x7000);
    new Uint8Array(memBuf).set(outputBytes, 0x8000);
    return {
        inputs, inputPtrs, inputCaps,
        ex: {
            memory: { buffer: memBuf } as WebAssembly.Memory,
            tb_enc_init: vi.fn(() => 1),
            tb_enc_input_ptr: vi.fn((slot: number) => inputPtrs[slot]),
            tb_enc_input_cap: vi.fn((slot: number) => inputCaps[slot]),
            tb_enc_set_input_len: vi.fn((slot: number, len: number) => {
                inputs[slot] = new Uint8Array(memBuf, inputPtrs[slot], len).slice();
            }),
            tb_enc_set_header: vi.fn(() => 1),
            tb_enc_run: vi.fn(() => outputBytes.length),
            tb_enc_output_ptr: vi.fn(() => 0x8000),
            tb_enc_error_ptr: vi.fn(() => 0x7000),
            tb_enc_error_len: vi.fn(() => errMsg.length),
        },
    };
}

describe('encoder', () => {
    test('encode stages all inputs and returns a copy of the output bytes', () => {
        const m = mockExports();
        const enc = makeEncoder(m.ex);
        const cover  = new Uint8Array([1, 2, 3]);
        const sprite = new Uint8Array([4, 5, 6]);
        const script = new TextEncoder().encode('print "hi"');
        const result = enc.encode({ cover, sprite, script, title: 'T', author: 'A' });
        expect(Array.from(result)).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(m.ex.tb_enc_set_input_len).toHaveBeenCalledWith(SLOT.COVER, 3);
        expect(m.ex.tb_enc_set_input_len).toHaveBeenCalledWith(SLOT.SPRITE, 3);
        expect(m.ex.tb_enc_set_input_len).toHaveBeenCalledWith(SLOT.SCRIPT, script.length);
        expect(m.ex.tb_enc_set_input_len).toHaveBeenCalledWith(SLOT.TITLE, 1);
        expect(m.ex.tb_enc_set_input_len).toHaveBeenCalledWith(SLOT.AUTHOR, 1);
        expect(m.ex.tb_enc_set_input_len).toHaveBeenCalledWith(SLOT.FRAME, 0);
    });

    test('encode throws EncodeError when tb_enc_run returns negative', () => {
        const m = mockExports();
        m.ex.tb_enc_run.mockReturnValue(-1);
        const enc = makeEncoder(m.ex);
        let caught: EncodeError | undefined;
        try {
            enc.encode({
                cover:  new Uint8Array([0]),
                sprite: new Uint8Array([0]),
                script: new Uint8Array([0]),
            });
        } catch (e) {
            caught = e as EncodeError;
        }
        expect(caught).toBeInstanceOf(EncodeError);
        expect(caught!.code).toBe(-1);
        expect(caught!.message).toContain('mock error');
    });

    test('encode passes frameOverride when provided', () => {
        const m = mockExports();
        const enc = makeEncoder(m.ex);
        enc.encode({
            cover:  new Uint8Array([1]),
            sprite: new Uint8Array([1]),
            script: new Uint8Array([1]),
            frameOverride: new Uint8Array([9, 9]),
        });
        expect(m.ex.tb_enc_set_input_len).toHaveBeenCalledWith(SLOT.FRAME, 2);
    });

    test('encode rejects title or author longer than 63 UTF-8 bytes pre-call', () => {
        const m = mockExports();
        const enc = makeEncoder(m.ex);
        const longTitle = 'x'.repeat(64);
        expect(() =>
            enc.encode({
                cover:  new Uint8Array([1]),
                sprite: new Uint8Array([1]),
                script: new Uint8Array([1]),
                title:  longTitle,
            }),
        ).toThrow(/title/i);
    });
});
