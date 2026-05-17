import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLuaHeap } from './useLuaHeap';
import type { Runtime } from './runtime';
import type { FrameLoopState } from './frameLoop';

function fakeRuntime(overrides: Partial<Runtime['tb']> = {}): Runtime {
    return {
        wasm: {} as never,
        memory: {} as never,
        tb: {
            init: vi.fn(), feedCartridge: vi.fn(), start: vi.fn(),
            stop: vi.fn(), loopOnce: vi.fn(), setButton: vi.fn(),
            displayView: vi.fn(() => new Uint16Array(0)),
            audioView:   vi.fn(() => new Int16Array(0)),
            ...overrides,
        },
        enc: {} as never, encoderAvailable: false,
        dec: {} as never, decoderAvailable: false,
        spritesheet: {} as never,
        preview: {} as never, previewAvailable: false,
    };
}

describe('useLuaHeap', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(()  => { vi.useRealTimers(); });

    it('returns idle when runtime is null', () => {
        const { result } = renderHook(() => useLuaHeap(null, 'idle'));
        expect(result.current).toEqual({ state: 'idle' });
    });

    it('returns idle when engineState is not "running"', () => {
        const rt = fakeRuntime({ luaMemUsed: () => 100, luaMemCapacity: () => 200 });
        const { result } = renderHook(() => useLuaHeap(rt, 'idle'));
        expect(result.current).toEqual({ state: 'idle' });
    });

    it('returns unavailable when runtime has no luaMemUsed', () => {
        const rt = fakeRuntime();                  // no luaMemUsed
        const { result } = renderHook(() => useLuaHeap(rt, 'running'));
        expect(result.current).toEqual({ state: 'unavailable' });
    });

    it('polls every 250 ms while running and reports live values', () => {
        let used = 1_000;
        const usedSpy = vi.fn(() => used);
        const capSpy  = vi.fn(() => 262_144);
        const rt = fakeRuntime({ luaMemUsed: usedSpy, luaMemCapacity: capSpy });

        const { result } = renderHook(() => useLuaHeap(rt, 'running'));

        // Initial sample happens immediately on mount.
        expect(result.current).toEqual({ state: 'live', used: 1_000, cap: 262_144 });
        expect(usedSpy).toHaveBeenCalledTimes(1);

        used = 2_500;
        act(() => { vi.advanceTimersByTime(250); });
        expect(result.current).toEqual({ state: 'live', used: 2_500, cap: 262_144 });
        expect(usedSpy).toHaveBeenCalledTimes(2);

        used = 9_001;
        act(() => { vi.advanceTimersByTime(250); });
        expect(result.current).toEqual({ state: 'live', used: 9_001, cap: 262_144 });
    });

    it('clears the interval when engineState transitions away from running', () => {
        const usedSpy = vi.fn(() => 100);
        const rt = fakeRuntime({ luaMemUsed: usedSpy, luaMemCapacity: () => 200 });

        const { result, rerender } = renderHook(
            ({ s }) => useLuaHeap(rt, s),
            { initialProps: { s: 'running' as FrameLoopState } },
        );
        expect(result.current).toEqual({ state: 'live', used: 100, cap: 200 });
        expect(usedSpy).toHaveBeenCalledTimes(1);

        rerender({ s: 'idle' as const });
        expect(result.current).toEqual({ state: 'idle' });

        // Advance time — interval should have been cleared, no more calls.
        act(() => { vi.advanceTimersByTime(2_000); });
        expect(usedSpy).toHaveBeenCalledTimes(1);
    });
});
