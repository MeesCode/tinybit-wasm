# Spritesheet editor

**Date:** 2026-05-11
**Branch:** `feat/spritesheet-editor`
**Scope:** Replace the "alt" tab placeholder in `editor/src/ui/AltEditorTab.tsx` with a working pixel editor for the 128×128 cartridge spritesheet. Pencil (with size modifier), eraser, flood fill, and eyedropper. Cursor-anchored zoom, a colour picker that snaps to the cartridge's native RGBA4444 depth, and grid + coordinate overlays at higher zoom. Live writes propagate to the running game via a new WASM export.

## Motivation

The cartridge tab currently asks authors to bring their own pre-made PNG. That's fine for power users and broken for everyone else. The "alt" tab next to `script.lua` has been a placeholder since the editor shipped — it's the natural home for an in-browser sprite editor. The two unblocking facts:

1. The cartridge format stores sprites at **RGBA4444** (top 4 bits of each channel survive encoding). That's a small, well-defined colour space we can build a faithful picker around.
2. The engine keeps the spritesheet at a known location in `TinyBitMemory`. Exposing a pointer to it (analogous to the existing `tb_display_ptr`) lets the editor write into the running game's sprite buffer between frames — same trick PICO-8 uses for live sprite preview.

Together those let the editor be both correct (no surprise colour shifts at encode time) and immediate (paint while the game runs).

## Decisions

| | |
|---|---|
| Live edit while running | Yes. New WASM export `tb_spritesheet_ptr()` returns a writable pointer to the engine's in-memory spritesheet. Paint strokes mirror into it in real time. |
| Pixel data model | Canonical RGBA8 `Uint8Array(128 * 128 * 4)` in JS state (`sketchStore.spritePixels`). PNG (`sketchStore.sprite`) is a derived form, re-encoded debounced on stroke commit. |
| Colour depth | Picker UI is full 8-bit, but every colour is snapped to top-4-bits-per-channel (RGBA4444 → 16 levels per channel, ~4096 colours, 16 alpha levels) before storage. Eyedropper also returns snapped values. |
| Tools (v1) | Pencil (size: 1/2/3/4/8 px), eraser (same size scale), flood fill (4-connected), eyedropper. No line/rect/selection in v1. |
| Undo/redo | Per-stroke history, cap 50. Stored as before/after dirty-rect patches (not full snapshots). `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`. |
| Zoom | Integer steps `1, 2, 4, 8, 16, 24, 32`. `Ctrl/Cmd+wheel` zooms toward the cursor. Keys `+`/`-` step. Toolbar buttons for explicit zoom in/out/100%/Fit. |
| Pan | Middle-mouse drag or `Space+drag`. Pan offset is in pixel-space (invariant under zoom changes). |
| Grid + numbers overlay | Auto by zoom (see thresholds table below). Manual toggles override. |
| Layout | Vertical tool rail (~44 px) on the left, canvas filling the remainder, colour panel as a bottom strip. |
| Canvas tech | Two stacked `<canvas>` elements (pixels + overlay), 2D context. No WebGL, no SVG. `image-rendering: pixelated` plus `imageSmoothingEnabled = false`. |
| Persistence | Tool/colour/recent prefs persist in `tinybit-editor/sprite-ui/v1` (small key). Pixel data persists via the existing `tinybit-editor/sketch/v1` PNG (decoded once on boot). Zoom/pan/undo are session-only. |
| Engine integration | Mirror-on-commit: pack the modified RGBA8 rect to RGBA4444 nibbles, `set()` into the engine view through `tb_spritesheet_ptr`. No-op when idle. Full reload after `tb_feed_cartridge` so Play after edits shows the painted spritesheet immediately. |

## Non-goals

- Line, rectangle, ellipse, polygon tools.
- Selection / move / copy / paste; transforms (flip, rotate, skew).
- Multi-layer editing, onion-skinning, animation, frames.
- Cover-image painting (this tab is the spritesheet; cover stays in the Cartridge tab file picker).
- Custom palette management beyond the 12-entry recent-colours ring.
- Touch / pen-pressure / tilt input.
- Sprite import/export beyond what the Cartridge tab already does (PNG file picker, `.tb.png` upload).
- Auto-rebuild of the WASM on Rust changes — adding `tb_spritesheet_ptr` is a one-time `scripts/build.sh` step.
- Theme switching, i18n.

