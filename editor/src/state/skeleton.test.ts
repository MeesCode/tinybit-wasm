import { describe, test, expect } from 'vitest';
import { SKELETON_SCRIPT, isUntouchedSkeleton } from './skeleton';

describe('SKELETON_SCRIPT', () => {
    test('contains a _draw function and a hello, world print', () => {
        expect(SKELETON_SCRIPT).toMatch(/function\s+_draw\s*\(/);
        expect(SKELETON_SCRIPT).toMatch(/hello,\s*world/);
    });
});

describe('isUntouchedSkeleton', () => {
    const base = {
        script: SKELETON_SCRIPT,
        sprite: null as Uint8Array | null,
        cover:  null as Uint8Array | null,
        title:  '',
        author: '',
    };

    test('returns true for the literal untouched skeleton', () => {
        expect(isUntouchedSkeleton(base)).toBe(true);
    });

    test('returns false when the script differs', () => {
        expect(isUntouchedSkeleton({ ...base, script: 'function _draw() end' })).toBe(false);
    });

    test('returns false when a sprite has been set', () => {
        expect(isUntouchedSkeleton({ ...base, sprite: new Uint8Array(1) })).toBe(false);
    });

    test('returns false when a cover has been set', () => {
        expect(isUntouchedSkeleton({ ...base, cover: new Uint8Array(1) })).toBe(false);
    });

    test('returns false when title is non-empty', () => {
        expect(isUntouchedSkeleton({ ...base, title: 'Hi' })).toBe(false);
    });

    test('returns false when author is non-empty', () => {
        expect(isUntouchedSkeleton({ ...base, author: 'Me' })).toBe(false);
    });
});
