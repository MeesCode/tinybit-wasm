# Editor Memory & Script-Size Display — Design

**Date:** 2026-05-17
**Status:** Spec
**Related code:**
- engine: `src/tinybit/tinybit.h`, `src/tinybit/tinybit.c`, `src/tinybit/lua_pool.{c,h}`
- wasm FFI: `src/bindings.rs`, `src/lib.rs`
- editor: `editor/src/ui/EditorPane.tsx`, `editor/src/ui/CanvasPane.tsx`, `editor/src/engine/tinybit.ts`, `editor/src/engine/runtime.ts`, `editor/src/state/sketchStore.ts`

## Problem

The TinyBit cartridge format has two hard limits that today are invisible to the user while authoring:

1. **Script payload:** 32,621 bytes (`encoder::SCRIPT_MAX`, enforced both Rust-side and editor-side). The user only finds out when they hit Play / Download and the encoder rejects.
2. **Lua heap:** the engine ships with a fixed 256 KiB Lua memory pool (`TB_MEM_LUA_STATE_SIZE`). A cartridge that allocates beyond this errors out at runtime with no warning that it was close.

The engine already tracks both: `lua_pool_get_used()` returns the current Lua heap watermark, and the script-byte length is available from the cartridge buffer. Surface them in the editor so authoring stays inside the cartridge envelope without trial-and-error.

## Goal

Two always-present footer strips inside the editor — one under the script-editor pane showing script-payload bytes vs. cap, one under the canvas pane showing Lua heap bytes vs. cap. Each is a 24 px tall bar + numeric readout, with green/yellow/red thresholds. The script meter is meaningful at all times; the Lua meter is live while the engine is running and dims to "idle" when it is not.

## Non-goals

- Per-region memory breakdown (spritesheet / display / audio / etc. are static-allocated and uninteresting).
- Tracking GC pauses, allocation rates, or other Lua VM telemetry.
- A console command or scripting hook to read these from inside the cartridge.
- Click-to-toggle units, hover tooltips, or a flyout with history graphs. (YAGNI; easy to bolt on later if asked.)
- Surfacing limits anywhere else in the UI (no toolbar pill, no modal, no console line).
- Modifying the engine's pool size or script cap.

## Engine + FFI surface (already implemented in this branch)

### `src/tinybit/tinybit.h`, `src/tinybit/tinybit.c`

```c
// Current Lua heap usage in bytes; capacity is TB_MEM_LUA_STATE_SIZE.
size_t tinybit_lua_memory_used();
```

Thin passthrough to `lua_pool_get_used()`. Safe to call at any time after `tinybit_init`; returns 0 before a Lua state is constructed and after `tinybit_stop` (the pool resets on next `tinybit_init`).

### `src/bindings.rs`

Adds `pub fn tinybit_lua_memory_used() -> usize` to the `extern "C"` block.

### `src/lib.rs` — two new wasm exports

```rust
#[no_mangle] pub extern "C" fn tb_lua_mem_used() -> u32;
#[no_mangle] pub extern "C" fn tb_lua_mem_capacity() -> u32;
```

`tb_lua_mem_used` returns 0 if the state isn't initialised (mirrors the pattern in the existing pointer-returning exports). `tb_lua_mem_capacity` is a constant returning `TB_MEM_LUA_STATE_SIZE` (262,144). Both are optional in the same sense as encoder/decoder exports: the editor's `runtime.ts` probes for them and degrades gracefully if they're missing on an older wasm.

## Editor-facing surface

### Layout

```
┌── Toolbar ───────────────────────────────────────────────────────┐
│  tinybit  ▶ Play  ■ Stop  🗑 …                          [Running]│
├────────────────────────────┬─────────────────────────────────────┤
│                            │                                     │
│  EditorPane (tabs)         │  CanvasPane                         │
│  ┌ Script / Alt / Score /  │  ┌──────────────┐                   │
│  │  Cartridge ┘            │  │   canvas     │                   │
│  │                         │  │              │                   │
│  │                         │  └──────────────┘                   │
│  ├─────────────────────────┤  ├─────────────────────────────────┤│
│  │ Script ▰▱▱▱▱  1.2/31.9 KB│  │ Lua heap ▰▰▱▱▱  43 / 256 KB    ││ <- 24 px footers
│  └─────────────────────────┘  └─────────────────────────────────┘│
│                            │  ConsolePane                        │
│                            │  …                                  │
└────────────────────────────┴─────────────────────────────────────┘
```

