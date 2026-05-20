import { describe, test, expect } from 'vitest';
import { shellLayout, PLAYER_BUTTONS } from './shellLayout';

describe('shellLayout', () => {
    test('has an imageUrl and positive intrinsic aspect', () => {
        expect(typeof shellLayout.imageUrl).toBe('string');
        expect(shellLayout.imageUrl.length).toBeGreaterThan(0);
        expect(shellLayout.imageAspect).toBeGreaterThan(0);
    });

    test('screen rect is within 0..100', () => {
        const r = shellLayout.screen;
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.left + r.width).toBeLessThanOrEqual(100);
        expect(r.top + r.height).toBeLessThanOrEqual(100);
    });

    test('all six buttons configured with in-bounds rects', () => {
        for (const name of PLAYER_BUTTONS) {
            const rect = shellLayout.buttons[name];
            expect(rect, `button ${name}`).toBeDefined();
            expect(rect.left).toBeGreaterThanOrEqual(0);
            expect(rect.top).toBeGreaterThanOrEqual(0);
            expect(rect.left + rect.width).toBeLessThanOrEqual(100);
            expect(rect.top + rect.height).toBeLessThanOrEqual(100);
        }
    });

    test('PLAYER_BUTTONS lists exactly the six expected names', () => {
        expect(PLAYER_BUTTONS).toEqual(['up', 'down', 'left', 'right', 'a', 'b']);
    });
});
