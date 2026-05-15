# Cartridge Gallery & Hello-World Skeleton — Design

**Date:** 2026-05-15
**Status:** Spec
**Related code:** `editor/src/App.tsx`, `editor/src/state/sketchStore.ts`, `editor/src/state/demo.ts` (removed), `editor/src/ui/Toolbar.tsx`, `editor/src/ui/DemoConfirm.tsx` (removed), `editor/src/ui/ClearConfirm.tsx`, `editor/src/engine/decoder.ts`, `editor/public/`

## Problem

The editor currently auto-loads the **Lucky Leprechaun** demo on first run and exposes a single `⭐ Demo` button to reload it. That choice solves "the empty editor is uninviting" but bakes in three limitations:

1. There is exactly one demo. To showcase what TinyBit can do — different art styles, music, gameplay shapes — there's no place to put more.
2. The single demo is hard-coded in TypeScript (`editor/src/state/demo.ts`). Contributors who want to add an example cartridge have to write Lua, paint a sprite, regenerate a PNG via a node script, and edit source — not the workflow you'd want.
3. The first-boot experience defaults to *running someone else's code*. The editor is a code editor; the natural default state is a tiny script the user can read at a glance.

The `Clear` button drops to a fully empty editor (`script = ''`, no sprite, no metadata). That's a fine "nuke" but it's a poor starting point — the user has to recall the shape of `_draw` from scratch before anything renders.

## Goal

Replace the auto-loaded demo with two distinct features:

1. A **hello-world skeleton** as the actual default editor state — minimal, readable, runnable. Used both on first boot and as the target state of `Clear`.
2. A **gallery modal** that lists `.tb.png` cartridges from a git-tracked folder. The user opens it from the toolbar, picks a card, the cartridge loads into the editor.

The Lucky Leprechaun demo is removed from the codebase entirely; the saved `.tb.png` can be dropped into the gallery folder later if desired as one example among others.

## Non-goals

- Auto-opening the gallery on first boot. The first-boot experience is the skeleton, full stop. The gallery is a deliberate action.
- Editing cartridges in-place from the gallery. Pick a cartridge → it loads into the editor → from there it's a normal edit session.
- Uploading or sharing cartridges from the browser into the gallery. The gallery is read-only; contributors add files via git.
- Tagging, search, categories, sorting. The gallery is a flat grid in filesystem order.
- A manifest file or build-time index. Enumeration is automatic from the folder contents.
- Touching the C engine, the encoder, or the wasm crate. All changes are in `editor/`.
- Preserving the user's current sketch on Clear or on gallery-load. Both are destructive and confirmed.

## User-facing surface

### First-boot experience

On a fresh browser, the editor opens with:

- **Script tab:** the hello-world skeleton (below). About 6 lines, including comments.
- **Sprite tab:** empty (null spritesheet — encoder uses placeholder at Play time).
- **Cartridge tab:** empty title, empty author, no cover.
- **Canvas:** idle. Pressing ▶ Play renders `hello, world` near the centre of the canvas; proves the engine boots.

The skeleton script:

```lua
-- Welcome to TinyBit. Press ▶ Play to run.
-- Click 🎮 Gallery in the toolbar to load an example cartridge.

function _draw()
    cls()
    cursor(34, 60)
    print("hello, world")
end
```

