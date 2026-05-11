import { describe, test, expect } from 'vitest';
import { computeOverlay } from './overlay';

describe('computeOverlay', () => {
    test('zoom 1: no grid, no numbers', () => {
        const o = computeOverlay(1, 'auto', 'auto');
        expect(o.showCellGrid).toBe(false);
        expect(o.showPixelGrid).toBe(false);
        expect(o.showCellNumbers).toBe(false);
        expect(o.showPixelNumbers).toBe(false);
    });

    test('zoom 4: only 8×8 grid', () => {
        const o = computeOverlay(4, 'auto', 'auto');
        expect(o.showCellGrid).toBe(true);
        expect(o.showPixelGrid).toBe(false);
        expect(o.showCellNumbers).toBe(false);
    });

    test('zoom 8: 8×8 + faint pixel grid + cell numbers', () => {
        const o = computeOverlay(8, 'auto', 'auto');
        expect(o.showCellGrid).toBe(true);
        expect(o.showPixelGrid).toBe(true);
        expect(o.showCellNumbers).toBe(true);
        expect(o.showPixelNumbers).toBe(false);
    });

    test('zoom 32: everything including per-pixel numbers', () => {
        const o = computeOverlay(32, 'auto', 'auto');
        expect(o.showCellGrid).toBe(true);
        expect(o.showPixelGrid).toBe(true);
        expect(o.showCellNumbers).toBe(true);
        expect(o.showPixelNumbers).toBe(true);
    });

    test('manual override: off forces everything off', () => {
        const o = computeOverlay(32, 'off', 'off');
        expect(o.showCellGrid).toBe(false);
        expect(o.showPixelGrid).toBe(false);
        expect(o.showCellNumbers).toBe(false);
        expect(o.showPixelNumbers).toBe(false);
    });

    test('manual override: on at zoom 1 still shows the grid', () => {
        const o = computeOverlay(1, 'on', 'on');
        expect(o.showCellGrid).toBe(true);
        expect(o.showCellNumbers).toBe(true);
    });
});
