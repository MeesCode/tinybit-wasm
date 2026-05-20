import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerRoute } from './PlayerRoute';
import type { Runtime } from '../engine/runtime';
import type { Tinybit } from '../engine/tinybit';
import type { Encoder } from '../engine/encoder';
import type { Decoder } from '../engine/decoder';
import type { FrameLoop } from '../engine/frameLoop';
import { gameLoaderImports } from '../engine/gameLoader';

const tb: Tinybit = {
    init: vi.fn(), feedCartridge: vi.fn(), start: vi.fn(), stop: vi.fn(),
    loopOnce: vi.fn(), setButton: vi.fn(),
    displayView: () => new Uint16Array(128 * 128),
    audioView:   () => new Int16Array(367),
    takeLuaError: () => null,
};

const enc: Encoder = { encode: vi.fn(() => new Uint8Array([1, 2, 3])) };

const dec: Decoder = {
    decode: vi.fn(() => ({
        title: 'Picked', author: 'M', script: '-- pick', sprite: new Uint8Array(0), cover: new Uint8Array(0),
        formatVersion: 1, gameVersion: 1, flags: 0, packageDate: 0, crcOk: true,
    })),
};

const fakeRuntime: Runtime = {
    wasm: {} as WebAssembly.Instance, memory: {} as WebAssembly.Memory,
    tb, enc, encoderAvailable: true, dec, decoderAvailable: true,
    spritesheet: { fullReload: vi.fn(), setRunningPredicate: vi.fn() } as never,
    preview: { music: vi.fn(), sfx: vi.fn(), stop: vi.fn() } as never,
    previewAvailable: false,
};

const fakeFrameLoop: FrameLoop = {
    start: vi.fn(() => Promise.resolve()),
    stop:  vi.fn(),
    state: () => 'idle',
    onStateChange: () => () => {},
    onError:       () => () => {},
    onLuaError:    () => () => {},
};

vi.mock('../engine/runtime', () => ({
    getRuntime: vi.fn(() => Promise.resolve(fakeRuntime)),
}));

vi.mock('../engine/frameLoop', () => ({
    makeFrameLoop: vi.fn(() => fakeFrameLoop),
}));

vi.mock('../state/gallery', () => ({
    loadGallery: vi.fn(() => Promise.resolve({
        entries: [{
            id: 'x', filename: 'x.tb.png', title: 'Cart', author: 'A',
            coverUrl: 'data:,x', cartridge: new Uint8Array([9, 9, 9]),
        }],
        failures: [],
    })),
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PlayerRoute', () => {
    test('boots the engine launcher and configures the host gallery loader', async () => {
        render(<PlayerRoute />);
        await waitFor(() => expect(tb.start).toHaveBeenCalled());
        // Launcher mode: init was called but no cartridge fed up front.
        expect(tb.init).toHaveBeenCalled();
        expect(tb.feedCartridge).not.toHaveBeenCalled();
        expect(fakeFrameLoop.start).toHaveBeenCalled();
        expect(screen.getByLabelText(/tinybit display/i)).toBeInTheDocument();

        // The host imports now report the gallery the engine can browse.
        expect(gameLoaderImports.js_gamecount()).toBe(1);
        gameLoaderImports.js_gameload(0);
        expect(tb.feedCartridge).toHaveBeenCalledWith(new Uint8Array([9, 9, 9]));
    });

    test('Reset restarts the engine launcher', async () => {
        render(<PlayerRoute />);
        await waitFor(() => expect(tb.start).toHaveBeenCalled());
        const startCallsBefore = (tb.start as ReturnType<typeof vi.fn>).mock.calls.length;
        await userEvent.click(screen.getByRole('button', { name: /restart launcher/i }));
        await waitFor(() => {
            expect((tb.start as ReturnType<typeof vi.fn>).mock.calls.length)
                .toBeGreaterThan(startCallsBefore);
        });
        expect(fakeFrameLoop.stop).toHaveBeenCalled();
        expect(tb.stop).toHaveBeenCalled();
    });
});
