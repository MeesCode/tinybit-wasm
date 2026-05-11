import { describe, test, expect } from 'vitest';
import { snapRgba8, packRgba8, unpackRgba8, hsvToRgb, rgbToHsv } from './color';

describe('snapRgba8', () => {
    test('zeroes the low 4 bits of every channel', () => {
        for (let v = 0; v < 256; v++) {
            expect(snapRgba8(v) & 0x0F).toBe(0);
        }
    });
    test('is idempotent', () => {
        for (let v = 0; v < 256; v++) {
            expect(snapRgba8(snapRgba8(v))).toBe(snapRgba8(v));
        }
    });
    test('keeps the top 4 bits intact', () => {
        for (let v = 0; v < 256; v++) {
            expect(snapRgba8(v) >>> 4).toBe(v >>> 4);
        }
    });
});

describe('packRgba8 / unpackRgba8', () => {
    test('round-trip preserves all four channels', () => {
        const samples = [[0,0,0,0], [255,255,255,255], [0xF0,0xA0,0x10,0x80], [128,64,32,255]];
        for (const [r,g,b,a] of samples) {
            const packed = packRgba8(r,g,b,a);
            const u = unpackRgba8(packed);
            expect([u.r,u.g,u.b,u.a]).toEqual([r,g,b,a]);
        }
    });
});

describe('hsvToRgb / rgbToHsv', () => {
    test('round-trips primary colours within 1 unit', () => {
        const cases: Array<[number,number,number]> = [[255,0,0],[0,255,0],[0,0,255],[255,255,255],[0,0,0],[128,128,128]];
        for (const [r,g,b] of cases) {
            const hsv = rgbToHsv(r,g,b);
            const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
            expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1);
            expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1);
            expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1);
        }
    });
});