(The exact pixel offsets in `cursor()` are owned by the implementer — the intent is "the text is visible and roughly centred". If TinyBit's default text colour against the default `cls()` background is unreadable, the implementer adds a `text()` call.)

### Toolbar

The `⭐ Demo` button is removed. A `🎮 Gallery` button takes the same slot:

```
[▶ Play] [■ Stop] [🗑 Clear] [🎮 Gallery] [📂 Open] [⬇ Download]   Idle
```

Always enabled. Same `neutralStyle` as the surrounding buttons. `aria-label="Open gallery"`.

### Clear button

Behaviour change: `Clear` now resets the editor to the **same untouched-skeleton state** as a fresh first-boot — not to fully empty fields.

- `script` ← `SKELETON_SCRIPT`
- `sprite` ← null
- `cover` ← null
- `title` ← `''`
- `author` ← `''`

The confirmation modal (`ClearConfirm.tsx`) stays. Body copy updates from *"This will discard your current script, sprite, cover, title, and author. Editor preferences are kept."* to:

> *"This will discard your current cartridge and reset the editor to the hello-world skeleton. Editor preferences are kept."*

The persistence write that already follows confirmation now writes the skeleton state to localStorage instead of empty strings.

### Gallery modal

Triggered by the toolbar's `🎮 Gallery` button. Same overlay/dialog styling as `UploadConfirm` and `DemoConfirm` (now removed) — but wider, since it holds a grid.

**Header:** *"Choose a cartridge"*

**Body:** a CSS grid of cards (≈3–4 per row at default modal width), each card:

- 96×96 cover thumbnail rendered from the cartridge's embedded cover.
- Title underneath — 14 px, single line, ellipsis on overflow.
- Author underneath — 12 px, muted, single line, ellipsis on overflow.
- The whole card is a `<button>` for keyboard accessibility. Hover/focus styles match the existing button visuals in the toolbar.

**Empty folder state:** centred message:

> *"No cartridges in `editor/src/cartridges/`. Drop `.tb.png` files there to populate the gallery."*

**Per-card failure state:** if a single `.tb.png` fails to decode, render a "broken cartridge" placeholder card (greyed border, ⚠ icon) with the filename and the decoder's error message in a smaller font. Clicking the card is a no-op. Other cards continue to work.

**Loading state:** while the first decode pass is in flight, show a centred "Loading…" message. Subsequent opens render instantly from cache.

**Footer:** a single `Cancel` button. There is no `Load` button — clicking a card is the load action.

**Keyboard:** `Esc` closes the modal (same behaviour as `DemoConfirm`).

### Click → load flow

Clicking a card:

1. If the current sketch is the **untouched skeleton** (script equals `SKELETON_SCRIPT`, sprite null, cover null, title `''`, author `''`) → load silently: decode the cartridge, populate the sketch store, stop the engine if running, close the modal.
2. Otherwise → close the gallery modal, open the existing `UploadConfirm` modal ("Replace current sketch?"). On confirm, run the same decode-and-populate flow. On cancel, the modal closes and the sketch is untouched.

Reusing `UploadConfirm` is deliberate — the user's mental model is "this is replacing my current work with someone else's cartridge", which is exactly the drag-and-drop / Open flow.

## Cartridges folder — the drop zone

**Location:** `editor/src/cartridges/`

To add an example cartridge to the gallery: drop any `.tb.png` file into this folder and commit it. No naming convention beyond the `.tb.png` extension. Filename is not user-visible — the cartridge's embedded title is what shows on the card. The folder ships with a `.gitkeep` file so it's tracked even when empty.

### Why `src/` and not `public/`

Two options were considered:

- **`editor/public/cartridges/`** — files served as-is by Vite, fetched by URL at runtime. Simple mental model, but Vite does *not* auto-serve directory listings, so we'd need a manifest JSON or a separate enumeration step.
- **`editor/src/cartridges/`** — files enumerated at build time via `import.meta.glob`. No manifest needed; adding a file is a one-step operation.

We pick `src/` because it cleanly satisfies "drop files in, gallery picks them up". The cartridge bytes are still served as static assets at runtime — `import.meta.glob` with `{ query: '?url', import: 'default' }` returns a record of `path → () => Promise<string>` (URL to the asset), so we still `fetch()` the bytes; we just get the URL list for free.

### Enumeration mechanics

```ts
// editor/src/state/gallery.ts
const modules = import.meta.glob<string>(
    '../cartridges/*.tb.png',
    { query: '?url', import: 'default' },
);
```

Vite watches the glob pattern in dev — adding/removing a file triggers HMR. In production, the file list is frozen at build time, which is correct: gallery contents are tied to the deployed bundle.

## Architecture

### New: `editor/src/state/skeleton.ts`

Single source of truth for the empty-editor state. Used by first-boot, by `Clear`, and by the gallery's "is current sketch untouched?" check.

```ts
export const SKELETON_SCRIPT = `\
-- Welcome to TinyBit. Press ▶ Play to run.
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

### New: `editor/src/state/gallery.ts`

```ts
import type { Decoder } from '../engine/decoder';

export interface GalleryEntry {
    id:        string;        // stable key — the path from the glob
    filename:  string;        // basename, for failure-card display
    title:     string;        // from tb_dec_title
    author:    string;        // from tb_dec_author
    coverUrl:  string;        // data: URL synthesized from tb_dec_cover RGBA
    cartridge: Uint8Array;    // raw .tb.png bytes (kept so we don't refetch)
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

export async function loadGallery(decoder: Decoder): Promise<GalleryLoadResult>;
```

Implementation:

1. `import.meta.glob` returns `Record<string, () => Promise<string>>`. Iterate keys in sorted order (deterministic display).
2. For each key, `await loader()` to get the URL, then `fetch(url)` to get the bytes.
3. Run `decoder.decode(bytes)`. On success, encode the 128×128 RGBA cover to a `data:image/png;base64,...` URL via a canvas (see "Cover encoding" below). Build the `GalleryEntry`.
4. On failure (network or `DecodeError`), record a `GalleryFailure`.
5. Return both lists. Caller decides what to render.

**Caching.** A module-level promise caches the first call:

```ts
let cachePromise: Promise<GalleryLoadResult> | null = null;

export function loadGallery(decoder: Decoder): Promise<GalleryLoadResult> {
    if (!cachePromise) cachePromise = loadGalleryImpl(decoder);
    return cachePromise;
}

if (import.meta.hot) {
    import.meta.hot.accept(() => { cachePromise = null; });
}
```

**Cover encoding.** The decoder yields a 128×128 RGBA `Uint8Array`. To get a `data:` URL, draw it onto an offscreen `<canvas>` via `ImageData` and call `canvas.toDataURL('image/png')`. `editor/src/lib/png.ts` today only exports `readPngSize`; we add `rgbaToDataUrl(pixels, width, height): string` there so the helper is colocated with the other PNG utilities.

### New: `editor/src/ui/GalleryModal.tsx`

Props:

```ts
export interface GalleryModalProps {
    open:     boolean;
    state:    | { kind: 'loading' }
              | { kind: 'ready'; entries: GalleryEntry[]; failures: GalleryFailure[] }
              | { kind: 'error'; message: string };
    onPick(entry: GalleryEntry): void;
    onCancel(): void;
}
```

Renders the modal shell (portal, overlay, dialog) and switches body based on `state`. Esc → `onCancel`. Click outside the dialog → `onCancel` (mirrors `UploadConfirm`).

Card click → `onPick(entry)`. The component does not itself decide whether to load silently or show the confirmation — that's `App.tsx`'s job.

### Changes: `editor/src/App.tsx`

Remove `loadDemo` import and the `demoConfirmOpen` state. Replace with:

```ts
import { SKELETON_SCRIPT, isUntouchedSkeleton } from './state/skeleton';
import { loadGallery, type GalleryLoadResult, type GalleryEntry } from './state/gallery';
import { GalleryModal } from './ui/GalleryModal';

const [galleryOpen, setGalleryOpen] = useState(false);
const [gallery, setGallery] = useState<GalleryLoadResult | null>(null);
const [galleryError, setGalleryError] = useState<string | null>(null);
```

**First-boot effect:**

```ts
useEffect(() => {
    const stored = loadSketch();
    if (stored) {
        // existing hydrate logic
    } else {
        sketch.setScript(SKELETON_SCRIPT);
        // sprite/cover/title/author already default to null/''
    }
}, []);
```

**Clear:** `handleClearConfirm` swaps `''` for `SKELETON_SCRIPT` and persists the skeleton:

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

**Gallery open:**

```ts
const handleGalleryOpen = useCallback(async () => {
    setGalleryOpen(true);
    if (!gallery && runtime?.decoderAvailable) {
        try {
            const result = await loadGallery(runtime.dec);
            setGallery(result);
        } catch (err) {
            setGalleryError(err instanceof Error ? err.message : String(err));
        }
    }
}, [gallery, runtime]);
```

**Gallery pick:**

```ts
const handleGalleryPick = useCallback((entry: GalleryEntry) => {
    setGalleryOpen(false);
    const current = {
        script: sketch.script, sprite: sketch.sprite, cover: sketch.cover,
        title:  sketch.title,  author: sketch.author,
    };
    if (isUntouchedSkeleton(current)) {
        loadCartridgeBytes(entry.cartridge, entry.filename);  // direct
    } else {
        setPendingUpload({ bytes: entry.cartridge, filename: entry.filename });
    }
}, [sketch, /* loadCartridgeBytes */]);
```

Where `loadCartridgeBytes(bytes, filename)` is the shared decode-and-populate path — extracted from the current `handleConfirmReplace`. After this refactor, both `handleConfirmReplace` (drag-drop / Open) and the silent gallery-pick path call the same function.

### Changes: `editor/src/ui/Toolbar.tsx`

Rename `onDemo` → `onGallery`; change label from `⭐ Demo` to `🎮 Gallery`; update `aria-label` to `"Open gallery"`. No other changes.

### Changes: `editor/src/ui/ClearConfirm.tsx`

Body copy updates as noted under "Clear button" above. No structural change.

### Files removed

- `editor/src/state/demo.ts`
- `editor/src/state/demo.test.ts`
- `editor/src/ui/DemoConfirm.tsx`
- `editor/src/ui/DemoConfirm.test.tsx`
- `editor/public/demo-sprite.png`
- `editor/tests/e2e/demo-button.spec.ts`

References in `Toolbar.test.tsx`, `App.test.tsx`, `e2e/smoke.spec.ts` that assert on Lucky Leprechaun strings are updated to assert on the skeleton instead.

### Files added

- `editor/src/state/skeleton.ts`
- `editor/src/state/skeleton.test.ts`
- `editor/src/state/gallery.ts`
- `editor/src/state/gallery.test.ts`
- `editor/src/ui/GalleryModal.tsx`
- `editor/src/ui/GalleryModal.test.tsx`
- `editor/src/cartridges/.gitkeep`
- `editor/tests/e2e/gallery.spec.ts`

## Tests

### Unit / component

| File | Status | What it covers |
|---|---|---|
| `editor/src/state/skeleton.test.ts` | new | `isUntouchedSkeleton` returns true for the literal default; returns false when any of script/sprite/cover/title/author is mutated. |
| `editor/src/state/gallery.test.ts` | new | Mock `import.meta.glob` to return two known URLs, mock `fetch`, mock decoder; verify entries shape, ordering, failure collection, and that a second call returns the cached promise. |
| `editor/src/ui/GalleryModal.test.tsx` | new | Renders loading/empty/error/ready states; clicking a card calls `onPick` with the right entry; Esc and outside-click call `onCancel`; failure cards are non-interactive. |
| `editor/src/ui/Toolbar.test.tsx` | update | `🎮 Gallery` button rendered in the right slot and calls `onGallery`. Remove demo-button assertion. |
| `editor/src/ui/ClearConfirm.test.tsx` | update | Body copy reflects "reset to skeleton". |
| `editor/src/App.test.tsx` | update | First-boot populates `script` with `SKELETON_SCRIPT`; Clear button resets to skeleton, not to empty. |
| `editor/src/state/sketchStore.test.ts` | no change | `DEFAULT_SCRIPT` in the store stays as-is — the skeleton lives in its own module. |

### E2E (Playwright)

| File | Status | What it covers |
|---|---|---|
| `editor/tests/e2e/smoke.spec.ts` | update | First-boot script editor contains `"hello, world"` (was: contains `"gold"`). |
| `editor/tests/e2e/clear.spec.ts` | update | After Clear, the editor shows the skeleton (assert on `"hello, world"`), not empty. |
| `editor/tests/e2e/gallery.spec.ts` | new | (a) Open gallery on a clean profile → cards render (depends on whether the folder ships with seed cartridges — see Open questions). (b) Click a card on untouched skeleton → cartridge loads silently. (c) Modify the script, click Gallery, click a card → `UploadConfirm` appears; Cancel keeps the modified script; Replace loads the cartridge. (d) Gallery with empty folder → empty-state message. |
| `editor/tests/e2e/demo-button.spec.ts` | removed | Demo button is gone. |

## Risks and edge cases

- **Vite HMR for newly added `.tb.png` files.** In some Vite versions, glob imports don't pick up new matching files without a server restart. If observed, document it (`scripts/dev.sh`'s restart cycle is short); not a design blocker.
- **First gallery-open decode cost.** For ≤10 cartridges, total <300 ms — acceptable behind a "Loading…" message. For 50+ cartridges this becomes noticeable; gallery is unlikely to grow that big, and `Promise.all` can be added later if it does.
- **Cover encoding via canvas.** Requires the cover RGBA to be a clean 128×128 array. The decoder already guarantees this shape (verified in `editor/src/engine/decoder.ts`). If a cartridge somehow ships a malformed cover, the canvas path throws — caught and surfaces as a per-card failure.
- **The skeleton-state detection is shallow string comparison.** If a future change mutates `SKELETON_SCRIPT` between releases, users who had auto-saved the *old* skeleton will no longer be considered "untouched" and will get the confirmation modal when they pick a gallery entry. Benign — they have nothing to lose by confirming.
- **Engine state on silent load.** The silent-load path still needs to `frameLoopRef.current?.stop()` and `runtime.tb.stop()` before decode, identical to `handleConfirmReplace`. That's why the shared helper exists.
- **Encoder placeholder for empty cover/sprite at Play time.** The skeleton has no cover or sprite. Existing `getPlaceholderCover` / `getPlaceholderSprite` already handle this — verified in `App.tsx:271-291`. No change needed.
- **localStorage migration.** Users who already have a saved Lucky Leprechaun sketch in localStorage will hydrate that on next visit — no upgrade hook needed, and nothing depends on the script's content. They can `Clear` to get the skeleton.

## Seed content

The initial PR ships with an **empty** `editor/src/cartridges/` folder (just `.gitkeep`). Example cartridges are added in follow-up commits as separate, reviewable units. The gallery's empty-state message is the first thing users see if they open the modal on a fresh clone — which is fine, since the message points to exactly the folder they need to populate.

The E2E gallery spec accounts for this: the "cards render" case is asserted via a test fixture (a `.tb.png` copied into `editor/src/cartridges/` only at test time, then cleaned up) rather than by depending on real seed files.

## Out of scope (future work)

- Searching / filtering / categories for large galleries.
- Hover-to-preview (autoplay in the card).
- "Save current sketch into the gallery" round-trip.
- Per-cartridge metadata beyond what's already in the cartridge header (e.g., description, controls).
- Localized strings — copy is English-only.
