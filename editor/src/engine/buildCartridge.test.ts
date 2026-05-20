import { describe, test, expect, vi } from 'vitest';
import { buildCartridge, type SketchInput } from './buildCartridge';
import { EncodeError, type Encoder } from './encoder';

vi.mock('./placeholders', () => ({
    getPlaceholderCover:  vi.fn(async () => new Uint8Array([0xC0, 0xC1])),
    getPlaceholderSprite: vi.fn(async () => new Uint8Array([0x50, 0x51])),
}));

function makeOkEncoder(): Encoder {
    return {
        encode: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
    };
}

function makeErrEncoder(err: unknown): Encoder {
    return {
        encode: vi.fn(() => { throw err; }),
    };
}

const baseSketch: SketchInput = {
    script: 'function _draw() end',
    sprite: new Uint8Array(10),
    cover:  new Uint8Array(10),
    title:  'demo',
    author: 'me',
};

describe('buildCartridge', () => {
    test('returns ok with bytes when encoder succeeds', async () => {
        const enc = makeOkEncoder();
        const result = await buildCartridge(enc, baseSketch);
        expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4]) });
    });

    test('passes title/author through to encoder', async () => {
        const enc = makeOkEncoder();
        await buildCartridge(enc, baseSketch);
        const call = (enc.encode as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.title).toBe('demo');
        expect(call.author).toBe('me');
    });

    test('substitutes "untitled" for empty title', async () => {
        const enc = makeOkEncoder();
        await buildCartridge(enc, { ...baseSketch, title: '' });
        const call = (enc.encode as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.title).toBe('untitled');
    });

    test('uses placeholder cover/sprite when null', async () => {
        const enc = makeOkEncoder();
        await buildCartridge(enc, { ...baseSketch, cover: null, sprite: null });
        const call = (enc.encode as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.cover).toBeInstanceOf(Uint8Array);
        expect(call.cover.length).toBeGreaterThan(0);
        expect(call.sprite).toBeInstanceOf(Uint8Array);
        expect(call.sprite.length).toBeGreaterThan(0);
    });

    test('returns formatted error for EncodeError', async () => {
        const enc = makeErrEncoder(new EncodeError(7, 'bad input'));
        const result = await buildCartridge(enc, baseSketch);
        expect(result).toEqual({ ok: false, error: 'Encode failed (7): bad input' });
    });

    test('returns generic error for non-EncodeError', async () => {
        const enc = makeErrEncoder(new Error('nope'));
        const result = await buildCartridge(enc, baseSketch);
        expect(result).toEqual({ ok: false, error: 'nope' });
    });
});