## Architecture

```
tinybit-wasm/
├── src/
│   └── lib.rs                                       # +tb_spritesheet_ptr()
└── editor/src/
    ├── ui/
    │   └── AltEditorTab.tsx                        # rewritten: renders <SpriteEditor>
    ├── sprite/                                      # NEW
    │   ├── SpriteEditor.tsx                        # layout shell + keyboard wiring
    │   ├── ToolRail.tsx                            # left rail: tools, size, zoom, overlay toggles
    │   ├── ColorPanel.tsx                          # bottom strip: HSV + alpha + hex + recents
    │   ├── PixelCanvas.tsx                         # pixel canvas + overlay canvas + pointer handling
    │   ├── viewport.ts                             # zoom/pan math, screen↔pixel
    │   ├── tools.ts                                # pencil/eraser/fill/eyedropper stroke fns
    │   ├── overlay.ts                              # grid + numbers renderer
    │   ├── history.ts                              # dirty-rect Patch stack
    │   ├── color.ts                                # RGBA8↔RGBA4444 snap; HSV↔RGB
    │   └── png.ts                                  # decode PNG → pixels; encode pixels → PNG
    ├── state/
    │   ├── sketchStore.ts                          # +spritePixels, +setSpritePixel/Block/FromPng
    │   ├── spriteEditorStore.ts                    # NEW: tool/zoom/colour/history
    │   └── persist.ts                              # +sprite-ui/v1 key adapter
    └── engine/
        └── spritesheet.ts                          # NEW: tb_spritesheet_ptr wrapper, mirror+fullReload
```

## Component tree

Inside the alt tab body:

```
<SpriteEditor>                            # CSS grid: [rail][canvas]; bottom row spans both: color panel
  ├─ <ToolRail>                           # 44 px wide
  │     • pencil / eraser / fill / eyedropper buttons
  │     • pencil-size slider (1/2/3/4/8)
  │     • zoom −/zoom number/+/100%/Fit
  │     • grid + numbers overlay toggles
  ├─ <PixelCanvas>                        # fills remaining cell
  │     ├─ <canvas id="pixels">           # sprite pixels; image-rendering: pixelated
  │     └─ <canvas id="overlay">          # grid + numbers + cursor preview
  └─ <ColorPanel>                         # bottom strip
        • HSV square (hue strip + SV plane)
        • alpha slider
        • hex input
        • 12 recent-colours row
```

## State

### `sketchStore` extension

```ts
interface SketchState {
    // existing: script, sprite, cover, title, author + setters …
    spritePixels: Uint8Array | null;               // 128*128*4 RGBA8
    setSpritePixel(x: number, y: number, rgba: number): void;
    setSpriteBlock(rect: DirtyRect, src: Uint8Array): void;
    setSpriteFromPng(bytes: Uint8Array): Promise<void>;   // decodes once; sets sprite + spritePixels
    clearSprite(): void;                                  // resets both
}

interface DirtyRect { x: number; y: number; w: number; h: number; }
```

Behaviour:

- `setSpritePixel` / `setSpriteBlock` mutate `spritePixels` in place (the store wraps the buffer in a new `Uint8Array` view to trigger subscribers without copying), schedule a 500 ms debounced re-encode (`pixels → PNG → setSprite(png)`), and call `engine.spritesheet.mirror(rect)`.
- `setSpriteFromPng` decodes the PNG once via offscreen canvas, validates 128×128 (errors back to caller), populates both `sprite` (the raw bytes passed in) and `spritePixels` atomically.
- The debounced re-encode runs through the same path as `setSprite` — so the existing 500 ms persistence debounce on `sketch.sprite` runs after that. End-to-end, a paint session triggers two debounces in series: pixels → PNG (in-memory) → localStorage write.

