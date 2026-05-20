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

vi.mock('../state/persist', () => ({
    loadSketch: vi.fn(() => ({
        script: 'function _draw() end', sprite: null, cover: null, title: 't', author: 'a',
    })),
    saveSketch: vi.fn(),
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

// placeholders use OffscreenCanvas which is unavailable in jsdom — stub them out.
vi.mock('../engine/placeholders', () => ({
    getPlaceholderCover:  vi.fn(async () => new Uint8Array([0xC0, 0xC1])),
    getPlaceholderSprite: vi.fn(async () => new Uint8Array([0x50, 0x51])),
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PlayerRoute', () => {
    test('mode="current" feeds the persisted sketch (no launcher)', async () => {
        render(<PlayerRoute initial="current" />);
        await waitFor(() => expect(tb.start).toHaveBeenCalled());
        expect(tb.init).toHaveBeenCalled();
        // ?play=current feeds the encoded sketch bytes directly.
        expect(tb.feedCartridge).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
        expect(fakeFrameLoop.start).toHaveBeenCalled();
        expect(screen.getByLabelText(/tinybit display/i)).toBeInTheDocument();
    });

    test('mode="gallery" configures the host loader and boots the engine launcher', async () => {
        render(<PlayerRoute initial="gallery" />);
        await waitFor(() => expect(tb.start).toHaveBeenCalled());
        // Launcher mode means tb.init was called but no cartridge was fed up-front;
        // bytes only flow when the engine calls back via js_gameload.
        expect(tb.init).toHaveBeenCalled();
        expect(tb.feedCartridge).not.toHaveBeenCalled();
        // The host imports should now report the gallery the engine can browse.
        expect(gameLoaderImports.js_gamecount()).toBe(1);
        // Triggering js_gameload(0) should feed the corresponding cartridge bytes.
        gameLoaderImports.js_gameload(0);
        expect(tb.feedCartridge).toHaveBeenCalledWith(new Uint8Array([9, 9, 9]));
    });

    test('encode failure renders error card with Back link', async () => {
        (enc.encode as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('encode boom'); });
        render(<PlayerRoute initial="current" />);
        await waitFor(() => expect(screen.getByText(/encode boom/i)).toBeInTheDocument());
        expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
    });

    test('exit from gallery mode restarts the launcher instead of navigating', async () => {
        render(<PlayerRoute initial="gallery" />);
        await waitFor(() => expect(tb.start).toHaveBeenCalled());
        const startCallsBefore = (tb.start as ReturnType<typeof vi.fn>).mock.calls.length;
        await userEvent.click(screen.getByRole('button', { name: /exit player/i }));
        await waitFor(() => {
            expect((tb.start as ReturnType<typeof vi.fn>).mock.calls.length)
                .toBeGreaterThan(startCallsBefore);
        });
        expect(fakeFrameLoop.stop).toHaveBeenCalled();
        expect(tb.stop).toHaveBeenCalled();
    });
});
