export const SKETCH_KEY = 'tinybit-editor/sketch/v1';
export const UI_KEY = 'tinybit-editor/ui/v1';

export interface PersistedSketch {
    script: string;
    sprite: Uint8Array | null;
    cover:  Uint8Array | null;
    title:  string;
    author: string;
}

interface SerializedSketch {
    script: string;
    title:  string;
    author: string;
    sprite_b64: string | null;
    cover_b64:  string | null;
}

function bytesToB64(b: Uint8Array | null): string | null {
    if (!b) return null;
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
}

function b64ToBytes(s: string | null): Uint8Array | null {
    if (s === null) return null;
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function loadSketch(): PersistedSketch | null {
    try {
        const raw = localStorage.getItem(SKETCH_KEY);
        if (raw === null) return null;
        const v = JSON.parse(raw) as SerializedSketch;
        if (typeof v.script !== 'string') return null;
        return {
            script: v.script,
            title:  v.title ?? '',
            author: v.author ?? '',
            sprite: b64ToBytes(v.sprite_b64 ?? null),
            cover:  b64ToBytes(v.cover_b64 ?? null),
        };
    } catch {
        return null;
    }
}

export type WarnSink = (msg: string) => void;

export function saveSketch(s: PersistedSketch, warn?: WarnSink): void {
    const serial: SerializedSketch = {
        script: s.script,
        title:  s.title,
        author: s.author,
        sprite_b64: bytesToB64(s.sprite),
        cover_b64:  bytesToB64(s.cover),
    };
    try {
        localStorage.setItem(SKETCH_KEY, JSON.stringify(serial));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn?.(`Could not persist sketch: ${msg}`);
    }
}

let debounceId: ReturnType<typeof setTimeout> | null = null;

export function saveSketchDebounced(s: PersistedSketch, warn?: WarnSink, ms = 500): void {
    if (debounceId !== null) clearTimeout(debounceId);
    debounceId = setTimeout(() => { saveSketch(s, warn); debounceId = null; }, ms);
}

export function loadUiLayout<T>(): T | null {
    try {
        const raw = localStorage.getItem(UI_KEY);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

export function saveUiLayout<T>(v: T): void {
    try { localStorage.setItem(UI_KEY, JSON.stringify(v)); } catch { /* layout is best-effort */ }
}
