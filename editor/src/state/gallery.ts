import type { Decoder } from '../engine/decoder';
import { rgbaToDataUrl } from '../lib/png';

export interface GalleryEntry {
    id:        string;
    filename:  string;
    title:     string;
    author:    string;
    coverUrl:  string;
    cartridge: Uint8Array;
}

export interface GalleryFailure {
    id:       string;
    filename: string;
    message:  string;
}

export interface GalleryLoadResult {
    entries:  GalleryEntry[];
    failures: GalleryFailure[];
}

export type CartridgeModules = Record<string, () => Promise<string>>;

export type CartridgeFetcher = (url: string) => Promise<Uint8Array>;

const defaultFetcher: CartridgeFetcher = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
};

const defaultModules = import.meta.glob<string>(
    '../cartridges/*.tb.png',
    { query: '?url', import: 'default' },
);

let cachePromise: Promise<GalleryLoadResult> | null = null;

export function loadGallery(
    decoder: Decoder,
    modules: CartridgeModules = defaultModules,
    fetcher: CartridgeFetcher = defaultFetcher,
): Promise<GalleryLoadResult> {
    if (!cachePromise) cachePromise = loadGalleryImpl(decoder, modules, fetcher);
    return cachePromise;
}

async function loadGalleryImpl(
    decoder: Decoder,
    modules: CartridgeModules,
    fetcher: CartridgeFetcher,
): Promise<GalleryLoadResult> {
    const paths = Object.keys(modules).sort();
    const entries: GalleryEntry[] = [];
    const failures: GalleryFailure[] = [];

    for (const path of paths) {
        const filename = path.split('/').pop() ?? path;
        try {
            const url = await modules[path]();
            const bytes = await fetcher(url);
            const decoded = decoder.decode(bytes);
            const coverUrl = rgbaToDataUrl(decoded.cover, 128, 128);
            entries.push({
                id: path,
                filename,
                title:  decoded.title,
                author: decoded.author,
                coverUrl,
                cartridge: bytes,
            });
        } catch (err) {
            failures.push({
                id: path,
                filename,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return { entries, failures };
}

export function resetGalleryCacheForTests(): void {
    cachePromise = null;
}

if (import.meta.hot) {
    import.meta.hot.accept(() => { cachePromise = null; });
}
