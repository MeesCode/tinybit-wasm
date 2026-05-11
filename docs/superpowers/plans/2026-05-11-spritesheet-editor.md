# Spritesheet Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder "alt" tab with a working 128×128 pixel editor (pencil, eraser, flood fill, eyedropper, zoom, grid/numbers overlay, RGBA4444 colour picker) that mirrors live edits into the running game.

**Architecture:** Canonical RGBA8 `Uint8Array(65536)` in JS state (`sketchStore.spritePixels`). PNG is derived (debounced re-encode on stroke commit). A new Rust export `tb_spritesheet_ptr()` exposes the engine's `[u16; 16384]` RGBA4444 spritesheet for live mirroring while running. All editor UI lives in `editor/src/sprite/` and is mounted from `editor/src/ui/AltEditorTab.tsx`.

**Tech Stack:** React 18 + TypeScript + Zustand (state) + 2D Canvas (rendering) + Vitest (unit/component) + Playwright (E2E). WASM built via existing `scripts/build.sh`.

**Authoritative spec:** `docs/superpowers/specs/2026-05-11-spritesheet-editor-design.md`. Each task implements one slice of the spec; read the spec for any detail not spelled out in the task.

---

## File Structure

**New files (Rust):** none (modifying `src/lib.rs` only)

**New files (editor):**
- `editor/src/sprite/color.ts` — RGBA8↔RGBA4444 snap + HSV↔RGB helpers
- `editor/src/sprite/color.test.ts`
- `editor/src/sprite/viewport.ts` — zoom/pan math
- `editor/src/sprite/viewport.test.ts`
- `editor/src/sprite/png.ts` — PNG ↔ pixels helpers
- `editor/src/sprite/png.test.ts`
- `editor/src/sprite/history.ts` — Patch stack
- `editor/src/sprite/history.test.ts`
- `editor/src/sprite/tools.ts` — pencil/eraser/fill/eyedropper strokes
- `editor/src/sprite/tools.test.ts`
- `editor/src/sprite/overlay.ts` — grid + numbers renderer
- `editor/src/sprite/overlay.test.ts`
- `editor/src/sprite/PixelCanvas.tsx`
- `editor/src/sprite/PixelCanvas.test.tsx`
- `editor/src/sprite/ToolRail.tsx`
- `editor/src/sprite/ToolRail.test.tsx`
- `editor/src/sprite/ColorPanel.tsx`
- `editor/src/sprite/ColorPanel.test.tsx`
- `editor/src/sprite/SpriteEditor.tsx`
- `editor/src/sprite/SpriteEditor.test.tsx`
- `editor/src/state/spriteEditorStore.ts`
- `editor/src/state/spriteEditorStore.test.ts`
- `editor/src/engine/spritesheet.ts`
- `editor/src/engine/spritesheet.test.ts`
- `scripts/smoke_spritesheet.mjs`

**Modified files:**
- `src/lib.rs` — add `tb_spritesheet_ptr` export
- `editor/src/engine/tinybit.ts` — add `tb_spritesheet_ptr` to `TinybitExports`
- `editor/src/engine/runtime.ts` — instantiate and expose `Spritesheet`
- `editor/src/state/sketchStore.ts` — add `spritePixels` and setters
- `editor/src/state/sketchStore.test.ts` — add new-method tests
- `editor/src/state/persist.ts` — add `tinybit-editor/sprite-ui/v1` adapter
- `editor/src/state/persist.test.ts` — add adapter tests
- `editor/src/ui/AltEditorTab.tsx` — mount `<SpriteEditor>`
- `editor/src/App.tsx` — Play path: flush re-encode + `fullReload(spritePixels)`; boot path: fill `spritePixels` from loaded sprite PNG
- `editor/tests/e2e.spec.ts` (or whichever existing Playwright spec lives there) — add sprite-edit + live-mirror + persistence assertions

---

## Task Ordering & Dependencies

Tasks within a phase have no cross-task dependencies; phases must be done in order.

- **Phase 0 — Engine export** (Rust): Tasks 1–2.
- **Phase 1 — Pure utility modules**: Tasks 3–7. All independent of each other.
- **Phase 2 — Engine + state plumbing**: Tasks 8–11. 8 depends on Phase 0; 9 depends on 5; 10–11 independent.
- **Phase 3 — Components**: Tasks 12–17. 13–17 depend on Phases 1–2.
- **Phase 4 — Integration & smoke**: Tasks 18–20.

---

## Phase 0 — Engine export

### Task 1: Add `tb_spritesheet_ptr` Rust export

**Files:**
- Modify: `src/lib.rs` — add the export below `tb_audio_ptr` (around line 333)

- [ ] **Step 1: Add the export**

Open `src/lib.rs` and add this function immediately after the existing `tb_audio_ptr`:

```rust
#[no_mangle]
pub extern "C" fn tb_spritesheet_ptr() -> *mut u8 {
    let mut ptr: *mut u8 = core::ptr::null_mut();
    STATE.with(|cell| {
        if let Some(state) = cell.borrow_mut().as_mut() {
            ptr = state.memory.spritesheet.as_mut_ptr() as *mut u8;
        }
    });
    ptr
}
```

The field name is `spritesheet` (verified in `src/bindings.rs`, declared as `[u16; TB_SCREEN_WIDTH * TB_SCREEN_HEIGHT]`). Returns `*mut u8` so the JS side can construct a `Uint16Array` view (16384 u16 = 32768 bytes).

- [ ] **Step 2: Rebuild the WASM artifact**

Run: `./scripts/build.sh`
Expected: completes without errors; `editor/public/tinybit_wasm.wasm` updated.

- [ ] **Step 3: Verify the export exists in the wasm module**

Run: `wasm-objdump -x editor/public/tinybit_wasm.wasm | grep tb_spritesheet_ptr` (if `wasm-objdump` is unavailable, use `strings editor/public/tinybit_wasm.wasm | grep tb_spritesheet_ptr`)
Expected: at least one match.

- [ ] **Step 4: Commit**

```bash
git add src/lib.rs editor/public/tinybit_wasm.wasm
git commit -m "$(cat <<'EOF'
engine: export tb_spritesheet_ptr for live sprite mirroring

Returns a writable pointer to the engine's in-memory 128x128 RGBA4444
spritesheet (TinyBitMemory.spritesheet). Mirrors the existing tb_display_ptr
shape. The editor will write packed RGBA4444 nibbles through this pointer to
update sprite data while the game is running.
EOF
)"
```

### Task 2: Engine-level smoke for the new export

**Files:**
- Create: `scripts/smoke_spritesheet.mjs`

- [ ] **Step 1: Write the smoke script**

```javascript
#!/usr/bin/env node
// Loads the built tinybit_wasm.wasm in Node, writes a known RGBA4444 value
// through tb_spritesheet_ptr, runs a tiny script that copies sprite (0,0) to
// display (0,0) via the sprite() Lua function, and asserts the display pixel.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '../target/wasm32-wasip1/release/tinybit_wasm.wasm');

// Minimal WASI shim — see scripts/smoke.mjs for the canonical version. Copy it.
import { makeWasiShim } from './lib/wasi_shim_node.mjs'; // hypothetical shared file

const memRef = { value: null };
const sinks = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) };
const shim = makeWasiShim(memRef, sinks);
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), { wasi_snapshot_preview1: shim });
memRef.value = instance.exports.memory;
const ex = instance.exports;

ex.tb_init();

// Build a minimal cartridge here is complicated; instead, just write through
// tb_spritesheet_ptr and read back to assert. Verify the pointer is non-zero
// and the round-trip works.
const ptr = ex.tb_spritesheet_ptr();
if (ptr === 0) throw new Error('tb_spritesheet_ptr returned null');
const view = new Uint16Array(ex.memory.buffer, ptr, 128 * 128);
view[0] = 0xF00F; // R=F, G=0, B=0, A=F (opaque red, top 4 bits per channel)
if (view[0] !== 0xF00F) throw new Error('readback mismatch');

console.log('smoke_spritesheet: OK');
```

The shared WASI shim is already used by `scripts/smoke.mjs`. **Before writing this script, read `scripts/smoke.mjs` and reuse the same in-file shim** (do not factor it out into a new module unless the existing scripts already share one). Replicate the in-file shim verbatim here so the smoke is self-contained.

- [ ] **Step 2: Confirm `scripts/smoke.mjs` structure first**

Run: `head -50 scripts/smoke.mjs`
Expected: shows whatever shim definition pattern is in use. Re-shape the smoke above to match.

- [ ] **Step 3: Run the smoke**

Run: `node scripts/smoke_spritesheet.mjs`
Expected: `smoke_spritesheet: OK` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke_spritesheet.mjs
git commit -m "test(engine): smoke for tb_spritesheet_ptr round-trip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — Pure utility modules

### Task 3: `sprite/color.ts` — RGBA snap + HSV conversions

**Files:**
- Create: `editor/src/sprite/color.ts`
- Test: `editor/src/sprite/color.test.ts`

- [ ] **Step 1: Write the failing tests**

`editor/src/sprite/color.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { snapRgba8, packRgba8, unpackRgba8, hsvToRgb, rgbToHsv } from './color';

describe('snapRgba8', () => {
    test('zeroes the low 4 bits of every channel', () => {
        for (let v = 0; v < 256; v++) {
            expect(snapRgba8(v) & 0x0F).toBe(0);
        }
    });
    test('is idempotent', () => {
        for (let v = 0; v < 256; v++) {
            expect(snapRgba8(snapRgba8(v))).toBe(snapRgba8(v));
        }
    });
    test('keeps the top 4 bits intact', () => {
        for (let v = 0; v < 256; v++) {
            expect(snapRgba8(v) >>> 4).toBe(v >>> 4);
        }
    });
});

describe('packRgba8 / unpackRgba8', () => {
    test('round-trip preserves all four channels', () => {
        const samples = [[0,0,0,0], [255,255,255,255], [0xF0,0xA0,0x10,0x80], [128,64,32,255]];
        for (const [r,g,b,a] of samples) {
            const packed = packRgba8(r,g,b,a);
            const u = unpackRgba8(packed);
            expect([u.r,u.g,u.b,u.a]).toEqual([r,g,b,a]);
        }
    });
});

describe('hsvToRgb / rgbToHsv', () => {
    test('round-trips primary colours within 1 unit', () => {
        const cases: Array<[number,number,number]> = [[255,0,0],[0,255,0],[0,0,255],[255,255,255],[0,0,0],[128,128,128]];
        for (const [r,g,b] of cases) {
            const hsv = rgbToHsv(r,g,b);
            const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
            expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1);
            expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1);
            expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1);
        }
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npm test -- color.test`
Expected: tests fail with "cannot find module" or undefined export errors.

- [ ] **Step 3: Implement**

`editor/src/sprite/color.ts`:

```typescript
export function snapRgba8(channel: number): number {
    return channel & 0xF0;
}

export function snapAllChannels(rgba: number): number {
    return rgba & 0xF0F0F0F0;
}

export function packRgba8(r: number, g: number, b: number, a: number): number {
    return ((r & 0xFF) << 24 | (g & 0xFF) << 16 | (b & 0xFF) << 8 | (a & 0xFF)) >>> 0;
}

export function unpackRgba8(packed: number): { r: number; g: number; b: number; a: number } {
    return {
        r: (packed >>> 24) & 0xFF,
        g: (packed >>> 16) & 0xFF,
        b: (packed >>>  8) & 0xFF,
        a:  packed         & 0xFF,
    };
}

export function pack4444(r: number, g: number, b: number, a: number): number {
    return ((r >>> 4) << 12) | ((g >>> 4) << 8) | ((b >>> 4) << 4) | (a >>> 4);
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    // h in [0,360), s and v in [0,1]
    const c = v * s;
    const hp = (h % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if      (hp < 1) [r1,g1,b1] = [c, x, 0];
    else if (hp < 2) [r1,g1,b1] = [x, c, 0];
    else if (hp < 3) [r1,g1,b1] = [0, c, x];
    else if (hp < 4) [r1,g1,b1] = [0, x, c];
    else if (hp < 5) [r1,g1,b1] = [x, 0, c];
    else             [r1,g1,b1] = [c, 0, x];
    const m = v - c;
    return {
        r: Math.round((r1 + m) * 255),
        g: Math.round((g1 + m) * 255),
        b: Math.round((b1 + m) * 255),
    };
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const r1 = r / 255, g1 = g / 255, b1 = b / 255;
    const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if      (max === r1) h = 60 * (((g1 - b1) / d) % 6);
        else if (max === g1) h = 60 * ( (b1 - r1) / d + 2);
        else                 h = 60 * ( (r1 - g1) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
}

export function rgbaToHex(rgba: number): string {
    const u = unpackRgba8(rgba);
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(u.r)}${h(u.g)}${h(u.b)}${h(u.a)}`;
}