### `spriteEditorStore` (new)

```ts
interface SpriteEditorState {
    tool:       'pencil'|'eraser'|'fill'|'eyedropper';
    pencilSize: 1|2|3|4|8;                          // square brush diameter, in pixels
    zoom:       1|2|4|8|16|24|32;
    pan:        { x: number; y: number };           // pixel-space offset
    color:      number;                              // RGBA8 packed u32, snapped to 4 bpc
    recent:     number[];                            // ring buffer, len ≤ 12, snapped colors
    showGrid:    'auto'|'on'|'off';
    showNumbers: 'auto'|'on'|'off';
    undo: Patch[];
    redo: Patch[];

    setTool(t): void;
    setPencilSize(n): void;
    setZoom(z, anchor?: { sx, sy, canvasW, canvasH }): void;   // anchor: sx, sy are CSS-px relative to the pixel canvas top-left; canvasW/H are its current CSS-px size. Anchored zoom shifts pan so the pixel under (sx,sy) stays put.
    setPan(p): void;
    setColor(rgba: number): void;                    // snaps to 4 bpc, prepends to recent
    setOverlay(which, mode): void;
    pushPatch(p: Patch): void;                       // also clears redo
    undo(): void;
    redo(): void;
}

interface Patch {
    rect:   DirtyRect;
    before: Uint8Array;                              // rect.w * rect.h * 4
    after:  Uint8Array;
}
```

Persisted subset (`tinybit-editor/sprite-ui/v1`): `tool`, `pencilSize`, `color`, `recent`, `showGrid`, `showNumbers`. Everything else is session-only.

## Canvas rendering

### Sizing

`PixelCanvas` reads its parent's client size on mount and via `ResizeObserver`. Both canvases match that size in CSS pixels and `width = height = clientSize * devicePixelRatio` in backing pixels. The render code multiplies all stroke widths and font sizes by DPR so HiDPI displays render crisply.

The available canvas area is `parent.clientSize` minus the gutters required by visible overlays (see table below). Numbers reserve gutter space *outside* the pixel viewport — the pixel viewport shrinks so the canvas content never overlaps gutter text.

### Pixel canvas redraw

A backing 128×128 offscreen canvas mirrors `sketch.spritePixels`. Per redraw:

1. Clear the visible (pixel) canvas with the checkerboard pattern (16-px light-grey/white squares) so alpha < 1 reads as transparent.
2. Compute the destination rect for the 128×128 sprite at `zoom` and `pan`.
3. `drawImage(offscreen, 0, 0, 128, 128, dstX, dstY, dstW, dstH)` with `imageSmoothingEnabled = false`.

Redraws are scheduled via `requestAnimationFrame` and coalesced. The subscription is to `sketchStore.spritePixels` identity plus `spriteEditorStore.{zoom, pan}` — paint strokes that mutate the buffer in place flip the wrapped view identity so subscribers re-render.

### Overlay canvas redraw

Redrawn whenever zoom/pan/`showGrid`/`showNumbers`/cursor changes. Order: grid lines → cell numbers → per-pixel coords → brush cursor preview.

### Grid + numbers thresholds (auto)

| Zoom | Grid | Numbers |
|---|---|---|
| 1× – 3× | none | none |
| 4× – 7× | 8×8 lines, 1 px, `rgba(0,0,0,0.25)` | none |
| 8× – 11× | 8×8 lines + per-pixel `rgba(0,0,0,0.08)` | 8×8 cell numbers (0, 8, …, 120) along top & left gutters |
| 12× – 16× | per-pixel `rgba(0,0,0,0.15)` + 8×8 emphasis `rgba(0,0,0,0.35)` | 8×8 cell numbers |
| 24× – 32× | same | 8×8 cell numbers + per-pixel coords (0..127) along top & left gutters |

Gutter reservations: 16 px top + 18 px left for 8×8 numbers; 24 px top + 26 px left when per-pixel coords are also shown. Numbers are rendered into the overlay canvas (no DOM nodes).