The two footers sit at the same vertical position when no console is open and read as one continuous row across the splitter. The CanvasPane footer is dark-themed to match the canvas chrome; the EditorPane footer is light to match the editor.

### Components

#### `editor/src/ui/MeterFooter.tsx` (new)

Pure presentational. No store knowledge, no effects.

```ts
interface MeterFooterProps {
  label: string;             // "Script" | "Lua heap"
  used: number | null;       // bytes; null = idle/unavailable
  cap: number;               // bytes
  mode: 'light' | 'dark';
  overflow?: boolean;        // used > cap (script only)
  idleText?: string;         // override "— idle"
}
```

Renders a 24 px row: `[label]  [bar]  [used / cap unit]`. Handles:
- Threshold colour selection (green <75%, yellow 75–90%, red ≥90%).
- Overflow state (bar capped at 100% fill in red, readout in red prefixed with `⚠`).
- Idle/null state (bar fill 0% in border colour, readout shows `${label} — ${idleText ?? 'idle'}` in dim grey).
- Unit formatting: `<1 KB` → `423 B`, otherwise `1.2 KB` with one decimal, slash-separated, same unit on both sides chosen by `cap`.
- `aria-label` on the bar with rounded percentage; container is `role="status" aria-live="off"`.

#### `editor/src/engine/useLuaHeap.ts` (new)

Custom hook. Subscribes to live Lua heap while running.

```ts
type LuaHeapReading =
  | { state: 'idle' }
  | { state: 'unavailable' }
  | { state: 'live'; used: number; cap: number };

function useLuaHeap(runtime: Runtime | null, engineState: EngineState): LuaHeapReading;
```

- If `runtime?.tb.luaMemUsed` is undefined → `{ state: 'unavailable' }`.
- If `engineState !== 'running'` → `{ state: 'idle' }`.
- Otherwise mounts a `setInterval(250)` that calls `runtime.tb.luaMemUsed()` and `runtime.tb.luaMemCapacity()` (capacity cached on first call). Cleans up on stop/unmount.
- The 250 ms cadence keeps React re-renders to ~4/s and is hand-wavy enough to be revisited without API changes.

#### `editor/src/engine/tinybit.ts` — extension

The `Tb` facade gains two optional methods:

```ts
interface Tb {
  // ...existing
  luaMemUsed?(): number;
  luaMemCapacity?(): number;
}
```

Implemented as thin wrappers over `instance.exports.tb_lua_mem_used` and `tb_lua_mem_capacity`. `runtime.ts` follows the existing optional-export probing pattern: if the symbol is absent on the wasm module, the methods stay undefined.

### Render sites

#### `editor/src/ui/EditorPane.tsx`

Adds a footer row inside the pane (below the tabbed content, outside the tab content's flex region so it doesn't change with tab switches). Reads `sketch.script` from `sketchStore`, computes byte length with `new TextEncoder().encode(script).length` inside `useMemo([script])`.

```tsx
<MeterFooter
  label="Script"
  used={byteLen}
  cap={SCRIPT_MAX}            // 32621, re-exported from engine/encoder.ts
  mode="light"
  overflow={byteLen > SCRIPT_MAX}
/>
```

Always visible regardless of active tab — script size is a cartridge-wide constraint that matters when the user is editing music or sprites too.

#### `editor/src/ui/CanvasPane.tsx`

Adds a footer row below the canvas. Receives `engineState` and `runtime` as new props (currently neither is plumbed through — see "App.tsx wiring" below).

```tsx
const heap = useLuaHeap(runtime, engineState);
<MeterFooter
  label="Lua heap"
  mode="dark"
  used={heap.state === 'live' ? heap.used : null}
  cap={heap.state === 'live' ? heap.cap : TB_MEM_LUA_STATE_SIZE}
  idleText={heap.state === 'unavailable' ? 'unavailable' : 'idle'}
/>
```

#### `editor/src/App.tsx`

`engineState` already exists. `runtime` already exists. The wiring change is small: pass both into `<CanvasPane runtime={runtime} engineState={engineState} ref={canvasRef} />`. `CanvasPane`'s existing forwardRef signature gains two optional props.

## Visual spec

