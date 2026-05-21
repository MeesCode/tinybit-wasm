# Script API Modal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column script-help modal with a two-pane layout (sidebar + search + per-entry params/example/tip), rewrite descriptions in plain language, and add an Insert button that drops the bare signature at the script-editor cursor.

**Architecture:**
- Data lives in `editor/src/info/scriptApi.ts` as an extended `ApiEntry` type with optional `params`, `tip`, and `insert` fields.
- The modal (`ScriptApiModal.tsx`) becomes a two-pane component: left rail with search + category buttons, right pane with entry cards. Inside the existing `InfoModal` shell.
- The Insert path threads an `EditorView` reference from `CodeEditor` (new `onReady` prop) up to `Editor.tsx`, which passes an `onInsert(text)` callback down to the modal. The callback dispatches a CodeMirror change at the current selection and closes the modal.

**Tech Stack:** React, TypeScript, Zustand (state), CodeMirror 6 (editor), Vitest + Testing Library (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-05-21-script-api-modal-redesign-design.md`

---

## File Structure

| File                                      | Action  | Responsibility                                                          |
|-------------------------------------------|---------|-------------------------------------------------------------------------|
| `editor/src/info/scriptApi.ts`            | Modify  | Extended `ApiEntry` type; rewritten descriptions; params/tip/insert data |
| `editor/src/info/scriptApi.test.ts`       | Modify  | Existing shape tests + new jargon-ban + params-shape tests              |
| `editor/src/info/ScriptApiModal.tsx`      | Rewrite | Two-pane layout, search, sidebar, entry cards, Insert button             |
| `editor/src/info/ScriptApiModal.test.tsx` | Rewrite | New tests for sidebar nav, search, Insert button behavior                |
| `editor/src/editor/CodeEditor.tsx`        | Modify  | Add optional `onReady(view)` prop                                       |
| `editor/src/editor/CodeEditor.test.tsx`   | Create  | Unit test for `onReady` callback                                         |
| `editor/src/Editor.tsx`                   | Modify  | Capture `EditorView` ref; pass `onInsert` callback to modal              |
| `editor/tests/e2e/script-api.spec.ts`     | Create  | E2E: Insert at cursor flow + search flow                                |

Each task below should land as one commit.

---

### Task 1: Extend `ApiEntry`, rewrite descriptions, add data-shape tests

**Files:**
- Modify: `editor/src/info/scriptApi.ts`
- Modify: `editor/src/info/scriptApi.test.ts`

- [ ] **Step 1: Write the failing jargon-ban test**

Append this block to `editor/src/info/scriptApi.test.ts`:

```ts
describe('SCRIPT_API_SECTIONS — jargon-free copy', () => {
    const BANNED = ['blit', 'RGBA4444', 'Pack 8-bit'];

    it('no description contains banned jargon', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            for (const e of s.items) {
                for (const term of BANNED) {
                    expect(e.description.toLowerCase()).not.toContain(term.toLowerCase());
                }
            }
        }
    });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd editor && npx vitest run src/info/scriptApi.test.ts`
Expected: FAIL — `cls` and several drawing/color entries currently contain banned terms.

- [ ] **Step 3: Extend the `ApiEntry` type**

Replace the top of `editor/src/info/scriptApi.ts` (lines 1-11) with:

```ts
export interface ApiParam {
    name: string;
    description: string;
}

export interface ApiEntry {
    name: string;
    signature: string;
    description: string;
    params?: ApiParam[];
    example?: string;
    tip?: string;
    /** Text inserted at the script-editor cursor when the user clicks Insert. Falls back to `signature`. */
    insert?: string;
}

export interface ApiSection {
    title: string;
    items: ApiEntry[];
}
```

- [ ] **Step 4: Rewrite the `SCRIPT_API_SECTIONS` data**

Replace `SCRIPT_API_SECTIONS` (currently lines 13-128) with the version below. This rewrites all descriptions in plain language, adds params/example/tip per entry where helpful, and sets `insert` overrides only where the signature isn't paste-friendly.

```ts
export const SCRIPT_API_SECTIONS: ApiSection[] = [
    {
        title: 'Hooks',
        items: [
            {
                name: '_draw',
                signature: 'function _draw() ... end',
                description: 'Define this function in your script. The engine calls it once per frame so you can draw the scene.',
                example: 'function _draw()\n  cls()\n  sprite(0, 60, 60)\nend',
                insert: 'function _draw()\n  -- draw your scene here\nend\n',
            },
        ],
    },
    {
        title: 'Annotations',
        items: [
            {
                name: '--@music',
                signature: '--@music[: name]',
                description: 'Editor-only marker. Place above a Lua string that holds an ABC music score; the Score tab will list it as an editable track. The optional name shows up as a chip in the Score tab.',
                example: '--@music: tune\nlocal tune = [[\nL:1/4\nK:C\nC D E F |\n]]\nmusic(tune)',
                insert: '--@music\n',
            },
            {
                name: '--@sfx',
                signature: '--@sfx[: name]',
                description: 'Editor-only marker. Place above a Lua string that holds a short ABC sound effect (up to 10 notes per voice); the Score tab will list it with the SFX cap. Optional name shows up as a chip.',
                example: '--@sfx: jump\nlocal jump = "c/4d/4e/4"\nsfx(jump)',
                insert: '--@sfx\n',
            },
        ],
    },
    {
        title: 'Drawing',
        items: [
            {
                name: 'cls',
                signature: 'cls()',
                description: 'Clear the whole display.',
                example: 'cls()',
            },
            {
                name: 'sprite',
                signature: 'sprite(n, x, y) | sprite(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',
                description: 'Draw a piece of the spritesheet onto the display. The short form copies the n-th 8×8 cell to (x, y). The long form copies any source rectangle from the sheet to any target rectangle, with an optional rotation.',
                params: [
                    { name: 'n', description: 'Cell index 0–255. The sheet is a 16×16 grid of 8×8 cells: cell = row * 16 + col.' },
                    { name: 'x, y', description: 'Top-left target position in pixels.' },
                ],
                example: 'sprite(0, 60, 60)',
                tip: 'The 128×128 sheet has 16 cells per row, so row 1 starts at index 16, row 2 at 32, and so on.',
                insert: 'sprite(n, x, y)',
            },
            {
                name: 'duplicate',
                signature: 'duplicate(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',
                description: 'Copy a rectangle of the display back to the display. Handy for motion trails or repeating patterns.',
            },
            {
                name: 'line',
                signature: 'line(x1, y1, x2, y2)',
                description: 'Draw a line from (x1, y1) to (x2, y2) using the current stroke color and width.',
                example: 'stroke(1, rgb(255, 255, 255))\nline(0, 0, 127, 127)',
            },
            {
                name: 'rect',
                signature: 'rect(x, y, w, h)',
                description: 'Draw a rectangle. The outline uses the stroke color and width; the inside uses the fill color.',
                example: 'fill(rgb(255, 0, 0))\nrect(10, 10, 30, 20)',
            },
            {
                name: 'oval',
                signature: 'oval(x, y, w, h)',
                description: 'Draw an oval that fits inside the rectangle (x, y, w, h). Outlined with stroke and filled with fill.',
            },
            {
                name: 'pset',
                signature: 'pset(x, y, color)',
                description: 'Set a single pixel at (x, y) to the given color.',
                params: [
                    { name: 'x, y', description: 'Pixel position, 0–127 for both axes.' },
                    { name: 'color', description: 'A packed color value from rgb(), rgba(), hsb(), or hsba().' },
                ],
            },
            {
                name: 'pget',
                signature: 'pget(x, y) -> color',
                description: 'Return the color at (x, y) as a packed color value.',
            },
            {
                name: 'poly_add',
                signature: 'poly_add(x, y)',
                description: 'Add a vertex (x, y) to the polygon you are building.',
            },
            {
                name: 'poly_clear',
                signature: 'poly_clear()',
                description: 'Throw away any vertices you have added so far so you can start a new polygon.',
            },
            {
                name: 'draw_polygon',
                signature: 'draw_polygon()',
                description: 'Draw the polygon built up with poly_add(): outline with stroke, inside with fill.',
                tip: 'A typical pattern is poly_clear(), several poly_add() calls, then draw_polygon().',
            },
            {
                name: 'stroke',
                signature: 'stroke(width, color)',
                description: 'Set the line width (in pixels) and outline color used by line, rect, oval, and draw_polygon.',
                params: [
                    { name: 'width', description: 'Line thickness in pixels.' },
                    { name: 'color', description: 'A packed color value from rgb(), rgba(), hsb(), or hsba().' },
                ],
            },
            {
                name: 'fill',
                signature: 'fill(color)',
                description: 'Set the fill color used by rect, oval, and draw_polygon.',
            },
            {
                name: 'text',
                signature: 'text(color)',
                description: 'Set the color used by print() for the text you draw.',
            },
            {
                name: 'cursor',
                signature: 'cursor(x, y)',
                description: 'Move the text cursor to (x, y). The next print() call starts here.',
            },
            {
                name: 'print',
                signature: 'print(str)',
                description: 'Draw str at the current text cursor position using the current text color.',
                example: 'cursor(10, 10)\ntext(rgb(255, 255, 255))\nprint("hello")',
            },
        ],
    },
    {
        title: 'Color',
        items: [
            {
                name: 'rgb',
                signature: 'rgb(r, g, b) -> color',
                description: 'Combine red, green, and blue (each 0–255) into a packed color value with full opacity.',
                params: [
                    { name: 'r', description: 'Red channel, 0–255.' },
                    { name: 'g', description: 'Green channel, 0–255.' },
                    { name: 'b', description: 'Blue channel, 0–255.' },
                ],
                example: 'local red = rgb(255, 0, 0)',
            },
            {
                name: 'rgba',
                signature: 'rgba(r, g, b, a) -> color',
                description: 'Combine red, green, blue, and alpha (each 0–255) into a packed color value. Use alpha < 255 for transparency.',
            },
            {
                name: 'hsb',
                signature: 'hsb(h, s, b) -> color',
                description: 'Combine hue, saturation, and brightness (each 0–255) into a packed color value with full opacity. Easier than rgb() for picking related colors.',
            },
            {
                name: 'hsba',
                signature: 'hsba(h, s, b, a) -> color',
                description: 'Combine hue, saturation, brightness, and alpha (each 0–255) into a packed color value.',
            },
        ],
    },
    {
        title: 'Audio',
        items: [
            {
                name: 'music',
                signature: 'music(abc_string)',
                description: 'Start a looping music track from an ABC notation string. Plays on the music channel.',
                example: 'music([[\nL:1/4\nK:C\nC D E F |\n]])',
                tip: 'You can author ABC tracks in the Score tab once you tag a string with --@music.',
            },
            {
                name: 'sfx',
                signature: 'sfx(abc_string)',
                description: 'Play a one-shot sound effect from an ABC notation string. Plays on the SFX channel.',
                example: 'sfx("c/4d/4e/4")',
            },
            {
                name: 'sfx_active',
                signature: 'sfx_active() -> bool',
                description: 'Returns true while the SFX channel is still playing. Use it to chain or gate sound effects.',
            },
        ],
    },
    {
        title: 'Input',
        items: [
            {
                name: 'btn',
                signature: 'btn(button) -> bool',
                description: 'Returns true for every frame the given button is held down.',
                params: [
                    { name: 'button', description: 'A button constant: A, B, UP, DOWN, LEFT, RIGHT, START, or SELECT.' },
                ],
                example: 'if btn(LEFT) then x = x - 1 end',
            },
            {
                name: 'btnp',
                signature: 'btnp(button) -> bool',
                description: 'Returns true only on the first frame the given button was pressed. Useful for one-shot actions like jumping or shooting.',
                example: 'if btnp(A) then sfx("c/4") end',
            },
            { name: 'A',     signature: 'A',     description: 'Button constant for the A button.' },
            { name: 'B',     signature: 'B',     description: 'Button constant for the B button.' },
            { name: 'UP',    signature: 'UP',    description: 'Button constant for the up direction.' },
            { name: 'DOWN',  signature: 'DOWN',  description: 'Button constant for the down direction.' },
            { name: 'LEFT',  signature: 'LEFT',  description: 'Button constant for the left direction.' },
            { name: 'RIGHT', signature: 'RIGHT', description: 'Button constant for the right direction.' },
            { name: 'START', signature: 'START', description: 'Button constant for the start button.' },
            { name: 'SELECT',signature: 'SELECT',description: 'Button constant for the select button.' },
        ],
    },
    {
        title: 'Misc',
        items: [
            {
                name: 'random',
                signature: 'random(min, max) -> int',
                description: 'Return a random whole number between min and max, including both ends.',
                example: 'local roll = random(1, 6)',
            },
            {
                name: 'millis',
                signature: 'millis() -> int',
                description: 'Return the current frame time in milliseconds. Handy for timing animations.',
            },
            {
                name: 'sleep',
                signature: 'sleep(ms)',
                description: 'Pause the engine for ms milliseconds. Blocks until the time has passed.',
                tip: 'Avoid sleep() inside _draw — it freezes the whole frame loop.',
            },
            {
                name: 'peek',
                signature: 'peek(addr) -> byte',
                description: 'Read one byte from the engine\'s raw memory at the given address. Advanced — most scripts will not need this.',
            },
            {
                name: 'poke',
                signature: 'poke(addr, val)',
                description: 'Write one byte (val & 0xFF) into the engine\'s raw memory at the given address. Advanced.',
            },
            {
                name: 'copy',
                signature: 'copy(dst, src, size)',
                description: 'Copy size bytes between two raw-memory addresses. Advanced.',
            },
            {
                name: 'log',
                signature: 'log(...)',
                description: 'Print the arguments to the editor\'s console pane, separated by spaces. Useful while debugging.',
                example: 'log("score:", score)',
            },
        ],
    },
    {
        title: 'Constants',
        items: [
            { name: 'TB_SCREEN_WIDTH',  signature: 'TB_SCREEN_WIDTH = 128',  description: 'Display width in pixels.' },
            { name: 'TB_SCREEN_HEIGHT', signature: 'TB_SCREEN_HEIGHT = 128', description: 'Display height in pixels.' },
            {
                name: 'SINE',
                signature: 'SINE',
                description: 'Waveform constant. Available for API symmetry, but the engine actually picks each voice\'s waveform from the ABC V: header name.',
                tip: 'Use V:SINE / V:SAW / V:SQUARE / V:NOISE inside your ABC score to choose a per-voice waveform.',
            },
            { name: 'SAW',    signature: 'SAW',    description: 'Waveform constant. See SINE for how the engine actually picks a waveform.' },
            { name: 'SQUARE', signature: 'SQUARE', description: 'Waveform constant. See SINE for how the engine actually picks a waveform.' },
            { name: 'NOISE',  signature: 'NOISE',  description: 'Waveform constant. See SINE for how the engine actually picks a waveform.' },
        ],
    },
];
```

- [ ] **Step 5: Add the params-shape test**

Append this block to `editor/src/info/scriptApi.test.ts`:

```ts
describe('SCRIPT_API_SECTIONS — params shape', () => {
    it('every params array, when present, is non-empty and well-formed', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            for (const e of s.items) {
                if (e.params === undefined) continue;
                expect(e.params.length).toBeGreaterThan(0);
                for (const p of e.params) {
                    expect(p.name.length).toBeGreaterThan(0);
                    expect(p.description.length).toBeGreaterThan(0);
                }
            }
        }
    });
});
```

- [ ] **Step 6: Run the full scriptApi test file, verify everything passes**

Run: `cd editor && npx vitest run src/info/scriptApi.test.ts`
Expected: PASS for every test (existing + jargon-ban + params-shape).

- [ ] **Step 7: Run the full vitest suite as a sanity check**

Run: `cd editor && npm test -- --run`
Expected: 349 (or however many existed) + 2 new tests = all pass. No regressions.

- [ ] **Step 8: Commit**

```bash
git add editor/src/info/scriptApi.ts editor/src/info/scriptApi.test.ts
git commit -m "feat(editor): extend ApiEntry with params/tip/insert, rewrite descriptions"
```

---

### Task 2: Rewrite `ScriptApiModal` to two-pane layout with search

**Files:**
- Rewrite: `editor/src/info/ScriptApiModal.tsx`
- Rewrite: `editor/src/info/ScriptApiModal.test.tsx`

Insert button is **not** added in this task — that lands in Task 4. This task only restructures the modal and exercises the new sections (params/example/tip rendering).

- [ ] **Step 1: Write the failing tests for the new layout**

Replace the contents of `editor/src/info/ScriptApiModal.test.tsx` with:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ScriptApiModal } from './ScriptApiModal';
import { SCRIPT_API_SECTIONS } from './scriptApi';

afterEach(() => cleanup());

function open() {
    return render(<ScriptApiModal open={true} onClose={() => {}} />);
}

describe('ScriptApiModal — shell', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<ScriptApiModal open={false} onClose={() => {}} />);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('invokes onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(<ScriptApiModal open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('ScriptApiModal — sidebar', () => {
    it('renders a tab for every section', () => {
        open();
        for (const s of SCRIPT_API_SECTIONS) {
            expect(screen.getByRole('tab', { name: new RegExp(`^${s.title}\\b`, 'i') })).toBeInTheDocument();
        }
    });

    it('starts on the first section (Hooks)', () => {
        open();
        const hooksTab = screen.getByRole('tab', { name: /^Hooks\b/ });
        expect(hooksTab).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('_draw')).toBeInTheDocument();
    });

    it('switching to Drawing reveals drawing entries and hides Hooks entries', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        expect(screen.getByText('cls')).toBeInTheDocument();
        expect(screen.getByText('sprite')).toBeInTheDocument();
        expect(screen.queryByText('_draw')).toBeNull();
    });

    it('renders the entry count in each sidebar tab', () => {
        open();
        const drawing = SCRIPT_API_SECTIONS.find((s) => s.title === 'Drawing')!;
        const tab = screen.getByRole('tab', { name: /^Drawing\b/ });
        expect(tab.textContent).toContain(String(drawing.items.length));
    });
});

describe('ScriptApiModal — entry rendering', () => {
    it('renders parameters when an entry has params', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        // sprite has params [n, "x, y"]
        const card = screen.getByText('sprite').closest('article')!;
        expect(within(card).getByText(/parameters/i)).toBeInTheDocument();
        expect(within(card).getByText('n')).toBeInTheDocument();
    });

    it('renders an example block when provided', () => {
        open();
        const card = screen.getByText('_draw').closest('article')!;
        expect(within(card).getByText(/example/i)).toBeInTheDocument();
    });

    it('renders a tip block when provided', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        const card = screen.getByText('sprite').closest('article')!;
        expect(within(card).getByText(/tip/i)).toBeInTheDocument();
    });

    it('omits parameters/example/tip blocks when the entry does not provide them', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        const card = screen.getByText('duplicate').closest('article')!;
        expect(within(card).queryByText(/parameters/i)).toBeNull();
        expect(within(card).queryByText(/example/i)).toBeNull();
        expect(within(card).queryByText(/^tip$/i)).toBeNull();
    });
});

describe('ScriptApiModal — search', () => {
    it('filters the right pane to matching entries in the active category', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sprite' } });
        expect(screen.getByText('sprite')).toBeInTheDocument();
        expect(screen.queryByText('cls')).toBeNull();
    });

    it('hides categories with zero matches from the sidebar while a filter is active', () => {
        open();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sprite' } });
        expect(screen.queryByRole('tab', { name: /^Hooks\b/ })).toBeNull();
        expect(screen.queryByRole('tab', { name: /^Color\b/ })).toBeNull();
        expect(screen.getByRole('tab', { name: /^Drawing\b/ })).toBeInTheDocument();
    });

    it('shows an empty state when the active category has no matches', () => {
        open();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzznomatch' } });
        expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    });

    it('matches against name, signature, and description', () => {
        open();
        // "Pause" only appears in sleep()'s description.
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pause' } });
        const miscTab = screen.getByRole('tab', { name: /^Misc\b/ });
        fireEvent.click(miscTab);
        expect(screen.getByText('sleep')).toBeInTheDocument();
    });
});

describe('ScriptApiModal — keyboard navigation', () => {
    it('ArrowDown on the sidebar moves to the next category', () => {
        open();
        const hooksTab = screen.getByRole('tab', { name: /^Hooks\b/ });
        hooksTab.focus();
        fireEvent.keyDown(hooksTab, { key: 'ArrowDown' });
        const annotationsTab = screen.getByRole('tab', { name: /^Annotations\b/ });
        expect(annotationsTab).toHaveAttribute('aria-selected', 'true');
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd editor && npx vitest run src/info/ScriptApiModal.test.tsx`
Expected: most tests FAIL — the modal still renders the old flat layout.

