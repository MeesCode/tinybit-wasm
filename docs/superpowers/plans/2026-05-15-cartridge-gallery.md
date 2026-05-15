# Cartridge Gallery & Hello-World Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-loaded Lucky Leprechaun demo with a hello-world skeleton (the default editor state) and a gallery modal that loads `.tb.png` cartridges from a git-tracked folder.

**Architecture:** A new `skeleton` module owns the "blank editor" state (script + predicate). A new `gallery` module enumerates `editor/src/cartridges/*.tb.png` via Vite's `import.meta.glob`, decodes each cartridge once via the existing WASM decoder, caches the result, and surfaces a list of cards. A new `GalleryModal` component renders those cards. `App.tsx` wires the toolbar's renamed `🎮 Gallery` button to the modal and reuses the existing `UploadConfirm` flow when picking a card over a non-skeleton sketch. The Lucky Leprechaun demo files are deleted.

**Tech Stack:** TypeScript, React, Zustand, Vitest + Testing Library, Playwright, Vite, the existing TinyBit wasm decoder.

**Reference spec:** `docs/superpowers/specs/2026-05-15-cartridge-gallery-design.md`

---

## File Structure

**New files:**
- `editor/src/state/skeleton.ts` — `SKELETON_SCRIPT` constant and `isUntouchedSkeleton(s)` predicate.
- `editor/src/state/skeleton.test.ts` — unit tests for the predicate.
- `editor/src/state/gallery.ts` — `loadGallery()` with caching, types `GalleryEntry` / `GalleryFailure` / `GalleryLoadResult`.
- `editor/src/state/gallery.test.ts` — unit tests with mocked decoder/fetch/modules.
- `editor/src/ui/GalleryModal.tsx` — modal component (loading / empty / ready / error states).
- `editor/src/ui/GalleryModal.test.tsx` — component tests.
- `editor/src/cartridges/.gitkeep` — empty file so the (currently empty) folder is tracked.
- `editor/tests/e2e/gallery.spec.ts` — E2E flow with a fixture cartridge.

**Modified files:**
- `editor/src/lib/png.ts` — add `rgbaToDataUrl(pixels, width, height): string`.
- `editor/src/App.tsx` — extract shared cartridge-load helper, swap first-boot loadDemo→skeleton, update Clear to restore skeleton, rename demo-button wiring to gallery-button wiring, render `GalleryModal`.
- `editor/src/ui/Toolbar.tsx` — rename `onDemo` prop to `onGallery`, change label/aria.
- `editor/src/ui/Toolbar.test.tsx` — update the demo-button test to assert on the new Gallery button.
- `editor/src/ui/ClearConfirm.tsx` — update body copy.
- `editor/src/ui/ClearConfirm.test.tsx` — update body-copy assertion.
- `editor/tests/e2e/clear.spec.ts` — assert on skeleton (not Lucky Leprechaun) in both tests.

**Deleted files:**
- `editor/src/state/demo.ts`
- `editor/src/state/demo.test.ts`
- `editor/src/ui/DemoConfirm.tsx`
- `editor/src/ui/DemoConfirm.test.tsx`
- `editor/public/demo-sprite.png`
- `editor/tests/e2e/demo-button.spec.ts`

**Deliberate non-changes:**
- `editor/src/App.test.tsx` — the spec mentions updating it, but its existing tests don't render-and-assert on the script content (CodeMirror's contents aren't straightforward to query from React Testing Library). The E2E `clear.spec.ts` already covers first-boot-shows-skeleton and clear-restores-skeleton end-to-end. We verify App.test.tsx still passes after the refactor; we do not add new assertions there.
- `editor/tests/e2e/smoke.spec.ts` — currently does its own script setup and does not reference Lucky Leprechaun, so no edits are needed. We verify it still passes.

---

## Task 1: Skeleton module

**Files:**
- Create: `editor/src/state/skeleton.ts`
- Test: `editor/src/state/skeleton.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `editor/src/state/skeleton.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { SKELETON_SCRIPT, isUntouchedSkeleton } from './skeleton';

