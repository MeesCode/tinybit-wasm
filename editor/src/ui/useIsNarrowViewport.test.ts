import { describe, test, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsNarrowViewport, NARROW_BREAKPOINT_PX } from './useIsNarrowViewport';
import { stubMatchMedia, restoreMatchMedia } from './testHelpers';

afterEach(() => {
    restoreMatchMedia();
});

describe('useIsNarrowViewport', () => {
    test('exposes the breakpoint constant at 720', () => {
        expect(NARROW_BREAKPOINT_PX).toBe(720);
    });

    test('returns true when the media query matches on mount', () => {
        stubMatchMedia(true);
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(true);
    });

    test('returns false when the media query does not match on mount', () => {
        stubMatchMedia(false);
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(false);
    });

    test('updates when the media query change event fires', () => {
        const stub = stubMatchMedia(false);
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(false);
        act(() => {
            stub.matches = true;
            stub.listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
        });
        expect(result.current).toBe(true);
    });

    test('removes its listener on unmount', () => {
        const stub = stubMatchMedia(false);
        const { unmount } = renderHook(() => useIsNarrowViewport());
        expect(stub.listeners.length).toBe(1);
        unmount();
        expect(stub.listeners.length).toBe(0);
    });

    test('defaults to false when matchMedia is unavailable', () => {
        // No stub installed — matchMedia is undefined in jsdom.
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(false);
    });
});
