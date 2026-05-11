import { describe, test, expect } from 'vitest';
import { makeHistory } from './history';

const rect = { x: 1, y: 1, w: 2, h: 2 };

describe('history', () => {
    test('push/undo restores before; redo restores after', () => {
        const buf = new Uint8Array(128 * 128 * 4);
        buf[5] = 9;
        const h = makeHistory(50);
        h.push({ rect, before: new Uint8Array(2*2*4), after: new Uint8Array([1,2,3,4, 5,6,7,8, 9,10,11,12, 13,14,15,16]) });
        for (let i = 0; i < 16; i++) buf[i] = i + 1;
        h.undo((p) => { for (let i = 0; i < 16; i++) buf[i] = p.before[i]; });
        expect(buf[0]).toBe(0);
        h.redo((p) => { for (let i = 0; i < 16; i++) buf[i] = p.after[i]; });
        expect(buf[0]).toBe(1);
    });

    test('new push clears redo', () => {
        const h = makeHistory(50);
        h.push({ rect, before: new Uint8Array(16), after: new Uint8Array(16) });
        h.undo(() => {});
        expect(h.canRedo()).toBe(true);
        h.push({ rect, before: new Uint8Array(16), after: new Uint8Array(16) });
        expect(h.canRedo()).toBe(false);
    });

    test('cap evicts oldest', () => {
        const h = makeHistory(3);
        for (let i = 0; i < 5; i++) h.push({ rect, before: new Uint8Array(16), after: new Uint8Array(16) });
        expect(h.undoDepth()).toBe(3);
    });

    test('undo/redo no-ops on empty stacks', () => {
        const h = makeHistory(50);
        expect(() => h.undo(() => { throw new Error('should not be called'); })).not.toThrow();
        expect(() => h.redo(() => { throw new Error('should not be called'); })).not.toThrow();
    });
});