- [ ] **Step 3: Rewrite `ScriptApiModal.tsx`**

Replace `editor/src/info/ScriptApiModal.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { InfoModal } from './InfoModal';
import { SCRIPT_API_SECTIONS, type ApiEntry, type ApiSection } from './scriptApi';

const layout: CSSProperties = { display: 'flex', height: '100%', minHeight: 0, gap: 0 };
const rail: CSSProperties = {
    width: 200, flex: '0 0 200px',
    borderRight: '1px solid #ECECF0',
    display: 'flex', flexDirection: 'column',
    background: '#FAFAFA',
};
const searchWrap: CSSProperties = { padding: '12px 12px 8px 12px' };
const searchInput: CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    fontSize: 13, lineHeight: '20px',
    padding: '6px 8px',
    border: '1px solid #ECECF0', borderRadius: 6,
    background: '#FFFFFF', color: '#181820',
    outlineColor: '#ED225D',
};
const tabList: CSSProperties = { display: 'flex', flexDirection: 'column', padding: '4px 8px 12px 8px', gap: 2, overflowY: 'auto', flex: 1 };
const tabBase: CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    border: 'none', background: 'transparent',
    fontSize: 13, color: '#181820',
    padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
    textAlign: 'left',
};
const tabActive: CSSProperties = { ...tabBase, background: '#FDE4EF', color: '#ED225D', fontWeight: 600 };
const tabCount: CSSProperties = { fontSize: 11, color: '#6B6B76', marginLeft: 8, fontVariantNumeric: 'tabular-nums' };
const pane: CSSProperties = { flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 18px' };
const paneHeading: CSSProperties = {
    position: 'sticky', top: -14, // counter the padding so it sits flush
    margin: '-14px -18px 12px -18px', padding: '10px 18px',
    background: '#FFFFFF',
    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: '#6B6B76', borderBottom: '1px solid #ECECF0',
    zIndex: 1,
};
const entryCard: CSSProperties = { marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #F4F4F7' };
const entryHead: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 };
const entryName: CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 700, color: '#181820' };
const entrySig: CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: '#6B6B76', fontSize: 12 };
const entryDesc: CSSProperties = { fontSize: 13, color: '#181820', marginTop: 2, lineHeight: 1.45 };
const sectionLabel: CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
    color: '#6B6B76', marginTop: 10, marginBottom: 4,
};
const paramRow: CSSProperties = { display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#181820' };
const paramName: CSSProperties = { flex: '0 0 80px', fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: '#ED225D' };
const codeBlock: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11, whiteSpace: 'pre',
    background: '#F6F6F8', border: '1px solid #ECECF0', borderRadius: 4,
    padding: '6px 10px', color: '#181820',
    overflowX: 'auto', margin: 0,
};
const tipBlock: CSSProperties = {
    fontSize: 12, lineHeight: 1.5, color: '#181820',
    background: '#FFF8E6', border: '1px solid #F2E2A6', borderRadius: 4,
    padding: '6px 10px', marginTop: 4,
};
const emptyState: CSSProperties = { fontSize: 13, color: '#6B6B76', padding: '40px 0', textAlign: 'center' };

interface FilteredSection extends ApiSection {
    matches: ApiEntry[];
}

function matchesQuery(entry: ApiEntry, q: string): boolean {
    const needle = q.toLowerCase();
    return (
        entry.name.toLowerCase().includes(needle) ||
        entry.signature.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)
    );
}

function filterSections(query: string): FilteredSection[] {
    const q = query.trim();
    return SCRIPT_API_SECTIONS.map((s) => ({
        ...s,
        matches: q.length === 0 ? s.items : s.items.filter((e) => matchesQuery(e, q)),
    })).filter((s) => q.length === 0 || s.matches.length > 0);
}

export interface ScriptApiModalProps {
    open: boolean;
    onClose(): void;
}

export function ScriptApiModal({ open, onClose }: ScriptApiModalProps) {
    const [query, setQuery] = useState('');
    const [activeTitle, setActiveTitle] = useState<string>(SCRIPT_API_SECTIONS[0]?.title ?? '');
    const searchRef = useRef<HTMLInputElement | null>(null);

    // Reset on open so each invocation starts clean.
    useEffect(() => {
        if (open) {
            setQuery('');
            setActiveTitle(SCRIPT_API_SECTIONS[0]?.title ?? '');
            // Defer focus so the input exists in the DOM.
            queueMicrotask(() => searchRef.current?.focus());
        }
    }, [open]);

    const filtered = useMemo(() => filterSections(query), [query]);

    // If the active category disappears under the filter, switch to the first visible one.
    useEffect(() => {
        if (filtered.length === 0) return;
        if (!filtered.some((s) => s.title === activeTitle)) {
            setActiveTitle(filtered[0].title);
        }
    }, [filtered, activeTitle]);

    const active = filtered.find((s) => s.title === activeTitle) ?? filtered[0];

    function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            const next = filtered[(index + delta + filtered.length) % filtered.length];
            if (next) setActiveTitle(next.title);
        } else if (e.key === 'Home') {
            e.preventDefault();
            if (filtered[0]) setActiveTitle(filtered[0].title);
        } else if (e.key === 'End') {
            e.preventDefault();
            const last = filtered[filtered.length - 1];
            if (last) setActiveTitle(last.title);
        }
    }

    return (
        <InfoModal open={open} title="Script API" onClose={onClose} widthCss="min(880px, 95vw)" maxHeightCss="85vh">
            <div style={layout}>
                <div style={rail}>
                    <div style={searchWrap}>
                        <input
                            ref={searchRef}
                            type="search"
                            role="searchbox"
                            placeholder="Search functions…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label="Search script API"
                            style={searchInput}
                        />
                    </div>
                    <div role="tablist" aria-label="Script API categories" style={tabList}>
                        {filtered.map((s, i) => {
                            const isActive = active && s.title === active.title;
                            const tabId = `script-api-tab-${s.title.toLowerCase()}`;
                            const total = SCRIPT_API_SECTIONS.find((x) => x.title === s.title)?.items.length ?? s.matches.length;
                            const showRatio = query.trim().length > 0 && s.matches.length !== total;
                            return (
                                <button
                                    key={s.title}
                                    id={tabId}
                                    role="tab"
                                    type="button"
                                    aria-selected={isActive}
                                    aria-controls="script-api-panel"
                                    tabIndex={isActive ? 0 : -1}
                                    style={isActive ? tabActive : tabBase}
                                    onClick={() => setActiveTitle(s.title)}
                                    onKeyDown={(e) => onTabKeyDown(e, i)}
                                >
                                    <span>{s.title}</span>
                                    <span style={tabCount}>{showRatio ? `${s.matches.length} / ${total}` : total}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div
                    id="script-api-panel"
                    role="tabpanel"
                    aria-labelledby={active ? `script-api-tab-${active.title.toLowerCase()}` : undefined}
                    style={pane}
                >
                    {active ? (
                        <>
                            <h2 style={paneHeading}>{active.title}</h2>
                            {active.matches.length === 0 ? (
                                <div style={emptyState}>No matches for &ldquo;{query}&rdquo; in {active.title}. Try another category.</div>
                            ) : (
                                active.matches.map((e) => <Entry key={e.name} entry={e} />)
                            )}
                        </>
                    ) : (
                        <div style={emptyState}>No matches for &ldquo;{query}&rdquo;.</div>
                    )}
                </div>
            </div>
        </InfoModal>
    );
}

function Entry({ entry }: { entry: ApiEntry }) {
    return (
        <article style={entryCard}>
            <div style={entryHead}>
                <span style={entryName}>{entry.name}</span>
                <span style={entrySig}>{entry.signature}</span>
            </div>
            <div style={entryDesc}>{entry.description}</div>
            {entry.params && entry.params.length > 0 && (
                <>
                    <div style={sectionLabel}>Parameters</div>
                    {entry.params.map((p) => (
                        <div key={p.name} style={paramRow}>
                            <span style={paramName}>{p.name}</span>
                            <span>{p.description}</span>
                        </div>
                    ))}
                </>
            )}
            {entry.example && (
                <>
                    <div style={sectionLabel}>Example</div>
                    <pre style={codeBlock}>{entry.example}</pre>
                </>
            )}
            {entry.tip && (
                <>
                    <div style={sectionLabel}>Tip</div>
                    <div style={tipBlock}>💡 {entry.tip}</div>
                </>
            )}
        </article>
    );
}
```

