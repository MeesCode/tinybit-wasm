# Script API Modal — Redesign Design

**Date:** 2026-05-21
**Status:** Spec
**Related code:** `editor/src/info/ScriptApiModal.tsx`, `editor/src/info/scriptApi.ts`, `editor/src/info/InfoModal.tsx`, `editor/src/editor/CodeEditor.tsx`, `editor/src/Editor.tsx`

## Problem

The script-help modal (opened from the `?` button on the script tab) renders all eight API sections as one long scroll: Hooks, Annotations, Drawing, Color, Audio, Input, Misc, Constants. Every entry is a name + monospace signature + one-liner description, plus an example only for a handful of entries.

Three pain points:

1. **Hard to scan.** Fifty-ish entries in a single 720 px-wide column. Finding a function means scrolling. No search, no nav, no per-category jump.
2. **Beginner-hostile wording.** Descriptions use jargon (`blit`, `RGBA4444 integer`, "stroke + fill"). A first-time Lua/TinyBit user has to translate twice.
3. **Read-only.** The user sees a function they want, then has to retype it into the script. The modal knows the signature; the editor has a cursor; nothing connects the two.

## Goal

A two-pane modal that (a) lets the user jump to a category or search by name, (b) explains each function in plain language with an example, and (c) drops the signature into the script at the cursor with one click.

## Non-goals

- **LSP-style snippet tabstops.** The Insert button drops the bare signature; the user replaces argument names manually. Avoids depending on a CodeMirror snippet extension.
- **Autocomplete in the editor.** This is docs-side only. A future autocomplete pass can reuse the same data, but is out of scope here.
- **Engine API changes.** No new functions; this is presentation + data-shape rework over the existing API surface.
- **Multi-language docs.** English only, matching the rest of the editor.
- **Persisting the open category across modal opens.** Always starts on the first category (Hooks).

## Layout

The modal continues to use `InfoModal` as a shell. Inside, the body becomes a two-pane layout:

- **Left rail (~180 px wide):** search input on top, then a vertical list of category buttons. Each button shows the category name and an entry count (`Drawing 15`). The active category is highlighted. Selecting a category swaps the right pane and clears any active filter.
- **Right pane:** scrolling list of entry cards for the active category. The category name renders as a sticky header at the top of the pane.

Modal panel size grows from `min(720px, 92vw) / 80vh` to `min(880px, 95vw) / 85vh` to give the two-pane layout room to breathe.

On the (currently hypothetical) narrow viewport: the rail collapses above the content as a horizontal scroller. The modal isn't expected to appear on phone-sized viewports today — the editor route is gated behind `MobileGate` — but the layout shouldn't break if it does.

## Per-entry rendering

Each entry renders the following blocks, in order, with each block conditional on having content:

```
sprite(n, x, y)                                    [ Insert ]
Draw one 8×8 cell from the spritesheet.

Parameters
  n   Cell index 0–255 (row 0 = 0–15, row 1 = 16–31, …)
  x   Left edge in pixels
  y   Top edge in pixels

Example
  sprite(0, 60, 60)

💡 Tip
  The 128×128 sheet is laid out as a 16×16 grid of cells.
```

- **Signature row:** name + signature (monospace), with an `Insert` button right-aligned.
- **Description:** one to three plain-language sentences, no jargon.
- **Parameters:** small definition list, one row per argument. Omitted entirely for entries with no arguments (e.g. `cls()`, constants).
- **Example:** a short code block. Every callable function has one; constants and annotations may omit.
- **Tip:** a single-paragraph callout with a 💡 icon. **Added only where it genuinely helps** — not on every entry. Good candidates: gotchas (`peek` reads "raw engine memory, not Lua values"), non-obvious behaviour (`sprite` cell-index layout, waveform constants being engine-selected via V: headers).

## Data model

`ApiEntry` and `ApiSection` move from this:

```ts
interface ApiEntry {
    name: string;
    signature: string;
    description: string;
    example?: string;
}
```

to this:

```ts
interface ApiEntry {
    name: string;
    signature: string;
    description: string;            // jargon-free, rewritten
    params?: { name: string; description: string }[];
    example?: string;
    tip?: string;
    insert?: string;                // defaults to signature
}
```

`ApiSection` stays unchanged.

### Description rewrite pass

Every existing description gets reread and reworded for a beginner reader. Specific banned terms (with replacements):

| Banned                       | Use instead                               |
|------------------------------|-------------------------------------------|
| blit                         | draw / copy                               |
| RGBA4444 integer             | packed color value                        |
| stroke + fill                | outline and fill                          |
| Pack 8-bit X into…           | Combine X values into a color value       |

The rewrite is part of this change, not a follow-up. A data-shape test enforces the banned-term list (see Testing).

### `insert` field

Defaults to the entry's `signature`. Overridden only when the displayed signature reads like documentation rather than runnable code:

| Entry        | `signature` (displayed)                       | `insert` (pasted)                                  |
|--------------|-----------------------------------------------|----------------------------------------------------|
| `_draw`      | `function _draw() ... end`                    | `function _draw()\n  -- draw your scene here\nend\n` |
| `--@music`   | `--@music[: name]`                            | `--@music\n`                                       |
| `--@sfx`     | `--@sfx[: name]`                              | `--@sfx\n`                                         |
| `sprite`     | `sprite(n, x, y) \| sprite(sx, sy, …)`        | `sprite(n, x, y)` (the short form)                 |

For entries with overloaded signatures shown with `|`, the short / most-common form is what gets inserted.

## Insert at cursor

### Plumbing

`CodeEditor` gains an optional callback prop:

