# TinyBit editor UI

**Date:** 2026-05-11
**Branch:** `feat/editor-ui`
**Scope:** Add a single-sketch, in-browser authoring environment ("the editor") for TinyBit cartridges, on top of the existing `tinybit_wasm` player and the in-flight `tb-encoder` exports. p5.js-web-editor-inspired feel: write Lua on the left, watch the canvas on the right, console at the bottom, hit Play.

## Motivation

The existing `web/` is a single-screen `<input type="file">` that uploads a finished `.tb.png` and plays it. Cartridge authoring still requires the native `TinyBit -c` wrapper. Once `feat/tb-encoder` lands, both halves of the toolchain — encode and decode — live inside the same WASM artifact. The remaining gap is a UI that lets a user:

1. Write a Lua script with a real editor (syntax highlighting, multicursor, line numbers).
2. Attach a 128×128 PNG spritesheet (and optional cover / title / author).
3. Press one button to encode the cartridge and play it in the browser.
4. Press another button to download the encoded `.tb.png`.
5. Keep their work between sessions without an account.

Closing that loop turns `tinybit_wasm` from a "play a cartridge someone else made" demo into a self-contained authoring environment.

## Non-goals (call them out so they aren't surprises)

- **No multi-sketch workspace, no sketch list, no cloud save, no accounts.** Single sketch in localStorage. A future spec can layer that on without rearchitecting.
- **No URL sharing, no examples gallery.**
- **No in-editor sprite paint tool.** Authors prep the PNG offline.
- **No `.tb.png` drag-drop into the *editor source*.** Drag-drop is a "play this cartridge" path — the engine has no script/sprite extractor exposed today. Surfaced as a console line.
- **No mobile / touch / on-screen gamepad.**
- **No auto-rebuild of the WASM on Rust changes.** `scripts/build.sh` stays a manual step.
- **The "Alternative editor" tab is a placeholder.** Its real content is a separate, future spec.

## Decisions

| | |
|---|---|
| Framework | **Vite + React 18 + TypeScript**, static SPA. No SSR; no API routes; pure client-side WASM. Deploys to any static host. |
| Code editor | **CodeMirror 6** with `@codemirror/legacy-modes/lua`. Default keymap gives Ctrl-click multicursor and line numbers. Light theme tuned to match the bubblegum palette. |
| State | **Zustand** — two stores: `sketchStore` (cartridge content, persisted) and `consoleStore` (ephemeral log). |
| Layout | Top toolbar; below it a horizontal split: editor pane on the left (with three tabs: Script / Alt / Cartridge), and a vertical split on the right (canvas on top, console below). All dividers drag-resize via `react-resizable-panels`. |
| Visual style | "Bubblegum": `#fafafa` background, `#ED225D` accent, Inter for UI, JetBrains Mono for code. Single accent colour; rounded corners; generous spacing. |
| WASM | Reuse the *existing* `web/tinybit_wasm.wasm` artifact. Build script copies it into `editor/public/` so Vite serves it as a plain static asset (no `vite-plugin-wasm`, no bundling). |
| Player & encoder | Wrapped in `editor/src/engine/{tinybit,encoder}.ts`. The encoder ABI is the `tb_enc_*` surface from `feat/tb-encoder`; this spec hard-depends on that branch landing first. |
| Persistence | One `localStorage` key for the sketch (script + sprite + cover + title + author), one for UI layout (split ratios). Write-debounced 500 ms. |
| Console source | The WASI shim's `fd_write` (currently logs to `console.error`/`console.log`) is rewired to a sink callback that the editor uses to append to the console pane. Default sink stays `console.*` so smoke tests are unaffected. |
| Existing `web/` | **Deleted.** The editor's Play button is a strict superset; keeping `web/` as well is dead weight. |
| Testing | Vitest for unit + component; Playwright for one end-to-end smoke. Node-side `scripts/smoke.mjs` is **unchanged** — it loads the WASM directly from `target/` and is independent of the editor. |

## Architecture