- [ ] **Step 4: Extend `InfoModal` to accept overridable size props**

The modal needs to grow to 880px / 85vh. Add optional `widthCss` and `maxHeightCss` props to `InfoModal`.

Edit `editor/src/info/InfoModal.tsx`:

Replace lines 8-15 (the `panel` style constant) and lines 31-36 (the `InfoModalProps` interface and the component signature) so that the panel size is parameterized.

Change the `panel` constant to a function:

```ts
const panel = (widthCss: string, maxHeightCss: string): CSSProperties => ({
    display: 'flex', flexDirection: 'column',
    background: '#FFFFFF', borderRadius: 10,
    width: widthCss, maxHeight: maxHeightCss,
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    fontSize: 14, color: '#181820',
    overflow: 'hidden',
});
```

Update `InfoModalProps`:

```ts
export interface InfoModalProps {
    open: boolean;
    title: string;
    onClose(): void;
    children: ReactNode;
    /** Override the default panel width CSS. Defaults to `min(720px, 92vw)`. */
    widthCss?: string;
    /** Override the default panel max-height CSS. Defaults to `80vh`. */
    maxHeightCss?: string;
}
```

Update the component signature and the panel usage:

```tsx
export function InfoModal({ open, title, onClose, children, widthCss = 'min(720px, 92vw)', maxHeightCss = '80vh' }: InfoModalProps) {
    // ...existing keydown effect unchanged...

    if (!open) return null;

    // ...existing onBackdrop unchanged...

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label={title} style={overlay} onClick={onBackdrop}>
            <div style={panel(widthCss, maxHeightCss)}>
                <div style={header}>
                    <div style={titleStyle}>{title}</div>
                    <button type="button" aria-label="Close" style={closeBtn} onClick={onClose}>×</button>
                </div>
                <div style={body}>{children}</div>
            </div>
        </div>,
        document.body,
    );
}
```

