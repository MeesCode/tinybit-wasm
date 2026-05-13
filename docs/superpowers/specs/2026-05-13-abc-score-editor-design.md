# ABC Score Editor — Design

**Date:** 2026-05-13
**Status:** Spec
**Related code:** `editor/src/`, `src/lib.rs`, `src/tinybit/audio.{c,h}` (read-only via submodule)

## Problem

TinyBit cartridges play music and SFX by passing ABC notation strings to two Lua-exposed functions:

```lua
music("L:1/4 K:C C D E F G A B c")    -- loops, SINE synth
sfx("c/4d/4e/4g/4")                    -- one-shot, SINE synth
```

Today users hand-write ABC as Lua string literals in their script. There is no syntax help, no sheet-music preview, no playback that doesn't require encoding a full cartridge. ABC is a steep enough notation that this gates non-musicians from writing game music, and frustrates musicians who can't see what they wrote.

## Goal

A new **Score** tab in the editor that gives users an ABC text editor with a live sheet-music preview and audio playback through the actual engine, bidirectionally linked to string literals in their Lua script via a `--@score` annotation. New scores are created by clicking a button that inserts a starter snippet at the script cursor.

## Non-goals

- A piano-roll / step-sequencer / MIDI-import UI. Users still write ABC text; the editor only adds syntax highlighting, rendered preview, and engine-truthful audition.
- A library of scores stored separately from the script. The Lua script is the single source of truth.
- Modifying the C engine or the ABC parser. Engine changes are confined to two thin Rust wrapper exports.
- Multi-browser-tab concurrent editing of the same sketch (out of scope; sketch persistence is per-localStorage today).
- Selecting waveform per score (engine hard-codes SINE for both channels). Could be added later behind the same surface.

## User-facing surface

### Score tab

A fourth tab (`Script` / `Sprite` / `Cartridge` / **`Score`**) in the left `EditorPane`. Split top/bottom:

```
┌─ Score tab ──────────────────────────────────┐
│ [chip: score_1] [chip: bass]    [+ New score]│
├──────────────────────────────────────────────┤
│   CodeMirror ABC editor                      │
│     L:1/4                                    │
│     K:C                                      │
│     C D E F | G A B c |                      │
│                                              │
├──────────────────────────────────────────────┤
│   abcjs SVG preview                          │
│   [▶ Play] [⏹ Stop]   <error band if any>    │
└──────────────────────────────────────────────┘
```

