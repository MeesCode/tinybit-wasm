# Editor Memory & Script-Size Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two always-on footer strips in the editor — a script-byte-size meter under the EditorPane and a live Lua-heap meter under the CanvasPane — each with bar + numeric readout and green/yellow/red thresholds.

**Architecture:** One pure presentational component (`MeterFooter`) reused twice. Script bytes flow from `sketchStore.script` via `useMemo(TextEncoder bytes)`. Lua heap flows from a new custom hook `useLuaHeap` that polls `runtime.tb.luaMemUsed()` at 4 Hz while the engine is running. New wasm exports (`tb_lua_mem_used`, `tb_lua_mem_capacity`) are surfaced through optional methods on the `Tinybit` facade, mirroring the encoder/decoder graceful-degrade pattern.

**Tech Stack:** Vite + React 18 + Zustand (existing) · Vitest + @testing-library/react (existing) · `wasm32-wasip1` engine via raw `extern "C"` exports (already implemented in this branch).

**Spec:** `docs/superpowers/specs/2026-05-17-editor-memory-display-design.md`

**Prerequisites already done in this branch:**
- `tinybit_lua_memory_used()` added to `src/tinybit/tinybit.{h,c}`.
- `tinybit_lua_memory_used` declared in `src/bindings.rs`.
- `tb_lua_mem_used` and `tb_lua_mem_capacity` exported from `src/lib.rs`.
- `./scripts/build.sh` has been run; `editor/public/tinybit_wasm.wasm` is up to date.

If `editor/public/tinybit_wasm.wasm` is older than the new Rust exports, run `./scripts/build.sh` from the repo root before starting Task 4.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `editor/src/engine/limits.ts` | **create** | Module-level constants `SCRIPT_MAX = 32621` and `LUA_HEAP_CAPACITY = 262144`. Single source of truth for the editor side. |
| `editor/src/engine/tinybit.ts` | **modify** | Add `tb_lua_mem_used`/`tb_lua_mem_capacity` to `TinybitExports`; expose optional `luaMemUsed()` / `luaMemCapacity()` on `Tinybit`. |
| `editor/src/engine/tinybit.test.ts` | **modify** | Cover the new wrappers and the graceful-degrade path. |
| `editor/src/engine/useLuaHeap.ts` | **create** | Hook returning `idle | unavailable | live` reading; 250 ms polling while running. |
| `editor/src/engine/useLuaHeap.test.ts` | **create** | Vitest + fake timers + `renderHook`. |
| `editor/src/ui/MeterFooter.tsx` | **create** | Pure presentational meter (bar + text + thresholds + idle/overflow states). |
| `editor/src/ui/MeterFooter.test.tsx` | **create** | Threshold colours, overflow, idle, unavailable, aria-label, number formatting. |
| `editor/src/ui/EditorPane.tsx` | **modify** | Add the Script footer below the tab body. |
| `editor/src/ui/CanvasPane.tsx` | **modify** | Restructure layout: canvas in a flex-1 region above a footer. Accept `runtime` and `engineState` props. |
| `editor/src/App.tsx` | **modify** | Pass `runtime` and `engineState` into `<CanvasPane>`. |

---

## Task 1 — Add cartridge-limit constants

**Files:**
- Create: `editor/src/engine/limits.ts`

- [ ] **Step 1: Create the limits module**

```ts
// editor/src/engine/limits.ts
// Cartridge-format constants surfaced to UI code.
// Mirrors src/encoder/mod.rs::SCRIPT_MAX and tinybit.h::TB_MEM_LUA_STATE_SIZE.

export const SCRIPT_MAX = 32_621;        // bytes; reserves 1 byte for trailing NUL
export const LUA_HEAP_CAPACITY = 262_144; // bytes; matches TB_MEM_LUA_STATE_SIZE
```

- [ ] **Step 2: Sanity-check the build still passes typescript**

Run: `cd editor && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add editor/src/engine/limits.ts
git commit -m "editor: add SCRIPT_MAX and LUA_HEAP_CAPACITY constants

Single source of truth for the cartridge-format limits the new memory
footers will display. Values mirror src/encoder/mod.rs::SCRIPT_MAX and
tinybit.h::TB_MEM_LUA_STATE_SIZE."
```

