import { describe, test, expect } from 'vitest';
import { makeSpritesheet } from './spritesheet';

function fakeMemory(byteLen = 1024 * 1024) {
    return { buffer: new ArrayBuffer(byteLen) } as unknown as WebAssembly.Memory;
}

describe('spritesheet mirror', () => {
    test('mirror packs RGBA8 → RGBA4444 nibble order matches encoder', () => {
        const mem = fakeMemory();
        const ptr = 1024;
        const view = new Uint16Array(mem.buffer, ptr, 16384);
        const ss = makeSpritesheet({ memory: mem, ptr: () => ptr, isRunning: () => true });
        const pixels = new Uint8Array(128 * 128 * 4);
        pixels[0] = 0xF0; pixels[1] = 0xA0; pixels[2] = 0x10; pixels[3] = 0xFF;
        ss.mirror(pixels, { x: 0, y: 0, w: 1, h: 1 });
        // Packing: ((0xF)<<12) | ((0xA)<<8) | ((0x1)<<4) | 0xF = 0xFA1F
        expect(view[0]).toBe(0xFA1F);
    });

    test('mirror is a no-op when not running', () => {
        const mem = fakeMemory();
        const view = new Uint16Array(mem.buffer, 1024, 16384);
        view[0] = 0xBEEF;
        const ss = makeSpritesheet({ memory: mem, ptr: () => 1024, isRunning: () => false });
        ss.mirror(new Uint8Array(128 * 128 * 4), { x: 0, y: 0, w: 128, h: 128 });
        expect(view[0]).toBe(0xBEEF);
    });

    test('fullReload writes the entire 128×128 regardless of running state', () => {
        const mem = fakeMemory();
        const view = new Uint16Array(mem.buffer, 1024, 16384);
        const ss = makeSpritesheet({ memory: mem, ptr: () => 1024, isRunning: () => false });
        const pixels = new Uint8Array(128 * 128 * 4).fill(0xFF);
        ss.fullReload(pixels);
        expect(view[0]).toBe(0xFFFF);
        expect(view[16383]).toBe(0xFFFF);
    });

    test('isReady returns false when ptr is 0; mirror is silently a no-op', () => {
        const ss = makeSpritesheet({ memory: fakeMemory(), ptr: () => 0, isRunning: () => true });
        expect(ss.isReady()).toBe(false);
        expect(() => ss.mirror(new Uint8Array(128 * 128 * 4), { x: 0, y: 0, w: 1, h: 1 })).not.toThrow();
    });

    test('setRunningPredicate replaces the predicate', () => {
        const mem = fakeMemory();
        const view = new Uint16Array(mem.buffer, 1024, 16384);
        view[0] = 0;
        const ss = makeSpritesheet({ memory: mem, ptr: () => 1024, isRunning: () => false });
        const pixels = new Uint8Array(128 * 128 * 4);
        pixels[0] = 0xFF; pixels[1] = 0xFF; pixels[2] = 0xFF; pixels[3] = 0xFF;
        ss.mirror(pixels, { x: 0, y: 0, w: 1, h: 1 });
        expect(view[0]).toBe(0);   // ignored because not running
        ss.setRunningPredicate(() => true);
        ss.mirror(pixels, { x: 0, y: 0, w: 1, h: 1 });
        expect(view[0]).toBe(0xFFFF);
    });
});