- [ ] **Step 5: Run the modal tests, verify they pass**

Run: `cd editor && npx vitest run src/info/ScriptApiModal.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Run the full vitest suite**

Run: `cd editor && npm test -- --run`
Expected: all tests PASS (we didn't break `InfoModal.test.tsx` or any other consumer).

- [ ] **Step 7: Commit**

```bash
git add editor/src/info/ScriptApiModal.tsx editor/src/info/ScriptApiModal.test.tsx editor/src/info/InfoModal.tsx
git commit -m "feat(editor): two-pane Script API modal with search and rich entries"
```

---

### Task 3: Add `onReady(view)` callback to `CodeEditor`

**Files:**
- Modify: `editor/src/editor/CodeEditor.tsx`
- Create: `editor/src/editor/CodeEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `editor/src/editor/CodeEditor.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { CodeEditor } from './CodeEditor';

afterEach(() => cleanup());

describe('CodeEditor', () => {
    it('calls onReady once with an EditorView after mount', () => {
        const onReady = vi.fn();
        render(<CodeEditor value="print('hi')" onChange={() => {}} onReady={onReady} />);
        expect(onReady).toHaveBeenCalledTimes(1);
        const view = onReady.mock.calls[0][0];
        expect(view).toBeInstanceOf(EditorView);
        expect(view.state.doc.toString()).toBe("print('hi')");
    });

    it('does not call onReady on subsequent prop updates', () => {
        const onReady = vi.fn();
        const { rerender } = render(<CodeEditor value="a" onChange={() => {}} onReady={onReady} />);
        rerender(<CodeEditor value="b" onChange={() => {}} onReady={onReady} />);
        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('works without an onReady prop', () => {
        expect(() => render(<CodeEditor value="x" onChange={() => {}} />)).not.toThrow();
    });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd editor && npx vitest run src/editor/CodeEditor.test.tsx`
