# Default Demo Cartridge & Reset — Design

**Date:** 2026-05-14
**Status:** Spec
**Related code:** `editor/src/state/sketchStore.ts`, `editor/src/state/persist.ts`, `editor/src/App.tsx`, `editor/src/ui/Toolbar.tsx`, `editor/src/ui/UploadConfirm.tsx`, `editor/public/`

## Problem

The first thing a new user sees when opening the editor is an essentially empty editor: a four-line stub script (`cls(0x0000); spr(0, 60, 60)`), a null spritesheet, and no title/author. There is nothing to play, nothing to read, no demonstration that audio or input or sprites work. After they start editing, there is also no built-in way to throw away their work and get back to a known-good starting point — the only path is to manually clear `localStorage` from devtools.

## Goal

Replace the empty default with a small, complete, playable **Star Catcher** demo that boots automatically on first run, and add a **Reset** button in the toolbar that returns the project to that demo state (with a confirmation dialog, since the action is destructive).

## Non-goals

- A tutorial / multi-step "first run" experience. The demo is one cartridge that runs; the script is the tutorial.
- Multiple demos to pick from. Future work can ship a sample-cartridges menu; this design adds one.
- Touching the C engine, the encoder/decoder, or the wasm crate. All changes are in `editor/`, `editor/public/`, and `scripts/`.
- Preserving the user's *current* project somewhere on reset. Reset discards. Users who want to keep work should download a `.tb.png` first; the toolbar already exposes that.
- Resetting editor preferences (panel layout, sprite-editor tool prefs). Reset clears project state only.

## User-facing surface

### First-run experience

On a fresh browser (or after `localStorage.clear()`), opening the editor shows:

- **Script tab:** ~60 lines of readable Lua implementing Star Catcher, with `--@music` and `--@sfx` annotations at the top.
- **Sprite tab:** A 128×128 spritesheet with sprite 0 (ship) and sprite 1 (star) painted in the top-left tiles; rest transparent.
- **Cartridge tab:** Title `Star Catcher`, author `TinyBit`.
- **Canvas:** Idle. Clicking ▶ Play runs the game — ship moves left/right with arrow keys, stars fall, score increments on catch, background music loops, catch SFX plays per catch.

### Toolbar — Reset button

