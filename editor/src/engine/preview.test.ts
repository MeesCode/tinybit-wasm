// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { makePreview, PreviewError, type PreviewExports } from './preview';

function makeExports(overrides: Partial<PreviewExports> = {}): PreviewExports {
    const mem = new WebAssembly.Memory({ initial: 1 });
    const written: Uint8Array[] = [];
    const PTR = 16;
    return {
        memory: mem,
        tb_preview_ptr: () => PTR,
        tb_preview_cap: () => 32 * 1024,
        tb_preview_music_play: vi.fn((len: number) => {
            written.push(new Uint8Array(mem.buffer, PTR, len).slice());
            return 0;
        }),
        tb_preview_sfx_play: vi.fn(() => 0),
        tb_preview_stop: vi.fn(() => {}),
        ...overrides,
        __written: written,
    } as unknown as PreviewExports & { __written: Uint8Array[] };
}

describe('makePreview', () => {
    it('stages UTF-8 bytes and calls tb_preview_music_play with the byte length', () => {
        const ex = makeExports();
        const p = makePreview(ex);
        p.music('L:1/4\nK:C\nC4');
        const utf8 = new TextEncoder().encode('L:1/4\nK:C\nC4');
        expect(ex.tb_preview_music_play).toHaveBeenCalledWith(utf8.length);
        expect((ex as any).__written[0]).toEqual(utf8);
    });

    it('routes sfx() through tb_preview_sfx_play', () => {
        const ex = makeExports();
        makePreview(ex).sfx('c/4');
        expect(ex.tb_preview_sfx_play).toHaveBeenCalled();
    });

    it('throws PreviewError with the engine code on negative return', () => {
        const ex = makeExports({ tb_preview_music_play: vi.fn(() => -1) });
        expect(() => makePreview(ex).music('garbage')).toThrow(PreviewError);
        try { makePreview(ex).music('garbage'); }
        catch (e) {
            expect((e as PreviewError).code).toBe(-1);
        }
    });

    it('throws PreviewError(-3) before calling the engine if input exceeds capacity', () => {
        const ex = makeExports({ tb_preview_cap: () => 8 });
        expect(() => makePreview(ex).music('123456789')).toThrow(PreviewError);
        expect(ex.tb_preview_music_play).not.toHaveBeenCalled();
    });

    it('stop() calls tb_preview_stop', () => {
        const ex = makeExports();
        makePreview(ex).stop();
        expect(ex.tb_preview_stop).toHaveBeenCalled();
    });
});