Expected: FAIL — `onReady` prop doesn't exist yet.

- [ ] **Step 3: Add the `onReady` prop**

Edit `editor/src/editor/CodeEditor.tsx`:

Add to `CodeEditorProps` (around lines 30-35):

```ts
export interface CodeEditorProps {
    value: string;
    onChange(v: string): void;
    extraExtensions?: Extension[];
    luaErrorMarker?: LuaErrorMarkerData | null;
    /** Called once with the EditorView immediately after it is constructed. */
    onReady?(view: EditorView): void;
}
```

Destructure `onReady` in the component signature, and call it after `viewRef.current = view;` inside the first `useEffect`. The mount effect should look like:

```tsx
export function CodeEditor({ value, onChange, extraExtensions, luaErrorMarker, onReady }: CodeEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
        if (!hostRef.current) return;
        const state = EditorState.create({
            doc: value,
            extensions: [
                // ...existing extensions, unchanged...
            ],
        });
        const view = new EditorView({ state, parent: hostRef.current });
        viewRef.current = view;
        onReadyRef.current?.(view);
        return () => { view.destroy(); viewRef.current = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ...rest unchanged...
}
```

The `onReadyRef` ref pattern (like `onChangeRef` above) keeps the mount effect from re-running when `onReady` identity changes, while still calling the latest callback.

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd editor && npx vitest run src/editor/CodeEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full vitest suite**