```
tinybit_wasm/
├── Cargo.toml, build.rs, rust-toolchain.toml, .cargo/   # unchanged
├── src/                                                 # unchanged Rust + C engine
├── editor/                                              # NEW: Vite + React + TS app
│   ├── package.json
│   ├── vite.config.ts                # base: './', no extra plugins
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   │   └── tinybit_wasm.wasm         # copied by scripts/build.sh
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── theme.css                 # design tokens
│       ├── ui/
│       │   ├── Toolbar.tsx, PlayButton.tsx, DownloadButton.tsx
│       │   ├── EditorPane.tsx        # tabs: Script | Alt | Cartridge
│       │   ├── CanvasPane.tsx
│       │   ├── ConsolePane.tsx
│       │   ├── CartridgeTab.tsx
│       │   ├── AltEditorTab.tsx
│       │   └── PanelSplitter.tsx
│       ├── editor/
│       │   ├── CodeEditor.tsx        # CodeMirror 6 + Lua + bubblegum theme
│       │   └── luaSupport.ts
│       ├── engine/
│       │   ├── runtime.ts            # singleton WASM boot
│       │   ├── tinybit.ts            # typed wrapper over tb_*
│       │   ├── encoder.ts            # typed wrapper over tb_enc_*
│       │   ├── wasiShim.ts           # ported, sink-driven
│       │   ├── audioWorklet.ts       # ported as-is
│       │   ├── frameLoop.ts          # tick/blit/audio-pump + tiny event emitter
│       │   └── placeholders.ts       # bundled 128×128 cover + sprite (base64)
│       ├── state/
│       │   ├── sketchStore.ts
│       │   ├── consoleStore.ts
│       │   └── persist.ts
│       └── lib/                      # crc, png-size sniff, file-pick helpers
├── scripts/
│   ├── build.sh                      # builds wasm THEN copies into editor/public/
│   ├── dev.sh                        # builds wasm, then `npm --prefix editor run dev`
│   └── smoke.mjs                     # unchanged
└── docs/superpowers/specs/2026-05-11-editor-ui-design.md   # this file
```

`web/` (the existing minimal page) is removed in the same change.

## UI components & contracts

```
<App>
  ├─ <Toolbar>                brand · ▶ Play · ■ Stop · ⬇ Download · status pill
  ├─ <PanelSplitter direction="horizontal">
  │    ├─ <EditorPane>        tabs strip + active tab body
  │    │    ├─ <CodeEditor>        // script tab
  │    │    ├─ <AltEditorTab>      // placeholder
  │    │    └─ <CartridgeTab>      // metadata + sprite/cover slots
  │    └─ <PanelSplitter direction="vertical">
  │         ├─ <CanvasPane>
  │         └─ <ConsolePane>
```

| Component | Reads | Writes | Notes |
|---|---|---|---|
| `Toolbar` | engine state (`idle`/`running`/`error`), `sketch.script` (for the disabled-when-empty rule) | `play()` / `stop()` / `download()` | Play is pink-filled when idle, ring-outlined while running; disabled when script is empty. Status pill on the right ("Idle", "Running", "Crashed — click to reset"). |
| `EditorPane` | `ui.activeTab` | `ui.activeTab` | Pure tab switcher. No engine knowledge. |
| `CodeEditor` | `sketch.script` | `sketch.script` (every CM6 onChange, no debounce here) | One CM6 instance, mounted once. Theme & extensions assembled at construction; re-mounted only when theme tokens change (test-only path). Debouncing happens in `state/persist.ts` — the React store is always live. |
| `CartridgeTab` | `sketch.{title,author,cover,sprite}` | same setters | Cover & sprite slots accept drag-drop and click-to-pick. Both validate as 128×128 PNG client-side; size + filename echoed back; thumb shown. |
| `AltEditorTab` | — | — | Centered placeholder `<div>Alternative editor — coming soon</div>`. |
| `CanvasPane` | imperative subscription to `frameLoop` | — | Wraps a `<canvas width=128 height=128 style="image-rendering: pixelated">` in a square aspect-ratio container scaled to its parent. Subscribes on mount, unsubscribes on unmount. |
| `ConsolePane` | `consoleStore.{lines,filters}` | `consoleStore.clear()` / `setFilter()` | Auto-scrolls when scrolled to bottom; freezes when the user scrolls up. Filter chips: `log` / `warn` / `error` / `engine`. Resize handle on the top edge (managed by the parent `PanelSplitter`). |

