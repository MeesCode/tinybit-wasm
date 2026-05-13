# Info Modals — Design

**Date:** 2026-05-14
**Status:** Spec
**Related code:** `editor/src/info/` (new), `editor/src/App.tsx`, `editor/src/score/ScoreTab.tsx`, `editor/src/ui/UploadConfirm.tsx` (visual reference)

## Problem

The editor exposes a sizable Lua API (~35 functions plus constants), an engine hook (`_draw`, called by the engine every frame), and a new editor-only annotation (`--@score[: name]`). It also expects users to write ABC music notation in the Score tab. None of this is discoverable from inside the editor — a newcomer has to read the upstream TinyBit README, the abcjs docs, and our own commit history to figure out what's available.

Add two information modals that sit one click away from the surface they document.

## Goal

A small in-editor reference system: a `?` button on each of the Script and Score tabs opens a modal whose content is curated for that tab. Modals are read-only, grouped, and scrollable. The ABC modal embeds rendered sheet music for its examples so users can see the notation render correctly before they try it themselves.

## Non-goals

- Full Lua language documentation (users can look that up externally).
- Live-editable playgrounds inside the modal (out of scope; the Score tab itself is the playground).
- A global help system / shortcut index (no Cmd+? overlay).
- Inline hover docs on individual API tokens (separate possible future feature; not what was asked for).
- Animations or transitions on modal show/hide (instant).

## User-facing surface

### Script tab

The script CodeEditor gets a `?` floating button overlaid in its top-right corner. Clicking opens `<ScriptApiModal>`. Closing returns the user to the script editor with no state change.

```
┌──────── Script tab body ───────────────────────────────────┐
│   ┌────────────────────────────────────────┐               │
│   │ CodeEditor (CodeMirror)            [?] │← top-right    │
│   │                                        │  overlay btn  │
│   └────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────┘
```

### Score tab

The chip bar at the top of the Score tab gains a `?` button at its right edge, immediately after `+ New score`. Clicking opens `<AbcInfoModal>`.

```
┌──────── Score tab body ────────────────────────────────────┐
│ [chip: melody] [chip: bass] [+ New score] [?]              │
│ ABC editor                                                 │
│ ...                                                        │
└────────────────────────────────────────────────────────────┘
```

### Modal shell

A centered dialog with a backdrop. Header has the title (`Script API` / `ABC Notation`) and a `✕` close button. Body is the only scrolling region. Width clamps around 720 px; max-height is 80% of viewport. Closes on:

- `✕` click,
- backdrop click,
- `Escape` key.

Visual style mirrors `UploadConfirm.tsx`: same overlay backdrop tint, same pill-shaped dialog with subtle shadow. Differences: bigger body (this is a reference, not a confirm), header strip with close button, no action buttons in a footer.

### Script API modal content

Grouped sections, in fixed order:

1. **Hooks** — `_draw` (signature + description + tiny code example). The engine calls this Lua-defined function once per frame.
2. **Annotations** — `--@score[: name]` (the editor-only annotation we just added; example shows a full `[[...]]` block bound to `music(...)`).
3. **Drawing** — `cls`, `sprite`, `line`, `rect`, `oval`, `pset`, `pget`, `text`, `cursor`, `print`, `poly_add`, `poly_clear`, `draw_polygon`, `duplicate`, `stroke`, `fill`.
4. **Color** — `rgb`, `rgba`, `hsb`, `hsba`.
5. **Audio** — `music`, `sfx`, `sfx_active`, `bpm`.
6. **Input** — `btn`, `btnp` (signatures + each button constant `A`/`B`/`UP`/`DOWN`/`LEFT`/`RIGHT`/`START`/`SELECT`).
7. **Misc** — `random`, `millis`, `sleep`, `peek`, `poke`, `log`.
8. **Constants** — `TB_SCREEN_WIDTH`, `TB_SCREEN_HEIGHT`, `SINE`, `SAW`, `SQUARE`, `NOISE`.

Each entry shows:
- Name (monospace bold).
- Signature (monospace, with parameter list and types where unambiguous).
- One-line plain-English description.
- Optional 1–3-line code example for the entries where it materially helps.

No search box. ~40 entries with section headings is short enough that scanning works, and the browser's Ctrl+F covers power users.

### ABC modal content

Grouped sections:

1. **Headers** — `X:`, `T:`, `M:`, `L:`, `Q:`, `K:`, `V:`. One snippet showing a typical header block, rendered inline.
2. **Notes and accidentals** — pitch letters (`C`-`B` octave 4, `c`-`b` octave 5), octave marks `,` / `'`, accidentals `^` (sharp), `_` (flat), `=` (natural). One rendered snippet.
3. **Durations** — `L:1/8` default; `C2` doubles, `C/2` halves, `C3/4` etc. Rendered snippet.
4. **Rests** — `z` and `z2`. Rendered snippet.
5. **Bars and repeats** — `|`, `||`, `|]`, `|:`, `:|`, numbered endings. Rendered snippet.
6. **Chords** — `[CEG]`. Rendered snippet.
7. **Tuplets** — `(3CDE`. Rendered snippet.
8. **Voices** — `V:MELODY` / `V:BASS`. Rendered snippet showing two voices.
9. **Engine limits** — text-only section noting `MUSIC_MAX_NOTES = 400` per voice, `MAX_VOICES = 3`, `SFX_MAX_NOTES = 10`, sample rate 22 kHz, SINE waveform only. No example.

Each example renders via a slimmed-down `<MiniScore>` component (see Architecture). Fixed staff width (~320 px), no resize observer, no scroll host — these are tiny 1–4 bar fixtures.

## Architecture

### Module layout

```
editor/src/info/                          ← new
  InfoModal.tsx          generic dialog shell (open / title / onClose / children)
  InfoModal.test.tsx
  HelpButton.tsx         small `?` button (props: onClick, style override)
  HelpButton.test.tsx
  MiniScore.tsx          trimmed score renderer for inline ABC examples
  MiniScore.test.tsx
  ScriptApiModal.tsx     renders <InfoModal> with grouped API sections
  ScriptApiModal.test.tsx
  AbcInfoModal.tsx       renders <InfoModal> with grouped ABC sections
  AbcInfoModal.test.tsx
  scriptApi.ts           pure data: SCRIPT_API_SECTIONS
  scriptApi.test.ts
  abcInfo.ts             pure data: ABC_SECTIONS
  abcInfo.test.ts
```

Touched:

| Path | Reason |
|---|---|
| `editor/src/App.tsx` | Render the script-tab `?` button + `<ScriptApiModal>` when `activeTab === 'script'`. Script-tab body becomes a positioning context for the corner-overlay button. |
| `editor/src/score/ScoreTab.tsx` | Add `<HelpButton>` to the right edge of the chip bar (after `+ New score`); render `<AbcInfoModal>` conditionally. |

### Component contracts

**`InfoModal`** — visual shell:
```ts
interface InfoModalProps {
    open: boolean;
    title: string;
    onClose(): void;
    children: ReactNode;
}
```
When `open=false`, returns `null`. When `open=true`, renders an `<div role="dialog" aria-modal="true" aria-label={title}>` backdrop + centered panel. Body is the children container with `overflow: auto` and `maxHeight` set such that the whole dialog fits within 80% of viewport. `Escape` handler attaches on mount, detaches on unmount. Backdrop click handler dismisses only when the click target *is* the backdrop (not bubbling from children).

**`HelpButton`** — pure presentation:
```ts
interface HelpButtonProps {
    onClick(): void;
    style?: CSSProperties;
    'aria-label'?: string;
}
```
Round 22 px button with `?` glyph, pink theme (`#ED225D` border, white background). Default style is inline; consumers can pass `style` to override positioning (script tab uses `position: absolute; top: 8px; right: 8px`).

**`MiniScore`** — inline ABC renderer:
```ts
interface MiniScoreProps {
    abc: string;
}
```
Lazy-imports abcjs (reusing the same dynamic import as `ScorePreview`; Vite dedupes the chunk). Renders into an inner div with `staffwidth: 320` and `scale: 0.9`. On abcjs throw, renders a red inline error band. No ResizeObserver, no scroll host. The outer wrap is `display: block; margin: 6px 0` — modal body provides the scrolling.

**`ScriptApiModal`** / **`AbcInfoModal`** — thin compositors:
```ts
interface InfoModalContentProps {
    open: boolean;
    onClose(): void;
}
```
Each maps over the corresponding data file and renders sections. Section heading style: small caps, gray, with a thin underline. Entry style: name (bold), signature (monospace, gray), description below.

### Data shape

```ts
// scriptApi.ts
export interface ApiEntry {
    name: string;
    signature: string;
    description: string;
    example?: string;
}
export interface ApiSection {
    title: string;
    items: ApiEntry[];
}
export const SCRIPT_API_SECTIONS: ApiSection[] = [/* see content section above */];

// abcInfo.ts
export interface AbcEntry {
    text: string;      // prose paragraph
    abc?: string;      // optional ABC snippet rendered via MiniScore
}
export interface AbcSection {
    title: string;
    body: AbcEntry[];
}
export const ABC_SECTIONS: AbcSection[] = [/* see content section above */];
```

