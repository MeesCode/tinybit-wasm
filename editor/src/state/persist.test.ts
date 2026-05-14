import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadSketch, saveSketch, SKETCH_KEY, UI_KEY, loadSpriteUi, saveSpriteUi, SPRITE_UI_KEY } from './persist';
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

describe('sprite-ui persistence', () => {
    beforeEach(() => localStorage.clear());

    test('save/load round-trip', () => {
        saveSpriteUi({ tool: 'fill', pencilSize: 4, color: 0xF0A0B0C0, recent: [0xFF0000FF, 0x00FF00FF], showGrid: 'on', showNumbers: 'off' });
        expect(loadSpriteUi()).toEqual({ tool: 'fill', pencilSize: 4, color: 0xF0A0B0C0, recent: [0xFF0000FF, 0x00FF00FF], showGrid: 'on', showNumbers: 'off' });
    });

    test('load returns null on missing key', () => {
        expect(loadSpriteUi()).toBeNull();
    });

    test('load tolerates malformed JSON', () => {
        localStorage.setItem(SPRITE_UI_KEY, 'not json');
        expect(loadSpriteUi()).toBeNull();
    });

    test('save survives quota errors silently', () => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
        expect(() => saveSpriteUi({ tool: 'pencil', pencilSize: 1, color: 0, recent: [], showGrid: 'auto', showNumbers: 'auto' })).not.toThrow();
        Storage.prototype.setItem = orig;
    });
});
