import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useSketchStore } from './sketchStore';
import { loadDemo, DEMO_TITLE, DEMO_AUTHOR, DEMO_SCRIPT } from './demo';
import { encodePixelsToPng } from '../sprite/png';

beforeEach(() => {
    useSketchStore.getState().reset();
    vi.restoreAllMocks();
});

async function makeFakeSpritePng(): Promise<Uint8Array> {
    // A 128×128 transparent RGBA buffer is enough — `loadDemo` only cares
    // that decoding succeeds and populates `spritePixels`.
    const pixels = new Uint8Array(128 * 128 * 4);
    return encodePixelsToPng(pixels);
}

describe('loadDemo', () => {
    test('exposes a non-empty script that contains the music + sfx annotations', () => {
        expect(DEMO_SCRIPT.length).toBeGreaterThan(0);
        expect(DEMO_SCRIPT).toContain('--@music');
        expect(DEMO_SCRIPT).toContain('--@sfx');
        expect(DEMO_TITLE).toBe('Star Catcher');
        expect(DEMO_AUTHOR).toBe('TinyBit');
    });

    test('populates script, title, author synchronously and sprite asynchronously', async () => {
        const png = await makeFakeSpritePng();
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        }) as unknown as Response));

        const warn = vi.fn();
        const sketch = useSketchStore.getState();
        await loadDemo(sketch, warn);

        const s = useSketchStore.getState();
        expect(s.script).toBe(DEMO_SCRIPT);
        expect(s.title).toBe(DEMO_TITLE);
        expect(s.author).toBe(DEMO_AUTHOR);
        expect(s.cover).toBeNull();
        expect(s.sprite).not.toBeNull();
        expect(s.spritePixels).not.toBeNull();
        expect(s.spritePixels!.length).toBe(128 * 128 * 4);
        expect(warn).not.toHaveBeenCalled();
    });

    test('falls back gracefully when the demo sprite fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 404,
            arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response));

        const warn = vi.fn();
        const sketch = useSketchStore.getState();
        await loadDemo(sketch, warn);

        const s = useSketchStore.getState();
        expect(s.script).toBe(DEMO_SCRIPT);   // script still loaded
        expect(s.sprite).toBeNull();          // sprite skipped
        expect(s.spritePixels).toBeNull();
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toMatch(/demo sprite/i);
    });
});
