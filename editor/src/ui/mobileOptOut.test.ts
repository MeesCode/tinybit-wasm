import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readMobileEditorOptOut, writeMobileEditorOptOut, MOBILE_OPT_OUT_KEY } from './mobileOptOut';

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('mobileOptOut', () => {
    test('uses the documented storage key', () => {
        expect(MOBILE_OPT_OUT_KEY).toBe('tinybit:editor-on-mobile');
    });

    test('read returns false when nothing is stored', () => {
        expect(readMobileEditorOptOut()).toBe(false);
    });

    test('write sets the flag and read returns true', () => {
        writeMobileEditorOptOut();
        expect(sessionStorage.getItem(MOBILE_OPT_OUT_KEY)).toBe('1');
        expect(readMobileEditorOptOut()).toBe(true);
    });

    test('read returns false when the value is not "1"', () => {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, 'no');
        expect(readMobileEditorOptOut()).toBe(false);
    });

    test('read swallows storage exceptions and returns false', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(readMobileEditorOptOut()).toBe(false);
    });

    test('write swallows storage exceptions silently', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => writeMobileEditorOptOut()).not.toThrow();
    });
});