---

## Task 2 — Extend the Tinybit facade with Lua-memory getters

**Files:**
- Modify: `editor/src/engine/tinybit.ts`
- Modify: `editor/src/engine/tinybit.test.ts`

- [ ] **Step 1: Write the failing test**

`editor/src/engine/tinybit.test.ts` already exists and has its own `mockExports()` helper that does not accept overrides. **Append** the following `describe` block at the bottom of that file. Do **not** redefine `mockExports`. The existing imports (`describe, test, expect, vi`) cover everything we need.

```ts
describe('makeTinybit lua memory wrappers', () => {
    test('luaMemUsed() forwards to tb_lua_mem_used', () => {
        const ex = mockExports() as ReturnType<typeof mockExports> & {
            tb_lua_mem_used: ReturnType<typeof vi.fn>;
        };
        ex.tb_lua_mem_used = vi.fn(() => 12_345);
        const tb = makeTinybit(ex);
        expect(tb.luaMemUsed?.()).toBe(12_345);
        expect(ex.tb_lua_mem_used).toHaveBeenCalledTimes(1);
    });

    test('luaMemCapacity() forwards to tb_lua_mem_capacity', () => {
        const ex = mockExports() as ReturnType<typeof mockExports> & {
            tb_lua_mem_capacity: ReturnType<typeof vi.fn>;
        };
        ex.tb_lua_mem_capacity = vi.fn(() => 262_144);
        const tb = makeTinybit(ex);
        expect(tb.luaMemCapacity?.()).toBe(262_144);
    });

    test('luaMemUsed/Capacity are undefined when exports are missing', () => {
        const ex = mockExports();   // no tb_lua_mem_* fields
        const tb = makeTinybit(ex);
        expect(tb.luaMemUsed).toBeUndefined();
        expect(tb.luaMemCapacity).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/engine/tinybit.test.ts`
Expected: FAIL — `luaMemUsed`/`luaMemCapacity` don't exist on `Tinybit`.

- [ ] **Step 3: Implement the wrappers**

Edit `editor/src/engine/tinybit.ts`. Replace the `TinybitExports` interface and the `Tinybit` interface with the versions below (only the new lines are highlighted in comments; do not delete unrelated lines):

```ts
export interface TinybitExports {
    memory: WebAssembly.Memory;
    tb_init(): void;
    tb_start(): number;
    tb_stop(): void;
    tb_loop_once(): void;
    tb_set_button(idx: number, pressed: number): void;
    tb_feed_buffer_ptr(): number;
    tb_feed_cartridge(len: number): number;
    tb_display_ptr(): number;
    tb_spritesheet_ptr(): number;
    tb_audio_ptr(): number;
    tb_lua_mem_used?(): number;      // optional: older wasm builds may not have this
    tb_lua_mem_capacity?(): number;  // optional
}

export interface Tinybit {
    init(): void;
    feedCartridge(bytes: Uint8Array): void;
    start(): void;
    stop(): void;
    loopOnce(): void;
    setButton(idx: number, pressed: boolean): void;
    displayView(): Uint16Array;
    audioView(): Int16Array;
    luaMemUsed?(): number;
    luaMemCapacity?(): number;
}
```

Then in `makeTinybit`, after the existing entries and before the closing brace of the returned object, conditionally attach the wrappers:

```ts
export function makeTinybit(ex: TinybitExports): Tinybit {
    const tb: Tinybit = {
        init: () => ex.tb_init(),
        feedCartridge(bytes) { /* ...unchanged... */ },
        start() { /* ...unchanged... */ },
        stop: () => ex.tb_stop(),
        loopOnce: () => ex.tb_loop_once(),
        setButton: (idx, pressed) => ex.tb_set_button(idx, pressed ? 1 : 0),
        displayView: () => new Uint16Array(ex.memory.buffer, ex.tb_display_ptr(), SCREEN_PIXELS),
        audioView:   () => new Int16Array(ex.memory.buffer, ex.tb_audio_ptr(), AUDIO_FRAME_SAMPLES),
    };
    if (typeof ex.tb_lua_mem_used === 'function') {
        tb.luaMemUsed = () => ex.tb_lua_mem_used!();
    }
    if (typeof ex.tb_lua_mem_capacity === 'function') {
        tb.luaMemCapacity = () => ex.tb_lua_mem_capacity!();
    }
    return tb;
}
```

