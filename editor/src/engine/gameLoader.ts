// Host implementations of the wasm `env.js_gamecount` and `env.js_gameload`
// imports. The C engine's built-in launcher cartridge calls gamecount() and
// gameload(idx) at the Lua level; those go through C bridges that call these
// imports. JS owns the list of available cartridges (typically loaded via
// loadGallery from state/gallery.ts) and feeds the chosen cartridge's bytes
// through the existing tb_feed_cartridge path when gameload fires.

type FeedFn = (bytes: Uint8Array) => void;

let gallery: readonly Uint8Array[] = [];
let feed: FeedFn | null = null;

export function configureGameLoader(opts: {
    gallery: readonly Uint8Array[];
    feed:    FeedFn;
}): void {
    gallery = opts.gallery;
    feed    = opts.feed;
}

export function clearGameLoader(): void {
    gallery = [];
    feed    = null;
}

export const gameLoaderImports = {
    js_gamecount(): number {
        return gallery.length;
    },
    js_gameload(idx: number): void {
        if (!feed) return;
        const bytes = gallery[idx];
        if (!bytes) return;
        feed(bytes);
    },
};