```ts
interface CodeEditorProps {
    // ... existing
    onReady?(view: EditorView): void;
}
```

Called once, immediately after the `EditorView` is constructed in the existing `useEffect`. `Editor.tsx` stores the view in a `useRef<EditorView | null>(null)`.

`ScriptApiModal` gains an optional callback prop:

```ts
interface ScriptApiModalProps {
    open: boolean;
    onClose(): void;
    onInsert?(text: string): void;
}
```

`Editor.tsx` passes:

```ts
<ScriptApiModal
    open={scriptHelpOpen}
    onClose={() => setScriptHelpOpen(false)}
    onInsert={(text) => {
        const view = editorViewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
        });
        setScriptHelpOpen(false);
        view.focus();
    }}
/>
```

### Behaviour

- Clicking `Insert` calls `onInsert(entry.insert ?? entry.signature)`.
- If `onInsert` is undefined, the Insert button is not rendered. (Future-proofs against the modal being opened from a non-script context.)
- The modal closes immediately after insert, so the user can see where the text landed. (Trade-off: inserting several functions in a row means reopening the modal each time. Accepted — primary use case is one-at-a-time discovery.)
- After insert, focus returns to the editor with the caret positioned at the end of the inserted text.
- The Insert button's accessible name is `Insert <name> at cursor` (e.g. `Insert sprite at cursor`).

## Search

A single text input lives at the top of the left rail.

- Filter is case-insensitive substring match against `name`, `signature`, and `description` (not `example`, `params`, `tip` — those produce too many noise hits).
- While the filter is non-empty:
  - Sidebar shows only categories that contain at least one matching entry; the count badge reflects matches, not total (e.g. `Drawing 3 / 15`).
  - The right pane shows only matching entries from the active category. If the active category has zero matches, the pane shows an empty state: `No matches for "<query>" in <category>. Try another category in the sidebar.`
  - Selecting a different sidebar category swaps the pane but keeps the filter active.
- Clearing the search restores all categories and entries.
- Search input is the initial focus when the modal opens.

## Navigation & accessibility

- Sidebar entries are `<button role="tab" aria-selected={…} aria-controls="script-api-panel">`. The right pane has `role="tabpanel" id="script-api-panel" aria-labelledby={activeTabId}`.
- `ArrowDown`/`ArrowUp` move between sidebar categories when focus is inside the sidebar (skipping the search input). `Home`/`End` jump to the first / last category. Following the WAI-ARIA tabs pattern.
- `Tab` moves focus from search → active sidebar item → first focusable element in the right pane (the first Insert button) → close button → backdrop.
- `Escape` closes the modal (already wired in `InfoModal`).
- All Insert buttons have visible focus rings and the accessible name described above.
- Color contrast for sidebar item / active state / Tip callout meets WCAG AA against the white panel background.

## Testing

### Vitest (`editor/src/info/`)

- `ScriptApiModal.test.tsx` updated and expanded:
  - Renders sidebar with all 8 categories and their counts.
  - Selecting a category swaps the right-pane content.
  - Typing in the search box hides non-matching entries and hides categories with zero matches.
  - Empty-state message renders when search returns zero matches in the active category.
  - Clicking `Insert` for an entry calls `onInsert` with the entry's `insert` (or `signature` fallback) and triggers `onClose`.
  - When `onInsert` is not provided, Insert buttons are not rendered.
  - Keyboard navigation: arrow keys move active category; Escape closes.
- `scriptApi.test.ts` updated:
  - Existing shape tests stay (name/signature/description non-empty).
  - New: no description in `SCRIPT_API_SECTIONS` contains any banned-jargon string.
  - New: every entry where `params` is provided lists at least one parameter, and every parameter has a non-empty `name` and `description`.

### Playwright (`editor/tests/e2e/`)

A new spec `script-api.spec.ts`:

- Open the editor, clear the script, type `-- hello\n` so the cursor is at the end. Open the script-help modal, click `Insert` on `cls`. Assert: modal is no longer visible, the script editor's text content contains `-- hello\ncls()`. Then type ` -- after` immediately and assert the resulting line is `cls() -- after` — proving the caret landed after the inserted text (not before).
- Open modal, type `spr` into the search box. Assert the sidebar surfaces a `Drawing` entry with a reduced count, and the right pane shows the `sprite` entry with its Insert button visible.

## Out of scope

- Inline parameter hints in the script editor (would need a CodeMirror tooltip extension reading from `scriptApi.ts`).
- Per-user favourites / pinned functions.
- Dark-mode styling. The modal follows the existing light-theme styling; a future dark-mode pass covers the whole editor.
- Tab-stop snippet expansion. The user explicitly chose bare-signature insertion.

## File map

| File                                       | Change                                                                                  |
|--------------------------------------------|-----------------------------------------------------------------------------------------|
| `editor/src/info/scriptApi.ts`             | Extend `ApiEntry`; rewrite descriptions; add `params`, `example`, `tip`, `insert` data. |
| `editor/src/info/ScriptApiModal.tsx`       | Rewrite to two-pane layout; add search, sidebar, Insert buttons.                        |
| `editor/src/info/ScriptApiModal.test.tsx`  | Update + expand tests per Testing section.                                              |
| `editor/src/info/scriptApi.test.ts`        | Add jargon-ban test, params-shape test.                                                 |
| `editor/src/editor/CodeEditor.tsx`         | Add optional `onReady(view)` prop.                                                      |
| `editor/src/Editor.tsx`                    | Capture `EditorView` ref, pass `onInsert` to `ScriptApiModal`.                          |
| `editor/tests/e2e/script-api.spec.ts`      | New file: insert flow + search flow.                                                    |