A new `↺ Reset` button is inserted **between Stop and Open** in `Toolbar.tsx`. Same `neutralStyle` as the other toolbar buttons. Always enabled (it doesn't depend on engine state).

```
[▶ Play] [■ Stop] [↺ Reset] [📂 Open] [⬇ Download]   Idle
```

Clicking opens a confirmation modal:

```
┌──────────────────────────────────────┐
│ Reset to the demo?                   │
│                                      │
│ This will discard your current       │
│ script, sprite, cover, title, and    │
│ author. Editor preferences are kept. │
│                                      │
│              [Cancel] [Reset]        │
└──────────────────────────────────────┘
```

Cancel dismisses with no side effects. Reset:

1. Stops the frame loop and the engine (same calls as `handleStop`).
2. Calls `clearSketch()` (new helper in `persist.ts`) to remove the `tinybit-editor/sketch/v1` localStorage key. UI layout and sprite-UI keys are left intact.
3. Calls `loadDemo(sketch, consoleAppend)` to repopulate the store with the demo (same routine that runs on first-boot below).
4. Closes the modal.

The auto-save effect in `App.tsx` will immediately re-persist the demo to localStorage after step 3, so a subsequent reload finds it cached and does not re-fetch the demo sprite PNG.

## Architecture

### New module: `editor/src/state/demo.ts`

Single export: `loadDemo(sketch, consoleAppend) → Promise<void>`.

```ts
export const DEMO_TITLE  = 'Star Catcher';
export const DEMO_AUTHOR = 'TinyBit';
export const DEMO_SCRIPT = `...`;  // the Lua source, as a template literal

export async function loadDemo(
    sketch: SketchState,
    warn: (msg: string) => void,
): Promise<void> {
    sketch.setScript(DEMO_SCRIPT);
    sketch.setTitle(DEMO_TITLE);
    sketch.setAuthor(DEMO_AUTHOR);
    sketch.setCover(null);  // placeholder cover used at encode time
    try {
        const res = await fetch('/demo-sprite.png');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        await sketch.setSpriteFromPng(bytes);
    } catch (err) {
        warn(`Could not load demo sprite: ${err instanceof Error ? err.message : String(err)}`);
        // Leave sprite null — encoder uses placeholder, game still runs but with no art.
    }
}
```

This is the single source of truth for "what is the demo." Both first-boot and Reset call it.

`DEMO_SCRIPT` is a regular template literal in source so it shows up in grep, diffs cleanly, and can be hand-edited without re-running any generator.

### New asset: `editor/public/demo-sprite.png`

A 128×128 RGBA PNG with two sprites:

- **Tile (0, 0)** — pixels `[0..7, 0..7]` — **Sprite 0: ship.** A small white triangle silhouette pointing up, ~5 rows tall, painted on a transparent background.
- **Tile (1, 0)** — pixels `[8..15, 0..7]` — **Sprite 1: star.** A yellow 5-point diamond/sparkle: corners filled, center column filled, ~7 yellow pixels.
- All other tiles: fully transparent (alpha = 0).

The transparent background relies on the engine's existing "alpha 0 = don't draw" convention — verified by inspecting `spr()` behavior in `src/tinybit/`. If that turns out to be wrong, fall back to using a designated chroma-key color (e.g. magenta `0xFF00FFFF`) and document it in the script comment.

### New generator: `scripts/build_demo_sprite.mjs`

A Node ESM script using only built-in `fs` and `zlib` (no npm deps). It:

1. Allocates a `Uint8Array(128 * 128 * 4)` (RGBA, all zero = fully transparent).
2. Paints sprite 0 and sprite 1 by writing RGBA bytes at the right offsets. Pixel patterns are hard-coded as small 2D arrays in the script — readable and editable.
3. Hand-rolls a minimal PNG: 8-byte signature, IHDR (color type 6 = RGBA, bit depth 8), IDAT (deflated stream of rows prefixed with filter byte `0x00`), IEND. CRCs computed inline.
4. Writes `editor/public/demo-sprite.png`.

The script is committed so the art is reproducible and so future contributors can tweak the sprites without resorting to external image tools (although they can equally well open the PNG in the editor's own Sprite tab and re-export).

Not added to `package.json` scripts — it's a one-shot regenerator, invoked manually (`node scripts/build_demo_sprite.mjs`) when the art changes.

### Changes to `editor/src/state/persist.ts`

Add one tiny function:

```ts
export function clearSketch(): void {
    try { localStorage.removeItem(SKETCH_KEY); } catch { /* ignore */ }
}
```

Only removes `SKETCH_KEY`. The `UI_KEY` and `SPRITE_UI_KEY` entries are deliberately left alone — those are editor preferences, not project state.

### Changes to `editor/src/state/sketchStore.ts`

**None.** `DEFAULT_SCRIPT` keeps its current 4-line stub value as the store's internal "blank canvas" default. The stub is never user-visible in normal flow: `App.tsx`'s mount effect runs `loadDemo()` immediately on null-localStorage, which synchronously overwrites the script before the first paint. The stub only surfaces in unit tests that construct the store directly, which is fine.

This keeps the change small and avoids touching the half-dozen tests across `sketchStore.test.ts`, `persist.test.ts`, and `score/ScoreTab.test.tsx` that depend on `DEFAULT_SCRIPT`.

`reset()` on the store stays as-is. The user-facing "Reset" button does *more* than `store.reset()` — it stops the engine, clears localStorage, and runs `loadDemo()` — so it lives at the `App.tsx` level, not as a store method.

### Changes to `editor/src/App.tsx`

The current mount effect:

```ts
useEffect(() => {
    const stored = loadSketch();
    if (stored) { /* hydrate */ }
}, []);
```

…becomes:

```ts
useEffect(() => {
    const stored = loadSketch();
    if (stored) {
        // hydrate from localStorage (existing logic)
    } else {
        void loadDemo(sketch, (msg) => consoleAppend('warn', msg));
    }
}, []);
```

A new `handleReset` callback wires the toolbar button:

```ts
const handleReset = useCallback(() => {
    setResetConfirmOpen(true);
}, []);

const handleResetConfirm = useCallback(() => {
    setResetConfirmOpen(false);
    frameLoopRef.current?.stop();
    runtime?.tb.stop();
    clearSketch();
    void loadDemo(sketch, (msg) => consoleAppend('warn', msg));
}, [runtime, sketch, consoleAppend]);
```

The toolbar gets a new `onReset` prop wired to `handleReset`. The `<ResetConfirm>` modal is rendered alongside `<UploadConfirm>` at the bottom of the JSX.

### New component: `editor/src/ui/ResetConfirm.tsx`

Direct parallel to `UploadConfirm.tsx`. Props: `{ onReset: () => void; onCancel: () => void }`. Same modal styling, same focus-trap behavior if `UploadConfirm` has one (verify when implementing). Body text: *"Reset to the demo? This will discard your current script, sprite, cover, title, and author. Editor preferences are kept."* Buttons: `Cancel` (default focus), `Reset` (red).

### Changes to `editor/src/ui/Toolbar.tsx`

Add `onReset(): void` to `ToolbarProps`. Insert the new button between the existing Stop and Open buttons, using the same `neutralStyle`:

```tsx
<button type="button" onClick={p.onReset} style={neutralStyle} aria-label="Reset to demo">
    ↺ Reset
</button>
```

## The demo script

Target: ~60 lines, readable, exercises `cls` / `spr` / `btn` / `print` / `music` / `sfx` / `math.random`.

```lua
--@music
local bgm = [[
L:1/4
K:C
Q:1/4=110
C E G c | B G E C | F A c f | e c A F |
]]

--@sfx
local catch_sfx = "c/4e/4g/4c"

local ship_x = 60
local score  = 0

local stars = {}
for i = 1, 3 do
    stars[i] = { x = math.random(0, 120), y = math.random(-128, 0) }
end

function _init()
    music(bgm)
end

function _update()
    if btn(0) then ship_x = ship_x - 2 end  -- left
    if btn(1) then ship_x = ship_x + 2 end  -- right
    if ship_x < 0   then ship_x = 0   end
    if ship_x > 120 then ship_x = 120 end

    for i, s in ipairs(stars) do
        s.y = s.y + 1
        local caught =
            s.y >= 112 and s.y <= 120 and
            s.x + 8 >= ship_x and s.x <= ship_x + 8
        if caught then
            score = score + 1
            sfx(catch_sfx)
            s.x = math.random(0, 120)
            s.y = math.random(-64, -8)
        elseif s.y > 128 then
            s.x = math.random(0, 120)
            s.y = math.random(-64, -8)
        end
    end
end

function _draw()
    cls(0x0000)
    for i, s in ipairs(stars) do
        spr(1, s.x, s.y)
    end
    spr(0, ship_x, 120)
    print("score " .. score, 4, 4, 0xFFFF)
end
```

Notes on this draft:
- `_init` / `_update` / `_draw` is the engine's expected callback shape (verify against the actual exposed callbacks during implementation — currently the existing default uses only `_draw`, so this may need adjusting).
- `music(bgm)` is called once in `_init` so it doesn't restart every frame.
- Button indices `0` and `1` are left/right per the engine convention (verify against `BUTTONS` map in `editor/src/engine/tinybit.ts` during implementation).
- Color `0xFFFF` for `print` is white (RGB565 all-bits-set, assuming RGB565 — verify against `cls` usage). If the engine uses a different color model for `print`, adjust.
- The actual final script text is owned by the implementer and may shift in details; this draft is the design intent.

## Tests

### Unit / component

| File | Adds |
|---|---|
| `editor/src/state/demo.test.ts` (new) | `loadDemo()` populates script/title/author; mocked `fetch` returning a known PNG results in `sketch.spritePixels` being non-null; fetch-failure path warns via the sink and leaves sprite null. |
| `editor/src/state/persist.test.ts` | `clearSketch()` removes only `SKETCH_KEY`; `UI_KEY` and `SPRITE_UI_KEY` survive. |
| `editor/src/state/sketchStore.test.ts` | No changes — `DEFAULT_SCRIPT` is preserved. |
| `editor/src/ui/Toolbar.test.tsx` | Reset button is rendered between Stop and Open and calls `onReset` when clicked. |
| `editor/src/ui/ResetConfirm.test.tsx` (new) | Renders body text; Cancel calls `onCancel`; Reset calls `onReset`; Escape key calls `onCancel` (if `UploadConfirm` has that, mirror it). |

### E2E (Playwright)

One new spec:

- Open app with a clean profile → editor shows the Star Catcher script (assert on a stable substring like `"score " .. score`).
- Type junk into the script editor → reload page → junk persists (existing persistence behavior, regression check).
- Click `↺ Reset` → confirm in the dialog → editor reverts to the demo script.
- Click `↺ Reset` → click Cancel → editor still shows the junk.

## Risks and edge cases

- **Engine callback shape.** If the engine doesn't support `_init` (only `_update` / `_draw`), restructure the demo to do the `music(bgm)` call inside `_update` guarded by a `started` flag, or in a top-level statement before the function definitions. Confirm during implementation by reading `src/tinybit/cartridge.c` or by trying it.
- **Transparency convention.** If `spr()` doesn't honor alpha-0 as transparent, the spritesheet generator switches to a chroma-key color (`0xFF00FFFF` magenta) and the design note above is updated. Verify before implementing the generator.
- **Fetch-on-reset latency.** On Reset the demo sprite re-fetches over the network (or from disk cache). Typical service-worker / Vite dev server response is <10ms; in dev with a cold cache it could be ~50ms. Acceptable. If it ever becomes a problem, cache the decoded `spritePixels` in a module-level variable.
- **Localized PNG missing in prod build.** `editor/public/demo-sprite.png` must be included in the Vite build output (default behavior for `public/`). Verify the file appears in `dist/` after `npm run build`. The `fetch` URL uses an absolute path so it works under any base path.
- **Audio context not started.** Browsers gate `AudioContext` behind a user gesture. The demo only starts audio when the user clicks Play, so the first audible note is post-gesture — no special handling needed.
- **Encoder-decoder round-trip.** Once the user plays/downloads the demo and re-uploads it, the spritesheet round-trips with 4-bit-per-channel loss (per `CLAUDE.md`). The demo's two sprites should still be visually identical after loss because they use only fully-saturated primaries. Verify by visual inspection during implementation.

## Open questions

None at design time. Implementation will need to verify the three "verify during implementation" items called out above (engine callbacks, transparency, button indices). Each has a documented fallback so none is a design blocker.

## Out of scope (future work)

- Multiple sample cartridges with a chooser UI.
- A "duplicate current as new starter" command.
- Localized strings — copy is English-only.