Both files are pure constants. No imports beyond their type definitions. Easy to update when the engine API drifts.

### Source of truth for the API list

The Lua API surface is defined in `src/tinybit/lua_functions.c` (`lua_setglobal` calls) plus our editor-side `--@score` annotation. The `scriptApi.ts` file is hand-curated to match. We deliberately do NOT auto-extract from C source — too brittle, and descriptions need human writing anyway. When the engine adds or renames a function upstream, updating `scriptApi.ts` is a separate intentional change.

### Wiring

**Script tab** (in `App.tsx`):
```tsx
const [scriptHelpOpen, setScriptHelpOpen] = useState(false);

{activeTab === 'script' && (
    <div style={{ position: 'relative', height: '100%' }}>
        <CodeEditor value={sketch.script} onChange={sketch.setScript} extraExtensions={[scoreHoverExtension]} />
        <HelpButton style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => setScriptHelpOpen(true)} aria-label="Script API help" />
    </div>
)}
<ScriptApiModal open={scriptHelpOpen} onClose={() => setScriptHelpOpen(false)} />
```

The modal renders at the App level (outside the EditorPane), so it overlays everything when open.

**Score tab** (in `ScoreTab.tsx`):
```tsx
const [helpOpen, setHelpOpen] = useState(false);
// ...
<div style={chipBar}>
    {/* chips */}
    <button type="button" style={newScoreBtn} onClick={handleNewScore}>+ New score</button>
    <HelpButton style={{ marginLeft: 4 }} onClick={() => setHelpOpen(true)} aria-label="ABC notation help" />
</div>
// ...
<AbcInfoModal open={helpOpen} onClose={() => setHelpOpen(false)} />
```

## Error handling

| Scenario | Behavior |
|---|---|
| abcjs fails to load in `MiniScore` (network, blocked, etc.) | Each example shows an inline red band with the error message; modal body remains usable. |
| Backdrop click while editing focus is elsewhere | `Escape` and backdrop click both close. Focus returns to the trigger button via `aria-modal` + a small `useEffect` that calls `triggerRef.current?.focus()` on close. |
| Tab is switched while modal is open | Modal stays open (it's rendered at App level for the script case, inside ScoreTab for the score case; the score case's modal unmounts with the tab — acceptable since opening it is one click). |
| Both modals opened by stale state somehow | They render independently; nothing blows up. Each owns its own `open` state. |

## Testing

### Unit / component (Vitest + jsdom + Testing Library)

- **`InfoModal.test.tsx`** — renders/doesn't render based on `open`; ✕ click, backdrop click, and Escape each invoke `onClose`; body has `overflow: auto` style.
- **`HelpButton.test.tsx`** — click invokes `onClick`; respects `aria-label`.
- **`MiniScore.test.tsx`** — renders an SVG via mocked abcjs for valid ABC; renders an error band on abcjs throw; re-renders on `abc` prop change.
- **`ScriptApiModal.test.tsx`** — renders all section titles from `SCRIPT_API_SECTIONS`; contains an entry for `--@score` and an entry for `_draw` (regression guards); ✕ click invokes `onClose`.
- **`AbcInfoModal.test.tsx`** — renders all section titles from `ABC_SECTIONS`; renders a `MiniScore` per entry with an `abc` field (assert via mocked abcjs producing a known test-id SVG); ✕ click invokes `onClose`.
- **`scriptApi.test.ts`** — every section non-empty; every entry has `name`, `signature`, `description`; no duplicate names within any section.
- **`abcInfo.test.ts`** — every section non-empty; every entry has `text`; no entry has an `abc` field shorter than 4 characters (catches accidental empties).
- Extend **`ScoreTab.test.tsx`** with one test: clicking the `?` button shows the ABC modal heading.
- Extend **`App.test.tsx`** with one test: clicking the script-tab `?` button shows the Script API modal heading.

### What we deliberately don't test

- abcjs's actual rendered output (not our concern).
- Modal visual layout (positioning, spacing — eyeball).
- Animations (none planned).

## Open questions

None blocking. We may want to revisit the Script-tab corner `?` overlay if it intrudes on the CodeMirror gutter / scrollbar — easy to reposition or move into a thin top toolbar later.
