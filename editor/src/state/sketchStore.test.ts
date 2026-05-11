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
});
