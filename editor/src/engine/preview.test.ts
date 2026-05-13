// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { makePreview, PreviewError, type PreviewExports } from './preview';

function makeExports(overrides: Partial<PreviewExports> = {}): PreviewExports {
    const mem = new WebAssembly.Memory({ initial: 1 });
    const written: Uint8Array[] = [];
    const PTR = 16;
    const ex = {
        memory: mem,
        tb_preview_ptr: () => PTR,
        tb_preview_cap: () => 32 * 1024,
        tb_preview_music_play: vi.fn((len: number) => {
            written.push(new Uint8Array(mem.buffer, PTR, len).slice());
            return 0;
        }),
        tb_preview_sfx_play: vi.fn(() => 0),
        tb_preview_stop: vi.fn(() => {}),
        tb_preview_tick: vi.fn(() => {}),
        tb_audio_ptr: () => 1024,
        ...overrides,
    };
    (ex as unknown as { __written: Uint8Array[] }).__written = written;
    return ex as unknown as PreviewExports;
}

describe('makePreview', () => {
    it('trims leading/trailing whitespace and stages UTF-8 bytes', async () => {
        const ex = makeExports();
        const p = makePreview(ex);
        await p.music('\n\nL:1/4\nK:C\nC4\n\n');
        const utf8 = new TextEncoder().encode('L:1/4\nK:C\nC4');
        expect(ex.tb_preview_music_play).toHaveBeenCalledWith(utf8.length);
        expect((ex as unknown as { __written: Uint8Array[] }).__written[0]).toEqual(utf8);
    });

    it('routes sfx() through tb_preview_sfx_play', async () => {
        const ex = makeExports();
        await makePreview(ex).sfx('c/4');
        expect(ex.tb_preview_sfx_play).toHaveBeenCalled();
    });

    it('throws PreviewError with the engine code on negative return', async () => {
        const ex = makeExports({ tb_preview_music_play: vi.fn(() => -1) });
        await expect(makePreview(ex).music('garbage')).rejects.toBeInstanceOf(PreviewError);
        try { await makePreview(ex).music('garbage'); }
        catch (e) {
            expect((e as PreviewError).code).toBe(-1);
        }
    });

    it('throws PreviewError(-1) without staging when input is whitespace only', async () => {
        const ex = makeExports();
        await expect(makePreview(ex).music('   \n  ')).rejects.toBeInstanceOf(PreviewError);
        expect(ex.tb_preview_music_play).not.toHaveBeenCalled();
    });

    it('throws PreviewError(-3) before calling the engine if input exceeds capacity', async () => {
        const ex = makeExports({ tb_preview_cap: () => 8 });
        await expect(makePreview(ex).music('123456789')).rejects.toBeInstanceOf(PreviewError);
        expect(ex.tb_preview_music_play).not.toHaveBeenCalled();
    });

    it('stop() calls tb_preview_stop', () => {
        const ex = makeExports();
        makePreview(ex).stop();
        expect(ex.tb_preview_stop).toHaveBeenCalled();
    });
});