describe('SKELETON_SCRIPT', () => {
    test('contains a _draw function and a hello, world print', () => {
        expect(SKELETON_SCRIPT).toMatch(/function\s+_draw\s*\(/);
        expect(SKELETON_SCRIPT).toMatch(/hello,\s*world/);
    });
});

describe('isUntouchedSkeleton', () => {
    const base = {
        script: SKELETON_SCRIPT,
        sprite: null as Uint8Array | null,
        cover:  null as Uint8Array | null,
        title:  '',
        author: '',
    };

    test('returns true for the literal untouched skeleton', () => {
        expect(isUntouchedSkeleton(base)).toBe(true);
    });

    test('returns false when the script differs', () => {
        expect(isUntouchedSkeleton({ ...base, script: 'function _draw() end' })).toBe(false);
    });

    test('returns false when a sprite has been set', () => {
        expect(isUntouchedSkeleton({ ...base, sprite: new Uint8Array(1) })).toBe(false);
    });

    test('returns false when a cover has been set', () => {
        expect(isUntouchedSkeleton({ ...base, cover: new Uint8Array(1) })).toBe(false);
    });

    test('returns false when title is non-empty', () => {
        expect(isUntouchedSkeleton({ ...base, title: 'Hi' })).toBe(false);
    });

    test('returns false when author is non-empty', () => {
        expect(isUntouchedSkeleton({ ...base, author: 'Me' })).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/state/skeleton.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the skeleton module**

Create `editor/src/state/skeleton.ts`:

```ts
export const SKELETON_SCRIPT = `-- Welcome to TinyBit. Press ▶ Play to run.
-- Click 🎮 Gallery in the toolbar to load an example cartridge.

function _draw()
    cls()
    cursor(34, 60)
    print("hello, world")
end
`;

export interface SkeletonShape {
    script: string;
    sprite: Uint8Array | null;
    cover:  Uint8Array | null;
    title:  string;
    author: string;
}

export function isUntouchedSkeleton(s: SkeletonShape): boolean {
    return s.script === SKELETON_SCRIPT
        && s.sprite === null
        && s.cover === null
        && s.title === ''
        && s.author === '';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/state/skeleton.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/skeleton.ts editor/src/state/skeleton.test.ts
git commit -m "state: add SKELETON_SCRIPT and isUntouchedSkeleton predicate"
```

---

## Task 2: `rgbaToDataUrl` helper in `lib/png.ts`

The gallery modal needs to render the decoder's 128×128 RGBA cover output as an `<img>`. We add a small helper next to `readPngSize`.

**Files:**
- Modify: `editor/src/lib/png.ts`
- Test: `editor/src/lib/png.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `editor/src/lib/png.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { rgbaToDataUrl } from './png';

describe('rgbaToDataUrl', () => {
    test('returns a data: URL without throwing', () => {
        // 2×2 fully-red, opaque
        const pixels = new Uint8Array([
            255, 0, 0, 255,   255, 0, 0, 255,
            255, 0, 0, 255,   255, 0, 0, 255,
        ]);
        const url = rgbaToDataUrl(pixels, 2, 2);
        // jsdom's canvas.toDataURL is a no-op stub that returns 'data:,' — the real
        // visual check lives in the gallery E2E spec. Here we just verify the helper
        // produces a data: URL and doesn't throw.
        expect(typeof url).toBe('string');
        expect(url.startsWith('data:')).toBe(true);
    });

    test('throws when pixels length does not match dimensions', () => {
        expect(() => rgbaToDataUrl(new Uint8Array(3), 2, 2)).toThrow(/length/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/lib/png.test.ts`
Expected: FAIL — `rgbaToDataUrl` is not exported.

- [ ] **Step 3: Add the helper to `lib/png.ts`**

Append to `editor/src/lib/png.ts`:

```ts
export function rgbaToDataUrl(pixels: Uint8Array, width: number, height: number): string {
    const expected = width * height * 4;
    if (pixels.length !== expected) {
        throw new Error(`rgbaToDataUrl: pixels length ${pixels.length} does not match ${width}×${height}×4 = ${expected}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('rgbaToDataUrl: 2D canvas context unavailable');
    const img = ctx.createImageData(width, height);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/lib/png.test.ts`
Expected: PASS (2 tests).

Note: vitest's `jsdom` environment supplies `document` and `canvas.toDataURL`. If the test fails because jsdom returns an empty data URL (some versions stub `toDataURL` to return `'data:,'`), accept any string that starts with `'data:image/png'` or update the test to assert on a smaller invariant — the implementer should not weaken the production path.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/png.ts editor/src/lib/png.test.ts
git commit -m "lib/png: add rgbaToDataUrl helper for gallery thumbnails"
```

---

## Task 3: Cartridges folder with `.gitkeep`

The gallery's `import.meta.glob` needs the folder to exist at build time, even when empty.

**Files:**
- Create: `editor/src/cartridges/.gitkeep`
- Create: `editor/src/cartridges/README.md` (one-line note for contributors)

- [ ] **Step 1: Create the folder and `.gitkeep`**

```bash
mkdir -p editor/src/cartridges
touch editor/src/cartridges/.gitkeep
```

- [ ] **Step 2: Add a tiny README for contributors**

Create `editor/src/cartridges/README.md`:

```markdown
# Gallery cartridges

Drop any `.tb.png` cartridge into this folder. It will appear in the editor's
gallery modal on next reload. The cartridge's embedded title and cover are
shown — the filename is not user-visible.
```

- [ ] **Step 3: Commit**

```bash
git add editor/src/cartridges/.gitkeep editor/src/cartridges/README.md
git commit -m "cartridges: add empty gallery folder with contributor note"
```

---

## Task 4: Gallery module

The module enumerates cartridges (via an injected `modules` map for testability), fetches their bytes, decodes them, and surfaces a typed result. A module-level promise caches the first call.

**Files:**
- Create: `editor/src/state/gallery.ts`
- Test: `editor/src/state/gallery.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `editor/src/state/gallery.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
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

beforeEach(() => resetGalleryCacheForTests());

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npx vitest run src/state/gallery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the gallery module**

Create `editor/src/state/gallery.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/state/gallery.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/gallery.ts editor/src/state/gallery.test.ts
git commit -m "state: add loadGallery with caching and injectable modules/fetcher"
```

---

## Task 5: `GalleryModal` component

A modal portal that renders a card grid. State-machine prop covers loading / ready / error. Empty `entries` array shows the empty-state message. Failures render as non-interactive cards.

**Files:**
- Create: `editor/src/ui/GalleryModal.tsx`
- Test: `editor/src/ui/GalleryModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `editor/src/ui/GalleryModal.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryModal } from './GalleryModal';
import type { GalleryEntry, GalleryFailure } from '../state/gallery';

function entry(overrides: Partial<GalleryEntry> = {}): GalleryEntry {
    return {
        id: 'a.tb.png', filename: 'a.tb.png',
        title: 'Alpha', author: 'A',
        coverUrl: 'data:image/png;base64,AAAA',
        cartridge: new Uint8Array(),
        ...overrides,
    };
}

describe('GalleryModal', () => {
    test('renders nothing when closed', () => {
        const { container } = render(
            <GalleryModal open={false} state={{ kind: 'loading' }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    test('renders a loading message when state is loading', () => {
        render(
            <GalleryModal open state={{ kind: 'loading' }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    test('renders an error message when state is error', () => {
        render(
            <GalleryModal open state={{ kind: 'error', message: 'boom' }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText(/boom/)).toBeInTheDocument();
    });

    test('renders the empty-folder message when ready with no entries or failures', () => {
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText(/no cartridges in/i)).toBeInTheDocument();
        expect(screen.getByText(/editor\/src\/cartridges/i)).toBeInTheDocument();
    });

    test('renders one card per entry with title and author', () => {
        render(
            <GalleryModal
                open
                state={{ kind: 'ready',
                    entries: [entry({ title: 'Alpha', author: 'A' }), entry({ id: 'b', filename: 'b.tb.png', title: 'Beta', author: 'B' })],
                    failures: [],
                }}
                onPick={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: /alpha/i })).toBeInTheDocument();
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /beta/i })).toBeInTheDocument();
        expect(screen.getByText('B')).toBeInTheDocument();
    });

    test('clicking a card calls onPick with that entry', async () => {
        const onPick = vi.fn();
        const e = entry({ id: 'a', title: 'Alpha', author: 'A' });
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [e], failures: [] }} onPick={onPick} onCancel={() => {}} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /alpha/i }));
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith(e);
    });

    test('failure cards render filename and error message and are not buttons', () => {
        const failures: GalleryFailure[] = [{ id: 'bad', filename: 'bad.tb.png', message: 'corrupt' }];
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText('bad.tb.png')).toBeInTheDocument();
        expect(screen.getByText(/corrupt/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /bad/ })).toBeNull();
    });

    test('Cancel button calls onCancel', async () => {
        const onCancel = vi.fn();
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onCancel={onCancel} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    test('Escape key calls onCancel', async () => {
        const onCancel = vi.fn();
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onCancel={onCancel} />,
        );
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npx vitest run src/ui/GalleryModal.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Create the component**

Create `editor/src/ui/GalleryModal.tsx`:

```tsx
import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { GalleryEntry, GalleryFailure } from '../state/gallery';

const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(24, 24, 32, 0.45)',
    display: 'grid', placeItems: 'center', zIndex: 9999,
};
const dialogStyle: CSSProperties = {
    background: '#FFFFFF', borderRadius: 10, padding: '20px 24px',
    minWidth: 480, maxWidth: 720, maxHeight: '80vh', overflow: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)', fontSize: 14, color: '#181820',
};
const titleStyle:  CSSProperties = { fontWeight: 700, fontSize: 16, marginBottom: 12 };
const gridStyle:   CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 14, marginBottom: 16 };
const cardStyle:   CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    padding: 8, borderRadius: 8, border: '1px solid #ECECF0', background: '#FFFFFF',
    cursor: 'pointer', fontSize: 13, color: '#181820',
};
const cardImgStyle: CSSProperties = { width: 96, height: 96, imageRendering: 'pixelated', borderRadius: 4, background: '#F1F1F4' };
const cardTitleStyle:  CSSProperties = { fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const cardAuthorStyle: CSSProperties = { color: '#6B6B76', fontSize: 12, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const failureCardStyle: CSSProperties = { ...cardStyle, cursor: 'default', borderStyle: 'dashed', color: '#6B6B76' };
const emptyStyle:  CSSProperties = { textAlign: 'center', color: '#6B6B76', padding: '20px 0' };
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const cancelStyle:  CSSProperties = {
    padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    border: '1px solid #ECECF0', background: '#F1F1F4', color: '#181820', cursor: 'pointer',
};

export type GalleryModalState =
    | { kind: 'loading' }
    | { kind: 'ready'; entries: GalleryEntry[]; failures: GalleryFailure[] }
    | { kind: 'error'; message: string };

export interface GalleryModalProps {
    open:     boolean;
    state:    GalleryModalState;
    onPick(entry: GalleryEntry): void;
    onCancel(): void;
}

export function GalleryModal({ open, state, onPick, onCancel }: GalleryModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onCancel]);

    if (!open) return null;

    return createPortal(
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Choose a cartridge">
            <div style={dialogStyle}>
                <div style={titleStyle}>Choose a cartridge</div>
                {state.kind === 'loading' && <div style={emptyStyle}>Loading…</div>}
                {state.kind === 'error'   && <div style={emptyStyle}>{state.message}</div>}
                {state.kind === 'ready'   && renderReady(state, onPick)}
                <div style={actionsStyle}>
                    <button type="button" style={cancelStyle} onClick={onCancel}>Cancel</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function renderReady(
    s: { kind: 'ready'; entries: GalleryEntry[]; failures: GalleryFailure[] },
    onPick: (e: GalleryEntry) => void,
) {
    if (s.entries.length === 0 && s.failures.length === 0) {
        return (
            <div style={emptyStyle}>
                <div>No cartridges in <code>editor/src/cartridges/</code>.</div>
                <div>Drop <code>.tb.png</code> files there to populate the gallery.</div>
            </div>
        );
    }
    return (
        <div style={gridStyle}>
            {s.entries.map((e) => (
                <button
                    key={e.id}
                    type="button"
                    style={cardStyle}
                    onClick={() => onPick(e)}
                    aria-label={e.title || e.filename}
                >
                    <img src={e.coverUrl} style={cardImgStyle} alt="" />
                    <div style={cardTitleStyle}>{e.title || e.filename}</div>
                    <div style={cardAuthorStyle}>{e.author}</div>
                </button>
            ))}
            {s.failures.map((f) => (
                <div key={f.id} style={failureCardStyle}>
                    <div style={{ ...cardImgStyle, display: 'grid', placeItems: 'center', fontSize: 24 }}>⚠</div>
                    <div style={cardTitleStyle}>{f.filename}</div>
                    <div style={cardAuthorStyle}>{f.message}</div>
                </div>
            ))}
        </div>
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/ui/GalleryModal.test.tsx`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/GalleryModal.tsx editor/src/ui/GalleryModal.test.tsx
git commit -m "ui: add GalleryModal with loading/empty/ready/error states"
```

---

## Task 6: Extract `loadCartridgeBytes` helper in `App.tsx`

The current `handleConfirmReplace` couples the decode-and-populate flow to a `pendingUpload` state. The gallery's silent-load path needs to run that same logic without going through `pendingUpload`. We extract a small helper now (no behavior change) so the gallery integration in Task 8 is a clean drop-in.

**Files:**
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: Read the current `handleConfirmReplace` body**

Run: `cd editor && grep -n "handleConfirmReplace" src/App.tsx`
Expected: locates the callback at roughly line 184.

- [ ] **Step 2: Add a `loadCartridgeBytes` helper above the callback**

In `editor/src/App.tsx`, find the `handleConfirmReplace` callback. Add a new `useCallback` just above it:

```ts
const loadCartridgeBytes = useCallback((bytes: Uint8Array): void => {
    if (!runtime || !runtime.decoderAvailable) {
        consoleAppend('error', 'Decoder not available in this WASM build.');
        return;
    }
    frameLoopRef.current?.stop();
    runtime.tb.stop();
    runtime.tb.init();
    try {
        const result = runtime.dec.decode(bytes);
        sketch.loadCartridge({
            title:  result.title,
            author: result.author,
            sprite: result.sprite,
            cover:  result.cover,
            script: result.script,
        });
        consoleAppend('log', `Loaded '${result.title || 'untitled'}' by ${result.author || '<unknown>'}`);
        if (!result.crcOk) {
            consoleAppend('warn', 'Loaded with CRC mismatch (script may be corrupted)');
        }
    } catch (err) {
        if (err instanceof DecodeError) consoleAppend('error', `Decode failed (${err.code}): ${err.message}`);
        else consoleAppend('error', err instanceof Error ? err.message : String(err));
    }
}, [runtime, sketch, consoleAppend]);
```

- [ ] **Step 3: Rewrite `handleConfirmReplace` to use the helper**

Replace the existing `handleConfirmReplace` callback body with:

```ts
const handleConfirmReplace = useCallback(() => {
    const pu = pendingUpload;
    setPendingUpload(null);
    if (!pu) return;
    loadCartridgeBytes(pu.bytes);
}, [pendingUpload, loadCartridgeBytes]);
```

- [ ] **Step 4: Run unit and e2e tests to verify no regressions**

Run: `cd editor && npm test`
Expected: All existing tests continue to pass.

(The e2e upload test exercises this path; running it locally is optional at this point but recommended:
`cd editor && npx playwright test tests/e2e/upload.spec.ts`.)

- [ ] **Step 5: Commit**

```bash
git add editor/src/App.tsx
git commit -m "app: extract loadCartridgeBytes helper (no behavior change)"
```

---

## Task 7: Replace `loadDemo` first-boot + update `Clear` to restore skeleton

This task swaps the auto-loaded Lucky Leprechaun for the hello-world skeleton at first boot, updates the `Clear` button to restore the skeleton, and updates the corresponding tests. The Demo button still works after this task — it's removed in Task 8. The demo source files still exist — they're deleted in Task 9.

**Files:**
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/ui/ClearConfirm.tsx`
- Modify: `editor/src/ui/ClearConfirm.test.tsx`
- Modify: `editor/tests/e2e/clear.spec.ts`

- [ ] **Step 1: Update `ClearConfirm` body copy**

In `editor/src/ui/ClearConfirm.tsx`, replace the `bodyStyle` div's text:

Old:
```tsx
<div style={bodyStyle}>
    This will discard your current script, sprite, cover, title, and author.
    Editor preferences are kept.
</div>
```

New:
```tsx
<div style={bodyStyle}>
    This will discard your current cartridge and reset the editor to the
    hello-world skeleton. Editor preferences are kept.
</div>
```

- [ ] **Step 2: Update the `ClearConfirm` test for the new copy**

In `editor/src/ui/ClearConfirm.test.tsx`, change the body-text assertion:

Old:
```ts
expect(screen.getByText(/discard your current/i)).toBeInTheDocument();
```

New:
```ts
expect(screen.getByText(/reset the editor to the hello-world skeleton/i)).toBeInTheDocument();
```

- [ ] **Step 3: Run the ClearConfirm tests to verify**

Run: `cd editor && npx vitest run src/ui/ClearConfirm.test.tsx`
Expected: PASS.

- [ ] **Step 4: Update `App.tsx` — import skeleton, change first-boot effect, change Clear handler**

Add to the imports at the top of `editor/src/App.tsx`:

```ts
import { SKELETON_SCRIPT } from './state/skeleton';
```

Replace the mount effect block:

Old:
```ts
useEffect(() => {
    const stored = loadSketch();
    if (stored) {
        sketch.setScript(stored.script);
        sketch.setTitle(stored.title);
        sketch.setAuthor(stored.author);
        if (stored.sprite) {
            void sketch.setSpriteFromPng(stored.sprite).catch((err) => {
                consoleAppend('warn', `Failed to decode persisted sprite: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        sketch.setCover(stored.cover);
    } else {
        void loadDemo(sketch, (msg) => consoleAppend('warn', msg));
    }
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

New:
```ts
useEffect(() => {
    const stored = loadSketch();
    if (stored) {
        sketch.setScript(stored.script);
        sketch.setTitle(stored.title);
        sketch.setAuthor(stored.author);
        if (stored.sprite) {
            void sketch.setSpriteFromPng(stored.sprite).catch((err) => {
                consoleAppend('warn', `Failed to decode persisted sprite: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        sketch.setCover(stored.cover);
    } else {
        sketch.setScript(SKELETON_SCRIPT);
    }
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

Replace the `handleClearConfirm` callback:

Old:
```ts
const handleClearConfirm = useCallback(() => {
    setClearConfirmOpen(false);
    frameLoopRef.current?.stop();
    runtime?.tb.stop();
    setEngineState('idle');
    sketch.setScript('');
    sketch.setTitle('');
    sketch.setAuthor('');
    sketch.setCover(null);
    sketch.clearSprite();
    saveSketch(
        { script: '', sprite: null, cover: null, title: '', author: '' },
        (msg) => consoleAppend('warn', msg),
    );
}, [runtime, sketch, consoleAppend]);
```

New:
```ts
const handleClearConfirm = useCallback(() => {
    setClearConfirmOpen(false);
    frameLoopRef.current?.stop();
    runtime?.tb.stop();
    setEngineState('idle');
    sketch.setScript(SKELETON_SCRIPT);
    sketch.setTitle('');
    sketch.setAuthor('');
    sketch.setCover(null);
    sketch.clearSprite();
    saveSketch(
        { script: SKELETON_SCRIPT, sprite: null, cover: null, title: '', author: '' },
        (msg) => consoleAppend('warn', msg),
    );
}, [runtime, sketch, consoleAppend]);
```

(Do *not* remove the `import { loadDemo } from './state/demo';` import yet — the Demo button's handler still uses it. Task 8 removes both.)

- [ ] **Step 5: Update the E2E `clear.spec.ts`**

Replace the entire contents of `editor/tests/e2e/clear.spec.ts` with:

```ts
import { test, expect } from '@playwright/test';

test('first run shows the hello-world skeleton', async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => localStorage.clear());

    await page.goto('/');

    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('hello, world');
    await expect(editor).toContainText('function _draw');

    // Title and author are empty on first run.
    await page.getByRole('tab', { name: /cartridge/i }).click();
    await expect(page.getByRole('textbox', { name: /title/i })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: /author/i })).toHaveValue('');
});

test('clear restores the skeleton and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/');

    const editor = page.locator('.cm-content');
    await expect(editor).toContainText('hello, world');

    // Type something into the editor to mutate state.
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('-- mutated', { delay: 1 });
    await expect(editor).toContainText('mutated');
    await expect(editor).not.toContainText('hello, world');

    // Cancel keeps the mutation.
    await page.getByRole('button', { name: /clear editor/i }).click();
    await expect(page.getByRole('dialog', { name: /clear editor/i })).toBeVisible();
    await page.getByRole('dialog', { name: /clear editor/i }).getByRole('button', { name: /cancel/i }).click();
    await expect(editor).toContainText('mutated');

    // Confirm restores the skeleton.
    await page.getByRole('button', { name: /clear editor/i }).click();
    await page.getByRole('dialog', { name: /clear editor/i }).getByRole('button', { name: /^clear$/i }).click();
    await expect(editor).toContainText('hello, world');
    await expect(editor).not.toContainText('mutated');

    // Reload — skeleton must persist (the just-saved state, not Lucky Leprechaun).
    await page.reload();
    const editorAfter = page.locator('.cm-content');
    await expect(editorAfter).toContainText('hello, world');
});
```

- [ ] **Step 6: Run unit tests**

Run: `cd editor && npm test`
Expected: All pass.

- [ ] **Step 7: Run the updated E2E spec**

Run: `cd editor && npx playwright test tests/e2e/clear.spec.ts`
Expected: PASS (2 tests).

If the dev server isn't auto-spawning, run `./scripts/dev.sh` in a separate shell or rely on the Playwright config's `webServer`.

- [ ] **Step 8: Commit**

```bash
git add editor/src/App.tsx editor/src/ui/ClearConfirm.tsx editor/src/ui/ClearConfirm.test.tsx editor/tests/e2e/clear.spec.ts
git commit -m "app: first-boot and Clear both land on the hello-world skeleton"
```

---

## Task 8: Replace the Demo button with the Gallery button + wire up `GalleryModal`

This is the integration task. After it, the Demo button is gone, the Gallery button is wired up, and the modal works end-to-end against in-memory state. The demo source files still exist on disk — Task 9 deletes them.

**Files:**
- Modify: `editor/src/ui/Toolbar.tsx`
- Modify: `editor/src/ui/Toolbar.test.tsx`
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: Update the Toolbar test for the new button**

In `editor/src/ui/Toolbar.test.tsx`, replace the final test (`renders a Demo button between Clear and Open and fires onDemo`) with:

```tsx
test('renders a Gallery button between Clear and Open and fires onGallery', async () => {
    const onGallery = vi.fn();
    render(
        <Toolbar
            engineState="idle"
            canPlay={true}
            onPlay={() => {}}
            onStop={() => {}}
            onClear={() => {}}
            onGallery={onGallery}
            onOpen={() => {}}
            onDownload={() => {}}
        />,
    );
    const buttons = screen.getAllByRole('button');
    const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    const clearIdx   = labels.findIndex((l) => /clear/i.test(l));
    const openIdx    = labels.findIndex((l) => /open/i.test(l));
    const galleryIdx = labels.findIndex((l) => /gallery/i.test(l));
    expect(galleryIdx).toBeGreaterThan(clearIdx);
    expect(galleryIdx).toBeLessThan(openIdx);

    await userEvent.click(screen.getByRole('button', { name: /gallery/i }));
    expect(onGallery).toHaveBeenCalledOnce();
});
```

Also update every other `<Toolbar ... />` render in this file: replace `onDemo={() => {}}` with `onGallery={() => {}}`. There are four such call sites at the top of the file (the "renders brand and four buttons", "Play is disabled…", "clicking Play, Open, Download…", and "Crashed pill" tests).

- [ ] **Step 2: Run the updated Toolbar test to verify it fails**

Run: `cd editor && npx vitest run src/ui/Toolbar.test.tsx`
Expected: FAIL — `onGallery` prop does not exist yet.

- [ ] **Step 3: Update `Toolbar.tsx`**

In `editor/src/ui/Toolbar.tsx`:

Change the props interface:

Old:
```ts
export interface ToolbarProps {
    engineState: EngineState;
    canPlay: boolean;
    onPlay():   void;
    onStop():   void;
    onClear():  void;
    onDemo():   void;
    onOpen():   void;
    onDownload(): void;
    onResetEngine?(): void;
}
```

New:
```ts
export interface ToolbarProps {
    engineState: EngineState;
    canPlay: boolean;
    onPlay():    void;
    onStop():    void;
    onClear():   void;
    onGallery(): void;
    onOpen():    void;
    onDownload(): void;
    onResetEngine?(): void;
}
```

Replace the Demo button JSX:

Old:
```tsx
<button type="button" onClick={p.onDemo} style={neutralStyle} aria-label="Load demo">
    ⭐ Demo
</button>
```

New:
```tsx
<button type="button" onClick={p.onGallery} style={neutralStyle} aria-label="Gallery">
    🎮 Gallery
</button>
```

(Note: the aria-label is just `"Gallery"`, not `"Open gallery"`, so it doesn't collide with the Open button's `"Open"` aria-label in tests that grep button labels by substring.)

- [ ] **Step 4: Run Toolbar tests to verify pass**

Run: `cd editor && npx vitest run src/ui/Toolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update `App.tsx` — imports**

In `editor/src/App.tsx`:

Remove these imports:
```ts
import { loadDemo } from './state/demo';
import { DemoConfirm } from './ui/DemoConfirm';
```

Add these imports (near the other state imports):
```ts
import { isUntouchedSkeleton } from './state/skeleton';
import { loadGallery, type GalleryEntry, type GalleryLoadResult } from './state/gallery';
import { GalleryModal, type GalleryModalState } from './ui/GalleryModal';
```

- [ ] **Step 6: Update `App.tsx` — replace demo state with gallery state**

Find the existing state hooks block:

```ts
const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
const [demoConfirmOpen, setDemoConfirmOpen] = useState(false);
```

Replace with:

```ts
const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
const [galleryOpen, setGalleryOpen] = useState(false);
const [galleryState, setGalleryState] = useState<GalleryModalState>({ kind: 'loading' });
const galleryLoadedRef = useRef(false);
```

- [ ] **Step 7: Update `App.tsx` — remove demo handlers, add gallery handlers**

Delete these three callbacks entirely:

```ts
const handleDemo = useCallback(() => { ... }, []);
const handleDemoCancel = useCallback(() => { ... }, []);
const handleDemoConfirm = useCallback(() => { ... }, [runtime, sketch, consoleAppend]);
```

Add these three callbacks in the same place:

```ts
const handleGalleryOpen = useCallback(async () => {
    setGalleryOpen(true);
    if (galleryLoadedRef.current || !runtime || !runtime.decoderAvailable) return;
    setGalleryState({ kind: 'loading' });
    try {
        const result: GalleryLoadResult = await loadGallery(runtime.dec);
        galleryLoadedRef.current = true;
        setGalleryState({ kind: 'ready', entries: result.entries, failures: result.failures });
    } catch (err) {
        setGalleryState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
}, [runtime]);

const handleGalleryCancel = useCallback(() => {
    setGalleryOpen(false);
}, []);

const handleGalleryPick = useCallback((entry: GalleryEntry) => {
    setGalleryOpen(false);
    const current = {
        script: sketch.script, sprite: sketch.sprite, cover: sketch.cover,
        title:  sketch.title,  author: sketch.author,
    };
    if (isUntouchedSkeleton(current)) {
        loadCartridgeBytes(entry.cartridge);
    } else {
        setPendingUpload({ bytes: entry.cartridge, filename: entry.filename });
    }
}, [sketch, loadCartridgeBytes]);
```

- [ ] **Step 8: Update `App.tsx` — Toolbar usage**

Replace:

```tsx
<Toolbar
    engineState={engineState}
    canPlay={canPlay}
    onPlay={handlePlay}
    onStop={handleStop}
    onClear={handleClear}
    onDemo={handleDemo}
    onOpen={handleOpenClick}
    onDownload={handleDownload}
    onResetEngine={handleResetEngine}
/>
```

With:

```tsx
<Toolbar
    engineState={engineState}
    canPlay={canPlay}
    onPlay={handlePlay}
    onStop={handleStop}
    onClear={handleClear}
    onGallery={handleGalleryOpen}
    onOpen={handleOpenClick}
    onDownload={handleDownload}
    onResetEngine={handleResetEngine}
/>
```

- [ ] **Step 9: Update `App.tsx` — modal rendering**

Replace the `{demoConfirmOpen && (...)}` block at the bottom of the JSX:

Old:
```tsx
{demoConfirmOpen && (
    <DemoConfirm
        onLoad={handleDemoConfirm}
        onCancel={handleDemoCancel}
    />
)}
```

New:
```tsx
<GalleryModal
    open={galleryOpen}
    state={galleryState}
    onPick={handleGalleryPick}
    onCancel={handleGalleryCancel}
/>
```

- [ ] **Step 10: Type-check and run all unit tests**

Run: `cd editor && npm test`
Expected: All pass.

If the typechecker complains about an unused `loadDemo` import or about `handleDemo`/`handleDemoConfirm`, you missed a deletion — search the file and remove the leftover.

- [ ] **Step 11: Smoke-test the gallery in the browser**

Run: `./scripts/dev.sh`

In the browser at http://localhost:5173:
1. Clear localStorage. Reload. Verify the editor shows the hello-world skeleton.
2. Click the 🎮 Gallery button. The modal opens with the "No cartridges in `editor/src/cartridges/`" message (folder is empty).
3. Press Esc — modal closes.
4. Click Gallery again, click Cancel — modal closes.

Manual verification only; no automated check at this step (the E2E spec in Task 10 covers it).

- [ ] **Step 12: Commit**

```bash
git add editor/src/App.tsx editor/src/ui/Toolbar.tsx editor/src/ui/Toolbar.test.tsx
git commit -m "ui: replace Demo button with Gallery button and wire up GalleryModal"
```

---

## Task 9: Delete dead demo files

The Demo button and its handler are gone; nothing references the demo module or assets anymore. Delete them.

**Files:**
- Delete: `editor/src/state/demo.ts`
- Delete: `editor/src/state/demo.test.ts`
- Delete: `editor/src/ui/DemoConfirm.tsx`
- Delete: `editor/src/ui/DemoConfirm.test.tsx`
- Delete: `editor/public/demo-sprite.png`
- Delete: `editor/tests/e2e/demo-button.spec.ts`

- [ ] **Step 1: Verify nothing else imports these files**

Run: `cd editor && grep -rn "from './demo'\|from '../state/demo'\|DemoConfirm\|demo-sprite" src tests`
Expected: no matches (or only matches inside files we're deleting).

If anything is found in a file we're keeping, fix it before continuing.

- [ ] **Step 2: Delete the files**

```bash
git rm editor/src/state/demo.ts editor/src/state/demo.test.ts
git rm editor/src/ui/DemoConfirm.tsx editor/src/ui/DemoConfirm.test.tsx
git rm editor/public/demo-sprite.png
git rm editor/tests/e2e/demo-button.spec.ts
```

- [ ] **Step 3: Run all unit tests**

Run: `cd editor && npm test`
Expected: All pass.

- [ ] **Step 4: Run the existing E2E suite (smoke + clear + upload + sprite + score)**

Run: `cd editor && npx playwright test`
Expected: All pass. The deleted `demo-button.spec.ts` is gone, so it won't run.

If any spec still asserts on Lucky Leprechaun, update it to assert on the skeleton instead and recommit.

- [ ] **Step 5: Commit**

```bash
git commit -m "demo: remove Lucky Leprechaun demo (replaced by gallery)"
```

---

## Task 10: E2E gallery spec

End-to-end coverage of the gallery flow. We use a Playwright fixture-file approach: before the test, copy a real `.tb.png` cartridge into `editor/src/cartridges/`; after the test, remove it. This requires the cartridge fixture file to live somewhere persistent — we add one in `editor/tests/fixtures/`.

Because the gallery's cartridge list is resolved by `import.meta.glob` at *build* time, the dev server must rescan after the fixture is dropped in. Vite does this automatically when a matching file appears in the watched glob, but the test must wait long enough for the HMR cycle to finish — see Step 4.

**Files:**
- Create: `editor/tests/fixtures/gallery-sample.tb.png` (binary fixture — see Step 1)
- Create: `editor/tests/e2e/gallery.spec.ts`

- [ ] **Step 1: Produce a fixture cartridge**

You need a valid 256×256 `.tb.png` cartridge to use as the fixture. The cleanest approach is to generate one from the editor itself:

1. Run `./scripts/dev.sh`.
2. Open the editor in a browser.
3. Click 🗑 Clear to ensure a known starting state.
4. Optionally edit the script to add a recognizable title (Cartridge tab → set title to "Gallery Sample", author to "Test").
5. Click ⬇ Download. Save the resulting `.tb.png` as `editor/tests/fixtures/gallery-sample.tb.png`.

Verify:
```bash
ls -lh editor/tests/fixtures/gallery-sample.tb.png
file editor/tests/fixtures/gallery-sample.tb.png  # should report "PNG image data, 256 x 256"
```

- [ ] **Step 2: Write the gallery E2E spec**

Create `editor/tests/e2e/gallery.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { copyFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE   = join(__dirname, '..', 'fixtures', 'gallery-sample.tb.png');
const CARTRIDGE_DIR = join(__dirname, '..', '..', 'src', 'cartridges');
const DROPPED   = join(CARTRIDGE_DIR, 'gallery-sample.tb.png');

test.describe('Gallery modal', () => {
    test('opens, lists no cartridges when folder is empty', async ({ page, context }) => {
        await context.clearCookies();
        await page.addInitScript(() => localStorage.clear());
        await page.goto('/');

        await page.getByRole('button', { name: /gallery/i }).click();
        const dialog = page.getByRole('dialog', { name: /choose a cartridge/i });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(/no cartridges in/i);
        await dialog.getByRole('button', { name: /cancel/i }).click();
        await expect(dialog).not.toBeVisible();
    });

    test('loads a cartridge from a populated gallery (silent over skeleton)', async ({ page, context }) => {
        if (!existsSync(FIXTURE)) test.skip(true, 'fixture cartridge missing — generate via Download in the editor');
        if (!existsSync(CARTRIDGE_DIR)) mkdirSync(CARTRIDGE_DIR, { recursive: true });
        copyFileSync(FIXTURE, DROPPED);

        try {
            await context.clearCookies();
            await page.addInitScript(() => localStorage.clear());
            // Give Vite a moment to rescan the glob.
            await page.waitForTimeout(800);
            await page.goto('/');

            const editor = page.locator('.cm-content');
            await expect(editor).toContainText('hello, world');

            await page.getByRole('button', { name: /gallery/i }).click();
            const dialog = page.getByRole('dialog', { name: /choose a cartridge/i });
            await expect(dialog).toBeVisible();

            // At least one card; click the first one.
            const card = dialog.getByRole('button').filter({ hasNotText: /cancel/i }).first();
            await expect(card).toBeVisible();
            await card.click();

            // Modal closes, no confirmation (we were on the untouched skeleton).
            await expect(dialog).not.toBeVisible();
            // Editor now shows the fixture's content rather than the skeleton's hello, world line.
            await expect(editor).not.toContainText('hello, world');
        } finally {
            if (existsSync(DROPPED)) unlinkSync(DROPPED);
        }
    });

    test('shows the replace-confirm when picking a card over a modified sketch', async ({ page, context }) => {
        if (!existsSync(FIXTURE)) test.skip(true, 'fixture cartridge missing — generate via Download in the editor');
        if (!existsSync(CARTRIDGE_DIR)) mkdirSync(CARTRIDGE_DIR, { recursive: true });
        copyFileSync(FIXTURE, DROPPED);

        try {
            await context.clearCookies();
            await page.addInitScript(() => localStorage.clear());
            await page.waitForTimeout(800);
            await page.goto('/');

            // Modify the script so isUntouchedSkeleton returns false.
            const editor = page.locator('.cm-content');
            await editor.click();
            await page.keyboard.press('Control+A');
            await page.keyboard.type('-- I have edits', { delay: 1 });
            await expect(editor).toContainText('I have edits');

            await page.getByRole('button', { name: /gallery/i }).click();
            const gallery = page.getByRole('dialog', { name: /choose a cartridge/i });
            const card = gallery.getByRole('button').filter({ hasNotText: /cancel/i }).first();
            await card.click();

            // Gallery closes, UploadConfirm appears.
            await expect(gallery).not.toBeVisible();
            const upload = page.getByRole('dialog', { name: /replace/i });
            await expect(upload).toBeVisible();

            // Cancel the replace — edits survive.
            await upload.getByRole('button', { name: /cancel/i }).click();
            await expect(upload).not.toBeVisible();
            await expect(editor).toContainText('I have edits');
        } finally {
            if (existsSync(DROPPED)) unlinkSync(DROPPED);
        }
    });
});
```

- [ ] **Step 3: Run the gallery E2E spec**

Run: `cd editor && npx playwright test tests/e2e/gallery.spec.ts`
Expected: 3 tests pass.

If "loads a cartridge" or "shows the replace-confirm" fails because the gallery shows the empty-state message even after the fixture was copied, increase the `waitForTimeout` to 2000 ms — Vite's glob rescan latency varies by machine. If the test still fails, run `./scripts/dev.sh` in a separate shell so the dev server is warm before Playwright starts.

- [ ] **Step 4: Commit**

```bash
git add editor/tests/fixtures/gallery-sample.tb.png editor/tests/e2e/gallery.spec.ts
git commit -m "e2e: gallery modal empty-state, silent load, and replace-confirm"
```

---

## Final verification

After all tasks are complete:

- [ ] **All unit tests pass**

Run: `cd editor && npm test`

- [ ] **All E2E tests pass**

Run: `cd editor && npx playwright test`

- [ ] **Manual sanity check**

Run: `./scripts/dev.sh`. In a fresh browser profile:
1. Editor opens with the hello-world skeleton.
2. ▶ Play renders text on the canvas.
3. 🗑 Clear → confirm → editor returns to the skeleton.
4. 🎮 Gallery → empty state message; Esc closes.
5. Drop a `.tb.png` cartridge into `editor/src/cartridges/` (you may need to wait or refresh).
6. 🎮 Gallery → card appears; click it → cartridge loads.

- [ ] **Lucky Leprechaun is entirely gone**

Run: `git grep -i "lucky leprechaun\|leprechaun_x\|catch_sound\|loadDemo\|DemoConfirm" -- ':!docs/'`
Expected: no matches (docs intentionally still reference the migration; everything else is clean).