Keep the existing implementation of `feedCartridge` and `start` — only the surrounding scaffolding changes from `return { ... }` to `const tb: Tinybit = { ... }; ... return tb;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/engine/tinybit.test.ts`
Expected: 3 new tests PASS. Any pre-existing tests in this file also still pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/engine/tinybit.ts editor/src/engine/tinybit.test.ts
git commit -m "editor: expose luaMemUsed/luaMemCapacity on the Tinybit facade

Optional wrappers around the new tb_lua_mem_used / tb_lua_mem_capacity
wasm exports. Undefined on older wasm builds, mirroring the existing
encoder/decoder graceful-degrade pattern in runtime.ts."
```

---

## Task 3 — Write the useLuaHeap hook

**Files:**
- Create: `editor/src/engine/useLuaHeap.ts`
- Create: `editor/src/engine/useLuaHeap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `editor/src/engine/useLuaHeap.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLuaHeap } from './useLuaHeap';
import type { Runtime } from './runtime';

function fakeRuntime(overrides: Partial<Runtime['tb']> = {}): Runtime {
    return {
        wasm: {} as never,
        memory: {} as never,
        tb: {
            init: vi.fn(), feedCartridge: vi.fn(), start: vi.fn(),
            stop: vi.fn(), loopOnce: vi.fn(), setButton: vi.fn(),
            displayView: vi.fn(() => new Uint16Array(0)),
            audioView:   vi.fn(() => new Int16Array(0)),
            ...overrides,
        },
        enc: {} as never, encoderAvailable: false,
        dec: {} as never, decoderAvailable: false,
        spritesheet: {} as never,
        preview: {} as never, previewAvailable: false,
    };
}

describe('useLuaHeap', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(()  => { vi.useRealTimers(); });

    it('returns idle when runtime is null', () => {
        const { result } = renderHook(() => useLuaHeap(null, 'idle'));
        expect(result.current).toEqual({ state: 'idle' });
    });

    it('returns idle when engineState is not "running"', () => {
        const rt = fakeRuntime({ luaMemUsed: () => 100, luaMemCapacity: () => 200 });
        const { result } = renderHook(() => useLuaHeap(rt, 'idle'));
        expect(result.current).toEqual({ state: 'idle' });
    });

    it('returns unavailable when runtime has no luaMemUsed', () => {
        const rt = fakeRuntime();                  // no luaMemUsed
        const { result } = renderHook(() => useLuaHeap(rt, 'running'));
        expect(result.current).toEqual({ state: 'unavailable' });
    });

    it('polls every 250 ms while running and reports live values', () => {
        let used = 1_000;
        const usedSpy = vi.fn(() => used);
        const capSpy  = vi.fn(() => 262_144);
        const rt = fakeRuntime({ luaMemUsed: usedSpy, luaMemCapacity: capSpy });

        const { result } = renderHook(() => useLuaHeap(rt, 'running'));

        // Initial sample happens immediately on mount.
        expect(result.current).toEqual({ state: 'live', used: 1_000, cap: 262_144 });
        expect(usedSpy).toHaveBeenCalledTimes(1);

        used = 2_500;
        act(() => { vi.advanceTimersByTime(250); });
        expect(result.current).toEqual({ state: 'live', used: 2_500, cap: 262_144 });
        expect(usedSpy).toHaveBeenCalledTimes(2);

        used = 9_001;
        act(() => { vi.advanceTimersByTime(250); });
        expect(result.current).toEqual({ state: 'live', used: 9_001, cap: 262_144 });
    });

    it('clears the interval when engineState transitions away from running', () => {
        const usedSpy = vi.fn(() => 100);
        const rt = fakeRuntime({ luaMemUsed: usedSpy, luaMemCapacity: () => 200 });

        const { result, rerender } = renderHook(
            ({ s }) => useLuaHeap(rt, s),
            { initialProps: { s: 'running' as const } },
        );
        expect(result.current).toEqual({ state: 'live', used: 100, cap: 200 });
        expect(usedSpy).toHaveBeenCalledTimes(1);

        rerender({ s: 'idle' as const });
        expect(result.current).toEqual({ state: 'idle' });

        // Advance time — interval should have been cleared, no more calls.
        act(() => { vi.advanceTimersByTime(2_000); });
        expect(usedSpy).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/engine/useLuaHeap.test.ts`
