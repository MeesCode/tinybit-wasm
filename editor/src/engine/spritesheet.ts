import type { DirtyRect } from '../sprite/history';

export interface SpritesheetDeps {
    memory: WebAssembly.Memory;
    ptr: () => number;
    isRunning: () => boolean;
}

export interface Spritesheet {
    mirror(pixels: Uint8Array, rect: DirtyRect): void;
    fullReload(pixels: Uint8Array): void;
    isReady(): boolean;
    setRunningPredicate(fn: () => boolean): void;
}

const SIZE = 128;

// Pack RGBA8 into the engine's uint16 pixel format:
// low byte  = RRRRGGGG  (R in high nibble, G in low nibble)
// high byte = BBBBAAAA  (B in high nibble, A in low nibble)
// Matches pack_color() in graphics.h and the cartridge decoder in cartridge.c.
function pack4444(r: number, g: number, b: number, a: number): number {
    const rg = (r & 0xF0) | (g >>> 4);
    const ba = (b & 0xF0) | (a >>> 4);
    return rg | (ba << 8);
}

export function makeSpritesheet(deps: SpritesheetDeps): Spritesheet {
    let cachedBuffer: ArrayBuffer | null = null;
    let cachedView:   Uint16Array | null = null;
    let cachedPtr:    number = 0;
    let isRunning = deps.isRunning;

    function view(): Uint16Array | null {
        const p = deps.ptr();
        if (p === 0) return null;
        if (cachedView && cachedBuffer === deps.memory.buffer && cachedPtr === p) return cachedView;
        cachedBuffer = deps.memory.buffer;
        cachedPtr = p;
        cachedView = new Uint16Array(deps.memory.buffer, p, SIZE * SIZE);
        return cachedView;
    }

    return {
        isReady() { return deps.ptr() !== 0; },
        setRunningPredicate(fn) { isRunning = fn; },
        mirror(pixels, rect) {
            if (!isRunning()) return;
            const v = view();
            if (!v) return;
            try {
                for (let y = rect.y; y < rect.y + rect.h; y++) {
                    for (let x = rect.x; x < rect.x + rect.w; x++) {
                        const o = (y * SIZE + x) * 4;
                        v[y * SIZE + x] = pack4444(pixels[o], pixels[o+1], pixels[o+2], pixels[o+3]);
                    }
                }
            } catch {
                // memory.grow race or OOB — silently drop
            }
        },
        fullReload(pixels) {
            const v = view();
            if (!v) return;
            try {
                for (let i = 0; i < SIZE * SIZE; i++) {
                    const o = i * 4;
                    v[i] = pack4444(pixels[o], pixels[o+1], pixels[o+2], pixels[o+3]);
                }
            } catch { /* same */ }
        },
    };
}