Manual toggles set `showGrid`/`showNumbers` to `'on'` or `'off'`, overriding `'auto'`.

### Cursor preview

When the pointer is over the canvas, the overlay draws an indicator of what a click would affect. Pencil/eraser: the N×N brush footprint centred on the cursor pixel, filled at half-alpha of the current colour (or transparent grey for the eraser). Fill and eyedropper: a single 1-px outline at the cursor pixel — we don't pre-run the BFS on hover, both to keep `pointermove` cheap and because the affected region is usually obvious to the user.

## Tools

All four tools share a common interface:

```ts
type ToolEvent = 'down' | 'move' | 'up';

interface Stroke {
    onEvent(e: ToolEvent, px: number, py: number): DirtyRect | null;
    commit(): Patch | null;
}
```

| Tool | `down` | `move` | `up` |
|---|---|---|---|
| **pencil** | stamp `pencilSize × pencilSize` brush at (px, py) with `color` | Bresenham line-rasterise from last `(px, py)` to current; stamp brush at every step | `commit()` → push Patch to undo |
| **eraser** | same as pencil but writes `0x00000000` | same | `commit()` → push Patch to undo |
| **fill** | 4-connected BFS from (px, py); collect matching pixels; write `color` | (no-op) | `commit()` → push Patch to undo |
| **eyedropper** | read RGBA at (px, py); set `color`; prepend to `recent`; auto-switch `tool` to `pencil` | (no-op) | (no-op, no commit) |

Brush stamps are clipped at the 128×128 boundary. Pixel addressing in `spritePixels`: `offset = (y * 128 + x) * 4` — channels are stored MSB R/G/B/A.

Each non-trivial stroke (pencil, eraser, fill) creates a `Patch`:

1. On `down`, snapshot the entire 128×128 `spritePixels` into a 64 KB stroke-baseline buffer and initialise a dirty-rect tracker `{x, y, w, h}` to the down pixel.
2. On each `move`, expand the tracker to include the new dirty pixels.
3. On `up`, compute the union dirty rect (clipped to 128×128); `before = baseline[rect]`, `after = current[rect]`. Push the `Patch` to `undo`.

A single 64 KB snapshot per stroke is cheap and keeps the diff logic obvious — no per-pixel before-tracking.

Fill is bounded to a 128×128 working area (the entire sprite); the BFS uses a flat `Uint8Array(128*128)` visited mask, peak memory ≤ 16 KB.

## Pointer & keyboard wiring

In `SpriteEditor`:

- `pointerdown` on canvas → `setPointerCapture`; left button starts the active tool; middle button starts pan.
- `pointermove` → if drawing, route to the active stroke; if panning, mutate `spriteEditorStore.pan`.
- `pointerup` → commit the stroke (if any); release capture.
- `wheel` with `ctrlKey || metaKey` → zoom toward cursor (anchored zoom): compute the pixel under the cursor at the old zoom, step to the next zoom level in the discrete ladder, set `pan` so that pixel stays under the cursor. Without ctrl/meta the event is *not* preventDefault'd, so a vertical-scrolling parent still scrolls if present.
- `wheel` without modifier on the canvas itself: no-op (we don't pan via wheel; pan is explicit).
- Keys (canvas focused or `<SpriteEditor>` focused): `+`/`-` zoom step, `[`/`]` pencil size step, `b/e/g/i` tool switch (matches Aseprite/Photoshop: `b`rush, `e`raser, `g` fill bucket, `i` eyedropper), `Space+drag` pan, `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo.

The canvas gets focus on click; `tabIndex={0}` for keyboard accessibility.

## Engine integration

### Rust — `tb_spritesheet_ptr()`

New `#[no_mangle] extern "C"` in `src/lib.rs`:

```rust
#[no_mangle]
pub extern "C" fn tb_spritesheet_ptr() -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.memory.sprites.as_mut_ptr() as *mut u8;
        }
    });
    ptr
}
```

The plan step will confirm the actual `TinyBitMemory` field name and element type by reading `src/tinybit/tinybit.h` and `src/bindings.rs` — the spec assumes a flat 16-bit-per-pixel store (128 × 128 = 16 384 `u16`s, 32 768 bytes total) carrying packed RGBA4444 nibbles, since that matches the encoder's documented "engine's in-memory 16-bit-per-pixel spritesheet (R-high, G-high, B-high, A-high — 4 bpc)" format.

If the actual layout differs, the wrapper compensates (e.g., per-pixel byte order) without altering the JS-facing `mirror`/`fullReload` API. Adjustment lands in `editor/src/engine/spritesheet.ts` not in the rest of the editor.

### JS — `engine/spritesheet.ts`

```ts
export interface Spritesheet {
    mirror(pixels: Uint8Array, rect: DirtyRect): void;   // sub-rect RGBA8 → RGBA4444 → set()
    fullReload(pixels: Uint8Array): void;                // full 128×128
    isReady(): boolean;
}
```

`mirror` is a no-op when `frameLoop.state() !== 'running'`. Packing:

```
packed = ((r >> 4) << 12) | ((g >> 4) << 8) | ((b >> 4) << 4) | (a >> 4)
```

A `Uint16Array(memory.buffer, ptr, 16384)` view is cached and reconstructed when `memory.buffer.byteLength` changes (defending against `memory.grow`).

`fullReload` is called at the top of the Play path, after `tb_feed_cartridge` but before `tb_start`, so the cartridge's original sprite data is overwritten with whatever the user has painted. Without this, the first frames of a Play after edits would briefly render the un-edited spritesheet.

## Persistence

### Round-trip table

| Trigger | Action |
|---|---|
| App boot, `tinybit-editor/sketch/v1` present with `sprite_b64` | base64-decode → PNG bytes → `setSpriteFromPng` → populates `sprite` + `spritePixels` |
| App boot, no key or missing field | `spritePixels = null`; first stroke initialises with the bundled placeholder PNG (decoded on demand) |
| `.tb.png` upload | decoder already returns sprite PNG bytes → `setSpriteFromPng` |
| Cartridge tab PNG file pick | `setSpriteFromPng` |
| Sprite editor stroke commit | mutate `spritePixels`; `engine.spritesheet.mirror(rect)`; schedule 500 ms debounced re-encode → `setSprite(png)` → existing 500 ms persist debounce |
| Play | force-flush the pending re-encode synchronously; `setSprite` if dirty; feed cartridge; `fullReload(spritePixels)` |
| Download | same flush; encode cartridge |
| `sketchStore.reset()` | `clearSprite()` clears both fields |

The PNG remains the canonical persisted form (~5–15 KB typical vs ~64 KB raw + base64 overhead for pixels). `spritePixels` is a *derived* in-memory view, rebuilt on boot.

### `persist.ts` change

Add a second persistence adapter keyed `tinybit-editor/sprite-ui/v1` storing `{ tool, pencilSize, color, recent, showGrid, showNumbers }`. Decoupled from the sketch and layout adapters so a "Reset tools" follow-up never wipes either of those.

## Error handling

| Boundary | Detection | Surfacing |
|---|---|---|
| PNG decode failure in `setSpriteFromPng` | offscreen `Image` `onerror` | `consoleStore.append('error', 'Failed to decode spritesheet PNG')`; `spritePixels` retained |
| Non-128×128 PNG | post-decode size check | same; `setSpriteFromPng` rejects |
| `tb_spritesheet_ptr` returns null (called before `tb_init`) | null-check in wrapper | `mirror`/`fullReload` are no-ops; `isReady() === false` |
| Re-encode (pixels → PNG) failure | offscreen canvas `toBlob` rejects / returns null | `consoleStore.append('error', 'Failed to re-encode sprite')`; do not clobber `sketch.sprite` |
| Undo on empty stack | guard in store | silent no-op |
| Fill on a pixel already matching the target colour | tool early-returns | no patch, no commit, no debounce |
| localStorage quota on `sprite-ui/v1` | adapter try/catch | reuses existing `'Could not persist sketch: …'` warn path |
| Live-mirror write throws (out-of-bounds, `memory.grow` race) | try/catch in `mirror` | `consoleStore.append('warn', 'Live sprite mirror failed')` once per session, then silent; paint loop unaffected |

## Testing

### Unit (Vitest, jsdom)

- `sprite/color.ts` — RGBA8↔RGBA4444 snap is idempotent and bit-stable across all 256 channel values (`snap(snap(x)) === snap(x)`, `snap(x) & 0x0F === 0`); HSV↔RGB round-trip; eyedropper-derived values are always snapped.
- `sprite/viewport.ts` — `screenToPixel` / `pixelToScreen` round-trip across every zoom level; cursor-anchored zoom invariant (the pixel under the cursor before zoom is still under the cursor after).
- `sprite/tools.ts` — pencil sizes 1/2/3/4/8 produce the expected dirty rect; Bresenham line between two `move` events draws contiguous pixels; fill covers a known contiguous region and stops at colour boundaries; eyedropper returns snapped colours and switches the active tool to pencil.
- `sprite/history.ts` — push/undo/redo restore the exact byte pattern; pushing a new patch clears `redo`; cap at 50 evicts the oldest.
- `state/sketchStore` — `setSpriteFromPng` populates `sprite` + `spritePixels` atomically; rejects non-128×128 with no state change; `setSpritePixel` mutation triggers debounced re-encode without clobbering an in-flight encode.
- `state/spriteEditorStore` — `setColor` snaps and prepends to `recent`, deduplicating; `setZoom` with anchor shifts `pan` so the anchored pixel stays put.
- `engine/spritesheet` — `mirror` packs a known RGBA8 sub-rect to RGBA4444 with the expected nibble order against a stub `Uint16Array`; ignores writes when `frameLoop.state() !== 'running'`.

### Component (Vitest + @testing-library/react)

- Tool rail switches tool on click and on keyboard shortcut; active tool's button has a selected indicator.
- Zoom buttons step through the ladder; pencil-size slider's edge values (1 and 8) work.
- Colour panel: clicking a hex input updates `spriteEditorStore.color` (snapped); recent-colours row gains an entry after each commit, capped at 12.
- Grid + numbers overlay snapshots: at zoom 4× only 8×8 grid; at 12× per-pixel grid + 8×8 numbers; at 32× per-pixel numbers also visible; manual overlay toggles override auto.

### E2E smoke (Playwright)

Extend the existing test:

1. After the existing Play assertion, open the alt tab.
2. Use `page.mouse` to click the pencil tool, set colour via the hex input to a bright red, set zoom to 8×, and click a single pixel near sprite coordinate (5, 5).
3. Wait one rAF; read the running canvas at the corresponding display location (driven by the existing `_draw` snippet) and assert the pixel is now red. This proves the live-mirror path.
4. Stop the game; click Download; in-test, hand the resulting `.tb.png` bytes to the decoder (existing smoke path); decode the sprite PNG and assert the pixel at (5, 5) is the painted red. This proves the persistence round-trip.

### Engine-level smoke (Node)

A new `scripts/smoke_spritesheet.mjs`: loads the WASM, calls `tb_init`, writes a known RGBA4444 pattern through `tb_spritesheet_ptr`, feeds a tiny script that pixel-copies sprite cell (0, 0) to display (0, 0), runs one frame, asserts the display pixel matches the written sprite colour. Belt + braces — verifies the new Rust export end-to-end independent of the editor.

## Build & deploy

- Adding `tb_spritesheet_ptr` to `src/lib.rs` requires re-running `./scripts/build.sh` once. No watcher.
- No new editor dependencies. CodeMirror, Zustand, react-resizable-panels already cover all editor UI needs; the sprite editor uses plain DOM + canvas.
- Vite config unchanged.

## Dependency on existing work

This spec assumes:

- `feat/tb-encoder` and the editor UI base (already merged on `main`).
- The current `wasiShim` console wiring, since errors flow through it.
- The cartridge upload path (`feat/tb-png-upload`), which already supplies sprite PNG bytes to the sketch store.

No version bumps, no toolchain changes.