Expected: FAIL with "Cannot find module './useLuaHeap'".

- [ ] **Step 3: Implement the hook**

Create `editor/src/engine/useLuaHeap.ts`:

```ts
import { useEffect, useState } from 'react';
import type { Runtime } from './runtime';
import type { FrameLoopState } from './frameLoop';

export type LuaHeapReading =
    | { state: 'idle' }
    | { state: 'unavailable' }
    | { state: 'live'; used: number; cap: number };

const SAMPLE_INTERVAL_MS = 250;

const IDLE: LuaHeapReading = { state: 'idle' };
const UNAVAILABLE: LuaHeapReading = { state: 'unavailable' };

export function useLuaHeap(runtime: Runtime | null, engineState: FrameLoopState): LuaHeapReading {
    const [reading, setReading] = useState<LuaHeapReading>(IDLE);

    useEffect(() => {
        if (!runtime || engineState !== 'running') {
            setReading(IDLE);
            return;
        }
        const used = runtime.tb.luaMemUsed;
        const cap  = runtime.tb.luaMemCapacity;
        if (typeof used !== 'function' || typeof cap !== 'function') {
            setReading(UNAVAILABLE);
            return;
        }
        const cachedCap = cap();
        const sample = () => setReading({ state: 'live', used: used(), cap: cachedCap });
        sample();
        const id = setInterval(sample, SAMPLE_INTERVAL_MS);
        return () => clearInterval(id);
    }, [runtime, engineState]);

    return reading;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/engine/useLuaHeap.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/engine/useLuaHeap.ts editor/src/engine/useLuaHeap.test.ts
git commit -m "editor: add useLuaHeap hook for live Lua-heap polling

Polls runtime.tb.luaMemUsed() at 4 Hz while engineState === 'running'.
Returns sentinel readings ({state:'idle'} / {state:'unavailable'}) when
the engine is stopped or the wasm build predates the export, so render
sites don't need to branch."
```

---

## Task 4 — Build the MeterFooter component (presentational)

**Files:**
- Create: `editor/src/ui/MeterFooter.tsx`
- Create: `editor/src/ui/MeterFooter.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `editor/src/ui/MeterFooter.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MeterFooter } from './MeterFooter';

function bar() {
    return screen.getByTestId('meter-bar');
}