### Play button semantics

1. Read sketch from `sketchStore`: `script` (UTF-8 string), `sprite` (Uint8Array | null), `cover` (Uint8Array | null), `title`, `author`.
2. If `sprite` or `cover` is null, substitute the bundled placeholder PNG from `engine/placeholders.ts`.
3. `encoder.encode({...})` → `Uint8Array` cartridge bytes. On `EncodeError`, append to console (`source: 'error'`), return to idle.
4. `tinybit.init()` → for each 256-byte chunk: write to `tb_feed_buffer_ptr()`-pointed staging buffer, call `tb_feed_cartridge(len)`. Bail on first `0` return with a console error.
5. `tinybit.start()` → start `frameLoop` (rAF). Toolbar state becomes `running`.

### Stop button semantics

`tinybit.stop()` + cancel rAF + drain audio worklet. Toolbar state returns to `idle`. `tb_init` happens fresh on the next Play.

### Download button semantics

Same as steps 1–3 of Play, then trigger a Blob download of the returned bytes. Filename: `<sanitised-title || 'cartridge'>.tb.png`. Sanitiser: `[A-Za-z0-9._-]`, other chars → `_`.

## WASM integration & data flow

```
            React tree (renders from store snapshots)
              │  reads / subscribes        ▲
              ▼                             │ set actions
        ┌─────────────────────┐
        │ sketchStore         │ ◀── localStorage adapter (debounced)
        │ consoleStore        │
        └────────┬────────────┘
                 │ append(line)
                 │
        ┌────────┴───────────────────────────┐
        │ engine/runtime.ts (singleton boot) │
        └─┬──────────────────┬───────────────┘
          ▼                  ▼
      tinybit.ts          encoder.ts
      tb_init/start/      tb_enc_*
      loop_once/stop/
      set_button
          │
          ▼ display/audio ptrs
      frameLoop.ts ─► canvas blit + AudioWorkletNode

  wasiShim.fd_write(stderr) ─► consoleStore.append('engine', line)
```

**`engine/runtime.ts`** — instantiates the WASM module exactly once, exposes:

```ts
export async function getRuntime(): Promise<{
    wasm: WebAssembly.Instance;
    memory: WebAssembly.Memory;
    tb: TinybitExports;        // typed view of tb_*
    enc: EncoderExports;       // typed view of tb_enc_*
}>;
```

A top-level `useEffect` in `App` awaits `getRuntime()` and gates the UI on it (boot splash until ready; full-bleed error if it rejects).

**`engine/wasiShim.ts`** — ports `web/wasi-shim.js`. New shape:

```ts
export interface WasiSinks { stdout(line: string): void; stderr(line: string): void; }
export function makeWasiShim(memoryRef, sinks: WasiSinks): WebAssembly.ModuleImports;
```

Default sinks for unit tests = `() => {}`. In the app, both are wired to `consoleStore.append('engine', line)`. Existing line-buffering behaviour (`flushLines`) is preserved.

**`engine/encoder.ts`** — wraps the `tb_enc_*` ABI:

```ts
export interface EncodeInput {
    script:   Uint8Array;        // UTF-8
    sprite:   Uint8Array;        // 128×128 PNG bytes
    cover:    Uint8Array;        // 128×128 PNG bytes
    title?:   string;            // ≤ 63 UTF-8 bytes; default 'untitled'
    author?:  string;            // ≤ 63 UTF-8 bytes; default ''
    gameVersion?:  number;       // u16; default 1
    flags?:        number;       // u16; default 0
    packageDate?:  number;       // unix seconds; default Date.now()/1000
    frameOverride?: Uint8Array;  // 256×256 PNG; default = bundled frame
}
export class EncodeError extends Error { code: number; }
export function encode(input: EncodeInput): Uint8Array;   // throws EncodeError on tb_enc_run < 0
```

