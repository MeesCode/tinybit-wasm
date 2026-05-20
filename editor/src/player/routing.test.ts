import { describe, test, expect } from 'vitest';
import { pickRoute } from './routing';

describe('pickRoute', () => {
    test('empty search → editor', () => {
        expect(pickRoute('')).toEqual({ kind: 'editor' });
    });

    test('search without play → editor', () => {
        expect(pickRoute('?foo=bar')).toEqual({ kind: 'editor' });
    });

    test('?play → player', () => {
        expect(pickRoute('?play')).toEqual({ kind: 'player' });
    });

    test('?play with any value → player (value ignored)', () => {
        expect(pickRoute('?play=gallery')).toEqual({ kind: 'player' });
        expect(pickRoute('?play=garbage')).toEqual({ kind: 'player' });
        expect(pickRoute('?play=current')).toEqual({ kind: 'player' });
    });

    test('extra params ignored', () => {
        expect(pickRoute('?play&debug=1')).toEqual({ kind: 'player' });
    });
});
