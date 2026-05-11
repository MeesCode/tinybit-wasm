import { describe, test, expect, beforeEach } from 'vitest';
import { useSpriteEditorStore } from './spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('spriteEditorStore', () => {
    test('default state', () => {
        const s = useSpriteEditorStore.getState();
        expect(s.tool).toBe('pencil');
        expect(s.pencilSize).toBe(1);
        expect(s.zoom).toBe(8);
        expect(s.color).toBe(0x000000FF);
    });

    test('setColor snaps to top-4-bits-per-channel', () => {
        useSpriteEditorStore.getState().setColor(0xFFA9B7CC);
        expect(useSpriteEditorStore.getState().color).toBe(0xF0A0B0C0);
    });

    test('setColor prepends to recent and dedupes (most-recent first)', () => {
        const { setColor } = useSpriteEditorStore.getState();
        setColor(0xFF0000FF);
        setColor(0x00FF00FF);
        setColor(0xFF0000FF);
        const r = useSpriteEditorStore.getState().recent;
        expect(r[0]).toBe(0xFF0000FF);
        expect(r.filter((c) => c === 0xFF0000FF).length).toBe(1);
    });

    test('recent caps at 12', () => {
        const { setColor } = useSpriteEditorStore.getState();
        for (let i = 0; i < 20; i++) setColor((i * 0x10101010) >>> 0);
        expect(useSpriteEditorStore.getState().recent.length).toBeLessThanOrEqual(12);
    });

    test('setZoom with anchor updates zoom and shifts pan', () => {
        useSpriteEditorStore.setState({ zoom: 4, pan: { x: 0, y: 0 } });
        useSpriteEditorStore.getState().setZoom(8, { sx: 200, sy: 150, canvasW: 400, canvasH: 400 });
        const z = useSpriteEditorStore.getState().zoom;
        expect(z).toBe(8);
    });

    test('pushPatch clears redo', () => {
        const { pushPatch, undo } = useSpriteEditorStore.getState();
        const rect = { x: 0, y: 0, w: 1, h: 1 };
        pushPatch({ rect, before: new Uint8Array(4), after: new Uint8Array(4) });
        undo(() => {});
        expect(useSpriteEditorStore.getState().redoDepth).toBeGreaterThan(0);
        pushPatch({ rect, before: new Uint8Array(4), after: new Uint8Array(4) });
        expect(useSpriteEditorStore.getState().redoDepth).toBe(0);
    });
});
