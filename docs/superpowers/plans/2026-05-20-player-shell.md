# Player Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a URL-routed mobile-friendly player view that wraps the 128×128 engine canvas in a swappable painted-on "Gameboy" shell with six touch-driven button hitboxes (A, B, D-pad), reachable via `?play=current` (in-editor sketch) and `?play` (gallery picker).

**Architecture:** New `editor/src/player/` directory hosts a pure routing function, a shared layout config (image URL + per-button % coordinates), a small pointer-event hook, and three components: `PlayerShell` (image + canvas + hitboxes), `PlayerGallery` (mobile cartridge picker), `PlayerRoute` (state machine that wires runtime + frame loop). The shared cartridge-build helper is extracted out of `App.tsx` into `editor/src/engine/buildCartridge.ts` so the player can reuse it without depending on the editor's React tree. `App.tsx` becomes a one-line router that delegates to either the new `PlayerRoute` or the existing editor body (extracted into `Editor.tsx`).

**Tech Stack:** TypeScript, React, Vitest + Testing Library, Playwright, Vite, the existing TinyBit wasm runtime + frame loop.

**Reference spec:** `docs/superpowers/specs/2026-05-20-player-shell-design.md`

---

## File Structure

**New files:**
- `editor/src/player/routing.ts` — pure `pickRoute(search)` and types.
- `editor/src/player/routing.test.ts` — table-driven unit tests.
- `editor/src/player/shellLayout.ts` — image URL, intrinsic aspect, screen rect, button → idx + rect map.
- `editor/src/player/shellLayout.test.ts` — verifies all six buttons configured, rects in 0–100 range.
- `editor/src/player/usePointerButton.ts` — hook that returns pointer handlers for one button.
- `editor/src/player/usePointerButton.test.ts` — synthetic pointer-event driver.
- `editor/src/player/PlayerShell.tsx` — image + absolutely-positioned canvas + 6 hitboxes + exit chip.
- `editor/src/player/PlayerShell.test.tsx` — component-level tests for layout + button wiring.
- `editor/src/player/PlayerGallery.tsx` — full-bleed grid of cover images for the standalone route.
- `editor/src/player/PlayerGallery.test.tsx` — renders gallery entries, fires pick callback.
- `editor/src/player/PlayerRoute.tsx` — state machine that boots runtime, loads sketch or gallery, runs the frame loop.
- `editor/src/player/PlayerRoute.test.tsx` — drives the state machine with mocked runtime/gallery.
- `editor/src/engine/buildCartridge.ts` — encoder wrapper that resolves placeholders and returns a tagged result.
- `editor/src/engine/buildCartridge.test.ts` — wraps a fake encoder; happy path + error path.
- `editor/src/Editor.tsx` — the existing App body, renamed; default export of `Editor`.
- `editor/public/player-shell.svg` — placeholder painted-on device illustration (the spec's `editor/public/player-shell.png` placeholder; SVG is identical purpose-wise and easier to commit to git; swap to PNG later by replacing the file and updating `shellLayout.imageUrl`).
- `editor/tests/e2e/player.spec.ts` — Playwright e2e for both routes.

**Modified files:**
- `editor/src/App.tsx` — replace its body with a router shim that picks `<Editor/>` or `<PlayerRoute/>`.
- `editor/src/App.test.tsx` — keep the existing test for the editor branch (renders without crashing) and add a player-branch test.
- `editor/src/ui/Toolbar.tsx` — add `onOpenPlayer` prop and a new 📱 Player button between Clear and Gallery.
- `editor/src/ui/Toolbar.test.tsx` — add tests for the new button.
- `editor/index.html` — change viewport meta to include `viewport-fit=cover`.

**Deliberate non-changes:**
- `editor/src/engine/frameLoop.ts` — unchanged. The player uses the same `makeFrameLoop` as the editor.
- `editor/src/state/gallery.ts` — unchanged. The player reuses `loadGallery()` with its existing module-level cache.
- `editor/src/state/persist.ts` — unchanged. Player reads via `loadSketch()`, editor writes via `saveSketch()`.
- The C engine, the Rust crate, the encoder, the decoder — no edits. All needed FFI exports already exist.

---

## Task 1: Routing module

**Files:**
- Create: `editor/src/player/routing.ts`
- Test:   `editor/src/player/routing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `editor/src/player/routing.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { pickRoute } from './routing';

describe('pickRoute', () => {
    test('empty search → editor', () => {
        expect(pickRoute('')).toEqual({ kind: 'editor' });
    });

    test('search without play → editor', () => {
        expect(pickRoute('?foo=bar')).toEqual({ kind: 'editor' });
    });

    test('?play (no value) → player gallery', () => {
        expect(pickRoute('?play')).toEqual({ kind: 'player', mode: 'gallery' });
    });

    test('?play=gallery → player gallery', () => {
        expect(pickRoute('?play=gallery')).toEqual({ kind: 'player', mode: 'gallery' });
    });

    test('?play=current → player current', () => {
        expect(pickRoute('?play=current')).toEqual({ kind: 'player', mode: 'current' });
    });

    test('unknown play value falls back to gallery', () => {
        expect(pickRoute('?play=garbage')).toEqual({ kind: 'player', mode: 'gallery' });
    });

    test('extra params ignored', () => {
        expect(pickRoute('?play=current&debug=1')).toEqual({ kind: 'player', mode: 'current' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/player/routing.test.ts`
Expected: FAIL — "Failed to resolve import './routing'".

- [ ] **Step 3: Implement `routing.ts`**

Create `editor/src/player/routing.ts`:

```ts
export type PlayerMode = 'current' | 'gallery';

export type Route =
    | { kind: 'editor' }
    | { kind: 'player'; mode: PlayerMode };

export function pickRoute(search: string): Route {
    const params = new URLSearchParams(search);
    if (!params.has('play')) return { kind: 'editor' };
    const v = params.get('play');
    if (v === 'current') return { kind: 'player', mode: 'current' };
    return { kind: 'player', mode: 'gallery' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npx vitest run src/player/routing.test.ts`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/player/routing.ts editor/src/player/routing.test.ts
git commit -m "player: pure URL routing function"
```

---

## Task 2: Extract `buildCartridge` helper

**Files:**
- Create: `editor/src/engine/buildCartridge.ts`
- Test:   `editor/src/engine/buildCartridge.test.ts`
- Modify: `editor/src/App.tsx` (lines around the inline `buildCartridge` useCallback)

- [ ] **Step 1: Write the failing tests**

Create `editor/src/engine/buildCartridge.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { buildCartridge, type SketchInput } from './buildCartridge';
import { EncodeError, type Encoder } from './encoder';

function makeOkEncoder(): Encoder {
    return {
        encode: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
    };
}

function makeErrEncoder(err: unknown): Encoder {
    return {
        encode: vi.fn(() => { throw err; }),
    };
}

const baseSketch: SketchInput = {
    script: 'function _draw() end',
    sprite: new Uint8Array(10),
    cover:  new Uint8Array(10),
    title:  'demo',
    author: 'me',
};

describe('buildCartridge', () => {
    test('returns ok with bytes when encoder succeeds', async () => {
        const enc = makeOkEncoder();
        const result = await buildCartridge(enc, baseSketch);
        expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4]) });
    });

    test('passes title/author through to encoder', async () => {
        const enc = makeOkEncoder();
        await buildCartridge(enc, baseSketch);
        const call = (enc.encode as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.title).toBe('demo');
        expect(call.author).toBe('me');
    });

    test('substitutes "untitled" for empty title', async () => {
        const enc = makeOkEncoder();
        await buildCartridge(enc, { ...baseSketch, title: '' });
        const call = (enc.encode as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.title).toBe('untitled');
    });

    test('uses placeholder cover/sprite when null', async () => {
        const enc = makeOkEncoder();
        await buildCartridge(enc, { ...baseSketch, cover: null, sprite: null });
        const call = (enc.encode as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.cover).toBeInstanceOf(Uint8Array);
        expect(call.cover.length).toBeGreaterThan(0);
        expect(call.sprite).toBeInstanceOf(Uint8Array);
        expect(call.sprite.length).toBeGreaterThan(0);
    });

    test('returns formatted error for EncodeError', async () => {
        const enc = makeErrEncoder(new EncodeError(7, 'bad input'));
        const result = await buildCartridge(enc, baseSketch);
        expect(result).toEqual({ ok: false, error: 'Encode failed (7): bad input' });
    });

    test('returns generic error for non-EncodeError', async () => {
        const enc = makeErrEncoder(new Error('nope'));
        const result = await buildCartridge(enc, baseSketch);
        expect(result).toEqual({ ok: false, error: 'nope' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/engine/buildCartridge.test.ts`
Expected: FAIL — "Failed to resolve import './buildCartridge'".

- [ ] **Step 3: Implement `buildCartridge.ts`**

Create `editor/src/engine/buildCartridge.ts`:

```ts
import { EncodeError, type Encoder } from './encoder';
import { getPlaceholderCover, getPlaceholderSprite } from './placeholders';

export interface SketchInput {
    script: string;
    sprite: Uint8Array | null;
    cover:  Uint8Array | null;
    title:  string;
    author: string;
}

export type BuildResult =
    | { ok: true;  bytes: Uint8Array }
    | { ok: false; error: string };

export async function buildCartridge(enc: Encoder, s: SketchInput): Promise<BuildResult> {
    const sprite = s.sprite ?? await getPlaceholderSprite();
    const cover  = s.cover  ?? await getPlaceholderCover();
    try {
        const bytes = enc.encode({
            script: new TextEncoder().encode(s.script),
            sprite,
            cover,
            title:  s.title  || 'untitled',
            author: s.author || '',
        });
        return { ok: true, bytes };
    } catch (err) {
        if (err instanceof EncodeError) {
            return { ok: false, error: `Encode failed (${err.code}): ${err.message}` };
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npx vitest run src/engine/buildCartridge.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Refactor App.tsx to use the helper**

In `editor/src/App.tsx`, replace the existing `buildCartridge` `useCallback` block. Find this block:

```tsx
const buildCartridge = useCallback(async (): Promise<Uint8Array | null> => {
    if (!runtime || !runtime.encoderAvailable) {
        consoleAppend('error', 'Encoder not available in this WASM build.');
        return null;
    }
    const sprite = sketch.sprite ?? await getPlaceholderSprite();
    const cover  = sketch.cover  ?? await getPlaceholderCover();
    try {
        return runtime.enc.encode({
            script: new TextEncoder().encode(sketch.script),
            sprite,
            cover,
            title:  sketch.title  || 'untitled',
            author: sketch.author || '',
        });
    } catch (err) {
        if (err instanceof EncodeError) consoleAppend('error', `Encode failed (${err.code}): ${err.message}`);
        else consoleAppend('error', String(err));
        return null;
    }
}, [runtime, sketch.script, sketch.sprite, sketch.cover, sketch.title, sketch.author, consoleAppend]);
```

Replace with:

```tsx
const buildCart = useCallback(async (): Promise<Uint8Array | null> => {
    if (!runtime || !runtime.encoderAvailable) {
        consoleAppend('error', 'Encoder not available in this WASM build.');
        return null;
    }
    const result = await buildCartridge(runtime.enc, {
        script: sketch.script,
        sprite: sketch.sprite,
        cover:  sketch.cover,
        title:  sketch.title,
        author: sketch.author,
    });
    if (result.ok) return result.bytes;
    consoleAppend('error', result.error);
    return null;
}, [runtime, sketch.script, sketch.sprite, sketch.cover, sketch.title, sketch.author, consoleAppend]);
```

Rename later references: in `handlePlay` change `await buildCartridge()` → `await buildCart()`. In `handleDownload`, same: `await buildCartridge()` → `await buildCart()`.

Update the imports at the top of App.tsx — remove the now-unused imports if they exist:
- Remove `import { EncodeError } from './engine/encoder';` (no longer referenced in App.tsx after the refactor).
- Remove `import { getPlaceholderCover, getPlaceholderSprite } from './engine/placeholders';` (no longer referenced in App.tsx).
- Add `import { buildCartridge } from './engine/buildCartridge';`.

(If your linter flags either as still-used because of another reference, leave that one in. Run the type check.)

- [ ] **Step 6: Run full editor test suite to verify nothing broke**

Run: `cd editor && npm test -- --run`
Expected: PASS — same number of tests as before (291 baseline).

- [ ] **Step 7: Type-check**

Run: `cd editor && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add editor/src/engine/buildCartridge.ts editor/src/engine/buildCartridge.test.ts editor/src/App.tsx
git commit -m "engine: extract buildCartridge helper out of App.tsx"
```

---

## Task 3: Shell layout config + placeholder asset

**Files:**
- Create: `editor/public/player-shell.svg`
- Create: `editor/src/player/shellLayout.ts`
- Test:   `editor/src/player/shellLayout.test.ts`

- [ ] **Step 1: Write the placeholder SVG asset**

Create `editor/public/player-shell.svg`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 480" preserveAspectRatio="xMidYMid meet">
  <defs>
    <linearGradient id="case" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#cdd0d7"/>
      <stop offset="100%" stop-color="#a4a8b1"/>
    </linearGradient>
    <radialGradient id="ab" cx="0.3" cy="0.3" r="0.8">
      <stop offset="0%" stop-color="#e0466c"/>
      <stop offset="100%" stop-color="#8a1c3b"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="280" height="480" rx="22" fill="url(#case)"/>
  <rect x="4" y="4" width="272" height="472" rx="20" fill="none" stroke="#8c8f97" stroke-width="2"/>
  <rect x="20" y="20" width="240" height="240" rx="8" fill="#2a2d34"/>
  <rect x="28" y="24" width="224" height="224" fill="#0f380f"/>
  <text x="140" y="278" text-anchor="middle" fill="#5a5d64" font-family="ui-monospace, monospace" font-size="11" font-weight="bold" letter-spacing="2">TINYBIT</text>
  <rect x="56" y="332" width="28" height="76" rx="4" fill="#2a2d34"/>
  <rect x="32" y="358" width="76" height="28" rx="4" fill="#2a2d34"/>
  <circle cx="70" cy="372" r="6" fill="#1f2227"/>
  <circle cx="244" cy="356" r="22" fill="url(#ab)" stroke="#5a142a" stroke-width="2"/>
  <text x="244" y="362" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="16" font-weight="bold">A</text>
  <circle cx="200" cy="386" r="22" fill="url(#ab)" stroke="#5a142a" stroke-width="2"/>
  <text x="200" y="392" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="16" font-weight="bold">B</text>
</svg>
```

- [ ] **Step 2: Write the failing test**

Create `editor/src/player/shellLayout.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { shellLayout, PLAYER_BUTTONS } from './shellLayout';

describe('shellLayout', () => {
    test('has an imageUrl and positive intrinsic aspect', () => {
        expect(typeof shellLayout.imageUrl).toBe('string');
        expect(shellLayout.imageUrl.length).toBeGreaterThan(0);
        expect(shellLayout.imageAspect).toBeGreaterThan(0);
    });

    test('screen rect is within 0..100', () => {
        const r = shellLayout.screen;
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.left + r.width).toBeLessThanOrEqual(100);
        expect(r.top + r.height).toBeLessThanOrEqual(100);
    });

    test('all six buttons configured with in-bounds rects', () => {
        for (const name of PLAYER_BUTTONS) {
            const rect = shellLayout.buttons[name];
            expect(rect, `button ${name}`).toBeDefined();
            expect(rect.left).toBeGreaterThanOrEqual(0);
            expect(rect.top).toBeGreaterThanOrEqual(0);
            expect(rect.left + rect.width).toBeLessThanOrEqual(100);
            expect(rect.top + rect.height).toBeLessThanOrEqual(100);
        }
    });

    test('PLAYER_BUTTONS lists exactly the six expected names', () => {
        expect(PLAYER_BUTTONS).toEqual(['up', 'down', 'left', 'right', 'a', 'b']);
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd editor && npx vitest run src/player/shellLayout.test.ts`
Expected: FAIL — "Failed to resolve import './shellLayout'".

- [ ] **Step 4: Implement `shellLayout.ts`**

Create `editor/src/player/shellLayout.ts`:

```ts
export const PLAYER_BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b'] as const;
export type PlayerButton = typeof PLAYER_BUTTONS[number];

// Engine button indices (mirrors BUTTONS map in editor/src/engine/tinybit.ts).
// Idx 6 (Start/Enter) and 7 (Select/Backspace) are deliberately not surfaced.
export const PLAYER_BUTTON_IDX: Record<PlayerButton, number> = {
    a:     0,
    b:     1,
    up:    2,
    down:  3,
    left:  4,
    right: 5,
};

export interface Rect {
    left:   number; // %, 0..100, relative to rendered image
    top:    number; // %
    width:  number; // %
    height: number; // %
}

export interface ShellLayout {
    imageUrl:    string;
    imageAspect: number;            // intrinsic width / intrinsic height
    screen:      Rect;
    buttons:     Record<PlayerButton, Rect>;
}

// Coordinates correspond to editor/public/player-shell.svg (viewBox 280×480).
// To swap the shell image: replace the file (or change imageUrl) and adjust
// these rects to match the new artwork.
export const shellLayout: ShellLayout = {
    imageUrl:    '/player-shell.svg',
    imageAspect: 280 / 480,
    screen:      { left: 10,    top: 5,    width: 80,    height: 46.7 },
    buttons: {
        up:    { left: 20,    top: 69.2, width: 10,    height: 7.9 },
        down:  { left: 20,    top: 77.1, width: 10,    height: 7.9 },
        left:  { left: 11.4,  top: 74.6, width: 13.6,  height: 5.8 },
        right: { left: 25,    top: 74.6, width: 13.6,  height: 5.8 },
        a:     { left: 79.3,  top: 69.6, width: 15.7,  height: 9.2 },
        b:     { left: 63.6,  top: 75.8, width: 15.7,  height: 9.2 },
    },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd editor && npx vitest run src/player/shellLayout.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add editor/public/player-shell.svg editor/src/player/shellLayout.ts editor/src/player/shellLayout.test.ts
git commit -m "player: placeholder device shell SVG + layout config"
```

---

## Task 4: `usePointerButton` hook

**Files:**
- Create: `editor/src/player/usePointerButton.ts`
- Test:   `editor/src/player/usePointerButton.test.ts`

- [ ] **Step 1: Write the failing test**

Create `editor/src/player/usePointerButton.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { usePointerButton } from './usePointerButton';

function Harness({ onChange }: { onChange: (pressed: boolean) => void }) {
    const handlers = usePointerButton(onChange);
    return <div data-testid="hitbox" {...handlers} style={{ width: 50, height: 50 }} />;
}

describe('usePointerButton', () => {
    test('pointerdown sets pressed true, pointerup false', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox');
        fireEvent.pointerDown(hb, { pointerId: 1 });
        fireEvent.pointerUp(hb, { pointerId: 1 });
        expect(onChange).toHaveBeenNthCalledWith(1, true);
        expect(onChange).toHaveBeenNthCalledWith(2, false);
    });

    test('pointercancel releases the button', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox');
        fireEvent.pointerDown(hb, { pointerId: 1 });
        fireEvent.pointerCancel(hb, { pointerId: 1 });
        expect(onChange).toHaveBeenLastCalledWith(false);
    });

    test('lostpointercapture releases the button', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox');
        fireEvent.pointerDown(hb, { pointerId: 1 });
        fireEvent.lostPointerCapture(hb, { pointerId: 1 });
        expect(onChange).toHaveBeenLastCalledWith(false);
    });

    test('touchAction style is "none"', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox') as HTMLElement;
        expect(hb.style.touchAction).toBe('none');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd editor && npx vitest run src/player/usePointerButton.test.ts`
Expected: FAIL — "Failed to resolve import './usePointerButton'".

- [ ] **Step 3: Implement the hook**

Create `editor/src/player/usePointerButton.ts`:

```ts
import { useCallback, type HTMLAttributes, type PointerEvent } from 'react';

export interface PointerButtonHandlers extends HTMLAttributes<HTMLElement> {
    onPointerDown(e: PointerEvent<HTMLElement>): void;
    onPointerUp(e:   PointerEvent<HTMLElement>): void;
    onPointerCancel(e: PointerEvent<HTMLElement>): void;
    onLostPointerCapture(e: PointerEvent<HTMLElement>): void;
}

export function usePointerButton(setPressed: (pressed: boolean) => void): PointerButtonHandlers {
    const down = useCallback((e: PointerEvent<HTMLElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setPressed(true);
    }, [setPressed]);

    const release = useCallback(() => {
        setPressed(false);
    }, [setPressed]);

    return {
        onPointerDown:        down,
        onPointerUp:          release,
        onPointerCancel:      release,
        onLostPointerCapture: release,
        style: { touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' },
    };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd editor && npx vitest run src/player/usePointerButton.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/player/usePointerButton.ts editor/src/player/usePointerButton.test.ts
git commit -m "player: pointer-event hook with capture and cancel handling"
```

---

## Task 5: `PlayerShell` component

**Files:**
- Create: `editor/src/player/PlayerShell.tsx`
- Test:   `editor/src/player/PlayerShell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `editor/src/player/PlayerShell.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { PlayerShell } from './PlayerShell';
import { PLAYER_BUTTONS } from './shellLayout';

describe('PlayerShell', () => {
    test('renders the shell image, a canvas, six button hitboxes, and an exit chip', () => {
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} onSetButton={() => {}} onExit={() => {}} />);

        expect(screen.getByAltText(/player shell/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/tinybit display/i)).toBeInstanceOf(HTMLCanvasElement);
        for (const name of PLAYER_BUTTONS) {
            expect(screen.getByLabelText(name, { exact: false })).toBeInTheDocument();
        }
        expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument();
    });

    test('clicking exit fires onExit', async () => {
        const onExit = vi.fn();
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} onSetButton={() => {}} onExit={onExit} />);
        await userEvent.click(screen.getByRole('button', { name: /exit/i }));
        expect(onExit).toHaveBeenCalledOnce();
    });

    test('pressing the A hitbox calls onSetButton with idx 0 (a) true then false', () => {
        const onSet = vi.fn();
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} onSetButton={onSet} onExit={() => {}} />);
        const a = screen.getByLabelText(/^a button$/i);
        fireEvent.pointerDown(a, { pointerId: 1 });
        fireEvent.pointerUp(a, { pointerId: 1 });
        expect(onSet).toHaveBeenNthCalledWith(1, 0, true);
        expect(onSet).toHaveBeenNthCalledWith(2, 0, false);
    });

    test('pressing the Up hitbox calls onSetButton with idx 2 (up)', () => {
        const onSet = vi.fn();
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} onSetButton={onSet} onExit={() => {}} />);
        const up = screen.getByLabelText(/^up button$/i);
        fireEvent.pointerDown(up, { pointerId: 1 });
        expect(onSet).toHaveBeenCalledWith(2, true);
    });

    test('canvas is 128x128 with pixelated rendering', () => {
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} onSetButton={() => {}} onExit={() => {}} />);
        const canvas = screen.getByLabelText(/tinybit display/i) as HTMLCanvasElement;
        expect(canvas.width).toBe(128);
        expect(canvas.height).toBe(128);
        expect(canvas.style.imageRendering).toBe('pixelated');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd editor && npx vitest run src/player/PlayerShell.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlayerShell`**

Create `editor/src/player/PlayerShell.tsx`:

```tsx
import { useState, type CSSProperties, type RefObject } from 'react';
import { shellLayout, PLAYER_BUTTONS, PLAYER_BUTTON_IDX, type PlayerButton } from './shellLayout';
import { usePointerButton } from './usePointerButton';

export interface PlayerShellProps {
    canvasRef:   RefObject<HTMLCanvasElement | null>;
    onSetButton(idx: number, pressed: boolean): void;
    onExit():    void;
}

const wrapStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100dvh',
    overflow: 'hidden',
    background: '#181820',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const innerStyle = (aspect: number): CSSProperties => ({
    position: 'relative',
    height: '100dvh',
    aspectRatio: `${aspect}`,
    maxWidth: '100vw',
    maxHeight: '100dvh',
});

const imageStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    display: 'block',
};

const exitStyle: CSSProperties = {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 999,
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    border: 'none',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    zIndex: 2,
};

function rectStyle(r: { left: number; top: number; width: number; height: number }): CSSProperties {
    return {
        position: 'absolute',
        left:   `${r.left}%`,
        top:    `${r.top}%`,
        width:  `${r.width}%`,
        height: `${r.height}%`,
    };
}

function Hitbox({ name, onSetButton }: { name: PlayerButton; onSetButton(idx: number, pressed: boolean): void }) {
    const [pressed, setPressed] = useState(false);
    const handlers = usePointerButton((p) => {
        setPressed(p);
        onSetButton(PLAYER_BUTTON_IDX[name], p);
    });
    return (
        <button
            type="button"
            aria-label={`${name} button`}
            {...handlers}
            style={{
                ...rectStyle(shellLayout.buttons[name]),
                background: pressed ? 'rgba(0,0,0,0.30)' : 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                ...(handlers.style ?? {}),
            }}
        />
    );
}

export function PlayerShell({ canvasRef, onSetButton, onExit }: PlayerShellProps) {
    return (
        <div style={wrapStyle} data-route="player">
            <div style={innerStyle(shellLayout.imageAspect)}>
                <img
                    src={shellLayout.imageUrl}
                    alt="Player shell"
                    style={imageStyle}
                    draggable={false}
                />
                <canvas
                    ref={canvasRef}
                    width={128}
                    height={128}
                    aria-label="TinyBit display"
                    style={{
                        ...rectStyle(shellLayout.screen),
                        background: '#000',
                        imageRendering: 'pixelated',
                    }}
                />
                {PLAYER_BUTTONS.map((name) => (
                    <Hitbox key={name} name={name} onSetButton={onSetButton} />
                ))}
                <button
                    type="button"
                    aria-label="Exit player"
                    onClick={onExit}
                    style={exitStyle}
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd editor && npx vitest run src/player/PlayerShell.test.tsx`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/player/PlayerShell.tsx editor/src/player/PlayerShell.test.tsx
git commit -m "player: device shell component with hitboxes and exit chip"
```

---

## Task 6: `PlayerGallery` component

**Files:**
- Create: `editor/src/player/PlayerGallery.tsx`
- Test:   `editor/src/player/PlayerGallery.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `editor/src/player/PlayerGallery.test.tsx`:

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerGallery } from './PlayerGallery';
import type { GalleryEntry } from '../state/gallery';

function entry(id: string, title: string): GalleryEntry {
    return {
        id, filename: `${id}.tb.png`, title, author: 'me',
        coverUrl: `data:,${id}`, cartridge: new Uint8Array(0),
    };
}

describe('PlayerGallery', () => {
    test('renders a card per entry; pick fires callback', async () => {
        const onPick = vi.fn();
        const onBack = vi.fn();
        render(
            <PlayerGallery
                state={{ kind: 'ready', entries: [entry('a', 'Alpha'), entry('b', 'Beta')], failures: [] }}
                onPick={onPick}
                onBack={onBack}
            />,
        );
        expect(screen.getByText(/Alpha/)).toBeInTheDocument();
        expect(screen.getByText(/Beta/)).toBeInTheDocument();
        await userEvent.click(screen.getByText(/Alpha/));
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    });

    test('shows loading state', () => {
        render(<PlayerGallery state={{ kind: 'loading' }} onPick={() => {}} onBack={() => {}} />);
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    test('shows error state', () => {
        render(<PlayerGallery state={{ kind: 'error', message: 'boom' }} onPick={() => {}} onBack={() => {}} />);
        expect(screen.getByText(/boom/i)).toBeInTheDocument();
    });

    test('shows empty hint when ready with zero entries', () => {
        render(<PlayerGallery state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onBack={() => {}} />);
        expect(screen.getByText(/no cartridges/i)).toBeInTheDocument();
    });

    test('back chip fires onBack', async () => {
        const onBack = vi.fn();
        render(<PlayerGallery state={{ kind: 'loading' }} onPick={() => {}} onBack={onBack} />);
        await userEvent.click(screen.getByRole('button', { name: /back/i }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd editor && npx vitest run src/player/PlayerGallery.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlayerGallery`**

Create `editor/src/player/PlayerGallery.tsx`:

```tsx
import type { CSSProperties } from 'react';
import type { GalleryEntry, GalleryFailure } from '../state/gallery';

export type PlayerGalleryState =
    | { kind: 'loading' }
    | { kind: 'ready'; entries: GalleryEntry[]; failures: GalleryFailure[] }
    | { kind: 'error'; message: string };

export interface PlayerGalleryProps {
    state: PlayerGalleryState;
    onPick(entry: GalleryEntry): void;
    onBack(): void;
}

const wrapStyle: CSSProperties = {
    width: '100vw',
    minHeight: '100dvh',
    background: '#181820',
    color: '#fff',
    padding: '16px 16px 32px',
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
};

const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
};

const backStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
};

const titleStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
};

const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 14,
};

const cardStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    background: '#23232c',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'center',
};

const coverStyle: CSSProperties = {
    width: '100%',
    aspectRatio: '1 / 1',
    objectFit: 'contain',
    imageRendering: 'pixelated',
    background: '#000',
    borderRadius: 6,
};

const subtitleStyle: CSSProperties = { color: '#a4a4ad', fontSize: 12 };

const msgStyle: CSSProperties = { textAlign: 'center', padding: '40px 0', color: '#a4a4ad' };

export function PlayerGallery({ state, onPick, onBack }: PlayerGalleryProps) {
    return (
        <div style={wrapStyle} data-route="player-gallery">
            <div style={headerStyle}>
                <button type="button" style={backStyle} onClick={onBack} aria-label="Back">‹ Back</button>
                <h1 style={titleStyle}>Pick a cartridge</h1>
            </div>
            {state.kind === 'loading' && <div style={msgStyle}>Loading…</div>}
            {state.kind === 'error'   && <div style={msgStyle}>{state.message}</div>}
            {state.kind === 'ready' && state.entries.length === 0 && state.failures.length === 0 && (
                <div style={msgStyle}>No cartridges available.</div>
            )}
            {state.kind === 'ready' && (state.entries.length > 0 || state.failures.length > 0) && (
                <div style={gridStyle}>
                    {state.entries.map((e) => (
                        <button key={e.id} type="button" style={cardStyle} onClick={() => onPick(e)}>
                            <img src={e.coverUrl} alt="" style={coverStyle} />
                            <div style={{ fontWeight: 600 }}>{e.title || e.filename}</div>
                            <div style={subtitleStyle}>{e.author}</div>
                        </button>
                    ))}
                    {state.failures.map((f) => (
                        <div key={f.id} style={{ ...cardStyle, opacity: 0.5, cursor: 'default' }}>
                            <div style={{ ...coverStyle, display: 'grid', placeItems: 'center', fontSize: 24 }}>⚠</div>
                            <div style={{ fontWeight: 600 }}>{f.filename}</div>
                            <div style={subtitleStyle}>{f.message}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd editor && npx vitest run src/player/PlayerGallery.test.tsx`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/player/PlayerGallery.tsx editor/src/player/PlayerGallery.test.tsx
git commit -m "player: mobile cartridge gallery picker"
```

---

## Task 7: `PlayerRoute` state machine

**Files:**
- Create: `editor/src/player/PlayerRoute.tsx`
- Test:   `editor/src/player/PlayerRoute.test.tsx`

This component owns the runtime and frame loop. The test mocks the runtime and gallery loader so we can drive transitions without booting wasm.

- [ ] **Step 1: Write the failing test**

Create `editor/src/player/PlayerRoute.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerRoute } from './PlayerRoute';
import type { Runtime } from '../engine/runtime';
import type { Tinybit } from '../engine/tinybit';
import type { Encoder } from '../engine/encoder';
import type { Decoder } from '../engine/decoder';
import type { FrameLoop } from '../engine/frameLoop';

const tb: Tinybit = {
    init: vi.fn(), feedCartridge: vi.fn(), start: vi.fn(), stop: vi.fn(),
    loopOnce: vi.fn(), setButton: vi.fn(),
    displayView: () => new Uint16Array(128 * 128),
    audioView:   () => new Int16Array(367),
    takeLuaError: () => null,
};

const enc: Encoder = { encode: vi.fn(() => new Uint8Array([1, 2, 3])) };

const dec: Decoder = {
    decode: vi.fn(() => ({
        title: 'Picked', author: 'M', script: '-- pick', sprite: new Uint8Array(0), cover: new Uint8Array(0),
        formatVersion: 1, gameVersion: 1, flags: 0, packageDate: 0, crcOk: true,
    })),
};

const fakeRuntime: Runtime = {
    wasm: {} as WebAssembly.Instance, memory: {} as WebAssembly.Memory,
    tb, enc, encoderAvailable: true, dec, decoderAvailable: true,
    spritesheet: { fullReload: vi.fn(), setRunningPredicate: vi.fn() } as never,
    preview: { music: vi.fn(), sfx: vi.fn(), stop: vi.fn() } as never,
    previewAvailable: false,
};

const fakeFrameLoop: FrameLoop = {
    start: vi.fn(() => Promise.resolve()),
    stop:  vi.fn(),
    state: () => 'idle',
    onStateChange: () => () => {},
    onError:       () => () => {},
    onLuaError:    () => () => {},
};

vi.mock('../engine/runtime', () => ({
    getRuntime: vi.fn(() => Promise.resolve(fakeRuntime)),
}));

vi.mock('../engine/frameLoop', () => ({
    makeFrameLoop: vi.fn(() => fakeFrameLoop),
}));

vi.mock('../state/persist', () => ({
    loadSketch: vi.fn(() => ({
        script: 'function _draw() end', sprite: null, cover: null, title: 't', author: 'a',
    })),
    saveSketch: vi.fn(),
}));

vi.mock('../state/gallery', () => ({
    loadGallery: vi.fn(() => Promise.resolve({
        entries: [{
            id: 'x', filename: 'x.tb.png', title: 'Cart', author: 'A',
            coverUrl: 'data:,x', cartridge: new Uint8Array([9]),
        }],
        failures: [],
    })),
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PlayerRoute', () => {
    test('mode="current" boots the engine with the persisted sketch', async () => {
        render(<PlayerRoute initial="current" />);
        await waitFor(() => expect(tb.start).toHaveBeenCalled());
        expect(tb.init).toHaveBeenCalled();
        expect(tb.feedCartridge).toHaveBeenCalled();
        expect(fakeFrameLoop.start).toHaveBeenCalled();
        expect(screen.getByLabelText(/tinybit display/i)).toBeInTheDocument();
    });

    test('mode="gallery" shows the picker, then boots after picking', async () => {
        render(<PlayerRoute initial="gallery" />);
        await waitFor(() => expect(screen.getByText(/Cart/i)).toBeInTheDocument());
        expect(tb.start).not.toHaveBeenCalled();
        await userEvent.click(screen.getByText(/Cart/i));
        await waitFor(() => expect(tb.start).toHaveBeenCalled());
        expect(tb.feedCartridge).toHaveBeenCalled();
    });

    test('encode failure renders error card with Back link', async () => {
        (enc.encode as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('encode boom'); });
        render(<PlayerRoute initial="current" />);
        await waitFor(() => expect(screen.getByText(/encode boom/i)).toBeInTheDocument());
        expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd editor && npx vitest run src/player/PlayerRoute.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlayerRoute`**

Create `editor/src/player/PlayerRoute.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getRuntime, type Runtime } from '../engine/runtime';
import { makeFrameLoop, type FrameLoop } from '../engine/frameLoop';
import { loadSketch } from '../state/persist';
import { loadGallery, type GalleryEntry, type GalleryFailure } from '../state/gallery';
import { buildCartridge } from '../engine/buildCartridge';
import { PlayerShell } from './PlayerShell';
import { PlayerGallery, type PlayerGalleryState } from './PlayerGallery';
import type { PlayerMode } from './routing';

type State =
    | { kind: 'boot' }
    | { kind: 'gallery'; data: PlayerGalleryState }
    | { kind: 'running' }
    | { kind: 'error'; message: string };

const errorWrap: CSSProperties = {
    width: '100vw', minHeight: '100dvh',
    background: '#181820', color: '#fff',
    display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
};

const linkStyle: CSSProperties = {
    color: '#ED225D', textDecoration: 'underline', marginTop: 12, display: 'inline-block',
};

export interface PlayerRouteProps {
    initial: PlayerMode;
}

export function PlayerRoute({ initial }: PlayerRouteProps) {
    const [state, setState] = useState<State>({ kind: 'boot' });
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const runtimeRef = useRef<Runtime | null>(null);
    const frameLoopRef = useRef<FrameLoop | null>(null);

    // Boot runtime + dispatch initial mode.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const rt = await getRuntime({ stdout: () => {}, stderr: () => {} });
                if (cancelled) return;
                runtimeRef.current = rt;
                frameLoopRef.current = makeFrameLoop(rt.tb);
                if (initial === 'current') {
                    await bootCurrent(rt);
                } else {
                    await bootGallery(rt);
                }
            } catch (err) {
                if (!cancelled) {
                    setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
                }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keyboard input (desktop convenience) - map only the six surfaced buttons.
    useEffect(() => {
        const map: Record<string, number> = {
            a: 0, A: 0, b: 1, B: 1,
            ArrowUp: 2, ArrowDown: 3, ArrowLeft: 4, ArrowRight: 5,
        };
        const down = (e: KeyboardEvent) => {
            const idx = map[e.key]; if (idx === undefined) return;
            if (e.key.startsWith('Arrow')) e.preventDefault();
            if (e.repeat) return;
            runtimeRef.current?.tb.setButton(idx, true);
        };
        const up = (e: KeyboardEvent) => {
            const idx = map[e.key]; if (idx === undefined) return;
            if (e.key.startsWith('Arrow')) e.preventDefault();
            runtimeRef.current?.tb.setButton(idx, false);
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, []);

    async function bootCurrent(rt: Runtime): Promise<void> {
        const stored = loadSketch();
        if (!stored) throw new Error('No sketch saved. Open the editor first.');
        const result = await buildCartridge(rt.enc, {
            script: stored.script, sprite: stored.sprite, cover: stored.cover,
            title: stored.title, author: stored.author,
        });
        if (!result.ok) throw new Error(result.error);
        setState({ kind: 'running' });
        await startEngine(rt, result.bytes);
    }

    async function bootGallery(rt: Runtime): Promise<void> {
        setState({ kind: 'gallery', data: { kind: 'loading' } });
        try {
            const g = await loadGallery(rt.dec);
            setState({ kind: 'gallery', data: { kind: 'ready', entries: g.entries, failures: g.failures } });
        } catch (err) {
            setState({
                kind: 'gallery',
                data: { kind: 'error', message: err instanceof Error ? err.message : String(err) },
            });
        }
    }

    async function startEngine(rt: Runtime, bytes: Uint8Array): Promise<void> {
        // Wait one frame so canvasRef is attached after the shell mounts.
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not mounted');
        rt.tb.init();
        rt.tb.feedCartridge(bytes);
        rt.tb.start();
        await frameLoopRef.current!.start(canvas);
    }

    async function handlePick(entry: GalleryEntry): Promise<void> {
        const rt = runtimeRef.current; if (!rt) return;
        try {
            setState({ kind: 'running' });
            await startEngine(rt, entry.cartridge);
        } catch (err) {
            setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
    }

    function handleSetButton(idx: number, pressed: boolean): void {
        runtimeRef.current?.tb.setButton(idx, pressed);
    }

    function handleExit(): void {
        frameLoopRef.current?.stop();
        runtimeRef.current?.tb.stop();
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = '/';
        }
    }

    if (state.kind === 'boot') {
        return <div style={errorWrap}>Loading engine…</div>;
    }
    if (state.kind === 'error') {
        return (
            <div style={errorWrap}>
                <div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Couldn't start</div>
                    <div style={{ color: '#cfcfd6' }}>{state.message}</div>
                    <a href="/" style={linkStyle}>Back to editor</a>
                </div>
            </div>
        );
    }
    if (state.kind === 'gallery') {
        return (
            <PlayerGallery
                state={state.data}
                onPick={handlePick}
                onBack={() => { window.location.href = '/'; }}
            />
        );
    }
    return (
        <PlayerShell canvasRef={canvasRef} onSetButton={handleSetButton} onExit={handleExit} />
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd editor && npx vitest run src/player/PlayerRoute.test.tsx`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/player/PlayerRoute.tsx editor/src/player/PlayerRoute.test.tsx
git commit -m "player: route state machine boots gallery or current sketch"
```

---

## Task 8: Editor extraction + router shim in App

**Files:**
- Create: `editor/src/Editor.tsx` (the old App body)
- Modify: `editor/src/App.tsx` (becomes a router)
- Modify: `editor/src/App.test.tsx` (cover both branches)

- [ ] **Step 1: Move existing App body into `Editor.tsx`**

Read the current `editor/src/App.tsx`. Copy its entire contents into a new file `editor/src/Editor.tsx`, except:

1. Rename the exported function from `App` to `Editor` (i.e. `export function Editor() { ... }`).
2. Keep all imports the same. Keep the `appStyle` constant.
3. Adjust relative imports as needed (they should be the same — Editor.tsx is in the same folder).

After saving Editor.tsx, do NOT yet shrink App.tsx. We'll verify the editor still runs through `Editor` before swapping.

- [ ] **Step 2: Temporarily wire App.tsx to render `<Editor/>`**

Replace the entire body of `editor/src/App.tsx` with:

```tsx
import { Editor } from './Editor';

export function App() {
    return <Editor />;
}
```

- [ ] **Step 3: Run the full editor test suite**

Run: `cd editor && npm test -- --run`
Expected: PASS — same total as baseline (App.test.tsx still renders App which now renders Editor).

- [ ] **Step 4: Run the type check**

Run: `cd editor && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Add the router shim**

Replace `editor/src/App.tsx` with the final shape:

```tsx
import { Editor } from './Editor';
import { PlayerRoute } from './player/PlayerRoute';
import { pickRoute } from './player/routing';

export function App() {
    const route = pickRoute(window.location.search);
    if (route.kind === 'player') return <PlayerRoute initial={route.mode} />;
    return <Editor />;
}
```

- [ ] **Step 6: Update App.test.tsx**

Replace the contents of `editor/src/App.test.tsx` with:

```tsx
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

const originalLocation = window.location;

function setSearch(search: string): void {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, search },
    });
}

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('App router', () => {
    beforeEach(() => { setSearch(''); });

    test('renders the editor by default', () => {
        render(<App />);
        // The editor toolbar contains the tinybit brand.
        expect(screen.getByText(/tinybit/i)).toBeInTheDocument();
    });

    test('renders the player route when ?play is present', () => {
        setSearch('?play');
        render(<App />);
        // The player route renders either a Loading screen or the gallery.
        // We just assert that the editor's toolbar is NOT rendered.
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders the player route when ?play=current is present', () => {
        setSearch('?play=current');
        render(<App />);
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 7: Run the full test suite**

Run: `cd editor && npm test -- --run`
Expected: PASS — original baseline + new tests added in Tasks 1–7. No regressions.

- [ ] **Step 8: Type-check**

Run: `cd editor && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add editor/src/App.tsx editor/src/Editor.tsx editor/src/App.test.tsx
git commit -m "app: route ?play to PlayerRoute, keep editor body in Editor.tsx"
```

---

## Task 9: Toolbar 📱 Player button + force-save navigation

**Files:**
- Modify: `editor/src/ui/Toolbar.tsx`
- Modify: `editor/src/ui/Toolbar.test.tsx`
- Modify: `editor/src/Editor.tsx`

- [ ] **Step 1: Update Toolbar tests**

Append to `editor/src/ui/Toolbar.test.tsx` (inside the existing `describe('Toolbar', () => { ... })` block):

```tsx
    test('renders a Player button between Clear and Gallery and fires onOpenPlayer', async () => {
        const onOpenPlayer = vi.fn();
        render(
            <Toolbar
                engineState="idle"
                canPlay={true}
                onPlay={() => {}}
                onStop={() => {}}
                onClear={() => {}}
                onGallery={() => {}}
                onOpen={() => {}}
                onDownload={() => {}}
                onOpenPlayer={onOpenPlayer}
            />,
        );
        const buttons = screen.getAllByRole('button');
        const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
        const clearIdx   = labels.findIndex((l) => /clear/i.test(l));
        const playerIdx  = labels.findIndex((l) => /open in player/i.test(l));
        const galleryIdx = labels.findIndex((l) => /gallery/i.test(l));
        expect(playerIdx).toBeGreaterThan(clearIdx);
        expect(playerIdx).toBeLessThan(galleryIdx);

        await userEvent.click(screen.getByRole('button', { name: /open in player/i }));
        expect(onOpenPlayer).toHaveBeenCalledOnce();
    });
```

Also, in the *existing* test `'renders a Gallery button between Clear and Open and fires onGallery'`, change the assertion `expect(galleryIdx).toBeGreaterThan(clearIdx);` to `expect(galleryIdx).toBeGreaterThan(clearIdx);` (no change) — but add a new pre-check that the player button is between them. Update the same test by replacing it with:

```tsx
    test('renders Player and Gallery buttons between Clear and Open', async () => {
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
                onOpenPlayer={() => {}}
            />,
        );
        const buttons = screen.getAllByRole('button');
        const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
        const clearIdx   = labels.findIndex((l) => /clear/i.test(l));
        const playerIdx  = labels.findIndex((l) => /open in player/i.test(l));
        const galleryIdx = labels.findIndex((l) => /gallery/i.test(l));
        const openIdx    = labels.findIndex((l) => /^open$/i.test(l));
        expect(clearIdx).toBeLessThan(playerIdx);
        expect(playerIdx).toBeLessThan(galleryIdx);
        expect(galleryIdx).toBeLessThan(openIdx);

        await userEvent.click(screen.getByRole('button', { name: /gallery/i }));
        expect(onGallery).toHaveBeenCalledOnce();
    });
```

(That replaces the older `'renders a Gallery button between Clear and Open and fires onGallery'` test — make sure to delete the old one.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd editor && npx vitest run src/ui/Toolbar.test.tsx`
Expected: FAIL — Toolbar doesn't accept `onOpenPlayer`.

- [ ] **Step 3: Update `Toolbar.tsx`**

In `editor/src/ui/Toolbar.tsx`, modify the `ToolbarProps` interface to add the new prop:

```tsx
    onOpenPlayer?(): void;
```

(Make it optional so callers in tests that don't pass it still work — when undefined, the button hides itself.)

Inside the JSX, between the Clear and Gallery buttons, add:

```tsx
            {p.onOpenPlayer && (
                <button type="button" onClick={p.onOpenPlayer} style={neutralStyle} aria-label="Open in player">
                    📱 Player
                </button>
            )}
```

- [ ] **Step 4: Re-run toolbar tests**

Run: `cd editor && npx vitest run src/ui/Toolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the new button in `Editor.tsx`**

In `editor/src/Editor.tsx`:

Add an import at the top:

```tsx
import { saveSketch } from './state/persist';
```

(If `saveSketch` is already imported elsewhere in the file, skip.)

Add a new handler near the other `handle…` callbacks (after `handleClear` and before the JSX return):

```tsx
    const handleOpenPlayer = useCallback(() => {
        frameLoopRef.current?.stop();
        runtime?.tb.stop();
        // Force a synchronous save so the player tab/route sees fresh state.
        saveSketch(
            { script: sketch.script, sprite: sketch.sprite, cover: sketch.cover, title: sketch.title, author: sketch.author },
            (msg) => consoleAppend('warn', msg),
        );
        window.location.search = '?play=current';
    }, [runtime, sketch.script, sketch.sprite, sketch.cover, sketch.title, sketch.author, consoleAppend]);
```

Pass it into the Toolbar render:

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
                onOpenPlayer={handleOpenPlayer}
            />
```

- [ ] **Step 6: Run the full editor suite**

Run: `cd editor && npm test -- --run`
Expected: PASS — all tests, no regressions.

- [ ] **Step 7: Type-check**

Run: `cd editor && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add editor/src/ui/Toolbar.tsx editor/src/ui/Toolbar.test.tsx editor/src/Editor.tsx
git commit -m "toolbar: 📱 Player button force-saves and navigates to ?play=current"
```

---

## Task 10: Mobile viewport meta

**Files:**
- Modify: `editor/index.html`

- [ ] **Step 1: Update the viewport meta tag**

In `editor/index.html`, change:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

to:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

- [ ] **Step 2: Sanity check (build still passes)**

Run: `cd editor && npm test -- --run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add editor/index.html
git commit -m "html: viewport-fit=cover for mobile player route"
```

---

## Task 11: Playwright e2e for the player route

**Files:**
- Create: `editor/tests/e2e/player.spec.ts`

- [ ] **Step 1: Inspect existing e2e patterns**

Read `editor/tests/e2e/smoke.spec.ts` (or any existing e2e file) for the standard shape: how the test waits for the engine to load, how `page.goto` is used, etc. This is reference only — the test below is self-contained.

- [ ] **Step 2: Write the e2e test**

Create `editor/tests/e2e/player.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('player route', () => {
    test('?play renders the gallery picker with at least one cartridge', async ({ page }) => {
        await page.goto('/?play');
        await expect(page.getByRole('heading', { name: /pick a cartridge/i })).toBeVisible();
        // The shipped sample cartridges in editor/src/cartridges/ should populate the gallery.
        // Allow up to 15s for wasm boot + gallery load.
        await expect(page.locator('button:has(img)').first()).toBeVisible({ timeout: 15_000 });
    });

    test('?play=current renders the shell with canvas and six hitboxes', async ({ page }) => {
        // First, visit the editor so localStorage has a sketch saved.
        await page.goto('/');
        // Wait for the editor toolbar to render — implies engine boot started.
        await expect(page.getByRole('button', { name: /clear editor/i })).toBeVisible({ timeout: 15_000 });

        // Then navigate to ?play=current.
        await page.goto('/?play=current');
        // Canvas appears once the runtime starts.
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
        // Six button hitboxes plus an exit chip.
        await expect(page.getByLabel(/^a button$/i)).toBeVisible();
        await expect(page.getByLabel(/^b button$/i)).toBeVisible();
        await expect(page.getByLabel(/^up button$/i)).toBeVisible();
        await expect(page.getByLabel(/^down button$/i)).toBeVisible();
        await expect(page.getByLabel(/^left button$/i)).toBeVisible();
        await expect(page.getByLabel(/^right button$/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /exit player/i })).toBeVisible();
    });

    test('Player toolbar button navigates to the player route', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /open in player/i })).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: /open in player/i }).click();
        await expect(page).toHaveURL(/\?play=current/);
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
    });
});
```

- [ ] **Step 3: Build the wasm (e2e needs the prod-style bundle)**

Run from the worktree root: `./scripts/build.sh`
Expected: produces `editor/public/tinybit_wasm.wasm`. If wasi-sdk is not yet downloaded this is the long step (one-time).

- [ ] **Step 4: Run the e2e suite**

Run: `cd editor && npm run test:e2e -- player.spec.ts`
Expected: PASS — 3 tests.

(If Playwright browsers are missing, run `npx playwright install` first.)

- [ ] **Step 5: Run the full e2e suite to check for regressions**

Run: `cd editor && npm run test:e2e`
Expected: PASS — including pre-existing e2e tests.

- [ ] **Step 6: Commit**

```bash
git add editor/tests/e2e/player.spec.ts
git commit -m "test(e2e): cover ?play, ?play=current, and toolbar Player button"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full Vitest suite**

Run: `cd editor && npm test -- --run`
Expected: PASS — baseline 291 tests + all new tests from Tasks 1–8. Should be roughly 291 + ~30 new ≈ ~320 passing.

- [ ] **Step 2: Run the type check**

Run: `cd editor && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run Playwright**

Run: `cd editor && npm run test:e2e`
Expected: PASS.

- [ ] **Step 4: Smoke the dev server in the browser (manual)**

Run from the worktree root: `./scripts/dev.sh`
Visit:
- `http://localhost:5173/` — confirm editor still loads and the toolbar shows a 📱 Player button.
- `http://localhost:5173/?play` — confirm the gallery picker renders with cards.
- Click a card — confirm the shell renders with canvas and six buttons, and the game starts running.
- Click the ✕ exit chip — confirm it navigates back to the previous page.
- `http://localhost:5173/?play=current` — confirm the in-editor sketch boots inside the shell.

(This step is documentation; the agent skips it if no human-loop is available, but the e2e suite already covers the same paths.)

- [ ] **Step 5: Confirm all tasks completed**

Look at the plan top to bottom. Every task has its commit. The worktree's branch (`worktree-feat+player-shell`) contains a clean linear history of one commit per task.

---

## Self-review notes (kept for the worker)

- All six button name strings (`up`, `down`, `left`, `right`, `a`, `b`) and their engine indices (2, 3, 4, 5, 0, 1) are defined once in `shellLayout.ts` and re-used everywhere — including the `usePointerButton` callbacks and the keyboard map in `PlayerRoute.tsx`. If you change one, change them all.
- `BuildResult` from `buildCartridge.ts` is a tagged-union — always check `result.ok` before accessing `result.bytes`. The editor path in `Editor.tsx` already does this (after Task 2's refactor).
- `PLAYER_BUTTONS` is a tuple-typed `as const` array — if you add Start/Select later, update this array, the layout config, the keyboard map, and the tests in lockstep.
- The "force save before navigate" in Task 9 is load-bearing for `?play=current`: the player reads from localStorage, which is debounced by ~500ms in normal editing. Without the explicit `saveSketch`, navigating immediately after a keystroke would race the debounce.
- The frame loop in `PlayerRoute` creates a new `FrameLoop` instance via `makeFrameLoop(rt.tb)`. The editor's frame loop is separate; they don't share state because navigation between routes is a full page reload.
