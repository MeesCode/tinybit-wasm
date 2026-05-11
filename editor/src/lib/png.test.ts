import { describe, test, expect } from 'vitest';
import { readPngSize } from './png';

function pngWithIHDR(w: number, h: number): Uint8Array {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdrLen = [0, 0, 0, 13];
    const ihdrType = [0x49, 0x48, 0x44, 0x52];
    const wb = [(w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff];
    const hb = [(h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
    return Uint8Array.from([...sig, ...ihdrLen, ...ihdrType, ...wb, ...hb, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
}

describe('readPngSize', () => {
    test('parses 128x128', () => {
        expect(readPngSize(pngWithIHDR(128, 128))).toEqual({ width: 128, height: 128 });
    });
    test('parses 64x64', () => {
        expect(readPngSize(pngWithIHDR(64, 64))).toEqual({ width: 64, height: 64 });
    });
    test('returns null on a non-PNG buffer', () => {
        expect(readPngSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    });
    test('returns null when IHDR is missing', () => {
        const bad = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(readPngSize(bad)).toBeNull();
    });
});