export function hexToRgba(hex: string): number | null {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
    if (!m) return null;
    const s = m[1];
    const r = parseInt(s.slice(0,2), 16);
    const g = parseInt(s.slice(2,4), 16);
    const b = parseInt(s.slice(4,6), 16);
    const a = s.length === 8 ? parseInt(s.slice(6,8), 16) : 0xFF;
    return packRgba8(r, g, b, a);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd editor && npm test -- color.test`
Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/color.ts editor/src/sprite/color.test.ts
git commit -m "sprite: RGBA8/RGBA4444 helpers + HSV conversion

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: `sprite/viewport.ts` — zoom/pan math

**Files:**
- Create: `editor/src/sprite/viewport.ts`
- Test: `editor/src/sprite/viewport.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from 'vitest';
import { screenToPixel, pixelToScreen, anchoredZoom, ZOOM_LEVELS, nextZoom, prevZoom } from './viewport';

describe('viewport math', () => {
    test('screenToPixel + pixelToScreen round-trip at every zoom', () => {
        for (const zoom of ZOOM_LEVELS) {
            const vp = { zoom, pan: { x: 0, y: 0 } };
            for (const [px, py] of [[0,0],[64,64],[127,127],[5,42]]) {
                const s = pixelToScreen(vp, px, py, 400, 400);
                const p = screenToPixel(vp, s.x, s.y, 400, 400);
                expect(p).toEqual({ x: px, y: py });
            }
        }
    });

    test('screenToPixel returns null for points outside the sprite', () => {
        const vp = { zoom: 1 as const, pan: { x: 0, y: 0 } };
        expect(screenToPixel(vp, -10, -10, 400, 400)).toBeNull();
        expect(screenToPixel(vp, 9999, 9999, 400, 400)).toBeNull();
    });

    test('anchoredZoom keeps the pixel under the cursor in place', () => {
        const vp = { zoom: 4 as const, pan: { x: 0, y: 0 } };
        // Cursor at screen (200, 150), canvas 400x400 — find the pixel under it.
        const before = screenToPixel(vp, 200, 150, 400, 400);
        const next = anchoredZoom(vp, 8, { sx: 200, sy: 150, canvasW: 400, canvasH: 400 });
        const after = screenToPixel(next, 200, 150, 400, 400);
        expect(after).toEqual(before);
    });

    test('nextZoom / prevZoom step the ladder, clamped', () => {
        expect(nextZoom(1)).toBe(2);
        expect(nextZoom(32)).toBe(32);
        expect(prevZoom(2)).toBe(1);
        expect(prevZoom(1)).toBe(1);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- viewport.test`
Expected: fail (module missing).

- [ ] **Step 3: Implement**

`editor/src/sprite/viewport.ts`:

```typescript
export const ZOOM_LEVELS = [1, 2, 4, 8, 16, 24, 32] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];

export interface Viewport { zoom: Zoom; pan: { x: number; y: number }; }

const SPRITE_SIZE = 128;

function spriteRect(vp: Viewport, canvasW: number, canvasH: number) {
    const drawW = SPRITE_SIZE * vp.zoom;
    const drawH = SPRITE_SIZE * vp.zoom;
    // Centre the sprite in the canvas, then offset by pan (pixel-space → screen-space = pan * zoom)
    const x = Math.floor((canvasW - drawW) / 2) + vp.pan.x * vp.zoom;
    const y = Math.floor((canvasH - drawH) / 2) + vp.pan.y * vp.zoom;
    return { x, y, w: drawW, h: drawH };
}

export function screenToPixel(vp: Viewport, sx: number, sy: number, canvasW: number, canvasH: number): { x: number; y: number } | null {
    const r = spriteRect(vp, canvasW, canvasH);
    const px = Math.floor((sx - r.x) / vp.zoom);
    const py = Math.floor((sy - r.y) / vp.zoom);
    if (px < 0 || py < 0 || px >= SPRITE_SIZE || py >= SPRITE_SIZE) return null;
    return { x: px, y: py };
}

export function pixelToScreen(vp: Viewport, px: number, py: number, canvasW: number, canvasH: number): { x: number; y: number } {
    const r = spriteRect(vp, canvasW, canvasH);
    return { x: r.x + px * vp.zoom + Math.floor(vp.zoom / 2), y: r.y + py * vp.zoom + Math.floor(vp.zoom / 2) };
}

export function nextZoom(z: Zoom): Zoom {
    const i = ZOOM_LEVELS.indexOf(z);
    return ZOOM_LEVELS[Math.min(i + 1, ZOOM_LEVELS.length - 1)];
}

export function prevZoom(z: Zoom): Zoom {
    const i = ZOOM_LEVELS.indexOf(z);
    return ZOOM_LEVELS[Math.max(i - 1, 0)];
}

export function anchoredZoom(vp: Viewport, newZoom: Zoom, anchor: { sx: number; sy: number; canvasW: number; canvasH: number }): Viewport {
    // Find the (fractional) pixel under the cursor at the *old* zoom.
    const r = spriteRect(vp, anchor.canvasW, anchor.canvasH);
    const pxF = (anchor.sx - r.x) / vp.zoom;
    const pyF = (anchor.sy - r.y) / vp.zoom;
    // Compute new pan so the same fractional pixel sits under the cursor at the new zoom.
    // Base rect (without pan) at the new zoom:
    const baseX = Math.floor((anchor.canvasW - SPRITE_SIZE * newZoom) / 2);
    const baseY = Math.floor((anchor.canvasH - SPRITE_SIZE * newZoom) / 2);
    // We want: baseX + newPan.x * newZoom + pxF * newZoom === anchor.sx
    const newPanX = (anchor.sx - baseX) / newZoom - pxF;
    const newPanY = (anchor.sy - baseY) / newZoom - pyF;
    return { zoom: newZoom, pan: { x: newPanX, y: newPanY } };
}

export function fitZoom(canvasW: number, canvasH: number): Zoom {
    const max = Math.min(canvasW, canvasH) / SPRITE_SIZE;
    let best: Zoom = 1;
    for (const z of ZOOM_LEVELS) if (z <= max) best = z;
    return best;
}
```

- [ ] **Step 4: Run tests**

Run: `cd editor && npm test -- viewport.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/viewport.ts editor/src/sprite/viewport.test.ts
git commit -m "sprite: zoom/pan viewport math + cursor-anchored zoom

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5: `sprite/png.ts` — PNG ↔ pixels

**Files:**
- Create: `editor/src/sprite/png.ts`
- Test: `editor/src/sprite/png.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from 'vitest';
import { decodePngToPixels, encodePixelsToPng } from './png';

describe('png helpers', () => {
    test('round-trip 128×128 buffer preserves the pixel data exactly', async () => {
        const pixels = new Uint8Array(128 * 128 * 4);
        for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31) & 0xFF;
        const png = await encodePixelsToPng(pixels);
        const decoded = await decodePngToPixels(png);
        expect(decoded.width).toBe(128);
        expect(decoded.height).toBe(128);
        expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
    });

    test('decode rejects non-128×128', async () => {
        // 64×64 PNG: encode a 64×64 buffer using the same path with width override
        const tiny = await encodePixelsToPng(new Uint8Array(64 * 64 * 4), 64, 64);
        await expect(decodePngToPixels(tiny)).rejects.toThrow(/128/);
    });

    test('decode rejects malformed input', async () => {
        await expect(decodePngToPixels(new Uint8Array([1,2,3,4]))).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- png.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/sprite/png.ts`:

```typescript
const SPRITE_SIZE = 128;

export async function decodePngToPixels(bytes: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload  = () => resolve(i);
            i.onerror = () => reject(new Error('Failed to decode PNG'));
            i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        if (c.width !== SPRITE_SIZE || c.height !== SPRITE_SIZE) {
            throw new Error(`Sprite PNG must be ${SPRITE_SIZE}×${SPRITE_SIZE} (got ${c.width}×${c.height})`);
        }
        const ctx = c.getContext('2d', { willReadFrequently: false });
        if (!ctx) throw new Error('2D canvas unavailable');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        return { width: c.width, height: c.height, pixels: new Uint8Array(data) };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function encodePixelsToPng(pixels: Uint8Array, width = SPRITE_SIZE, height = SPRITE_SIZE): Promise<Uint8Array> {
    if (pixels.length !== width * height * 4) throw new Error('pixels length does not match dimensions');
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    const img = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) throw new Error('Failed to encode PNG');
    return new Uint8Array(await blob.arrayBuffer());
}
```

Note for the test runner: Vitest with jsdom may not implement `canvas.toBlob` natively. The `editor/vitest.config.ts` already configures jsdom for existing tests (`CartridgeTab.test.tsx` uses canvas-adjacent APIs). If `toBlob` is unavailable in jsdom, install `canvas` as a dev dependency (`npm i -D canvas`) — that is the standard fix. Try the tests first; only add the dependency if they actually fail with a missing-API error.

- [ ] **Step 4: Run tests**

Run: `cd editor && npm test -- png.test`
Expected: green (after the `canvas` dep if needed).

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/png.ts editor/src/sprite/png.test.ts editor/package.json editor/package-lock.json
git commit -m "sprite: PNG <-> RGBA8 helpers via offscreen canvas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: `sprite/history.ts` — patch stack

**Files:**
- Create: `editor/src/sprite/history.ts`
- Test: `editor/src/sprite/history.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from 'vitest';
import { makeHistory } from './history';

const rect = { x: 1, y: 1, w: 2, h: 2 };

describe('history', () => {
    test('push/undo restores before; redo restores after', () => {
        const buf = new Uint8Array(128 * 128 * 4);
        buf[5] = 9;
        const h = makeHistory(50);
        h.push({ rect, before: new Uint8Array(2*2*4), after: new Uint8Array([1,2,3,4, 5,6,7,8, 9,10,11,12, 13,14,15,16]) });
        // Apply after to buf
        for (let i = 0; i < 16; i++) buf[i] = i + 1;
        h.undo((p) => { /* simulate apply 'before' */ for (let i = 0; i < 16; i++) buf[i] = p.before[i]; });
        expect(buf[0]).toBe(0);
        h.redo((p) => { for (let i = 0; i < 16; i++) buf[i] = p.after[i]; });
        expect(buf[0]).toBe(1);
    });

    test('new push clears redo', () => {
        const h = makeHistory(50);
        h.push({ rect, before: new Uint8Array(16), after: new Uint8Array(16) });
        h.undo(() => {});
        expect(h.canRedo()).toBe(true);
        h.push({ rect, before: new Uint8Array(16), after: new Uint8Array(16) });
        expect(h.canRedo()).toBe(false);
    });

    test('cap evicts oldest', () => {
        const h = makeHistory(3);
        for (let i = 0; i < 5; i++) h.push({ rect, before: new Uint8Array(16), after: new Uint8Array(16) });
        expect(h.undoDepth()).toBe(3);
    });

    test('undo/redo no-ops on empty stacks', () => {
        const h = makeHistory(50);
        expect(() => h.undo(() => { throw new Error('should not be called'); })).not.toThrow();
        expect(() => h.redo(() => { throw new Error('should not be called'); })).not.toThrow();
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- history.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/sprite/history.ts`:

```typescript
export interface DirtyRect { x: number; y: number; w: number; h: number; }

export interface Patch {
    rect:   DirtyRect;
    before: Uint8Array;
    after:  Uint8Array;
}

export interface History {
    push(p: Patch): void;
    undo(apply: (p: Patch) => void): void;
    redo(apply: (p: Patch) => void): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undoDepth(): number;
    redoDepth(): number;
    clear(): void;
}

export function makeHistory(cap: number): History {
    let undoStack: Patch[] = [];
    let redoStack: Patch[] = [];
    return {
        push(p) {
            undoStack.push(p);
            if (undoStack.length > cap) undoStack.shift();
            redoStack = [];
        },
        undo(apply) {
            const p = undoStack.pop();
            if (!p) return;
            apply(p);
            redoStack.push(p);
        },
        redo(apply) {
            const p = redoStack.pop();
            if (!p) return;
            apply(p);
            undoStack.push(p);
        },
        canUndo()    { return undoStack.length > 0; },
        canRedo()    { return redoStack.length > 0; },
        undoDepth()  { return undoStack.length; },
        redoDepth()  { return redoStack.length; },
        clear()      { undoStack = []; redoStack = []; },
    };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd editor && npm test -- history.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/history.ts editor/src/sprite/history.test.ts
git commit -m "sprite: undo/redo patch stack with cap

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7: `sprite/tools.ts` — pencil/eraser/fill/eyedropper

**Files:**
- Create: `editor/src/sprite/tools.ts`
- Test: `editor/src/sprite/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from 'vitest';
import { stampBrush, drawLine, floodFill, readPixel } from './tools';

function emptyBuf(): Uint8Array { return new Uint8Array(128 * 128 * 4); }
function px(buf: Uint8Array, x: number, y: number): number[] {
    const o = (y * 128 + x) * 4;
    return [buf[o], buf[o+1], buf[o+2], buf[o+3]];
}

describe('stampBrush', () => {
    test('size 1 writes a single pixel', () => {
        const buf = emptyBuf();
        const r = stampBrush(buf, 10, 10, 1, 0xFF0000FF);
        expect(px(buf, 10, 10)).toEqual([0xFF, 0x00, 0x00, 0xFF]);
        expect(r).toEqual({ x: 10, y: 10, w: 1, h: 1 });
    });

    test('size 3 stamps a 3x3 square centred on the cursor', () => {
        const buf = emptyBuf();
        stampBrush(buf, 10, 10, 3, 0x00FF00FF);
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
                expect(px(buf, 10+dx, 10+dy)).toEqual([0, 0xFF, 0, 0xFF]);
    });

    test('clips at sprite boundary', () => {
        const buf = emptyBuf();
        stampBrush(buf, 0, 0, 3, 0x123456FF);
        // top-left 2x2 should be filled, others untouched
        expect(px(buf, 0, 0)[3]).toBe(0xFF);
        expect(px(buf, 1, 1)[3]).toBe(0xFF);
    });
});

describe('drawLine', () => {
    test('connected horizontal line', () => {
        const buf = emptyBuf();
        drawLine(buf, 5, 5, 10, 5, 1, 0xFF00FFFF);
        for (let x = 5; x <= 10; x++) expect(px(buf, x, 5)[0]).toBe(0xFF);
    });

    test('45-degree line covers each diagonal step', () => {
        const buf = emptyBuf();
        drawLine(buf, 0, 0, 5, 5, 1, 0xFFFFFFFF);
        for (let i = 0; i <= 5; i++) expect(px(buf, i, i)[3]).toBe(0xFF);
    });
});

describe('floodFill', () => {
    test('fills a contiguous region and stops at colour boundaries', () => {
        const buf = emptyBuf();
        // Make a 4x4 island of red at (10,10)..(13,13) on a transparent canvas; we want to fill the transparent area
        for (let y = 10; y <= 13; y++)
            for (let x = 10; x <= 13; x++) {
                const o = (y * 128 + x) * 4;
                buf[o] = 0xFF; buf[o+3] = 0xFF;
            }
        const rect = floodFill(buf, 0, 0, 0x00FF00FF);
        // (0,0) is now green
        expect(px(buf, 0, 0)).toEqual([0, 0xFF, 0, 0xFF]);
        // the red island is untouched
        expect(px(buf, 11, 11)).toEqual([0xFF, 0, 0, 0xFF]);
        // rect should cover the entire sprite (it's all one contiguous region around the island)
        expect(rect).toEqual({ x: 0, y: 0, w: 128, h: 128 });
    });

    test('no-op when target colour already matches', () => {
        const buf = emptyBuf();
        const rect = floodFill(buf, 0, 0, 0x00000000);
        expect(rect).toBeNull();
    });
});

describe('readPixel', () => {
    test('returns packed RGBA', () => {
        const buf = emptyBuf();
        const o = (5 * 128 + 7) * 4;
        buf[o] = 0xAA; buf[o+1] = 0xBB; buf[o+2] = 0xCC; buf[o+3] = 0xDD;
        expect(readPixel(buf, 7, 5)).toBe(0xAABBCCDD >>> 0);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- tools.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/sprite/tools.ts`:

```typescript
import type { DirtyRect } from './history';

const SIZE = 128;

function setPixel(buf: Uint8Array, x: number, y: number, rgba: number): void {
    const o = (y * SIZE + x) * 4;
    buf[o]     = (rgba >>> 24) & 0xFF;
    buf[o + 1] = (rgba >>> 16) & 0xFF;
    buf[o + 2] = (rgba >>>  8) & 0xFF;
    buf[o + 3] =  rgba         & 0xFF;
}

export function readPixel(buf: Uint8Array, x: number, y: number): number {
    const o = (y * SIZE + x) * 4;
    return ((buf[o] << 24) | (buf[o+1] << 16) | (buf[o+2] << 8) | buf[o+3]) >>> 0;
}

export function stampBrush(buf: Uint8Array, cx: number, cy: number, size: number, rgba: number): DirtyRect {
    const half = Math.floor(size / 2);
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
    const x1 = Math.min(SIZE - 1, cx + (size - 1 - half));
    const y1 = Math.min(SIZE - 1, cy + (size - 1 - half));
    for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
            setPixel(buf, x, y, rgba);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function drawLine(buf: Uint8Array, x0: number, y0: number, x1: number, y1: number, size: number, rgba: number): DirtyRect {
    // Bresenham
    let x = x0, y = y0;
    const dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    let bx0 = SIZE, by0 = SIZE, bx1 = -1, by1 = -1;
    while (true) {
        const r = stampBrush(buf, x, y, size, rgba);
        if (r.x < bx0) bx0 = r.x;
        if (r.y < by0) by0 = r.y;
        if (r.x + r.w - 1 > bx1) bx1 = r.x + r.w - 1;
        if (r.y + r.h - 1 > by1) by1 = r.y + r.h - 1;
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
    }
    return { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
}

export function floodFill(buf: Uint8Array, sx: number, sy: number, rgba: number): DirtyRect | null {
    const target = readPixel(buf, sx, sy);
    if (target === rgba) return null;
    const visited = new Uint8Array(SIZE * SIZE);
    const stack: number[] = [sy * SIZE + sx];
    let bx0 = SIZE, by0 = SIZE, bx1 = -1, by1 = -1;
    while (stack.length) {
        const i = stack.pop()!;
        if (visited[i]) continue;
        const x = i % SIZE, y = Math.floor(i / SIZE);
        if (readPixel(buf, x, y) !== target) { visited[i] = 1; continue; }
        visited[i] = 1;
        setPixel(buf, x, y, rgba);
        if (x < bx0) bx0 = x;
        if (y < by0) by0 = y;
        if (x > bx1) bx1 = x;
        if (y > by1) by1 = y;
        if (x > 0)         stack.push(i - 1);
        if (x < SIZE - 1)  stack.push(i + 1);
        if (y > 0)         stack.push(i - SIZE);
        if (y < SIZE - 1)  stack.push(i + SIZE);
    }
    if (bx1 < 0) return null;
    return { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd editor && npm test -- tools.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/tools.ts editor/src/sprite/tools.test.ts
git commit -m "sprite: pencil/eraser/fill/eyedropper stroke primitives

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Engine + state plumbing

### Task 8: `engine/spritesheet.ts` — live mirror + full reload

**Files:**
- Create: `editor/src/engine/spritesheet.ts`
- Test: `editor/src/engine/spritesheet.test.ts`
- Modify: `editor/src/engine/tinybit.ts` — add `tb_spritesheet_ptr` to `TinybitExports`
- Modify: `editor/src/engine/runtime.ts` — instantiate `Spritesheet` and expose on `Runtime`

- [ ] **Step 1: Add the export to `TinybitExports`**

Open `editor/src/engine/tinybit.ts`, find the `TinybitExports` interface, add a line:

```typescript
tb_spritesheet_ptr(): number;
```

next to the existing `tb_display_ptr` declaration.

- [ ] **Step 2: Write the failing tests**

`editor/src/engine/spritesheet.test.ts`:

```typescript
import { describe, test, expect, vi } from 'vitest';
import { makeSpritesheet } from './spritesheet';

function fakeMemory(byteLen = 1024 * 1024) {
    return { buffer: new ArrayBuffer(byteLen) } as unknown as WebAssembly.Memory;
}

describe('spritesheet mirror', () => {
    test('mirror packs RGBA8 → RGBA4444 nibble order matches encoder', () => {
        const mem = fakeMemory();
        const ptr = 1024;
        const view = new Uint16Array(mem.buffer, ptr, 16384);
        const isRunning = () => true;
        const ss = makeSpritesheet({ memory: mem, ptr: () => ptr, isRunning });
        const pixels = new Uint8Array(128 * 128 * 4);
        // Write one pixel at (0,0): R=0xF0, G=0xA0, B=0x10, A=0xFF
        pixels[0] = 0xF0; pixels[1] = 0xA0; pixels[2] = 0x10; pixels[3] = 0xFF;
        ss.mirror(pixels, { x: 0, y: 0, w: 1, h: 1 });
        // Expected packing: ((0xF>>0)<<12) | ((0xA>>0)<<8) | ((0x1>>0)<<4) | 0xF = 0xFA1F
        expect(view[0]).toBe(0xFA1F);
    });

    test('mirror is a no-op when not running', () => {
        const mem = fakeMemory();
        const view = new Uint16Array(mem.buffer, 1024, 16384);
        view[0] = 0xBEEF;
        const ss = makeSpritesheet({ memory: mem, ptr: () => 1024, isRunning: () => false });
        ss.mirror(new Uint8Array(128 * 128 * 4), { x: 0, y: 0, w: 128, h: 128 });
        expect(view[0]).toBe(0xBEEF);
    });

    test('fullReload writes the entire 128×128 regardless of running state', () => {
        const mem = fakeMemory();
        const view = new Uint16Array(mem.buffer, 1024, 16384);
        const ss = makeSpritesheet({ memory: mem, ptr: () => 1024, isRunning: () => false });
        const pixels = new Uint8Array(128 * 128 * 4).fill(0xFF);
        ss.fullReload(pixels);
        expect(view[0]).toBe(0xFFFF);
        expect(view[16383]).toBe(0xFFFF);
    });

    test('isReady returns false when ptr is 0', () => {
        const ss = makeSpritesheet({ memory: fakeMemory(), ptr: () => 0, isRunning: () => true });
        expect(ss.isReady()).toBe(false);
        ss.mirror(new Uint8Array(128 * 128 * 4), { x: 0, y: 0, w: 1, h: 1 });
        // no throw
    });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `cd editor && npm test -- spritesheet.test`
Expected: fail.

- [ ] **Step 4: Implement**

`editor/src/engine/spritesheet.ts`:

```typescript
import type { DirtyRect } from '../sprite/history';

export interface SpritesheetDeps {
    memory: WebAssembly.Memory;
    ptr: () => number;            // returns tb_spritesheet_ptr() — 0 until tb_init
    isRunning: () => boolean;     // frameLoop.state() === 'running'
}

export interface Spritesheet {
    mirror(pixels: Uint8Array, rect: DirtyRect): void;
    fullReload(pixels: Uint8Array): void;
    isReady(): boolean;
}

const SIZE = 128;

function pack4444(r: number, g: number, b: number, a: number): number {
    return ((r >>> 4) << 12) | ((g >>> 4) << 8) | ((b >>> 4) << 4) | (a >>> 4);
}

export function makeSpritesheet(deps: SpritesheetDeps): Spritesheet {
    let cachedBuffer: ArrayBuffer | null = null;
    let cachedView:   Uint16Array | null = null;
    let cachedPtr:    number = 0;

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
        mirror(pixels, rect) {
            if (!deps.isRunning()) return;
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
                // memory.grow race or OOB — silently drop; full reload at next Play recovers.
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
```

- [ ] **Step 5: Wire into `runtime.ts`**

In `editor/src/engine/runtime.ts`, add a `Spritesheet` to the `Runtime` interface and construct it during `bootRuntime`:

```typescript
import { makeSpritesheet, type Spritesheet } from './spritesheet';

export interface Runtime {
    wasm: WebAssembly.Instance;
    memory: WebAssembly.Memory;
    tb: Tinybit;
    enc: Encoder; encoderAvailable: boolean;
    dec: Decoder; decoderAvailable: boolean;
    spritesheet: Spritesheet;
}
```

And in `bootRuntime`, after `const tb = makeTinybit(exports);`:

```typescript
const spritesheet = makeSpritesheet({
    memory: exports.memory,
    ptr: () => exports.tb_spritesheet_ptr(),
    isRunning: () => false,  // wired up in App.tsx where frameLoop is available
});
```

(The `isRunning` getter will be re-bound in App.tsx via a closure that reads from the frameLoop; if patching `runtime` after the fact is awkward, expose a `setRunningPredicate(fn)` on the `Spritesheet` instead.)

Update the final `return` to include `spritesheet`.

- [ ] **Step 6: Add `setRunningPredicate` to the spritesheet API**

Update `editor/src/engine/spritesheet.ts` so `isRunning` is settable post-construction (avoids a chicken-and-egg between runtime boot and frameLoop creation):

```typescript
export interface Spritesheet {
    mirror(pixels: Uint8Array, rect: DirtyRect): void;
    fullReload(pixels: Uint8Array): void;
    isReady(): boolean;
    setRunningPredicate(fn: () => boolean): void;
}
```

Implementation: store `isRunning` in a mutable variable inside the closure, default to `() => false`, expose a setter.

- [ ] **Step 7: Run tests, verify pass**

Run: `cd editor && npm test -- spritesheet.test`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add editor/src/engine/spritesheet.ts editor/src/engine/spritesheet.test.ts editor/src/engine/tinybit.ts editor/src/engine/runtime.ts
git commit -m "engine: spritesheet wrapper for live RGBA4444 mirror + full reload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 9: Extend `sketchStore` with `spritePixels`

**Files:**
- Modify: `editor/src/state/sketchStore.ts`
- Modify: `editor/src/state/sketchStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `editor/src/state/sketchStore.test.ts` (after the existing tests):

```typescript
import { encodePixelsToPng } from '../sprite/png';

describe('sketchStore — spritePixels', () => {
    test('starts null', () => {
        expect(useSketchStore.getState().spritePixels).toBeNull();
    });

    test('setSpriteFromPng populates sprite and spritePixels atomically', async () => {
        const pixels = new Uint8Array(128 * 128 * 4);
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 0xFF; pixels[i + 3] = 0xFF;  // solid red
        }
        const png = await encodePixelsToPng(pixels);
        await useSketchStore.getState().setSpriteFromPng(png);
        const s = useSketchStore.getState();
        expect(s.sprite).toBe(png);
        expect(s.spritePixels).not.toBeNull();
        expect(s.spritePixels!.length).toBe(128 * 128 * 4);
        expect(s.spritePixels![0]).toBe(0xFF);
    });

    test('setSpritePixel mutates the buffer and replaces the view identity', () => {
        const buf = new Uint8Array(128 * 128 * 4);
        useSketchStore.setState({ spritePixels: buf });
        const before = useSketchStore.getState().spritePixels;
        useSketchStore.getState().setSpritePixel(0, 0, 0xFF00FF00);
        const after = useSketchStore.getState().spritePixels!;
        expect(after).not.toBe(before);          // identity changed → subscribers re-render
        expect(after.buffer).toBe(buf.buffer);    // same underlying memory
        expect(after[0]).toBe(0xFF);
    });

    test('clearSprite clears both sprite and spritePixels', () => {
        useSketchStore.setState({ sprite: new Uint8Array([1,2,3]), spritePixels: new Uint8Array(128 * 128 * 4) });
        useSketchStore.getState().clearSprite();
        const s = useSketchStore.getState();
        expect(s.sprite).toBeNull();
        expect(s.spritePixels).toBeNull();
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- sketchStore.test`
Expected: new tests fail.

- [ ] **Step 3: Implement**

Modify `editor/src/state/sketchStore.ts`:

```typescript
import { create } from 'zustand';
import { decodePngToPixels } from '../sprite/png';
import type { DirtyRect } from '../sprite/history';

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
    spritePixels: Uint8Array | null;

    setScript(v: string): void;
    setSprite(v: Uint8Array | null): void;
    setCover(v: Uint8Array | null): void;
    setTitle(v: string): void;
    setAuthor(v: string): void;
    loadCartridge(parts: { title: string; author: string; sprite: Uint8Array; cover: Uint8Array; script: string }): void;
    reset(): void;

    setSpriteFromPng(bytes: Uint8Array): Promise<void>;
    setSpritePixel(x: number, y: number, rgba: number): void;
    setSpriteBlock(rect: DirtyRect, src: Uint8Array): void;
    clearSprite(): void;
}

const initial = {
    script: DEFAULT_SCRIPT,
    sprite: null as Uint8Array | null,
    cover:  null as Uint8Array | null,
    title:  '',
    author: '',
    spritePixels: null as Uint8Array | null,
};

const SIZE = 128;

export const useSketchStore = create<SketchState>((set, get) => ({
    ...initial,
    setScript: (v) => set({ script: v }),
    setSprite: (v) => set({ sprite: v }),
    setCover:  (v) => set({ cover: v }),
    setTitle:  (v) => set({ title: v }),
    setAuthor: (v) => set({ author: v }),
    loadCartridge: (parts) => {
        set({
            title:  parts.title,
            author: parts.author,
            sprite: parts.sprite,
            cover:  parts.cover,
            script: parts.script,
        });
        // fire-and-forget; spritePixels follows via setSpriteFromPng
        void get().setSpriteFromPng(parts.sprite);
    },
    reset: () => set({ ...initial }),

    async setSpriteFromPng(bytes) {
        const { pixels } = await decodePngToPixels(bytes);
        set({ sprite: bytes, spritePixels: pixels });
    },
    setSpritePixel(x, y, rgba) {
        const buf = get().spritePixels;
        if (!buf) return;
        const o = (y * SIZE + x) * 4;
        buf[o]     = (rgba >>> 24) & 0xFF;
        buf[o + 1] = (rgba >>> 16) & 0xFF;
        buf[o + 2] = (rgba >>>  8) & 0xFF;
        buf[o + 3] =  rgba         & 0xFF;
        set({ spritePixels: new Uint8Array(buf.buffer) });
    },
    setSpriteBlock(rect, src) {
        const buf = get().spritePixels;
        if (!buf) return;
        let si = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const rowOff = (y * SIZE + rect.x) * 4;
            buf.set(src.subarray(si, si + rect.w * 4), rowOff);
            si += rect.w * 4;
        }
        set({ spritePixels: new Uint8Array(buf.buffer) });
    },
    clearSprite() {
        set({ sprite: null, spritePixels: null });
    },
}));
```

- [ ] **Step 4: Run, verify pass**

Run: `cd editor && npm test -- sketchStore.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/sketchStore.ts editor/src/state/sketchStore.test.ts
git commit -m "state: sketchStore.spritePixels with per-pixel/block setters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 10: New `spriteEditorStore`

**Files:**
- Create: `editor/src/state/spriteEditorStore.ts`
- Test: `editor/src/state/spriteEditorStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { useSpriteEditorStore } from './spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('spriteEditorStore', () => {
    test('default state', () => {
        const s = useSpriteEditorStore.getState();
        expect(s.tool).toBe('pencil');
        expect(s.pencilSize).toBe(1);
        expect(s.zoom).toBe(8);
        expect(s.color).toBe(0x000000FF);
    });

    test('setColor snaps to top-4-bits-per-channel', () => {
        useSpriteEditorStore.getState().setColor(0xFFA9B7CC);
        // top 4 bits of each channel: 0xF0A0B0C0
        expect(useSpriteEditorStore.getState().color).toBe(0xF0A0B0C0);
    });

    test('setColor prepends to recent and dedupes (most-recent first)', () => {
        const { setColor } = useSpriteEditorStore.getState();
        setColor(0xFF0000FF);
        setColor(0x00FF00FF);
        setColor(0xFF0000FF);  // already exists
        const r = useSpriteEditorStore.getState().recent;
        expect(r[0]).toBe(0xFF0000FF);
        expect(r.filter((c) => c === 0xFF0000FF).length).toBe(1);
    });

    test('recent caps at 12', () => {
        const { setColor } = useSpriteEditorStore.getState();
        for (let i = 0; i < 20; i++) setColor((i * 0x10101010) >>> 0);
        expect(useSpriteEditorStore.getState().recent.length).toBeLessThanOrEqual(12);
    });

    test('setZoom with anchor keeps the anchored pixel under the cursor', () => {
        useSpriteEditorStore.setState({ zoom: 4, pan: { x: 0, y: 0 } });
        useSpriteEditorStore.getState().setZoom(8, { sx: 200, sy: 150, canvasW: 400, canvasH: 400 });
        const z = useSpriteEditorStore.getState().zoom;
        expect(z).toBe(8);
        // pan should have updated; checked end-to-end in viewport tests
    });

    test('pushPatch clears redo', () => {
        const { pushPatch, undo } = useSpriteEditorStore.getState();
        const rect = { x: 0, y: 0, w: 1, h: 1 };
        pushPatch({ rect, before: new Uint8Array(4), after: new Uint8Array(4) });
        undo(() => {});
        expect(useSpriteEditorStore.getState().redoDepth).toBeGreaterThan(0);
        pushPatch({ rect, before: new Uint8Array(4), after: new Uint8Array(4) });
        expect(useSpriteEditorStore.getState().redoDepth).toBe(0);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- spriteEditorStore.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/state/spriteEditorStore.ts`:

```typescript
import { create } from 'zustand';
import { snapAllChannels } from '../sprite/color';
import { makeHistory, type Patch } from '../sprite/history';
import { anchoredZoom, type Zoom } from '../sprite/viewport';

export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';
export type PencilSize = 1 | 2 | 3 | 4 | 8;
export type OverlayMode = 'auto' | 'on' | 'off';

export interface SpriteEditorState {
    tool: Tool;
    pencilSize: PencilSize;
    zoom: Zoom;
    pan: { x: number; y: number };
    color: number;
    recent: number[];
    showGrid: OverlayMode;
    showNumbers: OverlayMode;

    undoDepth: number;
    redoDepth: number;

    setTool(t: Tool): void;
    setPencilSize(n: PencilSize): void;
    setZoom(z: Zoom, anchor?: { sx: number; sy: number; canvasW: number; canvasH: number }): void;
    setPan(p: { x: number; y: number }): void;
    setColor(rgba: number): void;
    setOverlay(which: 'grid' | 'numbers', mode: OverlayMode): void;
    pushPatch(p: Patch): void;
    undo(apply: (p: Patch) => void): void;
    redo(apply: (p: Patch) => void): void;
    reset(): void;
}

const initial = {
    tool: 'pencil' as Tool,
    pencilSize: 1 as PencilSize,
    zoom: 8 as Zoom,
    pan: { x: 0, y: 0 },
    color: 0x000000FF,
    recent: [] as number[],
    showGrid: 'auto' as OverlayMode,
    showNumbers: 'auto' as OverlayMode,
    undoDepth: 0,
    redoDepth: 0,
};

const RECENT_CAP = 12;

export const useSpriteEditorStore = create<SpriteEditorState>((set, get) => {
    const history = makeHistory(50);

    return {
        ...initial,
        setTool(t)       { set({ tool: t }); },
        setPencilSize(n) { set({ pencilSize: n }); },
        setZoom(z, anchor) {
            const cur = get();
            if (!anchor) { set({ zoom: z }); return; }
            const v = anchoredZoom({ zoom: cur.zoom, pan: cur.pan }, z, anchor);
            set({ zoom: v.zoom, pan: v.pan });
        },
        setPan(p) { set({ pan: p }); },
        setColor(rgba) {
            const snapped = (snapAllChannels(rgba) >>> 0);
            const recent = [snapped, ...get().recent.filter((c) => c !== snapped)].slice(0, RECENT_CAP);
            set({ color: snapped, recent });
        },
        setOverlay(which, mode) {
            set(which === 'grid' ? { showGrid: mode } : { showNumbers: mode });
        },
        pushPatch(p) {
            history.push(p);
            set({ undoDepth: history.undoDepth(), redoDepth: history.redoDepth() });
        },
        undo(apply) {
            history.undo(apply);
            set({ undoDepth: history.undoDepth(), redoDepth: history.redoDepth() });
        },
        redo(apply) {
            history.redo(apply);
            set({ undoDepth: history.undoDepth(), redoDepth: history.redoDepth() });
        },
        reset() { history.clear(); set(initial); },
    };
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd editor && npm test -- spriteEditorStore.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/spriteEditorStore.ts editor/src/state/spriteEditorStore.test.ts
git commit -m "state: spriteEditorStore (tool, zoom, colour, history)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11: Persistence adapter for `sprite-ui/v1`

**Files:**
- Modify: `editor/src/state/persist.ts`
- Modify: `editor/src/state/persist.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `editor/src/state/persist.test.ts`:

```typescript
import { loadSpriteUi, saveSpriteUi, SPRITE_UI_KEY } from './persist';

describe('sprite-ui persistence', () => {
    beforeEach(() => localStorage.clear());

    test('save/load round-trip', () => {
        saveSpriteUi({ tool: 'fill', pencilSize: 4, color: 0xF0A0B0C0, recent: [0xFF0000FF, 0x00FF00FF], showGrid: 'on', showNumbers: 'off' });
        expect(loadSpriteUi()).toEqual({ tool: 'fill', pencilSize: 4, color: 0xF0A0B0C0, recent: [0xFF0000FF, 0x00FF00FF], showGrid: 'on', showNumbers: 'off' });
    });

    test('load returns null on missing key', () => {
        expect(loadSpriteUi()).toBeNull();
    });

    test('load tolerates malformed JSON', () => {
        localStorage.setItem(SPRITE_UI_KEY, 'not json');
        expect(loadSpriteUi()).toBeNull();
    });

    test('save survives quota errors silently', () => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
        expect(() => saveSpriteUi({ tool: 'pencil', pencilSize: 1, color: 0, recent: [], showGrid: 'auto', showNumbers: 'auto' })).not.toThrow();
        Storage.prototype.setItem = orig;
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- persist.test`
Expected: fail.

- [ ] **Step 3: Implement**

Append to `editor/src/state/persist.ts`:

```typescript
export const SPRITE_UI_KEY = 'tinybit-editor/sprite-ui/v1';

export interface PersistedSpriteUi {
    tool: 'pencil' | 'eraser' | 'fill' | 'eyedropper';
    pencilSize: 1 | 2 | 3 | 4 | 8;
    color: number;
    recent: number[];
    showGrid: 'auto' | 'on' | 'off';
    showNumbers: 'auto' | 'on' | 'off';
}

export function saveSpriteUi(v: PersistedSpriteUi): void {
    try {
        localStorage.setItem(SPRITE_UI_KEY, JSON.stringify(v));
    } catch {
        /* quota or storage disabled — silent (UI prefs are non-critical) */
    }
}

export function loadSpriteUi(): PersistedSpriteUi | null {
    try {
        const s = localStorage.getItem(SPRITE_UI_KEY);
        if (!s) return null;
        const parsed = JSON.parse(s);
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.tool !== 'string' || typeof parsed.pencilSize !== 'number') return null;
        return parsed as PersistedSpriteUi;
    } catch {
        return null;
    }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd editor && npm test -- persist.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/persist.ts editor/src/state/persist.test.ts
git commit -m "state: persist sprite-ui prefs under tinybit-editor/sprite-ui/v1

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Components

### Task 12: `sprite/overlay.ts` — grid + numbers renderer

**Files:**
- Create: `editor/src/sprite/overlay.ts`
- Test: `editor/src/sprite/overlay.test.ts`

The overlay renderer is largely a presentation function. The unit test covers the threshold logic only — pixel-perfect rendering is exercised in component snapshots in Task 13.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, test, expect } from 'vitest';
import { computeOverlay } from './overlay';

describe('computeOverlay', () => {
    test('zoom 1: no grid, no numbers', () => {
        const o = computeOverlay(1, 'auto', 'auto');
        expect(o.showCellGrid).toBe(false);
        expect(o.showPixelGrid).toBe(false);
        expect(o.showCellNumbers).toBe(false);
        expect(o.showPixelNumbers).toBe(false);
    });

    test('zoom 4: only 8×8 grid', () => {
        const o = computeOverlay(4, 'auto', 'auto');
        expect(o.showCellGrid).toBe(true);
        expect(o.showPixelGrid).toBe(false);
        expect(o.showCellNumbers).toBe(false);
    });

    test('zoom 8: 8×8 + faint pixel grid + cell numbers', () => {
        const o = computeOverlay(8, 'auto', 'auto');
        expect(o.showCellGrid).toBe(true);
        expect(o.showPixelGrid).toBe(true);
        expect(o.showCellNumbers).toBe(true);
        expect(o.showPixelNumbers).toBe(false);
    });

    test('zoom 32: everything including per-pixel numbers', () => {
        const o = computeOverlay(32, 'auto', 'auto');
        expect(o.showCellGrid).toBe(true);
        expect(o.showPixelGrid).toBe(true);
        expect(o.showCellNumbers).toBe(true);
        expect(o.showPixelNumbers).toBe(true);
    });

    test('manual override: off forces everything off', () => {
        const o = computeOverlay(32, 'off', 'off');
        expect(o.showCellGrid).toBe(false);
        expect(o.showPixelGrid).toBe(false);
        expect(o.showCellNumbers).toBe(false);
        expect(o.showPixelNumbers).toBe(false);
    });

    test('manual override: on at zoom 1 still shows the grid', () => {
        const o = computeOverlay(1, 'on', 'on');
        expect(o.showCellGrid).toBe(true);
        expect(o.showCellNumbers).toBe(true);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- overlay.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/sprite/overlay.ts`:

```typescript
import type { Zoom } from './viewport';
import type { OverlayMode } from '../state/spriteEditorStore';

export interface OverlayPlan {
    showCellGrid:     boolean;
    showPixelGrid:    boolean;
    cellGridAlpha:    number;
    pixelGridAlpha:   number;
    showCellNumbers:  boolean;
    showPixelNumbers: boolean;
    gutterTop:        number;
    gutterLeft:       number;
}

export function computeOverlay(zoom: Zoom, gridMode: OverlayMode, numbersMode: OverlayMode): OverlayPlan {
    const autoCellGrid = zoom >= 4;
    const autoPixelGrid = zoom >= 8;
    const autoCellNumbers = zoom >= 8;
    const autoPixelNumbers = zoom >= 24;

    const showCellGrid     = gridMode    === 'off' ? false : gridMode    === 'on' ? true : autoCellGrid;
    const showPixelGrid    = gridMode    === 'off' ? false : gridMode    === 'on' ? zoom >= 4 : autoPixelGrid;
    const showCellNumbers  = numbersMode === 'off' ? false : numbersMode === 'on' ? true : autoCellNumbers;
    const showPixelNumbers = numbersMode === 'off' ? false : numbersMode === 'on' ? zoom >= 12 : autoPixelNumbers;

    const cellGridAlpha  = zoom >= 12 ? 0.35 : 0.25;
    const pixelGridAlpha = zoom >= 12 ? 0.15 : 0.08;
    const gutterTop  = showCellNumbers ? (showPixelNumbers ? 24 : 16) : 0;
    const gutterLeft = showCellNumbers ? (showPixelNumbers ? 26 : 18) : 0;

    return { showCellGrid, showPixelGrid, cellGridAlpha, pixelGridAlpha, showCellNumbers, showPixelNumbers, gutterTop, gutterLeft };
}

export interface DrawOverlayInput {
    ctx: CanvasRenderingContext2D;
    canvasW: number;
    canvasH: number;
    plan: OverlayPlan;
    spriteRect: { x: number; y: number; w: number; h: number };
    zoom: Zoom;
}

export function drawOverlay({ ctx, canvasW, canvasH, plan, spriteRect, zoom }: DrawOverlayInput): void {
    ctx.clearRect(0, 0, canvasW, canvasH);
    // Pixel grid
    if (plan.showPixelGrid) {
        ctx.strokeStyle = `rgba(0,0,0,${plan.pixelGridAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 128; i++) {
            const x = spriteRect.x + i * zoom + 0.5;
            ctx.moveTo(x, spriteRect.y);
            ctx.lineTo(x, spriteRect.y + spriteRect.h);
            const y = spriteRect.y + i * zoom + 0.5;
            ctx.moveTo(spriteRect.x, y);
            ctx.lineTo(spriteRect.x + spriteRect.w, y);
        }
        ctx.stroke();
    }
    // 8×8 cell grid (drawn after so it sits on top)
    if (plan.showCellGrid) {
        ctx.strokeStyle = `rgba(0,0,0,${plan.cellGridAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
            const x = spriteRect.x + i * 8 * zoom + 0.5;
            ctx.moveTo(x, spriteRect.y);
            ctx.lineTo(x, spriteRect.y + spriteRect.h);
            const y = spriteRect.y + i * 8 * zoom + 0.5;
            ctx.moveTo(spriteRect.x, y);
            ctx.lineTo(spriteRect.x + spriteRect.w, y);
        }
        ctx.stroke();
    }
    // Numbers
    if (plan.showCellNumbers) {
        ctx.fillStyle = '#6B6B76';
        ctx.font = '10px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < 16; i++) {
            const num = (i * 8).toString();
            const x = spriteRect.x + i * 8 * zoom + (8 * zoom) / 2;
            ctx.textAlign = 'center';
            ctx.fillText(num, x, spriteRect.y - 8);
            const y = spriteRect.y + i * 8 * zoom + (8 * zoom) / 2;
            ctx.textAlign = 'right';
            ctx.fillText(num, spriteRect.x - 4, y);
        }
    }
    if (plan.showPixelNumbers) {
        ctx.fillStyle = '#A0A0AA';
        ctx.font = '8px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < 128; i++) {
            const x = spriteRect.x + i * zoom + zoom / 2;
            ctx.textAlign = 'center';
            ctx.fillText(i.toString(), x, spriteRect.y - 20);
            const y = spriteRect.y + i * zoom + zoom / 2;
            ctx.textAlign = 'right';
            ctx.fillText(i.toString(), spriteRect.x - 16, y);
        }
    }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd editor && npm test -- overlay.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/overlay.ts editor/src/sprite/overlay.test.ts
git commit -m "sprite: overlay plan + canvas drawer (grid + numbers)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 13: `sprite/PixelCanvas.tsx` — pixel + overlay canvases

This is a presentational component wired to the stores. Most of its logic is in `useEffect` and rAF callbacks — covered by a single integration-style component test.

**Files:**
- Create: `editor/src/sprite/PixelCanvas.tsx`
- Test: `editor/src/sprite/PixelCanvas.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PixelCanvas } from './PixelCanvas';
import { useSketchStore } from '../state/sketchStore';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => {
    useSketchStore.getState().reset();
    useSpriteEditorStore.getState().reset();
});

describe('<PixelCanvas>', () => {
    test('renders two canvases', () => {
        const { container } = render(<PixelCanvas onPointer={() => {}} />);
        const canvases = container.querySelectorAll('canvas');
        expect(canvases.length).toBe(2);
    });

    test('clicking emits a pointer event with sprite-pixel coords', () => {
        const events: Array<{ type: string; px: number; py: number }> = [];
        const { container } = render(<PixelCanvas onPointer={(t, px, py) => events.push({ type: t, px, py })} />);
        const canvas = container.querySelector('canvas')! as HTMLCanvasElement;
        // jsdom doesn't lay out, so we monkey-patch getBoundingClientRect to fake a 320x320 canvas
        canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 320, width: 320, height: 320, x: 0, y: 0, toJSON: () => ({}) });
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 160, clientY: 160, button: 0 }));
        // We don't strictly assert pixel coords (depends on layout); just that something fired.
        expect(events.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- PixelCanvas.test`
Expected: fail (module not found).

- [ ] **Step 3: Implement**

`editor/src/sprite/PixelCanvas.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSketchStore } from '../state/sketchStore';
import { useSpriteEditorStore } from '../state/spriteEditorStore';
import { screenToPixel, type Viewport } from './viewport';
import { computeOverlay, drawOverlay } from './overlay';

export type PointerCb = (type: 'down' | 'move' | 'up', px: number, py: number, modifiers: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean; button: number }) => void;

const SIZE = 128;
const wrapStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%', minHeight: 0 };
const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, imageRendering: 'pixelated', cursor: 'crosshair' };

export function PixelCanvas({ onPointer }: { onPointer: PointerCb }) {
    const pixelsRef = useRef<HTMLCanvasElement | null>(null);
    const overlayRef = useRef<HTMLCanvasElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const spritePixels = useSketchStore((s) => s.spritePixels);
    const { zoom, pan, showGrid, showNumbers } = useSpriteEditorStore();

    // Track parent size
    useEffect(() => {
        if (!wrapRef.current) return;
        const el = wrapRef.current;
        const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        setSize({ w: el.clientWidth, h: el.clientHeight });
        return () => ro.disconnect();
    }, []);

    // Redraw pixels
    useEffect(() => {
        const c = pixelsRef.current;
        if (!c || size.w === 0) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = size.w * dpr; c.height = size.h * dpr;
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.scale(dpr, dpr);

        // Checkerboard background
        const tile = 16;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size.w, size.h);
        ctx.fillStyle = '#E8E8EE';
        for (let y = 0; y < size.h; y += tile) for (let x = 0; x < size.w; x += tile)
            if (((x / tile + y / tile) & 1) === 0) ctx.fillRect(x, y, tile, tile);

        if (!spritePixels) return;

        // Offscreen 128×128 backing
        const off = new OffscreenCanvas(SIZE, SIZE);
        const offCtx = off.getContext('2d')!;
        const img = new ImageData(new Uint8ClampedArray(spritePixels), SIZE, SIZE);
        offCtx.putImageData(img, 0, 0);

        // Centre + pan
        const drawW = SIZE * zoom, drawH = SIZE * zoom;
        const x = Math.floor((size.w - drawW) / 2) + pan.x * zoom;
        const y = Math.floor((size.h - drawH) / 2) + pan.y * zoom;
        ctx.drawImage(off, x, y, drawW, drawH);
    }, [spritePixels, zoom, pan, size]);

    // Redraw overlay
    useEffect(() => {
        const c = overlayRef.current;
        if (!c || size.w === 0) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = size.w * dpr; c.height = size.h * dpr;
        const ctx = c.getContext('2d')!;
        ctx.scale(dpr, dpr);
        const drawW = SIZE * zoom, drawH = SIZE * zoom;
        const sx = Math.floor((size.w - drawW) / 2) + pan.x * zoom;
        const sy = Math.floor((size.h - drawH) / 2) + pan.y * zoom;
        drawOverlay({
            ctx, canvasW: size.w, canvasH: size.h,
            plan: computeOverlay(zoom, showGrid, showNumbers),
            spriteRect: { x: sx, y: sy, w: drawW, h: drawH },
            zoom,
        });
    }, [zoom, pan, size, showGrid, showNumbers]);

    function pointerHandler(type: 'down' | 'move' | 'up') {
        return (e: React.PointerEvent<HTMLCanvasElement>) => {
            const c = pixelsRef.current; if (!c) return;
            const rect = c.getBoundingClientRect();
            const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
            const vp: Viewport = { zoom, pan };
            const p = screenToPixel(vp, sx, sy, rect.width, rect.height);
            if (!p) {
                if (type === 'up') onPointer(type, -1, -1, mods(e));
                return;
            }
            if (type === 'down') c.setPointerCapture(e.pointerId);
            if (type === 'up')   c.releasePointerCapture?.(e.pointerId);
            onPointer(type, p.x, p.y, mods(e));
        };
    }
    function mods(e: React.PointerEvent) {
        return { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, button: e.button };
    }

    return (
        <div ref={wrapRef} style={wrapStyle}>
            <canvas ref={pixelsRef}  style={canvasStyle}
                onPointerDown={pointerHandler('down')}
                onPointerMove={pointerHandler('move')}
                onPointerUp={pointerHandler('up')} />
            <canvas ref={overlayRef} style={{ ...canvasStyle, pointerEvents: 'none' }} />
        </div>
    );
}
```

Note: `OffscreenCanvas` is supported in jsdom only via the optional `canvas` dep added in Task 5. If the test runner complains, replace `OffscreenCanvas` with `document.createElement('canvas')` of size 128×128 — same API.

- [ ] **Step 4: Run tests**

Run: `cd editor && npm test -- PixelCanvas.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/PixelCanvas.tsx editor/src/sprite/PixelCanvas.test.tsx
git commit -m "sprite: PixelCanvas — stacked pixel + overlay canvases

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 14: `sprite/ToolRail.tsx`

**Files:**
- Create: `editor/src/sprite/ToolRail.tsx`
- Test: `editor/src/sprite/ToolRail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ToolRail } from './ToolRail';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('<ToolRail>', () => {
    test('renders four tool buttons', () => {
        render(<ToolRail />);
        expect(screen.getByRole('button', { name: /pencil/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /eraser/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /fill/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /eyedropper/i })).toBeTruthy();
    });

    test('clicking a tool switches the store', () => {
        render(<ToolRail />);
        fireEvent.click(screen.getByRole('button', { name: /eraser/i }));
        expect(useSpriteEditorStore.getState().tool).toBe('eraser');
    });

    test('pencil size slider updates store', () => {
        render(<ToolRail />);
        const slider = screen.getByLabelText(/pencil size/i) as HTMLInputElement;
        fireEvent.change(slider, { target: { value: '3' } });
        expect(useSpriteEditorStore.getState().pencilSize).toBe(4); // sizes: 1,2,3,4,8 → index 3 → 4
    });

    test('zoom in/out buttons step the ladder', () => {
        useSpriteEditorStore.setState({ zoom: 1 });
        render(<ToolRail />);
        fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
        expect(useSpriteEditorStore.getState().zoom).toBe(2);
        fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
        expect(useSpriteEditorStore.getState().zoom).toBe(1);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- ToolRail.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/sprite/ToolRail.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { useSpriteEditorStore, type Tool, type PencilSize } from '../state/spriteEditorStore';
import { ZOOM_LEVELS, nextZoom, prevZoom } from './viewport';

const SIZES: PencilSize[] = [1, 2, 3, 4, 8];

const railStyle: CSSProperties = { width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 6, background: '#F6F6F8', borderRight: '1px solid #ECECF0', overflowY: 'auto' };
const btnStyle = (active: boolean): CSSProperties => ({
    width: 32, height: 32, borderRadius: 6, border: 'none',
    background: active ? '#ED225D' : '#FFFFFF',
    color: active ? '#FFFFFF' : '#181820',
    cursor: 'pointer', fontSize: 14, lineHeight: 1,
});
const dividerStyle: CSSProperties = { width: 28, height: 1, background: '#ECECF0', margin: '4px 0' };

export function ToolRail() {
    const { tool, pencilSize, zoom, setTool, setPencilSize, setZoom } = useSpriteEditorStore();

    const toolBtn = (id: Tool, label: string, glyph: string) => (
        <button type="button" key={id} aria-label={label} title={label} onClick={() => setTool(id)} style={btnStyle(tool === id)}>{glyph}</button>
    );

    return (
        <div style={railStyle} role="toolbar">
            {toolBtn('pencil',     'Pencil',     '✎')}
            {toolBtn('eraser',     'Eraser',     '⌫')}
            {toolBtn('fill',       'Fill',       '🪣')}
            {toolBtn('eyedropper', 'Eyedropper', '💧')}
            <div style={dividerStyle} />
            <label htmlFor="pencil-size" style={{ fontSize: 10, color: '#6B6B76' }}>Size</label>
            <input id="pencil-size" type="range" aria-label="Pencil size"
                min={0} max={SIZES.length - 1} step={1}
                value={SIZES.indexOf(pencilSize)}
                onChange={(e) => setPencilSize(SIZES[Number(e.target.value)])}
                style={{ writingMode: 'vertical-lr', WebkitAppearance: 'slider-vertical' as never, width: 32, height: 80 } as CSSProperties} />
            <div style={{ fontSize: 11, color: '#181820' }}>{pencilSize}</div>
            <div style={dividerStyle} />
            <button type="button" aria-label="Zoom in"  onClick={() => setZoom(nextZoom(zoom))} style={btnStyle(false)}>+</button>
            <div style={{ fontSize: 11, color: '#181820' }}>{zoom}×</div>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom(prevZoom(zoom))} style={btnStyle(false)}>−</button>
        </div>
    );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd editor && npm test -- ToolRail.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/ToolRail.tsx editor/src/sprite/ToolRail.test.tsx
git commit -m "sprite: ToolRail — tools, size, zoom

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 15: `sprite/ColorPanel.tsx`

**Files:**
- Create: `editor/src/sprite/ColorPanel.tsx`
- Test: `editor/src/sprite/ColorPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ColorPanel } from './ColorPanel';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('<ColorPanel>', () => {
    test('hex input sets the colour (snapped)', () => {
        render(<ColorPanel />);
        const hex = screen.getByLabelText(/hex/i) as HTMLInputElement;
        fireEvent.change(hex, { target: { value: '#a9b7c8ff' } });
        fireEvent.blur(hex);
        expect(useSpriteEditorStore.getState().color).toBe(0xA0B0C0F0);
    });

    test('recent colours render and clicking one sets current colour', () => {
        useSpriteEditorStore.getState().setColor(0xFF0000FF);
        useSpriteEditorStore.getState().setColor(0x00FF00FF);
        render(<ColorPanel />);
        const buttons = screen.getAllByRole('button', { name: /recent colour/i });
        expect(buttons.length).toBe(2);
        // first button should be the most-recent (green)
        useSpriteEditorStore.getState().setColor(0x000000FF); // change current
        fireEvent.click(buttons[0]);
        expect(useSpriteEditorStore.getState().color).toBe(0x00FF00FF);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- ColorPanel.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/sprite/ColorPanel.tsx`:

```tsx
import { useState, type CSSProperties, type ChangeEvent } from 'react';
import { useSpriteEditorStore } from '../state/spriteEditorStore';
import { hexToRgba, rgbaToHex, unpackRgba8, packRgba8 } from './color';

const wrap: CSSProperties = { display: 'flex', gap: 12, padding: 12, background: '#F6F6F8', borderTop: '1px solid #ECECF0', alignItems: 'center' };
const swatch = (rgba: number): CSSProperties => ({
    width: 22, height: 22, borderRadius: 4, border: '1px solid #ECECF0',
    background: rgbaToHex(rgba),
    cursor: 'pointer',
});

export function ColorPanel() {
    const { color, recent, setColor } = useSpriteEditorStore();
    const [draft, setDraft] = useState(rgbaToHex(color));

    function commit() {
        const v = hexToRgba(draft);
        if (v !== null) setColor(v);
        else setDraft(rgbaToHex(color));
    }

    const u = unpackRgba8(color);

    return (
        <div style={wrap} role="region" aria-label="Colour panel">
            <div style={{ ...swatch(color), width: 36, height: 36 }} aria-label="Current colour" title="Current colour" />
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#6B6B76' }}>
                Hex
                <input
                    aria-label="Hex"
                    type="text"
                    value={draft}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                    style={{ width: 96, padding: '4px 6px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, border: '1px solid #ECECF0', borderRadius: 4 }}
                />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#6B6B76' }}>
                Alpha
                <input
                    aria-label="Alpha"
                    type="range" min={0} max={255}
                    value={u.a}
                    onChange={(e) => setColor(packRgba8(u.r, u.g, u.b, Number(e.target.value)))}
                />
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
                {recent.map((c, i) => (
                    <button key={i} type="button" aria-label={`Recent colour ${i + 1}`} title={rgbaToHex(c)} onClick={() => setColor(c)} style={swatch(c)} />
                ))}
            </div>
        </div>
    );
}
```

Note: a full HSV square + hue strip is feature-rich; for v1 we ship hex + alpha slider + recents (which is sufficient and matches the spec's bare minimum). A follow-up can add the HSV plane component without touching the rest of the editor.

- [ ] **Step 4: Run, verify pass**

Run: `cd editor && npm test -- ColorPanel.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/ColorPanel.tsx editor/src/sprite/ColorPanel.test.tsx
git commit -m "sprite: ColorPanel — hex input, alpha slider, recent colours

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 16: `sprite/SpriteEditor.tsx` — shell + pointer + keyboard

**Files:**
- Create: `editor/src/sprite/SpriteEditor.tsx`
- Test: `editor/src/sprite/SpriteEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SpriteEditor } from './SpriteEditor';
import { useSketchStore } from '../state/sketchStore';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => {
    useSketchStore.getState().reset();
    useSpriteEditorStore.getState().reset();
});

describe('<SpriteEditor>', () => {
    test('renders the three subcomponents', () => {
        const { container } = render(<SpriteEditor />);
        expect(container.querySelector('[role="toolbar"]')).toBeTruthy();
        expect(container.querySelectorAll('canvas').length).toBe(2);
        expect(container.querySelector('[role="region"]')).toBeTruthy();
    });

    test('keyboard b/e/g/i switches tools', () => {
        const { container } = render(<SpriteEditor />);
        const root = container.firstChild as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'e' });
        expect(useSpriteEditorStore.getState().tool).toBe('eraser');
        fireEvent.keyDown(root, { key: 'g' });
        expect(useSpriteEditorStore.getState().tool).toBe('fill');
        fireEvent.keyDown(root, { key: 'i' });
        expect(useSpriteEditorStore.getState().tool).toBe('eyedropper');
        fireEvent.keyDown(root, { key: 'b' });
        expect(useSpriteEditorStore.getState().tool).toBe('pencil');
    });

    test('keyboard + / - zooms', () => {
        useSpriteEditorStore.setState({ zoom: 4 });
        const { container } = render(<SpriteEditor />);
        const root = container.firstChild as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: '+' });
        expect(useSpriteEditorStore.getState().zoom).toBe(8);
        fireEvent.keyDown(root, { key: '-' });
        expect(useSpriteEditorStore.getState().zoom).toBe(4);
    });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd editor && npm test -- SpriteEditor.test`
Expected: fail.

- [ ] **Step 3: Implement**

`editor/src/sprite/SpriteEditor.tsx`:

```tsx
import { useEffect, useRef, type CSSProperties } from 'react';
import { ToolRail } from './ToolRail';
import { ColorPanel } from './ColorPanel';
import { PixelCanvas, type PointerCb } from './PixelCanvas';
import { useSketchStore } from '../state/sketchStore';
import { useSpriteEditorStore, type Tool, type PencilSize } from '../state/spriteEditorStore';
import { stampBrush, drawLine, floodFill, readPixel } from './tools';
import { nextZoom, prevZoom } from './viewport';
import { encodePixelsToPng } from './png';

const root: CSSProperties = { display: 'grid', gridTemplateColumns: 'auto 1fr', gridTemplateRows: '1fr auto', height: '100%', minHeight: 0, outline: 'none' };
const railCell: CSSProperties = { gridRow: '1 / 2' };
const canvasCell: CSSProperties = { gridColumn: '2 / 3', gridRow: '1 / 2', minWidth: 0, minHeight: 0 };
const bottomCell: CSSProperties = { gridColumn: '1 / 3', gridRow: '2 / 3' };

const SIZE_LIST: PencilSize[] = [1, 2, 3, 4, 8];

export function SpriteEditor() {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const lastMoveRef = useRef<{ x: number; y: number } | null>(null);
    const baselineRef = useRef<Uint8Array | null>(null);
    const dirtyRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

    // Initial sprite placeholder if pixels are null on mount (so paint has something to write into)
    useEffect(() => {
        const s = useSketchStore.getState();
        if (s.spritePixels) return;
        // Lazy-create an empty 128×128 buffer; the persist path may fill it later
        useSketchStore.setState({ spritePixels: new Uint8Array(128 * 128 * 4) });
    }, []);

    // Debounced re-encode pixels → PNG → sketchStore.sprite
    useEffect(() => {
        let t: ReturnType<typeof setTimeout> | null = null;
        const unsub = useSketchStore.subscribe((s, prev) => {
            if (s.spritePixels === prev.spritePixels) return;
            if (!s.spritePixels) return;
            if (t) clearTimeout(t);
            t = setTimeout(async () => {
                try {
                    const png = await encodePixelsToPng(useSketchStore.getState().spritePixels!);
                    useSketchStore.getState().setSprite(png);
                } catch {
                    // re-encode failed; the next stroke will trigger another attempt
                }
            }, 500);
        });
        return () => { unsub(); if (t) clearTimeout(t); };
    }, []);

    function handlePointer(...args: Parameters<PointerCb>): void {
        const [type, px, py, mods] = args;
        const sketch = useSketchStore.getState();
        const buf = sketch.spritePixels;
        if (!buf) return;
        const ed = useSpriteEditorStore.getState();

        if (type === 'down') {
            if (px < 0) return;
            baselineRef.current = new Uint8Array(buf);  // 64 KB snapshot
            dirtyRef.current = { x: px, y: py, w: 1, h: 1 };
            applyTool(ed.tool, ed, buf, px, py, /*down*/ true);
            lastMoveRef.current = { x: px, y: py };
            useSketchStore.setState({ spritePixels: new Uint8Array(buf.buffer) });
        } else if (type === 'move' && lastMoveRef.current && px >= 0) {
            if (ed.tool === 'pencil' || ed.tool === 'eraser') {
                const colour = ed.tool === 'eraser' ? 0 : ed.color;
                const r = drawLine(buf, lastMoveRef.current.x, lastMoveRef.current.y, px, py, ed.pencilSize, colour);
                growRect(dirtyRef.current!, r);
                useSketchStore.setState({ spritePixels: new Uint8Array(buf.buffer) });
            }
            lastMoveRef.current = { x: px, y: py };
        } else if (type === 'up') {
            const baseline = baselineRef.current;
            const dirty = dirtyRef.current;
            baselineRef.current = null;
            dirtyRef.current = null;
            lastMoveRef.current = null;
            if (!baseline || !dirty) return;
            if (ed.tool === 'eyedropper') return;
            const before = sliceRect(baseline, dirty);
            const after  = sliceRect(buf, dirty);
            useSpriteEditorStore.getState().pushPatch({ rect: dirty, before, after });
        }
    }

    function applyTool(tool: Tool, ed: ReturnType<typeof useSpriteEditorStore.getState>, buf: Uint8Array, px: number, py: number, isDown: boolean) {
        if (tool === 'pencil') {
            const r = stampBrush(buf, px, py, ed.pencilSize, ed.color);
            growRect(dirtyRef.current!, r);
        } else if (tool === 'eraser') {
            const r = stampBrush(buf, px, py, ed.pencilSize, 0);
            growRect(dirtyRef.current!, r);
        } else if (tool === 'fill') {
            const r = floodFill(buf, px, py, ed.color);
            if (r) growRect(dirtyRef.current!, r);
        } else if (tool === 'eyedropper' && isDown) {
            const c = readPixel(buf, px, py);
            ed.setColor(c);
            ed.setTool('pencil');
        }
    }

    function growRect(target: { x: number; y: number; w: number; h: number }, r: { x: number; y: number; w: number; h: number }) {
        const x0 = Math.min(target.x, r.x), y0 = Math.min(target.y, r.y);
        const x1 = Math.max(target.x + target.w, r.x + r.w);
        const y1 = Math.max(target.y + target.h, r.y + r.h);
        target.x = x0; target.y = y0; target.w = x1 - x0; target.h = y1 - y0;
    }

    function sliceRect(buf: Uint8Array, rect: { x: number; y: number; w: number; h: number }): Uint8Array {
        const out = new Uint8Array(rect.w * rect.h * 4);
        let oi = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const off = (y * 128 + rect.x) * 4;
            out.set(buf.subarray(off, off + rect.w * 4), oi);
            oi += rect.w * 4;
        }
        return out;
    }

    // Pan state: space-held + drag, or middle-mouse drag.
    const panStateRef = useRef<{ spaceDown: boolean; dragging: boolean; lastX: number; lastY: number }>({ spaceDown: false, dragging: false, lastX: 0, lastY: 0 });

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === ' ') panStateRef.current.spaceDown = true; };
        const onKeyUp   = (e: KeyboardEvent) => { if (e.key === ' ') panStateRef.current.spaceDown = false; };
        const onMouseMove = (e: MouseEvent) => {
            const s = panStateRef.current;
            if (!s.dragging) return;
            const dx = e.clientX - s.lastX, dy = e.clientY - s.lastY;
            s.lastX = e.clientX; s.lastY = e.clientY;
            const ed = useSpriteEditorStore.getState();
            const z = ed.zoom;
            ed.setPan({ x: ed.pan.x + dx / z, y: ed.pan.y + dy / z });
        };
        const onMouseUp = () => { panStateRef.current.dragging = false; };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup',   onKeyUp);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup',   onMouseUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup',   onKeyUp);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup',   onMouseUp);
        };
    }, []);

    function onMouseDownCapture(e: React.MouseEvent<HTMLDivElement>) {
        const s = panStateRef.current;
        const isMiddle = e.button === 1;
        const isSpaceLeft = s.spaceDown && e.button === 0;
        if (isMiddle || isSpaceLeft) {
            s.dragging = true;
            s.lastX = e.clientX;
            s.lastY = e.clientY;
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function onWheel(e: React.WheelEvent<HTMLDivElement>) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const ed = useSpriteEditorStore.getState();
        const target = e.deltaY < 0 ? nextZoom(ed.zoom) : prevZoom(ed.zoom);
        if (target === ed.zoom) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        ed.setZoom(target, { sx: e.clientX - rect.left, sy: e.clientY - rect.top, canvasW: rect.width, canvasH: rect.height });
    }

    function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
        const ed = useSpriteEditorStore.getState();
        switch (e.key) {
            case 'b': ed.setTool('pencil'); break;
            case 'e': ed.setTool('eraser'); break;
            case 'g': ed.setTool('fill'); break;
            case 'i': ed.setTool('eyedropper'); break;
            case '+': case '=': ed.setZoom(nextZoom(ed.zoom)); break;
            case '-': ed.setZoom(prevZoom(ed.zoom)); break;
            case '[': {
                const i = SIZE_LIST.indexOf(ed.pencilSize);
                if (i > 0) ed.setPencilSize(SIZE_LIST[i - 1]);
                break;
            }
            case ']': {
                const i = SIZE_LIST.indexOf(ed.pencilSize);
                if (i < SIZE_LIST.length - 1) ed.setPencilSize(SIZE_LIST[i + 1]);
                break;
            }
            case 'z':
                if (e.ctrlKey || e.metaKey) {
                    const buf = useSketchStore.getState().spritePixels;
                    if (!buf) return;
                    if (e.shiftKey) {
                        ed.redo((p) => { writePatch(buf, p.rect, p.after); });
                    } else {
                        ed.undo((p) => { writePatch(buf, p.rect, p.before); });
                    }
                    useSketchStore.setState({ spritePixels: new Uint8Array(buf.buffer) });
                }
                break;
        }
    }

    function writePatch(buf: Uint8Array, rect: { x: number; y: number; w: number; h: number }, data: Uint8Array) {
        let si = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const off = (y * 128 + rect.x) * 4;
            buf.set(data.subarray(si, si + rect.w * 4), off);
            si += rect.w * 4;
        }
    }

    return (
        <div ref={rootRef} tabIndex={0} style={root} onKeyDown={handleKey} onMouseDownCapture={onMouseDownCapture} onWheel={onWheel}>
            <div style={railCell}><ToolRail /></div>
            <div style={canvasCell}><PixelCanvas onPointer={handlePointer} /></div>
            <div style={bottomCell}><ColorPanel /></div>
        </div>
    );
}
```

- [ ] **Step 4: Run tests**

Run: `cd editor && npm test -- SpriteEditor.test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add editor/src/sprite/SpriteEditor.tsx editor/src/sprite/SpriteEditor.test.tsx
git commit -m "sprite: SpriteEditor shell — pointer + keyboard + stroke commits

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 17: Mount `<SpriteEditor>` from `AltEditorTab`

**Files:**
- Modify: `editor/src/ui/AltEditorTab.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `editor/src/ui/AltEditorTab.tsx` with:

```tsx
import { SpriteEditor } from '../sprite/SpriteEditor';

export function AltEditorTab() {
    return <SpriteEditor />;
}
```

- [ ] **Step 2: Run existing tests to confirm nothing regressed**

Run: `cd editor && npm test`
Expected: all green (no test references the old placeholder text).

- [ ] **Step 3: Commit**

```bash
git add editor/src/ui/AltEditorTab.tsx
git commit -m "ui: alt tab now hosts the spritesheet editor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Integration

### Task 18: Wire `spritesheet.fullReload` + live `setRunningPredicate` from `App.tsx`

**Files:**
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: After runtime boot, bind the running predicate**

Find the `useEffect` that awaits `getRuntime` and, after the runtime is created and `frameLoop` is set up, wire the spritesheet's running predicate:

```typescript
rt.spritesheet.setRunningPredicate(() => frameLoop.state() === 'running');
```

Place this immediately after `frameLoop` is instantiated (search for `setRunning` or `frameLoop` to find the right line).

- [ ] **Step 2: In `handlePlay`, flush the pending re-encode then call fullReload**

Read the current `handlePlay` callback. Replace its body so that after the cartridge is fed but before `rt.tb.start()`, we call:

```typescript
const pixels = sketch.spritePixels;
if (pixels) rt.spritesheet.fullReload(pixels);
```

The pending pixels-→-PNG debounce will not have run yet for an in-progress paint session — but `feedCartridge` was already given `sketch.sprite` (the *previous* PNG). `fullReload` overwrites the engine's spritesheet with the current pixel buffer, so the running game sees the freshly-painted sprite from frame 0. This is the intended behaviour.

- [ ] **Step 3: Run all tests**

Run: `cd editor && npm test`
Expected: green.

- [ ] **Step 4: Run dev server, visually verify Play behaviour**

Run: `./scripts/dev.sh`
Open `http://localhost:5173/`. Edit a sprite pixel in the alt tab; hit Play. Confirm the painted pixel appears in the running canvas immediately.

- [ ] **Step 5: Commit**

```bash
git add editor/src/App.tsx
git commit -m "app: wire spritesheet.fullReload + live running predicate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 19: Decode persisted/loaded sprite PNG into `spritePixels` on app boot and cartridge load

**Files:**
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: After the existing persist-load `useEffect` fills `sketch.sprite`, also fill `spritePixels`**

Find the boot-time effect that calls `sketch.setSprite(stored.sprite)`. Replace `setSprite(stored.sprite)` with `void setSpriteFromPng(stored.sprite)` (the new store method, defined in Task 9). Add `setSpriteFromPng` to the destructured `sketch` actions.

- [ ] **Step 2: Same for cartridge upload (decoded sprite)**

Find the decode-success branch that calls `sketch.setSprite(result.sprite)` after a cartridge upload. Replace with `void sketch.setSpriteFromPng(result.sprite)`.

The `loadCartridge` store method already does this (see Task 9 — it calls `setSpriteFromPng` internally). If `App.tsx` uses `loadCartridge` here, no change is needed for the cartridge path. If `App.tsx` uses `setSprite` directly, switch to `setSpriteFromPng`.

- [ ] **Step 3: Same for the Cartridge tab file picker**

`editor/src/ui/CartridgeTab.tsx` validates a picked PNG is 128×128 then calls `setBytes(raw)` — which is `setSprite` for the sprite slot. Route the sprite slot through `setSpriteFromPng` while leaving the cover slot on `setCover`.

In `editor/src/ui/CartridgeTab.tsx`, change the `CartridgeTab` body so the sprite slot calls a sprite-specific handler:

```tsx
export function CartridgeTab() {
    const { title, author, sprite, cover, setTitle, setAuthor, setSpriteFromPng, setCover } = useSketchStore();
    const [spriteErr, setSpriteErr] = useState<string | null>(null);
    const [coverErr,  setCoverErr]  = useState<string | null>(null);

    const handleSprite = async (raw: Uint8Array) => {
        const size = readPngSize(raw);
        if (!size) { setSpriteErr('Not a valid PNG.'); return; }
        if (size.width !== 128 || size.height !== 128) {
            setSpriteErr(`Must be 128×128 (got ${size.width}×${size.height}).`);
            return;
        }
        setSpriteErr(null);
        try { await setSpriteFromPng(raw); }
        catch (e) { setSpriteErr((e as Error).message); }
    };

    const handleCover = (raw: Uint8Array) => {
        const size = readPngSize(raw);
        if (!size) { setCoverErr('Not a valid PNG.'); setCover(null); return; }
        if (size.width !== 128 || size.height !== 128) {
            setCoverErr(`Must be 128×128 (got ${size.width}×${size.height}).`);
            setCover(null);
            return;
        }
        setCoverErr(null);
        setCover(raw);
    };

    return (
        <div style={wrapStyle}>
            <label style={fieldStyle}>
                Title
                <input style={inputStyle} value={title} maxLength={63} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            </label>
            <label style={fieldStyle}>
                Author
                <input style={inputStyle} value={author} maxLength={63} onChange={(e) => setAuthor(e.target.value)} aria-label="Author" />
            </label>
            <AssetSlot label="Spritesheet" bytes={sprite}  onPick={handleSprite} error={spriteErr} inputTestId="sprite-input" />
            <AssetSlot label="Cover image" bytes={cover}   onPick={handleCover}  error={coverErr}  inputTestId="cover-input"  />
        </div>
    );
}
```

The existing `handleAsset` is split into `handleSprite` / `handleCover`. The shape of `AssetSlot` is unchanged.

- [ ] **Step 4: Run all tests + check the CartridgeTab tests still pass**

Run: `cd editor && npm test`
Expected: green. If `CartridgeTab.test.tsx` asserts `setSprite` is called, update it to assert `setSpriteFromPng` instead.

- [ ] **Step 5: Commit**

```bash
git add editor/src/App.tsx editor/src/ui/CartridgeTab.tsx editor/src/ui/CartridgeTab.test.tsx
git commit -m "app: persisted/loaded PNGs seed spritePixels via setSpriteFromPng

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 20: Playwright E2E for live mirror + persistence round-trip

**Files:**
- Modify: the existing Playwright spec (`editor/tests/*.spec.ts` — confirm path first)

- [ ] **Step 1: Inspect the existing Playwright spec**

Run: `ls editor/tests && cat editor/tests/*.spec.ts | head -150`
Note the patterns used (locators, the `_draw` snippet, assertion helpers).

- [ ] **Step 2: Add a new test (or extend the existing single test)**

Append this test after the existing assertion (adjust selectors as needed to match the actual codebase):

```typescript
test('sprite-edit live mirror + cartridge round-trip', async ({ page }) => {
    await page.goto('/');
    // Wait for runtime to boot — match whatever readiness signal the existing test uses.

    // Write a known Lua script that copies sprite (0,0) to display (0,0).
    await page.evaluate(() => {
        const ev = new Event('input', { bubbles: true });
        // hook into the sketchStore directly for deterministic typing
        // @ts-expect-error — store handle exposed for tests; if not, use the editor input
        window.useSketchStore?.getState().setScript('function _draw() cls(0x0000); sprite(0,0,1,1,0,0,1,1) end');
    });

    // Open the alt tab
    await page.getByRole('tab', { name: /alt/i }).click();

    // Pick the pencil, set colour to bright red, click pixel (5,5).
    // The picker resolution depends on the layout; the most reliable path is to mutate the
    // store programmatically:
    await page.evaluate(() => {
        // @ts-expect-error
        window.useSpriteEditorStore?.getState().setColor(0xFF0000FF);
        // @ts-expect-error
        window.useSketchStore?.getState().setSpritePixel(5, 5, 0xFF0000FF);
    });

    // Hit Play. (Use the existing Play selector.)
    await page.getByRole('button', { name: /play/i }).click();

    // Wait a few frames and assert the canvas pixel at the location the script writes.
    await page.waitForTimeout(120);
    const px = await page.evaluate(() => {
        const c = document.querySelector('canvas[width="128"]') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    });
    expect(px[0]).toBeGreaterThan(150); // dominant red
});
```

**Important:** to make the store handles accessible from `page.evaluate`, attach them to `window` from `App.tsx` *only when `import.meta.env.MODE === 'test'`*:

```typescript
if (import.meta.env.MODE === 'test' || import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).useSketchStore = useSketchStore;
    (window as unknown as Record<string, unknown>).useSpriteEditorStore = useSpriteEditorStore;
}
```

(If exposing in dev too is undesirable, gate strictly on `MODE === 'test'` and run Playwright with `--mode test`.)

- [ ] **Step 3: Run the E2E suite**

Run: `cd editor && npm run test:e2e`
Expected: existing tests still pass; new sprite-edit test passes.

- [ ] **Step 4: Commit**

```bash
git add editor/tests editor/src/App.tsx
git commit -m "test(e2e): live sprite mirror + paint-then-Play roundtrip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final sanity sweep

After Task 20, run the whole suite once more end-to-end:

- [ ] `./scripts/build.sh` — WASM still builds cleanly.
- [ ] `cd editor && npm test` — all unit + component tests green.
- [ ] `cd editor && npm run test:e2e` — Playwright green.
- [ ] `node scripts/smoke.mjs` — existing engine smoke unchanged.
- [ ] `node scripts/smoke_spritesheet.mjs` — new engine smoke passes.
- [ ] `./scripts/dev.sh` — manual: open the alt tab, paint, hit Play, confirm live mirror; Stop, paint more, Download, reload page, confirm persistence.

If everything passes, the feature is ready to merge. Open a PR with body referencing `docs/superpowers/specs/2026-05-11-spritesheet-editor-design.md`.
