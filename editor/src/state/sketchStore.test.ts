import { describe, test, expect, beforeEach } from 'vitest';
import { useSketchStore, DEFAULT_SCRIPT } from './sketchStore';
import { encodePixelsToPng } from '../sprite/png';

beforeEach(() => useSketchStore.getState().reset());

describe('sketchStore', () => {
    test('seeds with the default script and empty assets', () => {
        const s = useSketchStore.getState();
        expect(s.script).toBe(DEFAULT_SCRIPT);
        expect(s.sprite).toBeNull();
        expect(s.cover).toBeNull();
        expect(s.title).toBe('');
        expect(s.author).toBe('');
    });

    test('setScript replaces the script', () => {
        useSketchStore.getState().setScript('print("hi")');
        expect(useSketchStore.getState().script).toBe('print("hi")');
    });

    test('setSprite stores the bytes verbatim', () => {
        const bytes = new Uint8Array([1, 2, 3]);
        useSketchStore.getState().setSprite(bytes);
        expect(useSketchStore.getState().sprite).toBe(bytes);
    });

    test('reset returns everything to defaults', () => {
        const { setScript, setSprite, setTitle, reset } = useSketchStore.getState();
        setScript('changed');
        setSprite(new Uint8Array([9]));
        setTitle('foo');
        reset();
        const s = useSketchStore.getState();
        expect(s.script).toBe(DEFAULT_SCRIPT);
        expect(s.sprite).toBeNull();
        expect(s.title).toBe('');
    });

    test('loadCartridge sets all five fields atomically', () => {
        const sprite = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const cover  = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
        useSketchStore.getState().loadCartridge({
            title:  'demo',
            author: 'alice',
            sprite,
            cover,
            script: 'function _draw() end',
        });
        const s = useSketchStore.getState();
        expect(s.title).toBe('demo');
        expect(s.author).toBe('alice');
        expect(s.sprite).toBe(sprite);
        expect(s.cover).toBe(cover);
        expect(s.script).toBe('function _draw() end');
    });
});

describe('sketchStore — spritePixels', () => {
    test('starts null', () => {
        expect(useSketchStore.getState().spritePixels).toBeNull();
    });

    test('setSpriteFromPng populates sprite and spritePixels atomically', async () => {
        const pixels = new Uint8Array(128 * 128 * 4);
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 0xFF; pixels[i + 3] = 0xFF;
        }
        const png = await encodePixelsToPng(pixels);
        await useSketchStore.getState().setSpriteFromPng(png);
        const s = useSketchStore.getState();
        expect(s.sprite).toBe(png);
        expect(s.spritePixels).not.toBeNull();
        expect(s.spritePixels!.length).toBe(128 * 128 * 4);
        expect(s.spritePixels![0]).toBe(0xFF);
    });

    test('setSpritePixel mutates the buffer and replaces the view identity', () => {
        const buf = new Uint8Array(128 * 128 * 4);
        useSketchStore.setState({ spritePixels: buf });
        const before = useSketchStore.getState().spritePixels;
        useSketchStore.getState().setSpritePixel(0, 0, 0xFF00FF00);
        const after = useSketchStore.getState().spritePixels!;
        expect(after).not.toBe(before);
        expect(after.buffer).toBe(buf.buffer);
        expect(after[0]).toBe(0xFF);
    });

    test('clearSprite clears both sprite and spritePixels', () => {
        useSketchStore.setState({ sprite: new Uint8Array([1,2,3]), spritePixels: new Uint8Array(128 * 128 * 4) });
        useSketchStore.getState().clearSprite();
        const s = useSketchStore.getState();
        expect(s.sprite).toBeNull();
        expect(s.spritePixels).toBeNull();
    });
});
