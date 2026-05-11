import { describe, test, expect } from 'vitest';
import { decodePngToPixels, encodePixelsToPng } from './png';

describe('png helpers', () => {
    test('round-trip 128×128 buffer preserves the pixel data exactly', async () => {
        const pixels = new Uint8Array(128 * 128 * 4);
        for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31) & 0xFF;
        const png = await encodePixelsToPng(pixels);
        const decoded = await decodePngToPixels(png);
        expect(decoded.width).toBe(128);
        expect(decoded.height).toBe(128);
        expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
    });

    test('decode rejects non-128×128', async () => {
        const tiny = await encodePixelsToPng(new Uint8Array(64 * 64 * 4), 64, 64);
        await expect(decodePngToPixels(tiny)).rejects.toThrow(/128/);
    });

    test('decode rejects malformed input', async () => {
        await expect(decodePngToPixels(new Uint8Array([1,2,3,4]))).rejects.toThrow();
    });
});
