import { create } from 'zustand';
import { decodePngToPixels } from '../sprite/png';
import type { DirtyRect } from '../sprite/history';

export const DEFAULT_SCRIPT = `function _draw()
    cls(0x0000)
    spr(0, 60, 60)
end
`;

export interface SketchState {
    script: string;
    sprite: Uint8Array | null;
    cover:  Uint8Array | null;
    title:  string;
    author: string;
    spritePixels: Uint8Array | null;

    setScript(v: string): void;
    setSprite(v: Uint8Array | null): void;
    setCover(v: Uint8Array | null): void;
    setTitle(v: string): void;
    setAuthor(v: string): void;
    loadCartridge(parts: { title: string; author: string; sprite: Uint8Array; cover: Uint8Array; script: string }): void;
    reset(): void;

    setSpriteFromPng(bytes: Uint8Array): Promise<void>;
    setSpritePixel(x: number, y: number, rgba: number): void;
    setSpriteBlock(rect: DirtyRect, src: Uint8Array): void;
    clearSprite(): void;
}

const initial = {
    script: DEFAULT_SCRIPT,
    sprite: null as Uint8Array | null,
    cover:  null as Uint8Array | null,
    title:  '',
    author: '',
    spritePixels: null as Uint8Array | null,
};

const SIZE = 128;

export const useSketchStore = create<SketchState>((set, get) => ({
    ...initial,
    setScript: (v) => set({ script: v }),
    setSprite: (v) => set({ sprite: v }),
    setCover:  (v) => set({ cover: v }),
    setTitle:  (v) => set({ title: v }),
    setAuthor: (v) => set({ author: v }),
    loadCartridge: (parts) => {
        set({
            title:  parts.title,
            author: parts.author,
            sprite: parts.sprite,
            cover:  parts.cover,
            script: parts.script,
        });
        void get().setSpriteFromPng(parts.sprite).catch(() => {});
    },
    reset: () => set({ ...initial }),

    async setSpriteFromPng(bytes) {
        const { pixels } = await decodePngToPixels(bytes);
        set({ sprite: bytes, spritePixels: pixels });
    },
    setSpritePixel(x, y, rgba) {
        const buf = get().spritePixels;
        if (!buf) return;
        const o = (y * SIZE + x) * 4;
        buf[o]     = (rgba >>> 24) & 0xFF;
        buf[o + 1] = (rgba >>> 16) & 0xFF;
        buf[o + 2] = (rgba >>>  8) & 0xFF;
        buf[o + 3] =  rgba         & 0xFF;
        set({ spritePixels: new Uint8Array(buf.buffer) });
    },
    setSpriteBlock(rect, src) {
        const buf = get().spritePixels;
        if (!buf) return;
        let si = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const rowOff = (y * SIZE + rect.x) * 4;
            buf.set(src.subarray(si, si + rect.w * 4), rowOff);
            si += rect.w * 4;
        }
        set({ spritePixels: new Uint8Array(buf.buffer) });
    },
    clearSprite() {
        set({ sprite: null, spritePixels: null });
    },
}));