- Top chip bar lists every score discovered in the current script. Selecting a chip loads that score into the editor.
- `+ New score` inserts a starter snippet at the script cursor (see *Insertion snippet* below), switches to the Score tab, and selects the newly-inserted score.
- ABC editor is CodeMirror 6 with a `simpleMode` definition for ABC syntax.
- Preview is rendered by [abcjs](https://github.com/paulrosen/abcjs) (MIT, JS ABC renderer) into an SVG node beneath the editor. abcjs's own audio path is **not** used.
- Play button feeds the current ABC string through the engine via new wasm exports. Stop button clears the channel.

### Hover popup in the Script tab

When the cursor hovers any character inside a string literal that is bound to a `--@score` annotation, CodeMirror shows a tooltip:

> ✏️ Edit `score_1` in Score tab

Clicking the tooltip switches `activeTab` to `'score'` and selects that score in the Score tab.

### Annotation syntax

```lua
--@score
local tune = [[
L:1/4
K:C
C D E F | G A B c |
]]
music(tune)

--@score: jump_sfx
local jump = "c/4d/4e/4g/4"
sfx(jump)
```

Rules:

- `--@score` must occupy a line by itself (whitespace allowed). Optional name: `--@score: name` (one or more spaces after `:`).
- Within the next 3 non-blank lines after the annotation, the first non-whitespace token must be the opener of a Lua string literal: `[[...]]`, `[==[...]==]` (and deeper levels `[===[...]===]`, …), `"..."`, or `'...'`. Intervening tokens (e.g. `local foo =`) are allowed on the same line as the opener.
- An annotation with no following literal within that window emits a console warning and produces no link.
- Two annotations sharing a name disambiguate in the UI as `name`, `name (2)`, etc. (console warning on first detection).

### Insertion snippet (`+ New score`)

```
--@score
local score_1 = [[
L:1/4
K:C
C D E F |
]]

```

The auto-generated name is `score_<N>` where `<N>` is the lowest integer producing an unused name. Insertion is at the current script cursor; if the cursor is mid-line, the snippet is prefixed with a newline.

### Storage form

- New scores always emit `[[ ... ]]` long-bracket literals (multi-line friendly, no `\n` escaping).
- Existing `"..."` / `'...'` literals are recognized when reading. Writeback preserves the user's chosen form: `[[...]]` stays `[[...]]`, `"..."` stays `"..."` (with `\n`/`\\`/`\"` re-escaping).
- If the new content contains the user's chosen closing bracket (`]]`), `replaceScoreContent` escalates to the next bracket level (`[==[...]==]`, then `[===[...]===]`). Three levels of escalation are supported; deeper fails with a console error and the writeback is dropped.

## Architecture

### Module layout

```
editor/src/score/                       ← new
  scoreLinks.ts        pure findScores(script) → ScoreLink[]
  scoreLinks.test.ts
  scoreSync.ts         pure replaceScoreContent / insertNewScoreSnippet
  scoreSync.test.ts
  abcMode.ts           CodeMirror simpleMode for ABC
  abcMode.test.ts
  ScoreEditor.tsx      controlled CodeMirror ABC editor
  ScorePreview.tsx     abcjs SVG renderer
  ScorePreview.test.tsx
  ScoreTab.tsx         composes the above
  ScoreTab.test.tsx
  scoreHoverTooltip.ts CodeMirror extension for the script editor's hover popup
  scoreHoverTooltip.test.ts

editor/src/engine/preview.ts            ← new (TS wrapper)
editor/src/engine/runtime.ts            ← modified (probe + expose runtime.preview)
editor/src/editor/CodeEditor.tsx        ← modified (mount scoreHoverTooltip)
editor/src/ui/EditorPane.tsx            ← modified (+ 'score' tab)
editor/src/App.tsx                      ← modified (route Score tab, handle hover-tooltip-click)

src/lib.rs                              ← modified (new tb_preview_* exports)
src/bindings.rs                         ← modified (extern decl for audio_load_abc, ABC channel reset)
```

### Engine changes

The C engine is **not modified**. We add Rust-side wrappers in `src/lib.rs` that delegate to existing `audio_load_abc` (already declared in `src/tinybit/audio.h`; not yet declared on the Rust side). Add `extern "C"` decls in `src/bindings.rs` for `audio_load_abc` and the `WAVEFORM` / channel-index constants.

Stop semantics: the engine has no dedicated "clear channel" entry point — `tb_preview_stop` calls `audio_load_abc(channel, "", SINE, false)` to load an empty NotePool, which silences the channel on the next frame. Verified during implementation; see *Open questions* if the empty-string path turns out not to silence the channel.

**Staging buffer pattern**, mirroring `tb_feed_buffer_ptr` / `tb_feed_cartridge`:

```rust
const PREVIEW_BUF_CAP: usize = 32 * 1024;

struct PreviewState {
    buf: Vec<u8>, // PREVIEW_BUF_CAP
}

#[no_mangle] pub extern "C" fn tb_preview_ptr() -> *mut u8 { ... }
#[no_mangle] pub extern "C" fn tb_preview_cap() -> u32 { PREVIEW_BUF_CAP as u32 }

// Return codes:
//   0  = ok
//  -1  = engine parser rejected the ABC
//  -2  = engine note-pool exhausted
//  -3  = oversized input (len > PREVIEW_BUF_CAP)
//  -4  = non-UTF-8 / not NUL-terminatable

#[no_mangle] pub extern "C" fn tb_preview_music_play(len: u32) -> i32 {
    // 1. bounds-check len against PREVIEW_BUF_CAP → -3
    // 2. UTF-8 validate the buf[..len] slice → -4
    // 3. Append a trailing NUL (NUL is reserved in the buffer past the cap)
    // 4. Call audio_load_abc(CHANNEL_MUSIC, ptr, SINE, true).
    // 5. Map engine return: 0 → 0, <0 → that value.
}

#[no_mangle] pub extern "C" fn tb_preview_sfx_play(len: u32) -> i32 { /* same, repeat=false */ }

#[no_mangle] pub extern "C" fn tb_preview_stop() {
    // Load an empty (zero-length, NUL-only) ABC string into both channels to silence them.
    audio_load_abc(CHANNEL_MUSIC, EMPTY_C_STR.as_ptr(), SINE, false);
    audio_load_abc(CHANNEL_SFX,   EMPTY_C_STR.as_ptr(), SINE, false);
}
```

The audio worklet (`editor/src/engine/audioWorklet.ts`) is already running and pulls from `tb_audio_ptr` — preview rides the existing path.

`tb_preview_music_play` returns the underlying `audio_load_abc` return code so the UI can surface specific error codes. UTF-8 validation failure returns `-4`. Oversized input (`len > PREVIEW_BUF_CAP`) returns `-3` before touching the engine.

### TS wrapper

`editor/src/engine/preview.ts`:

```ts
export interface Preview {
    music(abc: string): void;  // throws PreviewError on engine code != 0
    sfx(abc: string): void;
    stop(): void;
}
export class PreviewError extends Error { constructor(public code: number, message: string) { super(message); } }
```

`runtime.ts` probes for `tb_preview_music_play` and exposes `runtime.preview: Preview | null` + `runtime.previewAvailable: boolean`, same pattern as `enc`/`encoderAvailable` and `dec`/`decoderAvailable` today.

### `scoreLinks` (the index)

```ts
export interface ScoreLink {
    id: string;             // stable across `findScores` calls when the link is conceptually the same
    name?: string;          // present if annotation was `--@score: name`
    annotationLine: number; // 1-based
    contentRange: { from: number; to: number }; // offsets into the script, EXCLUDING the bracket/quote characters
    openerRange:  { from: number; to: number }; // offsets of the opening `[[`, `[==[`, `"`, or `'`
    closerRange:  { from: number; to: number }; // offsets of the closing token
    form: { kind: 'long', level: number } | { kind: 'quoted', quote: '"' | "'" };
    content: string;        // decoded content (escapes resolved for quoted form)
}

export function findScores(script: string): { links: ScoreLink[]; diagnostics: Diagnostic[] };
```

**Implementation sketch**: a single forward scan over the script. State machine recognizes Lua line comments, block comments, string literals (for skipping — we must not treat `--@score` inside a string as an annotation), and `--@score[: name]` markers. When a marker is found, look ahead up to 3 lines (skipping blanks and whitespace) for a string-literal opener and consume the matching closer. Memoized at the call site (`useMemo(() => findScores(script), [script])`).

**ID stability**: `id = "name:" + name` if named; else `id = "anon:" + annotationLine`. The Score tab additionally remembers which link it adopted *when the user last selected a chip* (`adoptedLinkId` state). If the held link disappears from a fresh `findScores` result while the ABC editor is non-empty, the tab shows the "no longer linked" banner instead of silently swapping to a different link.

### `scoreSync` (the rewriter)

```ts
export function replaceScoreContent(
    script: string,
    link: ScoreLink,
    newContent: string,
): { script: string } | { error: 'link-stale' | 'bracket-escalation-exhausted' };

export function insertNewScoreSnippet(
    script: string,
    cursor: number,
): { script: string; newLink: ScoreLink; cursor: number };
```

`replaceScoreContent` re-runs `findScores` on the input to verify the link still exists at the stored offsets; if not, returns `{ error: 'link-stale' }`. Otherwise it splices in the new content, escalating brackets if needed, and returns the new script.

### Data flow

1. **Script → ScoreTab**: `ScoreTab` subscribes to `sketchStore.script`, runs `useMemo(() => findScores(script), [script])`, derives `links`. The chip bar renders one chip per link. Mounting a chip sets `selectedLinkId`; the `ScoreEditor` mounts with `link.content`.
2. **Typing in ScoreEditor**: held in `ScoreEditor` local state for low-latency display. After 300 ms of idle, `scoreSync.replaceScoreContent(script, link, value)` is called and `sketchStore.setScript` commits.
3. **Preview**: `ScorePreview` re-renders the abcjs SVG on every value change (cheap; abcjs is debounced internally). Play/Stop call `runtime.preview.music(value)` / `.stop()`.
4. **Script-tab hover**: `scoreHoverTooltip` is a CodeMirror 6 extension that owns its own copy of `findScores` results (kept in sync via a dispatched effect on each `value` change). On hover within a `contentRange`, it shows the tooltip; on click of the tooltip's button, it calls a callback wired in `App.tsx` that switches the tab.

### Error handling

| Scenario | Behavior |
|---|---|
| `--@score` with no literal within 3 lines | No link emitted; console warning with line number. |
| `--@score: ` (empty name) | Treated as unnamed; no warning. |
| Duplicate names | All links kept; disambiguated in UI; first detection warns. |
| Unclosed `[[ ... ` literal | No link emitted; Lua VM will error on play. We don't gate. |
| abcjs throws on render | Red inline error band beneath the editor. Play still works. |
| `tb_preview_*_play` returns `< 0` | UI shows `Engine rejected score: <message> (<code>)`. Code mapping: -1 invalid syntax, -2 pool exhausted, -3 oversized, -4 non-UTF-8. |
| Preview exports missing (older WASM build) | `runtime.preview` is `null`; Play button disabled with tooltip *"Preview requires rebuilding the WASM"*. |
| Link stale at writeback (annotation removed externally) | Drop writeback; console warn; Score tab shows banner *"This score is no longer linked. [Re-insert] [Discard]"*. |
| Bracket escalation exceeded (>3 levels) | Writeback fails; console error; ABC editor retains in-flight buffer; user can copy out. |
| Content contains invalid UTF-8 (shouldn't happen via typing, but defensive) | `tb_preview_*_play` returns -4; UI shows error. |

## Testing

### Unit (Vitest, jsdom)

- `scoreLinks.test.ts` — annotation detection (named, unnamed, with `--@score: name` spacing variants), bracket-level detection, quoted-literal detection with escape handling, no-literal-within-3-lines, duplicate names, annotations inside strings ignored.
- `scoreSync.test.ts` — preserves form, escalates brackets when content contains `]]`, returns `link-stale` when annotation gone, `insertNewScoreSnippet` inserts at cursor and returns a valid `ScoreLink`.
- `abcMode.test.ts` — at least one happy-path tokenization test (simpleMode regexes drift easily).
- `ScoreTab.test.tsx` — empty state + `+ New score`; chip switching; debounced writeback (advance timers); link-stale banner.
- `ScorePreview.test.tsx` — renders SVG for valid ABC; renders error band when abcjs throws (mocked).
- `scoreHoverTooltip.test.ts` — hover within linked range shows tooltip, hover outside does not, click invokes callback.

### End-to-end (Playwright)

- `editor/tests/e2e/score.spec.ts` — boot, switch to Score tab, `+ New score` inserts snippet, type in ABC editor → Script tab reflects change, click Play → engine state `running`, click Stop → engine state `idle`. Does not assert audio output.

### Engine smoke

- `scripts/smoke_preview.mjs` — boot wasm in Node, init, push a short ABC string through `tb_preview_sfx_play`, advance 60 frames, assert `tb_audio_ptr` produces non-zero samples within a window. Mirrors `scripts/smoke.mjs`.

### Excluded

- abcjs output correctness (their concern).
- Audio pitch/timbre (engine's concern; upstream TinyBit-lib tests).

## Open questions

**Q1. Does `audio_load_abc(channel, "", SINE, false)` reliably silence the channel?**
The engine has no documented clear-channel entry point. Empirically the parser produces an empty NotePool from empty input and the audio worklet should stop emitting samples on that channel within a frame or two. To verify during implementation: write a one-line test that loads a tone, then loads empty, and asserts the audio buffer goes to zero within N frames. If it doesn't, fall back to either (a) loading a `z1` rest (an explicit silent note) or (b) tracking the issue upstream in TinyBit-lib and exposing a real `audio_clear(channel)` in the C engine — the latter is a separate spec, not in scope here.

**Q2. abcjs bundle weight.**
abcjs is ~250 KB gzipped. We lazy-import it in `ScorePreview.tsx` so the script-only path is not impacted, but it's worth measuring after wiring. If the lazy chunk size is unacceptable, consider `abcjs/src/api/render-abc.js` (the standalone renderer entry point) without the synth/midi modules.

## Out-of-scope follow-ups (not in this spec)

- Per-score waveform selection (SQUARE / SAW / TRIANGLE / NOISE) once the engine exposes a waveform-by-channel API.
- A piano-roll authoring surface that emits ABC.
- MIDI / `.abc`-file import.
- Sharing scores between cartridges (a score library).
