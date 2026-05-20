import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFrameLoop } from './frameLoop';
import type { Tinybit } from './tinybit';

function mockTinybit(): Tinybit & { loopOnce: ReturnType<typeof vi.fn> } {
    const display = new Uint16Array(128 * 128);
    const audio = new Int16Array(367);
    return {
        init: vi.fn(),
        feedCartridge: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        loopOnce: vi.fn(),
        setButton: vi.fn(),
        displayView: () => display,
        audioView: () => audio,
        takeLuaError: () => null,
    } as Tinybit & { loopOnce: ReturnType<typeof vi.fn> };
}

describe('makeFrameLoop pacing', () => {
    let nowMs = 0;
    let pendingRaf: ((t: number) => void) | null = null;

    beforeEach(() => {
        nowMs = 0;
        pendingRaf = null;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
        vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
            pendingRaf = cb;
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', () => { pendingRaf = null; });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function step(deltaMs: number) {
        nowMs += deltaMs;
        const cb = pendingRaf;
        pendingRaf = null;
        cb?.(nowMs);
    }

    function fakeCanvas(): HTMLCanvasElement {
        const ctx2d = {
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
            putImageData: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
        return { getContext: () => ctx2d } as unknown as HTMLCanvasElement;
    }

    test('at 120Hz rAF cadence, runs loopOnce on every other frame', async () => {
        const tb = mockTinybit();
        const loop = makeFrameLoop(tb);
        const canvas = fakeCanvas();
        await loop.start(canvas);
        // start scheduled first rAF; advance by 120Hz frames (8.333ms)
        for (let i = 0; i < 20; i++) step(1000 / 120);
        // 20 rAFs at ~8.33ms = ~166ms total → ~10 engine steps
        expect(tb.loopOnce).toHaveBeenCalledTimes(10);
        loop.stop();
    });

    test('at 60Hz rAF cadence, runs loopOnce roughly once per frame', async () => {
        const tb = mockTinybit();
        const loop = makeFrameLoop(tb);
        const canvas = fakeCanvas();
        await loop.start(canvas);
        // Real displays don't deliver frames at exactly 16.666ms; nudge slightly to
        // avoid floating-point underrun.
        for (let i = 0; i < 12; i++) step(1000 / 60 + 0.1);
        expect(tb.loopOnce).toHaveBeenCalledTimes(12);
        loop.stop();
    });

    test('clamps catch-up after a long pause (tab backgrounded)', async () => {
        const tb = mockTinybit();
        const loop = makeFrameLoop(tb);
        const canvas = fakeCanvas();
        await loop.start(canvas);
        // simulate 5-second tab pause then a single rAF tick
        step(5000);
        // should run at most 2 steps (catch-up cap), not 300
        expect(tb.loopOnce).toHaveBeenCalledTimes(2);
        loop.stop();
    });
});

describe('makeFrameLoop audio gesture unlock', () => {
    let resumeSpy: ReturnType<typeof vi.fn>;
    let ctxState: 'suspended' | 'running';
    let connectSpy: ReturnType<typeof vi.fn>;
    let postMessageSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ctxState = 'suspended';
        resumeSpy = vi.fn(() => {
            ctxState = 'running';
            return Promise.resolve();
        });
        connectSpy = vi.fn();
        postMessageSpy = vi.fn();

        class FakeAudioContext {
            destination = {};
            audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
            get state() { return ctxState; }
            resume = resumeSpy;
        }
        class FakeAudioWorkletNode {
            connect = connectSpy;
            port = { postMessage: postMessageSpy };
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.stubGlobal('Blob', class { constructor(_p: unknown[], _o: unknown) {} });
        vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
        vi.stubGlobal('requestAnimationFrame', () => 1);
        vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    function fakeCanvas(): HTMLCanvasElement {
        const ctx2d = {
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
            putImageData: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
        return { getContext: () => ctx2d } as unknown as HTMLCanvasElement;
    }

    test('resumes a suspended AudioContext on the first user gesture', async () => {
        const tb = mockTinybit();
        const loop = makeFrameLoop(tb);
        await loop.start(fakeCanvas());
        expect(resumeSpy).not.toHaveBeenCalled();
        window.dispatchEvent(new Event('pointerdown'));
        expect(resumeSpy).toHaveBeenCalledTimes(1);
        loop.stop();
    });

    test('removes its unlock listeners after the first gesture', async () => {
        const tb = mockTinybit();
        const loop = makeFrameLoop(tb);
        await loop.start(fakeCanvas());
        window.dispatchEvent(new Event('pointerdown'));
        window.dispatchEvent(new Event('pointerdown'));
        window.dispatchEvent(new Event('keydown'));
        window.dispatchEvent(new Event('touchstart'));
        expect(resumeSpy).toHaveBeenCalledTimes(1);
        loop.stop();
    });

    test('does not register unlock listeners when the context is already running', async () => {
        ctxState = 'running';
        const tb = mockTinybit();
        const loop = makeFrameLoop(tb);
        await loop.start(fakeCanvas());
        window.dispatchEvent(new Event('pointerdown'));
        expect(resumeSpy).not.toHaveBeenCalled();
        loop.stop();
    });
});
