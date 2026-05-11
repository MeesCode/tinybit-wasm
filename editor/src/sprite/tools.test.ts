import { describe, test, expect } from 'vitest';
import { stampBrush, drawLine, floodFill, readPixel } from './tools';

function emptyBuf(): Uint8Array { return new Uint8Array(128 * 128 * 4); }
function px(buf: Uint8Array, x: number, y: number): number[] {
    const o = (y * 128 + x) * 4;
    return [buf[o], buf[o+1], buf[o+2], buf[o+3]];
}

describe('stampBrush', () => {
    test('size 1 writes a single pixel', () => {
        const buf = emptyBuf();
        const r = stampBrush(buf, 10, 10, 1, 0xFF0000FF);
        expect(px(buf, 10, 10)).toEqual([0xFF, 0x00, 0x00, 0xFF]);
        expect(r).toEqual({ x: 10, y: 10, w: 1, h: 1 });
    });

    test('size 3 stamps a 3x3 square centred on the cursor', () => {
        const buf = emptyBuf();
        stampBrush(buf, 10, 10, 3, 0x00FF00FF);
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
                expect(px(buf, 10+dx, 10+dy)).toEqual([0, 0xFF, 0, 0xFF]);
    });

    test('clips at sprite boundary', () => {
        const buf = emptyBuf();
        stampBrush(buf, 0, 0, 3, 0x123456FF);
        expect(px(buf, 0, 0)[3]).toBe(0xFF);
        expect(px(buf, 1, 1)[3]).toBe(0xFF);
    });
});

describe('drawLine', () => {
    test('connected horizontal line', () => {
        const buf = emptyBuf();
        drawLine(buf, 5, 5, 10, 5, 1, 0xFF00FFFF);
        for (let x = 5; x <= 10; x++) expect(px(buf, x, 5)[0]).toBe(0xFF);
    });

    test('45-degree line covers each diagonal step', () => {
        const buf = emptyBuf();
        drawLine(buf, 0, 0, 5, 5, 1, 0xFFFFFFFF);
        for (let i = 0; i <= 5; i++) expect(px(buf, i, i)[3]).toBe(0xFF);
    });
});

describe('floodFill', () => {
    test('fills a contiguous region and stops at colour boundaries', () => {
        const buf = emptyBuf();
        for (let y = 10; y <= 13; y++)
            for (let x = 10; x <= 13; x++) {
                const o = (y * 128 + x) * 4;
                buf[o] = 0xFF; buf[o+3] = 0xFF;
            }
        const rect = floodFill(buf, 0, 0, 0x00FF00FF);
        expect(px(buf, 0, 0)).toEqual([0, 0xFF, 0, 0xFF]);
        expect(px(buf, 11, 11)).toEqual([0xFF, 0, 0, 0xFF]);
        expect(rect).toEqual({ x: 0, y: 0, w: 128, h: 128 });
    });

    test('no-op when target colour already matches', () => {
        const buf = emptyBuf();
        const rect = floodFill(buf, 0, 0, 0x00000000);
        expect(rect).toBeNull();
    });
});

describe('readPixel', () => {
    test('returns packed RGBA', () => {
        const buf = emptyBuf();
        const o = (5 * 128 + 7) * 4;
        buf[o] = 0xAA; buf[o+1] = 0xBB; buf[o+2] = 0xCC; buf[o+3] = 0xDD;
        expect(readPixel(buf, 7, 5)).toBe(0xAABBCCDD >>> 0);
    });
});