Staging mirrors the encoder spec slot enum (`COVER=0, SPRITE=1, SCRIPT=2, FRAME=3, TITLE=4, AUTHOR=5`). Result bytes are `.slice()`-copied so they survive any subsequent `memory.grow`.

**`engine/tinybit.ts`** — wraps the player ABI:

```ts
export interface Tinybit {
    init(): void;
    feedCartridge(bytes: Uint8Array): void;     // throws on a 0 return
    start(): void;                              // throws on a 0 return
    stop(): void;
    setButton(idx: number, pressed: boolean): void;
    displayView(): Uint16Array;                 // recreated each call
    audioView(): Int16Array;                    // recreated each call
}
```

Button indices match `web/index.js` (`A=0, B=1, UP=2, DOWN=3, LEFT=4, RIGHT=5, ENTER=6, BACKSPACE=7`). Keyboard listeners live in `App` (attached on mount, removed on unmount), call `setButton`. Same `PREVENT_DEFAULT_KEYS` set.

**`engine/frameLoop.ts`** — owns the rAF loop, owns the `AudioContext` + `AudioWorkletNode`:

```ts
export interface FrameLoop {
    start(canvas: HTMLCanvasElement): void;
    stop(): void;
    onStateChange(cb: (state: 'idle'|'running'|'error') => void): () => void;
    state(): 'idle'|'running'|'error';
}
```

Per tick: `tb.tb_loop_once()` (try/catch → on throw, transition to `'error'`, append to console, stop), then blit (existing 5-6-5-ish display unpack from `web/index.js`), then post audio buffer to the worklet.

## State & persistence

```ts
// state/sketchStore.ts
interface SketchState {
    script: string;
    sprite: Uint8Array | null;
    cover:  Uint8Array | null;
    title:  string;
    author: string;
    setScript(v: string): void;     // debounced persist via middleware
    setSprite(v: Uint8Array | null): void;
    setCover(v: Uint8Array | null): void;
    setTitle(v: string): void;
    setAuthor(v: string): void;
    reset(): void;
}

// state/consoleStore.ts
interface ConsoleState {
    lines: { id: number; source: 'log'|'warn'|'error'|'engine'; text: string; ts: number }[];
    filters: Set<'log'|'warn'|'error'|'engine'>;
    nextId: number;
    append(source, text): void;     // ring-buffer cap = 1000
    clear(): void;
    setFilter(source, on: boolean): void;
}
```

**Persistence** (`state/persist.ts`):

- Key `tinybit-editor/sketch/v1`. JSON body:
  ```json
  { "script": "...", "title": "...", "author": "...",
    "sprite_b64": "iVBORw0KGgo...", "cover_b64": "iVBORw0KGgo..." }
  ```
  Sprite and cover are base64-encoded so the whole record is one string. Typical size: ≤ 32 KB total (well under the per-origin 5 MB cap).
- Write debounced 500 ms after the last mutation.
- Read on app boot; on JSON parse failure or unknown version, log a console warning and start with defaults.
- Schema version baked into the key (`v1`) so future breaking changes don't silently corrupt user data.
- UI layout (split ratios, console height) persists in a separate key `tinybit-editor/ui/v1`. Decoupled so a "Reset layout" button never wipes the sketch.

**Default sketch on first boot:**
```lua
function _draw()
    cls(0x0000)
    spr(0, 60, 60)
end
```
Minimal but non-empty so the canvas isn't black on first Play.

## Error handling

