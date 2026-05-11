import { describe, test, expect, beforeEach } from 'vitest';
import { useSketchStore, DEFAULT_SCRIPT } from './sketchStore';

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