Run: `cd editor && npm test -- --run`
Expected: all PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add editor/src/editor/CodeEditor.tsx editor/src/editor/CodeEditor.test.tsx
git commit -m "feat(editor): expose EditorView via CodeEditor onReady prop"
```

---

### Task 4: Add Insert button to modal; wire `EditorView` ref through `Editor.tsx`

**Files:**
- Modify: `editor/src/info/ScriptApiModal.tsx`
- Modify: `editor/src/info/ScriptApiModal.test.tsx`
- Modify: `editor/src/Editor.tsx`

- [ ] **Step 1: Write the failing tests for the Insert button**

Append to `editor/src/info/ScriptApiModal.test.tsx`:

```tsx
describe('ScriptApiModal — Insert button', () => {
    it('does not render Insert buttons when onInsert is not provided', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        expect(screen.queryByRole('button', { name: /^insert .* at cursor$/i })).toBeNull();
    });

    it('renders an Insert button per entry when onInsert is provided', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} onInsert={() => {}} />);
        // On the default Hooks tab: _draw is the only entry.
        expect(screen.getByRole('button', { name: /^insert _draw at cursor$/i })).toBeInTheDocument();
    });

    it('clicking Insert calls onInsert with the entry\'s `insert` value when present', () => {
        const onInsert = vi.fn();
        render(<ScriptApiModal open={true} onClose={() => {}} onInsert={onInsert} />);
        fireEvent.click(screen.getByRole('button', { name: /^insert _draw at cursor$/i }));
        expect(onInsert).toHaveBeenCalledTimes(1);
        // _draw has an `insert` override that is a multi-line skeleton.
        const arg = onInsert.mock.calls[0][0] as string;
        expect(arg).toContain('function _draw()');
        expect(arg).toContain('end');
    });

    it('clicking Insert falls back to signature when `insert` is absent', () => {
        const onInsert = vi.fn();
        render(<ScriptApiModal open={true} onClose={() => {}} onInsert={onInsert} />);
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        fireEvent.click(screen.getByRole('button', { name: /^insert cls at cursor$/i }));
        expect(onInsert).toHaveBeenCalledWith('cls()');
    });

    it('clicking Insert closes the modal', () => {
        const onInsert = vi.fn();
        const onClose = vi.fn();
        render(<ScriptApiModal open={true} onClose={onClose} onInsert={onInsert} />);
        fireEvent.click(screen.getByRole('button', { name: /^insert _draw at cursor$/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd editor && npx vitest run src/info/ScriptApiModal.test.tsx`
Expected: the new Insert-button tests FAIL — the button doesn't exist yet.

- [ ] **Step 3: Add `onInsert` prop and the Insert button to `ScriptApiModal.tsx`**

Update `ScriptApiModalProps` and the component to accept `onInsert`, then update `Entry` to render the button when `onInsert` is provided.

Replace `ScriptApiModalProps` and the component signature:

```tsx
export interface ScriptApiModalProps {
    open: boolean;
    onClose(): void;
    onInsert?(text: string): void;
}

export function ScriptApiModal({ open, onClose, onInsert }: ScriptApiModalProps) {
    // ...existing state/effects/filtered unchanged...

    // (keep the existing JSX, but pass `onInsert` and `onClose` to each Entry)

    return (
        <InfoModal open={open} title="Script API" onClose={onClose} widthCss="min(880px, 95vw)" maxHeightCss="85vh">
            {/* ...layout unchanged... */}
            <div id="script-api-panel" role="tabpanel" /* ... */>
                {active && active.matches.length > 0 ? (
                    active.matches.map((e) => (
                        <Entry key={e.name} entry={e} onInsert={onInsert} onClose={onClose} />
                    ))
                ) : (
                    // ...empty state unchanged...
                )}
            </div>
        </InfoModal>
    );
}
```

(The header rendering and matching empty-state branches stay as they are — only the `<Entry />` call changes.)

Update the `Entry` component to accept and render the button:

```tsx
const insertBtn: CSSProperties = {
    border: '1px solid #ECECF0', background: '#FFFFFF', color: '#ED225D',
    fontSize: 12, fontWeight: 600, lineHeight: '20px',
    padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
    marginLeft: 'auto',
};

interface EntryProps {
    entry: ApiEntry;
    onInsert?: (text: string) => void;
    onClose: () => void;
}

function Entry({ entry, onInsert, onClose }: EntryProps) {
    const insertText = entry.insert ?? entry.signature;

    function handleInsert() {
        if (!onInsert) return;
        onInsert(insertText);
        onClose();
    }

    return (
        <article style={entryCard}>
            <div style={entryHead}>
                <span style={entryName}>{entry.name}</span>
                <span style={entrySig}>{entry.signature}</span>
                {onInsert && (
                    <button
                        type="button"
                        style={insertBtn}
                        onClick={handleInsert}
                        aria-label={`Insert ${entry.name} at cursor`}
                    >
                        Insert
                    </button>
                )}
            </div>
            {/* description, params, example, tip unchanged */}
        </article>
    );
}
```

- [ ] **Step 4: Run the modal tests, verify they pass**

Run: `cd editor && npx vitest run src/info/ScriptApiModal.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Wire the EditorView ref + `onInsert` callback in `Editor.tsx`**

Edit `editor/src/Editor.tsx`:

Add to the imports (alongside the existing `@codemirror` imports — there are none yet, so add a new line):

```ts
import { EditorView } from '@codemirror/view';
```

Inside the `Editor` component, add a new ref alongside the existing refs (e.g. near `frameLoopRef` around line 70):

```ts
const editorViewRef = useRef<EditorView | null>(null);
```

Update the `CodeEditor` usage (around lines 471-476) to pass `onReady`:

```tsx
<CodeEditor
    value={sketch.script}
    onChange={sketch.setScript}
    extraExtensions={[scoreHoverExtension]}
    luaErrorMarker={luaErrorMarker}
    onReady={(view) => { editorViewRef.current = view; }}
/>
```

Update the `ScriptApiModal` usage (around line 526) to pass `onInsert`:

```tsx
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
        // Defer focus so it happens after the modal unmounts.
        queueMicrotask(() => view.focus());
    }}
/>
```

Note: `setScriptHelpOpen(false)` is already invoked by the modal's `onClose`, which `handleInsert` calls inside the modal. So `Editor.tsx` doesn't need to close it again — but the focus needs to wait for the modal to unmount, which is what the `queueMicrotask` handles.

- [ ] **Step 6: Run the full vitest suite**

Run: `cd editor && npm test -- --run`
Expected: all PASS — including the existing `ScriptApiModal.test.tsx` tests that don't provide `onInsert`.

- [ ] **Step 7: Build the editor to confirm TypeScript / build passes**

Run: `cd editor && npm run build 2>&1 | tail -20`
Expected: build succeeds, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add editor/src/info/ScriptApiModal.tsx editor/src/info/ScriptApiModal.test.tsx editor/src/Editor.tsx
git commit -m "feat(editor): Script API modal can insert signatures at the script cursor"
```

---

### Task 5: E2E coverage for Insert + Search flows

**Files:**
- Create: `editor/tests/e2e/script-api.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `editor/tests/e2e/script-api.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Script API modal', () => {
    test('Insert drops the signature at the script cursor and closes the modal', async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto('/');

        const editor = page.locator('.cm-content');
        await expect(editor).toContainText('hello, world');

        // Replace the script with a single comment so we have a known cursor position at end-of-doc.
        await editor.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type('-- start', { delay: 1 });
        await page.keyboard.press('End');

        // Open the script-help modal.
        await page.getByRole('button', { name: /script api help/i }).click();
        const dialog = page.getByRole('dialog', { name: /script api/i });
        await expect(dialog).toBeVisible();

        // Switch to Drawing and Insert cls.
        await dialog.getByRole('tab', { name: /^Drawing\b/ }).click();
        await dialog.getByRole('button', { name: /^insert cls at cursor$/i }).click();

        // Modal closes; cls() lands after `-- start`.
        await expect(dialog).not.toBeVisible();
        await expect(editor).toContainText('-- startcls()');

        // The caret should be positioned right after cls() — typing now appends.
        await page.keyboard.type(' -- after', { delay: 1 });
        await expect(editor).toContainText('-- startcls() -- after');
    });

    test('search filters the sidebar and the right pane', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /script api help/i }).click();

        const dialog = page.getByRole('dialog', { name: /script api/i });
        await expect(dialog).toBeVisible();

        const search = dialog.getByRole('searchbox', { name: /search script api/i });
        await search.fill('sprite');

        // Categories without matches disappear from the sidebar.
        await expect(dialog.getByRole('tab', { name: /^Hooks\b/ })).toHaveCount(0);
        await expect(dialog.getByRole('tab', { name: /^Color\b/ })).toHaveCount(0);

        // Drawing tab survives and the sprite entry is visible.
        await expect(dialog.getByRole('tab', { name: /^Drawing\b/ })).toBeVisible();
        await expect(dialog.getByText('sprite', { exact: true })).toBeVisible();

        // The Insert button for sprite is reachable.
        await expect(dialog.getByRole('button', { name: /^insert sprite at cursor$/i })).toBeVisible();
    });
});
```

- [ ] **Step 2: Run the e2e suite (just this spec)**

Run: `cd editor && npx playwright test tests/e2e/script-api.spec.ts`
Expected: both tests PASS.

- [ ] **Step 3: Run the full e2e suite to check for regressions**

Run: `cd editor && npm run test:e2e`
Expected: only the pre-existing `gallery.spec.ts` failure (unrelated to this work). Everything else passes.

- [ ] **Step 4: Commit**

```bash
git add editor/tests/e2e/script-api.spec.ts
git commit -m "test(editor): e2e for Script API modal Insert + search"
```

---

## Done criteria

- Modal opens to a two-pane layout with sidebar + search.
- Every entry shows description; entries with `params`/`example`/`tip` render those blocks; entries without those fields don't.
- Search filters both the sidebar and the right pane, with an empty state on zero matches.
- Clicking Insert on any entry drops the bare signature (or `insert` override) at the script-editor cursor and closes the modal.
- All vitest tests pass. The new e2e tests pass. No new regressions in the full e2e suite.
- Five commits land on `main` (one per task).
