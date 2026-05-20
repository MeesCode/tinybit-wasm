import { describe, test, expect } from 'vitest';
import { pickRoute } from './routing';

describe('pickRoute', () => {
    test('empty search → editor', () => {
        expect(pickRoute('')).toEqual({ kind: 'editor' });
    });

    test('search without play → editor', () => {
        expect(pickRoute('?foo=bar')).toEqual({ kind: 'editor' });
    });

    test('?play (no value) → player gallery', () => {
        expect(pickRoute('?play')).toEqual({ kind: 'player', mode: 'gallery' });
    });

    test('?play=gallery → player gallery', () => {
        expect(pickRoute('?play=gallery')).toEqual({ kind: 'player', mode: 'gallery' });
    });

    test('?play=current → player current', () => {
        expect(pickRoute('?play=current')).toEqual({ kind: 'player', mode: 'current' });
    });

    test('unknown play value falls back to gallery', () => {
        expect(pickRoute('?play=garbage')).toEqual({ kind: 'player', mode: 'gallery' });
    });

    test('extra params ignored', () => {
        expect(pickRoute('?play=current&debug=1')).toEqual({ kind: 'player', mode: 'current' });
    });
});