describe('MeterFooter', () => {
    it('shows label + used/cap in KB with one decimal at 50%', () => {
        render(<MeterFooter label="Script" used={16_310} cap={32_621} mode="light" />);
        expect(screen.getByText('Script')).toBeInTheDocument();
        expect(screen.getByText('15.9 / 31.9 KB')).toBeInTheDocument();
        expect(bar().getAttribute('aria-label')).toMatch(/50%/);
    });

    it('uses bytes when used < 1024', () => {
        render(<MeterFooter label="Script" used={423} cap={32_621} mode="light" />);
        // cap drives the unit; readout uses the cap's unit on both sides
        expect(screen.getByText('0.4 / 31.9 KB')).toBeInTheDocument();
    });

    it('colours the bar green below 75%', () => {
        render(<MeterFooter label="Script" used={1_000} cap={32_621} mode="light" />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.backgroundColor).toBe('rgb(22, 163, 74)');     // #16A34A
    });

    it('colours the bar yellow between 75% and 90%', () => {
        render(<MeterFooter label="Script" used={26_500} cap={32_621} mode="light" />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.backgroundColor).toBe('rgb(234, 179, 8)');     // #EAB308
    });

    it('colours the bar red at or above 90%', () => {
        render(<MeterFooter label="Script" used={30_000} cap={32_621} mode="light" />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.backgroundColor).toBe('rgb(220, 38, 38)');     // #DC2626
    });

    it('renders overflow state: bar capped at 100% in red, readout prefixed with warning', () => {
        render(<MeterFooter label="Script" used={40_000} cap={32_621} mode="light" overflow />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('100%');
        expect(fill.style.backgroundColor).toBe('rgb(220, 38, 38)');
        expect(screen.getByText(/⚠/)).toBeInTheDocument();
    });

    it('renders idle state with dim "— idle" label and no numbers', () => {
        render(<MeterFooter label="Lua heap" used={null} cap={262_144} mode="dark" />);
        expect(screen.getByText(/Lua heap — idle/)).toBeInTheDocument();
        expect(screen.queryByText(/KB/)).toBeNull();
    });

    it('renders the custom idleText (e.g. "unavailable") when provided', () => {
        render(<MeterFooter label="Lua heap" used={null} cap={262_144} mode="dark" idleText="unavailable" />);
        expect(screen.getByText(/Lua heap — unavailable/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/ui/MeterFooter.test.tsx`
Expected: FAIL with "Cannot find module './MeterFooter'".

- [ ] **Step 3: Implement the component**

Create `editor/src/ui/MeterFooter.tsx`:

```tsx
import type { CSSProperties } from 'react';

export interface MeterFooterProps {
    label: string;
    used: number | null;        // bytes; null = idle/unavailable
    cap: number;                // bytes
    mode: 'light' | 'dark';
    overflow?: boolean;
    idleText?: string;
}

const FILL_GREEN  = '#16A34A';
const FILL_YELLOW = '#EAB308';
const FILL_RED    = '#DC2626';

const lightPalette = {
    background: '#FAFAFB',
    border:     '#ECECF0',
    text:       '#4B4B58',
    dim:        '#6B6B76',
    track:      '#ECECF0',
};
const darkPalette = {
    background: '#1a1a22',
    border:     '#2a2a35',
    text:       '#c6c6cf',
    dim:        '#6B6B76',
    track:      '#2a2a35',
};

function fillColor(pct: number): string {
    if (pct >= 90) return FILL_RED;
    if (pct >= 75) return FILL_YELLOW;
    return FILL_GREEN;
}

function formatBytes(bytes: number, capUnit: 'B' | 'KB'): string {
    if (capUnit === 'B') return `${bytes}`;
    return (Math.round(bytes / 102.4) / 10).toFixed(1);
}

function unitFor(cap: number): 'B' | 'KB' {
    return cap < 1024 ? 'B' : 'KB';
}

export function MeterFooter({ label, used, cap, mode, overflow, idleText }: MeterFooterProps) {
    const palette = mode === 'dark' ? darkPalette : lightPalette;
    const isIdle = used === null;

    const rowStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 24,
        padding: '0 10px',
        background: palette.background,
        borderTop: `1px solid ${palette.border}`,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        color: isIdle ? palette.dim : palette.text,
        flexShrink: 0,
    };

    const trackStyle: CSSProperties = {
        width: 60,
        height: 6,
        background: palette.track,
        borderRadius: 3,
        overflow: 'hidden',
        flexShrink: 0,
    };

    if (isIdle) {
        return (
            <div role="status" aria-live="off" style={rowStyle}>
                <span>{label} — {idleText ?? 'idle'}</span>
                <div data-testid="meter-bar" style={trackStyle} aria-label={`${label}: ${idleText ?? 'idle'}`}>
                    <div data-testid="meter-fill" style={{ width: '0%', height: '100%', backgroundColor: palette.track }} />
                </div>
            </div>
        );
    }

    const rawPct = (used / cap) * 100;
    const clampedPct = Math.min(100, Math.max(0, rawPct));
    const color = fillColor(rawPct);
    const unit = unitFor(cap);
    const usedStr = formatBytes(used, unit);
    const capStr  = formatBytes(cap, unit);
    const readout = `${usedStr} / ${capStr}${unit === 'KB' ? ' KB' : ' B'}`;
    const readoutColor = overflow ? FILL_RED : palette.text;

    return (
        <div role="status" aria-live="off" style={rowStyle}>
            <span>{label}</span>
            <div
                data-testid="meter-bar"
                style={trackStyle}
                aria-label={`${label} usage: ${usedStr} of ${capStr} ${unit === 'KB' ? 'kilobytes' : 'bytes'} (${Math.round(rawPct)}%)`}
            >
                <div
                    data-testid="meter-fill"
                    style={{ width: `${clampedPct}%`, height: '100%', backgroundColor: color }}
                />
            </div>
            <span style={{ color: readoutColor, marginLeft: 'auto' }}>
                {overflow ? `⚠ ${readout}` : readout}
            </span>
        </div>
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/ui/MeterFooter.test.tsx`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/MeterFooter.tsx editor/src/ui/MeterFooter.test.tsx
git commit -m "editor: add MeterFooter presentational component

24px-tall bar + numeric readout with green/yellow/red thresholds
(<75%, 75-90%, >=90%) and dim idle / unavailable / overflow states.
Light and dark variants for the editor and canvas pane footers."
```

---

## Task 5 — Mount the Script footer under EditorPane

**Files:**
- Modify: `editor/src/ui/EditorPane.tsx`

Note: EditorPane has no existing test file. The footer is straightforward presentation wired to the existing `sketchStore`; a manual integration check at the end of the plan covers it.

- [ ] **Step 1: Edit EditorPane.tsx**

Replace the file with:

```tsx
import { useMemo, type ReactNode, type CSSProperties } from 'react';
import { useSketchStore } from '../state/sketchStore';
import { SCRIPT_MAX } from '../engine/limits';
import { MeterFooter } from './MeterFooter';

export type EditorTab = 'script' | 'alt' | 'cartridge' | 'score';

export interface EditorPaneProps {
    active: EditorTab;
    onChange(t: EditorTab): void;
    children: ReactNode;        // the body of the active tab
}

const wrapStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: '#FFFFFF',
};

const tabsStyle: CSSProperties = {
    display: 'flex',
    background: '#F6F6F8',
    borderBottom: '1px solid #ECECF0',
    flexShrink: 0,
};

function tabStyle(active: boolean): CSSProperties {
    return {
        padding: '8px 14px',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: active ? '#ED225D' : '#6B6B76',
        background: active ? '#FFFFFF' : 'transparent',
        borderBottom: active ? '2px solid #ED225D' : '2px solid transparent',
        borderRight: '1px solid #ECECF0',
    };
}

const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, overflow: 'hidden' };

const encoder = new TextEncoder();

export function EditorPane({ active, onChange, children }: EditorPaneProps) {
    const script = useSketchStore((s) => s.script);
    const scriptBytes = useMemo(() => encoder.encode(script).length, [script]);

    return (
        <div style={wrapStyle}>
            <div role="tablist" style={tabsStyle}>
                {(['script', 'alt', 'score', 'cartridge'] as const).map((t) => (
                    <button
                        key={t}
                        role="tab"
                        aria-selected={active === t}
                        type="button"
                        onClick={() => onChange(t)}
                        style={tabStyle(active === t)}>
                        {t === 'script' ? 'script'
                         : t === 'alt' ? 'spritesheet'
                         : t === 'score' ? 'score'
                         : 'cartridge'}
                    </button>
                ))}
            </div>
            <div role="tabpanel" style={bodyStyle}>{children}</div>
            <MeterFooter
                label="Script"
                used={scriptBytes}
                cap={SCRIPT_MAX}
                mode="light"
                overflow={scriptBytes > SCRIPT_MAX}
            />
        </div>
    );
}
```

If `useSketchStore` lives at a different path, adjust the import. Verify with `grep -n "export.*useSketchStore" editor/src/state/sketchStore.ts` before editing — at time of plan writing the export is `useSketchStore` from `editor/src/state/sketchStore.ts`.

- [ ] **Step 2: Run vitest + typecheck**

Run: `cd editor && npx tsc --noEmit && npx vitest run`
Expected: typecheck passes; all tests pass (no test file for EditorPane, so no new tests run here).

- [ ] **Step 3: Commit**

```bash
git add editor/src/ui/EditorPane.tsx
git commit -m "editor: show Script byte-size meter below the editor tabs

Always-visible footer at the bottom of EditorPane, reading
sketchStore.script bytes (UTF-8) and comparing against SCRIPT_MAX.
Lives outside the tab body so it remains visible across all tabs."
```

---

## Task 6 — Mount the Lua-heap footer under CanvasPane

**Files:**
- Modify: `editor/src/ui/CanvasPane.tsx`

- [ ] **Step 1: Edit CanvasPane.tsx**

The current pane centers the canvas with flex align/justify. The new layout makes the canvas live in a flex-1 region above a fixed-height footer. Replace the file with:

```tsx
import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { Runtime } from '../engine/runtime';
import type { FrameLoopState } from '../engine/frameLoop';
import { useLuaHeap } from '../engine/useLuaHeap';
import { LUA_HEAP_CAPACITY } from '../engine/limits';
import { MeterFooter } from './MeterFooter';

export interface CanvasPaneProps {
    runtime: Runtime | null;
    engineState: FrameLoopState;
}

const wrapStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: '#F1F1F4',
};

const canvasAreaStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    containerType: 'size',
};

const canvasStyle: CSSProperties = {
    width: 'min(calc(100cqw - 16px), calc(100cqh - 16px))',
    aspectRatio: '1 / 1',
    imageRendering: 'pixelated',
    background: '#000',
    border: '1px solid #ECECF0',
    borderRadius: 4,
};

export interface CanvasHandle { getCanvas(): HTMLCanvasElement | null; }

export const CanvasPane = forwardRef<CanvasHandle, CanvasPaneProps>(function CanvasPane(
    { runtime, engineState }, ref,
) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    useImperativeHandle(ref, () => ({ getCanvas: () => canvasRef.current }), []);

    const heap = useLuaHeap(runtime, engineState);

    const used = heap.state === 'live' ? heap.used : null;
    const cap  = heap.state === 'live' ? heap.cap  : LUA_HEAP_CAPACITY;
    const idleText = heap.state === 'unavailable' ? 'unavailable' : 'idle';

    return (
        <div style={wrapStyle}>
            <div style={canvasAreaStyle}>
                <canvas ref={canvasRef} width={128} height={128} style={canvasStyle} aria-label="TinyBit display" />
            </div>
            <MeterFooter
                label="Lua heap"
                used={used}
                cap={cap}
                mode="dark"
                idleText={idleText}
            />
        </div>
    );
});
```

Note: this **changes the signature** of `CanvasPane` from `forwardRef<CanvasHandle>` to `forwardRef<CanvasHandle, CanvasPaneProps>` — callers must now pass `runtime` and `engineState`. That happens in Task 7.

- [ ] **Step 2: Run typecheck to confirm App.tsx now fails to compile**

Run: `cd editor && npx tsc --noEmit`
Expected: FAIL with an error in `App.tsx` saying `CanvasPane` is missing required props `runtime` and `engineState`. This is the expected wedge driving Task 7.

- [ ] **Step 3: Commit**

```bash
git add editor/src/ui/CanvasPane.tsx
git commit -m "editor: show Lua heap meter below the canvas

Restructures CanvasPane into a flex column: canvas above (flex:1) and
the new MeterFooter below. Heap reading is polled via useLuaHeap while
engineState === 'running', dim 'idle' otherwise. App.tsx wiring in the
next commit."
```

---

## Task 7 — Wire props from App.tsx into CanvasPane

**Files:**
- Modify: `editor/src/App.tsx`

- [ ] **Step 1: Edit the `<CanvasPane>` usage**

Open `editor/src/App.tsx`, find:

```tsx
                rightTop={<CanvasPane ref={canvasRef} />}
```

Replace with:

```tsx
                rightTop={<CanvasPane ref={canvasRef} runtime={runtime} engineState={engineState} />}
```

`runtime` and `engineState` are already in scope (look earlier in the file for `const [engineState, setEngineState]` and `runtime`).

- [ ] **Step 2: Run typecheck**

Run: `cd editor && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `cd editor && npx vitest run`
Expected: all tests pass. There may be existing tests that render `<App />` or `<CanvasPane />` — if any of them break because the new props are required, fix the call sites by passing `runtime={null} engineState="idle"` in the test. Do **not** make the props optional in production code.

- [ ] **Step 4: Commit**

```bash
git add editor/src/App.tsx
git commit -m "editor: pass runtime + engineState into CanvasPane

Completes the wiring so the Lua heap footer goes live while a
cartridge is running."
```

---

## Task 8 — End-to-end smoke check

**Files:** none modified; this task is verification.

- [ ] **Step 1: Verify wasm is current**

Run from the repo root:

```bash
ls -l editor/public/tinybit_wasm.wasm
```

If the file is older than `src/lib.rs`, rebuild:

```bash
./scripts/build.sh
```

Expected: build script completes; the wasm is regenerated and copied to `editor/public/`.

- [ ] **Step 2: Confirm the new exports are present in the wasm**

Run:

```bash
grep -ao 'tb_lua_mem_[a-z]*' editor/public/tinybit_wasm.wasm | sort -u
```

Expected: prints `tb_lua_mem_capacity` and `tb_lua_mem_used`.

- [ ] **Step 3: Start the dev server**

Run: `./scripts/dev.sh`
Expected: Vite serves at http://localhost:5173.

- [ ] **Step 4: Manual checks in the browser**

Open http://localhost:5173 and verify:

1. The EditorPane (left side) has a thin light footer at the bottom showing `Script  ▰▱▱▱▱  X.X / 31.9 KB`. Type into the script editor — the bar and numbers update on each keystroke.
2. The CanvasPane (right top) has a matching dark footer at the bottom showing `Lua heap — idle`.
3. Click **Play**. The Lua heap footer flips to live numbers, e.g. `Lua heap  ▰▱▱▱▱  43.0 / 256 KB`, and the value visibly updates roughly four times per second.
4. The bar colour is green well below 75%. If you can drive heap above 75% (paste in a memory-hungry cartridge, or temporarily lower `LUA_HEAP_CAPACITY` for testing), confirm yellow then red.
5. Paste in a script that exceeds 32,621 bytes (e.g. a long comment block padded out). The script footer turns red, shows the `⚠` prefix, and the bar caps at 100% fill.
6. Click **Stop**. The Lua heap footer returns to `Lua heap — idle` and stops sampling.

If any check fails, stop here and triage. Do **not** mark this task complete until the manual checks pass.

- [ ] **Step 5: Run the full vitest suite once more**

Run: `cd editor && npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Final commit (only if any tweaks were needed during smoke)**

If no source changes were needed, skip. Otherwise:

```bash
git add -p   # selectively stage tweaks
git commit -m "editor: tidy memory-display tweaks from manual QA"
```

---

## Notes for the executing engineer

- **Why `useMemo` for the script byte count:** `TextEncoder().encode()` allocates a `Uint8Array` of the script length on every call. Cheap for 1 KB, wasteful for 30 KB on every render. The memo keys on the script string identity, which is stable across unrelated re-renders.
- **Why the hook caches capacity:** capacity is a compile-time constant; reading it once avoids an extra wasm call per tick.
- **Why initial sample fires on mount:** without it, the footer would render `0 / 256 KB` for the first 250 ms after pressing Play, then snap to a real value. Calling `sample()` synchronously before scheduling the interval shows the real heap immediately.
- **Why dark footer uses the canvas pane's existing palette:** matches the visual rhythm — the canvas chrome and the footer should read as one surface, not two.
- **Don't add features here that the spec calls out as future work** (unit toggle on click, hover breakdowns, peak markers). YAGNI.