| Property | Light footer (under editor) | Dark footer (under canvas) |
|---|---|---|
| Height | 24 px | 24 px |
| Background | `#FAFAFB` | `#1a1a22` |
| Border-top | `#ECECF0` | `#2a2a35` |
| Text | `#4B4B58`, monospace 11 px | `#c6c6cf`, monospace 11 px |
| Dim text (idle/unavailable) | `#6B6B76` | `#6B6B76` |
| Bar track | `#ECECF0` | `#2a2a35` |
| Bar fill <75% | `#16A34A` | `#16A34A` |
| Bar fill 75–90% | `#EAB308` | `#EAB308` |
| Bar fill ≥90% | `#DC2626` | `#DC2626` |
| Bar size | 60 × 6 px, 3 px radius, inline-block | same |
| Internal padding | `6px 10px` | `6px 10px` |

Number format:
- `bytes < 1024` → `423 B / 31.9 KB` (script case never hits this, but the rule covers it).
- `bytes ≥ 1024` → `1.2 KB / 31.9 KB`, one decimal place, `Math.round(bytes / 102.4) / 10`.
- Both sides of the slash use the unit chosen by `cap`.

## Threshold behaviour

| Condition | Bar fill % | Bar colour | Readout colour | Readout prefix |
|---|---|---|---|---|
| 0 ≤ pct < 75 | pct | green | neutral | — |
| 75 ≤ pct < 90 | pct | yellow | neutral | — |
| 90 ≤ pct ≤ 100 | pct | red | neutral | — |
| pct > 100 (script only) | 100 | red | red | `⚠ ` |
| Idle / unavailable | 0 | track colour | dim | — |

Lua heap cannot exceed `cap` (the pool allocator refuses, and the cartridge errors before the meter could show overflow), so overflow styling is script-only in practice.

## Data flow summary

```
Script size:
  sketchStore.script  ──▶  useMemo(TextEncoder bytes)  ──▶  <MeterFooter>

Lua heap (running):
  setInterval(250ms)  ──▶  runtime.tb.luaMemUsed()
                       ──▶  wasm tb_lua_mem_used()
                       ──▶  tinybit_lua_memory_used()  ──▶  lua_heap_used
                       ──▶  setState({used, cap})  ──▶  <MeterFooter>

Lua heap (idle / unavailable):
  engineState ≠ 'running'  ──▶  hook returns sentinel  ──▶  dim footer
  tb_lua_mem_used missing   ──▶  hook returns sentinel  ──▶  dim footer
```

## Edge cases

- **Engine resets (`tb_init` called again):** `lua_heap_used` resets via `lua_pool_reset()`. The hook keeps polling; the meter follows the value down.
- **Mid-frame allocation spikes:** the 250 ms sample misses sub-tick peaks. Acceptable — this is an authoring aid, not a profiler.
- **Wasm reload (HMR):** `runtime` reference changes; the hook's effect re-runs; old interval is cleared.
- **Memory.grow:** does not affect the meter — capacity is the pool size, not wasm linear memory.
- **Older wasm without the new exports:** hook returns `unavailable`, footer renders `Lua heap — unavailable`. Script meter is unaffected (it doesn't depend on wasm).
- **Multi-byte UTF-8 in script:** byte length, not character count, drives the meter. Matches the encoder's check.

## Testing

Component test for `MeterFooter` (vitest + jsdom):
- Renders three threshold colours at 50% / 80% / 95% fill.
- Renders overflow state at 110% (cap fill at 100%, red, `⚠` prefix).
- Renders idle and unavailable labels with no numbers.
- `aria-label` includes rounded percentage.

Hook test for `useLuaHeap`:
- Returns `idle` when `engineState !== 'running'`.
- Returns `unavailable` when runtime lacks `luaMemUsed`.
- Polls every 250 ms while running (use `vi.useFakeTimers` + `vi.advanceTimersByTime`).
- Clears interval on unmount and on engineState transition to non-running.

Integration check: bring up the editor (`./scripts/dev.sh`), confirm the script meter updates as you type, press Play, confirm the Lua meter goes live and the bar moves with the running cartridge.

## Open questions / Future work

None blocking. Plausible future additions if asked:
- Click footer to swap units (B / KB / %).
- Hover for breakdown (e.g., Lua heap split into objects / strings / userdata via `lua_gc(LUA_GCCOUNT)`).
- A high-water-mark dot on the bar so users can see peak usage after Stop.
