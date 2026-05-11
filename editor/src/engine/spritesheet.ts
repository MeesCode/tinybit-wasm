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

function pack4444(r: number, g: number, b: number, a: number): number {
    return ((r >>> 4) << 12) | ((g >>> 4) << 8) | ((b >>> 4) << 4) | (a >>> 4);
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
