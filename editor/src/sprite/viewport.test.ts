import { describe, test, expect } from 'vitest';
import { screenToPixel, pixelToScreen, anchoredZoom, ZOOM_LEVELS, nextZoom, prevZoom } from './viewport';

describe('viewport math', () => {
    test('screenToPixel + pixelToScreen round-trip at every zoom', () => {
        for (const zoom of ZOOM_LEVELS) {
            const vp = { zoom, pan: { x: 0, y: 0 } };
            for (const [px, py] of [[0,0],[64,64],[127,127],[5,42]]) {
                const s = pixelToScreen(vp, px, py, 400, 400);
                const p = screenToPixel(vp, s.x, s.y, 400, 400);
                expect(p).toEqual({ x: px, y: py });
            }
        }
    });

    test('screenToPixel returns null for points outside the sprite', () => {
        const vp = { zoom: 1 as const, pan: { x: 0, y: 0 } };
        expect(screenToPixel(vp, -10, -10, 400, 400)).toBeNull();
        expect(screenToPixel(vp, 9999, 9999, 400, 400)).toBeNull();
    });

    test('anchoredZoom keeps the pixel under the cursor in place', () => {
        const vp = { zoom: 4 as const, pan: { x: 0, y: 0 } };
        const before = screenToPixel(vp, 200, 150, 400, 400);
        const next = anchoredZoom(vp, 8, { sx: 200, sy: 150, canvasW: 400, canvasH: 400 });
        const after = screenToPixel(next, 200, 150, 400, 400);
        expect(after).toEqual(before);
    });

    test('nextZoom / prevZoom step the ladder, clamped', () => {
        expect(nextZoom(1)).toBe(2);
        expect(nextZoom(32)).toBe(32);
        expect(prevZoom(2)).toBe(1);
        expect(prevZoom(1)).toBe(1);
    });
});
