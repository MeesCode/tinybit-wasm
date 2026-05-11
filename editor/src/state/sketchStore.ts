import { create } from 'zustand';

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
    setScript(v: string): void;
    setSprite(v: Uint8Array | null): void;
    setCover(v: Uint8Array | null): void;
    setTitle(v: string): void;
    setAuthor(v: string): void;
    loadCartridge(parts: { title: string; author: string; sprite: Uint8Array; cover: Uint8Array; script: string }): void;
    reset(): void;
}

const initial = {
    script: DEFAULT_SCRIPT,
    sprite: null,
    cover: null,
    title: '',
    author: '',
};

export const useSketchStore = create<SketchState>((set) => ({
    ...initial,
    setScript: (v) => set({ script: v }),
    setSprite: (v) => set({ sprite: v }),
    setCover:  (v) => set({ cover: v }),
    setTitle:  (v) => set({ title: v }),
    setAuthor: (v) => set({ author: v }),
    loadCartridge: (parts) => set({
        title:  parts.title,
        author: parts.author,
        sprite: parts.sprite,
        cover:  parts.cover,
        script: parts.script,
    }),
    reset: () => set({ ...initial }),
}));
