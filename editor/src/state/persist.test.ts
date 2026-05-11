import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadSketch, saveSketch, SKETCH_KEY } from './persist';
import { DEFAULT_SCRIPT } from './sketchStore';

beforeEach(() => localStorage.clear());

describe('persist', () => {
    test('loadSketch returns null when nothing is stored', () => {
        expect(loadSketch()).toBeNull();
    });

    test('saveSketch then loadSketch round-trips all fields', () => {
        const sprite = new Uint8Array([1, 2, 3, 250]);
        const cover  = new Uint8Array([10, 20, 30]);
        saveSketch({ script: 'print "hi"', sprite, cover, title: 't', author: 'a' });
        const loaded = loadSketch();
        expect(loaded).not.toBeNull();
        expect(loaded!.script).toBe('print "hi"');
        expect(loaded!.title).toBe('t');
        expect(loaded!.author).toBe('a');
        expect(Array.from(loaded!.sprite!)).toEqual(Array.from(sprite));
        expect(Array.from(loaded!.cover!)).toEqual(Array.from(cover));
    });

    test('loadSketch returns null on malformed JSON', () => {
        localStorage.setItem(SKETCH_KEY, '{not json');
        expect(loadSketch()).toBeNull();
    });

    test('saveSketch swallows quota errors and reports via the sink', () => {
        const sink = vi.fn();
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        saveSketch({ script: DEFAULT_SCRIPT, sprite: null, cover: null, title: '', author: '' }, sink);
        expect(sink).toHaveBeenCalled();
        spy.mockRestore();
    });
});