| Boundary | Detected by | Surfaced as |
|---|---|---|
| WASM module load | `instantiateStreaming` rejection | Full-bleed boot-error screen with reload button; also `consoleStore.append('error', ...)`. |
| Sprite/cover upload size mismatch | Client-side `decodeImageSize(bytes)`; reject if not 128×128 | Inline error under the file slot in `CartridgeTab`; sketch state unchanged. |
| Encode failure | `tb_enc_run < 0` → `EncodeError` from `encoder.encode` | `consoleStore.append('error', msg)`; toolbar returns to `idle`. |
| Feed failure | `tb_feed_cartridge == 0` | `consoleStore.append('error', \`Cartridge rejected at offset ${i}\`)`; idle. |
| Start failure | `tb_start == 0` | `consoleStore.append('error', 'Engine failed to start')`; idle. |
| Lua runtime errors | Engine's `log_cb` writes to fd 2 → WASI sink | `consoleStore.append('engine', line)`. |
| Unhandled WASM trap in `tb_loop_once` | try/catch in the rAF tick | Stop loop; `consoleStore.append('error', ...)`; toolbar pill becomes red "Crashed — click to reset", click → `init()` + return to idle. |
| Unimplemented WASI fn | Existing `Proxy` warn path | `consoleStore.append('warn', \`unimplemented WASI fn: ${name}\`)`. |
| localStorage parse error / quota | Adapter try/catch around `JSON.parse` and `setItem` | `consoleStore.append('warn', 'Could not persist sketch: <reason>')`; in-memory state untouched. |

**The console pane is the single user-visible sink.** No `alert()`, no toast library — the chrome stays quiet.

## Testing

- **Unit (Vitest, jsdom)** — `state/*` mutations, `state/persist` round-trip with a stubbed `localStorage`, `engine/encoder` argument staging with a mocked `tb_enc_*` surface, `engine/wasiShim` sink wiring (write to fd 1 and fd 2, assert sinks see exact bytes), `engine/tinybit.feedCartridge` chunking. Target ~80 % on `engine/*` and `state/*`.
- **Component (Vitest + @testing-library/react)** — tab switching, cartridge tab file slots accept a 128×128 fixture PNG and reject a 64×64 one, console filter chips toggle line visibility, toolbar Play is disabled when script is empty.
- **E2E smoke (Playwright)** — one test. Boots the dev server, programmatically types a known-good Lua snippet (`function _draw() pset(10,10,0xFFFF) end`), drops fixture sprite + cover PNGs onto the slots, clicks Play, waits ~3 rAF ticks, reads canvas pixel (10,10) via `ctx.getImageData`, asserts non-zero.
- **`scripts/smoke.mjs` unchanged.** Belt + braces — exercises the WASM independent of the editor.

Coverage gates aren't enforced in CI for this PR; we treat the smoke + handful of component tests as the floor and let the unit tests pile up naturally.

## Build & deploy

- **`scripts/build.sh`** — existing Rust/wasi-sdk build emits `target/wasm32-wasip1/release/tinybit_wasm.wasm`. New trailing step: `cp` to `editor/public/tinybit_wasm.wasm`. The smoke test continues to load from `target/...`.
- **`scripts/dev.sh`** — runs `scripts/build.sh` once, then `npm --prefix editor run dev`. Vite HMR picks up TS/CSS changes; WASM reloads require re-running `scripts/build.sh` (out of scope: a watcher).
- **`editor/package.json` scripts** — `dev`, `build` (`vite build`), `preview`, `lint` (eslint), `test` (vitest), `test:e2e` (playwright).
- **Static output** — `editor/dist/` is fully static; host on anything (GitHub Pages, Netlify, S3, a folder served by `python3 -m http.server`).
- **Vite config** — `base: './'` so the build is host-path-agnostic; no special WASM handling needed (the file is in `public/` and referenced by relative URL from runtime code).

## Out of scope (recap, for the planning step)

- Multi-sketch workspace, sketch list, cloud save, accounts.
- URL sharing, examples gallery, social features.
- In-editor sprite paint tool.
- Cartridge → editor source extraction on drag-drop.
- Mobile / touch / on-screen gamepad.
- Auto-rebuild of WASM on Rust source changes.
- Real content for the Alternative editor tab.
- Theme switching (light/dark toggle). One palette ships in v1.
- i18n.

## Dependency on `feat/tb-encoder`

This spec assumes the encoder branch lands first (or merges into the same train). The editor's Play and Download paths both go through `tb_enc_run`. If `feat/tb-encoder` slips, the editor can still ship with Play wired only to a "drop a `.tb.png`" fallback — but that's a degraded mode and not the primary v1 experience.
