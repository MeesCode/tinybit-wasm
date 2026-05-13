import { describe, expect, it } from 'vitest';

// Runtime construction is exercised by integration tests; this file only checks
// the optional-export probe logic in isolation.
describe('runtime preview probe', () => {
    it('exposes previewAvailable=false when exports are missing', async () => {
        const { __probePreview } = await import('./runtime');
        const r = __probePreview({} as any);
        expect(r.previewAvailable).toBe(false);
        expect(() => r.preview.music('x')).toThrow(/not present/i);
    });

    it('exposes previewAvailable=true when exports are present', async () => {
        const { __probePreview } = await import('./runtime');
        const ex = {
            memory: new WebAssembly.Memory({ initial: 1 }),
            tb_preview_ptr: () => 0,
            tb_preview_cap: () => 32 * 1024,
            tb_preview_music_play: () => 0,
            tb_preview_sfx_play: () => 0,
            tb_preview_stop: () => {},
        };
        const r = __probePreview(ex as any);
        expect(r.previewAvailable).toBe(true);
    });
});
