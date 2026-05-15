import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadGallery, resetGalleryCacheForTests, type CartridgeModules } from './gallery';
import type { Decoder, DecodedCartridge } from '../engine/decoder';

function fakeDecoded(title: string, author: string, coverByte = 0): DecodedCartridge {
    return {
        title, author,
        sprite: new Uint8Array(128 * 128 * 4),
        // 128×128 RGBA filled with one constant byte so different cartridges produce different data URLs
        cover:  new Uint8Array(128 * 128 * 4).fill(coverByte),
        script: '-- ' + title,
        formatVersion: 1, gameVersion: 1, flags: 0, packageDate: 0, crcOk: true,
    };
}

function fakeDecoder(map: Record<string, DecodedCartridge | Error>): Decoder {
    return {
        decode(bytes) {
            // Distinguish files by the first byte of bytes (tests pass distinct first bytes).
            const key = String(bytes[0]);
            const v = map[key];
            if (v instanceof Error) throw v;
            if (!v) throw new Error(`fakeDecoder: no fixture for key ${key}`);
            return v;
        },
    };
}

function makeFetcher(bytesByUrl: Record<string, Uint8Array>): (url: string) => Promise<Uint8Array> {
    return async (url) => {
        const b = bytesByUrl[url];
        if (!b) throw new Error(`fetcher: no fixture for url ${url}`);
        return b;
    };
}

// jsdom does not implement HTMLCanvasElement.prototype.getContext — stub it.
const stubCtx = {
    createImageData: (w: number, h: number) => ({ data: { set: () => {} }, width: w, height: h }),
    putImageData: () => {},
};
let getContextSpy: ReturnType<typeof vi.spyOn>;
let toDataUrlSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    resetGalleryCacheForTests();
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
        .mockReturnValue(stubCtx as unknown as CanvasRenderingContext2D);
    toDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
        .mockReturnValue('data:image/png;base64,abc');
});

afterEach(() => {
    getContextSpy.mockRestore();
    toDataUrlSpy.mockRestore();
});

describe('loadGallery', () => {
    test('returns an empty result for an empty modules map', async () => {
        const decoder = { decode: vi.fn() } as unknown as Decoder;
        const result = await loadGallery(decoder, {}, async () => new Uint8Array());
        expect(result.entries).toEqual([]);
        expect(result.failures).toEqual([]);
    });

    test('decodes each cartridge and returns entries sorted by path', async () => {
        const modules: CartridgeModules = {
            '../cartridges/zeta.tb.png':  () => Promise.resolve('/zeta.url'),
            '../cartridges/alpha.tb.png': () => Promise.resolve('/alpha.url'),
        };
        const fetcher = makeFetcher({
            '/zeta.url':  new Uint8Array([0x10, 0x00]),
            '/alpha.url': new Uint8Array([0x20, 0x00]),
        });
        const decoder = fakeDecoder({
            '16': fakeDecoded('Zeta',  'Z',  0x10),
            '32': fakeDecoded('Alpha', 'A',  0x20),
        });

        const result = await loadGallery(decoder, modules, fetcher);
        expect(result.failures).toEqual([]);
        expect(result.entries.map((e) => e.title)).toEqual(['Alpha', 'Zeta']);
        expect(result.entries[0].id).toBe('../cartridges/alpha.tb.png');
        expect(result.entries[0].filename).toBe('alpha.tb.png');
        expect(result.entries[0].author).toBe('A');
        expect(result.entries[0].coverUrl.startsWith('data:')).toBe(true);
        expect(result.entries[0].cartridge).toEqual(new Uint8Array([0x20, 0x00]));
    });

    test('decoder failures land in failures, not entries', async () => {
        const modules: CartridgeModules = {
            '../cartridges/good.tb.png': () => Promise.resolve('/g.url'),
            '../cartridges/bad.tb.png':  () => Promise.resolve('/b.url'),
        };
        const fetcher = makeFetcher({
            '/g.url': new Uint8Array([0x01, 0x00]),
            '/b.url': new Uint8Array([0x02, 0x00]),
        });
        const decoder = fakeDecoder({
            '1': fakeDecoded('Good', 'G', 0x01),
            '2': new Error('boom'),
        });

        const result = await loadGallery(decoder, modules, fetcher);
        expect(result.entries.map((e) => e.title)).toEqual(['Good']);
        expect(result.failures).toEqual([
            { id: '../cartridges/bad.tb.png', filename: 'bad.tb.png', message: 'boom' },
        ]);
    });

    test('fetch failures land in failures', async () => {
        const modules: CartridgeModules = {
            '../cartridges/missing.tb.png': () => Promise.resolve('/m.url'),
        };
        const fetcher: (url: string) => Promise<Uint8Array> = async () => {
            throw new Error('network gone');
        };
        const decoder = { decode: vi.fn() } as unknown as Decoder;

        const result = await loadGallery(decoder, modules, fetcher);
        expect(result.entries).toEqual([]);
        expect(result.failures).toEqual([
            { id: '../cartridges/missing.tb.png', filename: 'missing.tb.png', message: 'network gone' },
        ]);
    });

    test('caches results across calls (decoder runs once per cartridge)', async () => {
        const modules: CartridgeModules = {
            '../cartridges/a.tb.png': () => Promise.resolve('/a.url'),
        };
        const fetcher = makeFetcher({ '/a.url': new Uint8Array([0x01, 0x00]) });
        const inner = fakeDecoder({ '1': fakeDecoded('A', '', 0x01) });
        const decode = vi.spyOn(inner, 'decode');

        const r1 = await loadGallery(inner, modules, fetcher);
        const r2 = await loadGallery(inner, modules, fetcher);

        expect(r1).toBe(r2);
        expect(decode).toHaveBeenCalledTimes(1);
    });
});
