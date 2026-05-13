# Info Modals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two in-editor info modals — a Script API reference (Lua functions, hooks, constants, the `--@score` annotation) reachable from a `?` button on the Script tab, and an ABC notation cheatsheet reachable from a `?` button on the Score tab.

**Architecture:** A generic `InfoModal` shell + a small `HelpButton` are shared. Two thin wrappers (`ScriptApiModal`, `AbcInfoModal`) render structured content from pure data files (`scriptApi.ts`, `abcInfo.ts`). ABC examples render via a slimmed-down `MiniScore` that lazy-imports abcjs.

**Tech Stack:** React 18, Vitest + jsdom + @testing-library/react, [abcjs](https://www.npmjs.com/package/abcjs) (already a dependency).

**Source spec:** `docs/superpowers/specs/2026-05-14-info-modals-design.md`

---

## File map

**Created:**

| Path | Purpose |
|---|---|
| `editor/src/info/InfoModal.tsx` | Generic dialog shell. |
| `editor/src/info/InfoModal.test.tsx` | Unit tests. |
| `editor/src/info/HelpButton.tsx` | Small `?` button. |
| `editor/src/info/HelpButton.test.tsx` | Unit test. |
| `editor/src/info/MiniScore.tsx` | Inline ABC renderer (slim version of ScorePreview). |
| `editor/src/info/MiniScore.test.tsx` | Unit tests. |
| `editor/src/info/scriptApi.ts` | Pure data: `SCRIPT_API_SECTIONS`. |
| `editor/src/info/scriptApi.test.ts` | Data sanity tests. |
| `editor/src/info/abcInfo.ts` | Pure data: `ABC_SECTIONS`. |
| `editor/src/info/abcInfo.test.ts` | Data sanity tests. |
| `editor/src/info/ScriptApiModal.tsx` | Composes InfoModal + SCRIPT_API_SECTIONS. |
| `editor/src/info/ScriptApiModal.test.tsx` | Unit test. |
| `editor/src/info/AbcInfoModal.tsx` | Composes InfoModal + ABC_SECTIONS. |
| `editor/src/info/AbcInfoModal.test.tsx` | Unit test. |

**Modified:**

| Path | Change |
|---|---|
| `editor/src/score/ScoreTab.tsx` | Add `<HelpButton>` at right edge of chip bar; render `<AbcInfoModal>` conditionally. |
| `editor/src/App.tsx` | Wrap script-tab body in positioning context; overlay `<HelpButton>` top-right; render `<ScriptApiModal>` at App level. |

---

## Conventions

- TDD: failing test → impl → passing → commit.
- Tests: `cd editor && npx vitest run <path>` for single file; `npm test` for all.
- Each commit uses HEREDOC + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Branch: `feat/info-modals`, forked from `feat/score-editor` (the spec depends on score-editor work that hasn't merged yet — score-tab chip bar, MUSIC_MAX_NOTES constants, scoreLinks, etc.).

---

## Task 0: Branch setup

- [ ] **Step 1: Verify base branch state**

```bash
cd /home/mees/git/tinybit_projects/tinybit_wasm && git branch --show-current && git log --oneline -1
```

Expected: current branch is `feat/score-editor`, HEAD includes the latest score-editor commits (most recent is the info-modals spec commit `408eb11` or later).

- [ ] **Step 2: Create the new feature branch**

```bash
git checkout -b feat/info-modals
```

Expected: switched to a new branch named `feat/info-modals`.

- [ ] **Step 3: Sanity-check the editor still builds**

```bash
cd editor && npx tsc --noEmit
```

Expected: zero errors.

(No commit yet — Task 1 brings the first real change.)

---

## Task 1: `HelpButton.tsx`

**Files:**
- Create: `editor/src/info/HelpButton.tsx`
- Create: `editor/src/info/HelpButton.test.tsx`

- [ ] **Step 1: Write failing test**

Create `editor/src/info/HelpButton.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HelpButton } from './HelpButton';

afterEach(() => cleanup());

describe('HelpButton', () => {
    it('renders a button with a ? glyph and the provided aria-label', () => {
        render(<HelpButton onClick={() => {}} aria-label="Open help" />);
        const btn = screen.getByRole('button', { name: /open help/i });
        expect(btn.textContent).toContain('?');
    });

    it('invokes onClick when clicked', () => {
        const onClick = vi.fn();
        render(<HelpButton onClick={onClick} aria-label="Open help" />);
        fireEvent.click(screen.getByRole('button', { name: /open help/i }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('applies extra style overrides', () => {
        render(<HelpButton onClick={() => {}} aria-label="Help" style={{ position: 'absolute', top: 8, right: 8 }} />);
        const btn = screen.getByRole('button', { name: /help/i });
        expect(btn.style.position).toBe('absolute');
        expect(btn.style.top).toBe('8px');
        expect(btn.style.right).toBe('8px');
    });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd editor && npx vitest run src/info/HelpButton.test.tsx
```

Expected: FAIL with "Cannot find module ./HelpButton" or similar.

- [ ] **Step 3: Implement `HelpButton.tsx`**

Create `editor/src/info/HelpButton.tsx`:

```tsx
import type { CSSProperties } from 'react';

const baseStyle: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, padding: 0,
    fontSize: 12, fontWeight: 700,
    border: '1px solid #ED225D',
    borderRadius: 999,
    background: '#FFFFFF', color: '#ED225D',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
};

export interface HelpButtonProps {
    onClick(): void;
    'aria-label': string;
    style?: CSSProperties;
}

export function HelpButton({ onClick, style, ...rest }: HelpButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={rest['aria-label']}
            style={{ ...baseStyle, ...style }}>
            ?
        </button>
    );
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
cd editor && npx vitest run src/info/HelpButton.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/info/HelpButton.tsx editor/src/info/HelpButton.test.tsx
git commit -m "$(cat <<'EOF'
info: add HelpButton — small "?" trigger used by Script and Score tabs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `InfoModal.tsx`

**Files:**
- Create: `editor/src/info/InfoModal.tsx`
- Create: `editor/src/info/InfoModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `editor/src/info/InfoModal.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InfoModal } from './InfoModal';

afterEach(() => cleanup());

describe('InfoModal', () => {
    it('renders nothing when open=false', () => {
        const { container } = render(<InfoModal open={false} title="X" onClose={() => {}}>body</InfoModal>);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders title, children, and a close button when open=true', () => {
        render(<InfoModal open={true} title="Script API" onClose={() => {}}><span>BODY</span></InfoModal>);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Script API');
        expect(screen.getByText('Script API')).toBeInTheDocument();
        expect(screen.getByText('BODY')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('invokes onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}>body</InfoModal>);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('invokes onClose when the backdrop is clicked', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}>body</InfoModal>);
        // The backdrop is the role="dialog" element itself; clicking it (not children) closes.
        fireEvent.click(screen.getByRole('dialog'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does NOT invoke onClose when a child of the dialog is clicked', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}><button>inside</button></InfoModal>);
        fireEvent.click(screen.getByRole('button', { name: 'inside' }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('invokes onClose on Escape keypress', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}>body</InfoModal>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not bind Escape when closed (no spurious onClose calls)', () => {
        const onClose = vi.fn();
        render(<InfoModal open={false} title="X" onClose={onClose}>body</InfoModal>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('marks the scrollable body with overflow:auto', () => {
        render(<InfoModal open={true} title="X" onClose={() => {}}><span data-testid="kid" /></InfoModal>);
        const body = screen.getByTestId('kid').parentElement!;
        expect(body.style.overflow).toBe('auto');
    });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd editor && npx vitest run src/info/InfoModal.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `InfoModal.tsx`**

Create `editor/src/info/InfoModal.tsx`:

```tsx
import { useEffect, type CSSProperties, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(24, 24, 32, 0.45)',
    display: 'grid', placeItems: 'center', zIndex: 9999,
};
const panel: CSSProperties = {
    display: 'flex', flexDirection: 'column',
    background: '#FFFFFF', borderRadius: 10,
    width: 'min(720px, 92vw)', maxHeight: '80vh',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    fontSize: 14, color: '#181820',
    overflow: 'hidden',
};
const header: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid #ECECF0',
    flex: '0 0 auto',
};
const titleStyle: CSSProperties = { fontWeight: 700, fontSize: 16 };
const closeBtn: CSSProperties = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 22, lineHeight: 1, color: '#6B6B76', padding: '0 4px',
};
const body: CSSProperties = {
    overflow: 'auto', padding: '14px 18px',
    flex: 1, minHeight: 0,
};

export interface InfoModalProps {
    open: boolean;
    title: string;
    onClose(): void;
    children: ReactNode;
}

export function InfoModal({ open, title, onClose, children }: InfoModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label={title} style={overlay} onClick={onBackdrop}>
            <div style={panel}>
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

- [ ] **Step 4: Run, expect pass**

```bash
cd editor && npx vitest run src/info/InfoModal.test.tsx
```

Expected: 8/8 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/info/InfoModal.tsx editor/src/info/InfoModal.test.tsx
git commit -m "$(cat <<'EOF'
info: add InfoModal — generic dialog shell with title, close, scrollable body

Pattern mirrors UploadConfirm.tsx (overlay + portal + Escape handler).
Backdrop click closes only when the click target is the backdrop
itself. Body region has overflow:auto and a 80vh max height so long
reference content scrolls inside the dialog rather than expanding it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `MiniScore.tsx`

**Files:**
- Create: `editor/src/info/MiniScore.tsx`
- Create: `editor/src/info/MiniScore.test.tsx`

Pattern reference: `editor/src/score/ScorePreview.tsx` (the lazy-import + render-into-inner-div approach we discovered abcjs requires).

- [ ] **Step 1: Write failing test**

Create `editor/src/info/MiniScore.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MiniScore } from './MiniScore';

const renderAbc = vi.fn((el: HTMLElement, _abc: string): void => {
    el.innerHTML = '<svg data-testid="mini-svg"></svg>';
});

vi.mock('abcjs', () => ({
    default:    { renderAbc: (el: HTMLElement, abc: string) => renderAbc(el, abc) },
    renderAbc:  (el: HTMLElement, abc: string) => renderAbc(el, abc),
}));

beforeEach(() => { renderAbc.mockClear(); });
afterEach(() => cleanup());

describe('MiniScore', () => {
    it('renders an SVG via abcjs for valid ABC', async () => {
        render(<MiniScore abc="K:C\nC D E F" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByTestId('mini-svg')).toBeInTheDocument());
    });

    it('renders an error band when abcjs throws', async () => {
        renderAbc.mockImplementationOnce(() => { throw new Error('mini-boom'); });
        render(<MiniScore abc="bogus" />);
        await waitFor(() => expect(screen.getByText(/mini-boom/i)).toBeInTheDocument());
    });

    it('re-renders when the abc prop changes', async () => {
        const { rerender } = render(<MiniScore abc="K:C\nC" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(1));
        rerender(<MiniScore abc="K:G\nG" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(2));
    });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd editor && npx vitest run src/info/MiniScore.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `MiniScore.tsx`**

Create `editor/src/info/MiniScore.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from 'react';

type RenderAbc = (target: HTMLElement, abc: string, options?: Record<string, unknown>) => unknown;

const outerWrap: CSSProperties = { display: 'block', margin: '6px 0' };
const errorBand: CSSProperties = {
    background: '#FEF2F2', color: '#B91C1C',
    border: '1px solid #FCA5A5', borderRadius: 4,
    padding: '4px 8px', fontSize: 11,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
};

export interface MiniScoreProps {
    abc: string;
}

export function MiniScore({ abc }: MiniScoreProps) {
    const targetRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [renderAbc, setRenderAbc] = useState<RenderAbc | null>(null);

    useEffect(() => {
        let cancelled = false;
        import('abcjs')
            .then((mod) => {
                if (cancelled) return;
                const fn: RenderAbc | undefined =
                    (mod as { renderAbc?: RenderAbc }).renderAbc ??
                    ((mod as { default?: { renderAbc?: RenderAbc } }).default?.renderAbc);
                if (!fn) { setError('abcjs module did not expose renderAbc'); return; }
                setRenderAbc(() => fn);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!renderAbc || !targetRef.current) return;
        setError(null);
        try {
            renderAbc(targetRef.current, abc, { staffwidth: 320, scale: 0.9 });
        } catch (err) {
            targetRef.current.innerHTML = '';
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [renderAbc, abc]);

    return (
        <div style={outerWrap}>
            {error && <div style={errorBand}>{error}</div>}
            <div ref={targetRef} aria-label="example score" />
        </div>
    );
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd editor && npx vitest run src/info/MiniScore.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/info/MiniScore.tsx editor/src/info/MiniScore.test.tsx
git commit -m "$(cat <<'EOF'
info: add MiniScore — inline ABC renderer for modal examples

A slimmed-down sibling of ScorePreview: fixed staffwidth (320),
0.9 scale, no ResizeObserver, no scroll host. abcjs is still
lazy-imported (Vite dedupes the chunk so it's shared with
ScorePreview).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `scriptApi.ts` data + sanity test

**Files:**
- Create: `editor/src/info/scriptApi.ts`
- Create: `editor/src/info/scriptApi.test.ts`

- [ ] **Step 1: Write failing data sanity test**

Create `editor/src/info/scriptApi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SCRIPT_API_SECTIONS, type ApiSection } from './scriptApi';

describe('SCRIPT_API_SECTIONS data', () => {
    it('has a non-empty list of sections', () => {
        expect(SCRIPT_API_SECTIONS.length).toBeGreaterThan(0);
    });

    it('every section is non-empty and has a title', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            expect(s.title.length).toBeGreaterThan(0);
            expect(s.items.length).toBeGreaterThan(0);
        }
    });

    it('every entry has name, signature, and description', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            for (const e of s.items) {
                expect(e.name.length).toBeGreaterThan(0);
                expect(e.signature.length).toBeGreaterThan(0);
                expect(e.description.length).toBeGreaterThan(0);
            }
        }
    });

    it('has no duplicate entry names within any section', () => {
        for (const s of SCRIPT_API_SECTIONS) {
            const names = s.items.map((e) => e.name);
            expect(new Set(names).size).toBe(names.length);
        }
    });

    it('includes the --@score annotation in an Annotations section', () => {
        const section = SCRIPT_API_SECTIONS.find((s: ApiSection) => s.title === 'Annotations');
        expect(section).toBeDefined();
        expect(section!.items.some((e) => e.name === '--@score')).toBe(true);
    });

    it('includes the _draw hook in a Hooks section', () => {
        const section = SCRIPT_API_SECTIONS.find((s: ApiSection) => s.title === 'Hooks');
        expect(section).toBeDefined();
        expect(section!.items.some((e) => e.name === '_draw')).toBe(true);
    });

    it('includes the music() audio function', () => {
        const audio = SCRIPT_API_SECTIONS.find((s) => s.title === 'Audio');
        expect(audio).toBeDefined();
        expect(audio!.items.some((e) => e.name === 'music')).toBe(true);
    });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd editor && npx vitest run src/info/scriptApi.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scriptApi.ts`**

Create `editor/src/info/scriptApi.ts`. The full content is structured data; signatures match `src/tinybit/lua_functions.c` exactly:

```ts
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

export const SCRIPT_API_SECTIONS: ApiSection[] = [
    {
        title: 'Hooks',
        items: [
            {
                name: '_draw',
                signature: 'function _draw() ... end',
                description: 'Called by the engine every frame. Define this in your script to draw your scene.',
                example: 'function _draw()\n  cls(0x0000)\n  sprite(0, 0, 8, 8, 60, 60, 8, 8)\nend',
            },
        ],
    },
    {
        title: 'Annotations',
        items: [
            {
                name: '--@score',
                signature: '--@score[: name]',
                description: 'Editor-only marker. Place above a Lua string literal containing an ABC score; the Score tab will list it as an editable score. Optional name shows up as a chip.',
                example: '--@score: tune\nlocal tune = [[\nL:1/4\nK:C\nC D E F |\n]]\nmusic(tune)',
            },
        ],
    },
    {
        title: 'Drawing',
        items: [
            { name: 'cls',          signature: 'cls()',                                                              description: 'Clear the display.' },
            { name: 'sprite',       signature: 'sprite(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',                 description: 'Blit a region of the spritesheet to the display.' },
            { name: 'duplicate',    signature: 'duplicate(sx, sy, sw, sh, tx, ty, tw, th[, rotation])',              description: 'Copy a region of the display back to the display (useful for trails / effects).' },
            { name: 'line',         signature: 'line(x1, y1, x2, y2)',                                               description: 'Stroke a line. Uses the current stroke color and width.' },
            { name: 'rect',         signature: 'rect(x, y, w, h)',                                                   description: 'Stroke + fill a rectangle. Uses current stroke + fill colors.' },
            { name: 'oval',         signature: 'oval(x, y, w, h)',                                                   description: 'Stroke + fill an oval inscribed in (x, y, w, h).' },
            { name: 'pset',         signature: 'pset(x, y, color)',                                                  description: 'Set one pixel to color (RGBA4444 integer).' },
            { name: 'pget',         signature: 'pget(x, y) -> color',                                                description: 'Read the color at (x, y).' },
            { name: 'poly_add',     signature: 'poly_add(x, y)',                                                     description: 'Append a vertex to the in-progress polygon.' },
            { name: 'poly_clear',   signature: 'poly_clear()',                                                       description: 'Clear the polygon vertex list.' },
            { name: 'draw_polygon', signature: 'draw_polygon()',                                                     description: 'Stroke + fill the current polygon.' },
            { name: 'stroke',       signature: 'stroke(width, color)',                                               description: 'Set stroke width (pixels) and color (RGBA4444).' },
            { name: 'fill',         signature: 'fill(color)',                                                        description: 'Set fill color (RGBA4444).' },
            { name: 'text',         signature: 'text(color)',                                                        description: 'Set text color (RGBA4444). Affects subsequent print() calls.' },
            { name: 'cursor',       signature: 'cursor(x, y)',                                                       description: 'Set the text cursor position.' },
            { name: 'print',        signature: 'print(str)',                                                         description: 'Print str at the current cursor position.' },
        ],
    },
    {
        title: 'Color',
        items: [
            { name: 'rgb',  signature: 'rgb(r, g, b) -> color',         description: 'Pack 8-bit RGB into an RGBA4444 integer with alpha=255.' },
            { name: 'rgba', signature: 'rgba(r, g, b, a) -> color',     description: 'Pack 8-bit RGBA into an RGBA4444 integer.' },
            { name: 'hsb',  signature: 'hsb(h, s, b) -> color',         description: 'Pack 8-bit HSB into an RGBA4444 integer with alpha=255.' },
            { name: 'hsba', signature: 'hsba(h, s, b, a) -> color',     description: 'Pack 8-bit HSBA into an RGBA4444 integer.' },
        ],
    },
    {
        title: 'Audio',
        items: [
            {
                name: 'music',
                signature: 'music(abc_string)',
                description: 'Load and loop a music track from an ABC notation string on CHANNEL_MUSIC.',
                example: 'music([[\nL:1/4\nK:C\nC D E F |\n]])',
            },
            {
                name: 'sfx',
                signature: 'sfx(abc_string)',
                description: 'Play a one-shot SFX from an ABC notation string on CHANNEL_SFX.',
                example: 'sfx("c/4d/4e/4")',
            },
            { name: 'sfx_active', signature: 'sfx_active() -> bool',  description: 'Returns true while the SFX channel is still playing.' },
            { name: 'bpm',        signature: 'bpm(new_bpm)',          description: 'Set the audio engine tempo in beats per minute.' },
        ],
    },
    {
        title: 'Input',
        items: [
            { name: 'btn',   signature: 'btn(button) -> bool',   description: 'Returns true while button is held. Pass a button constant (A/B/UP/...).' },
            { name: 'btnp',  signature: 'btnp(button) -> bool',  description: 'Returns true only on the frame button was first pressed this hold.' },
            { name: 'A',     signature: 'A',                     description: 'Button constant: A.' },
            { name: 'B',     signature: 'B',                     description: 'Button constant: B.' },
            { name: 'UP',    signature: 'UP',                    description: 'Button constant: UP.' },
            { name: 'DOWN',  signature: 'DOWN',                  description: 'Button constant: DOWN.' },
            { name: 'LEFT',  signature: 'LEFT',                  description: 'Button constant: LEFT.' },
            { name: 'RIGHT', signature: 'RIGHT',                 description: 'Button constant: RIGHT.' },
            { name: 'START', signature: 'START',                 description: 'Button constant: START.' },
            { name: 'SELECT',signature: 'SELECT',                description: 'Button constant: SELECT.' },
        ],
    },
    {
        title: 'Misc',
        items: [
            { name: 'random', signature: 'random(min, max) -> int',  description: 'Random integer in [min, max] inclusive.' },
            { name: 'millis', signature: 'millis() -> int',          description: 'Current frame time in milliseconds.' },
            { name: 'sleep',  signature: 'sleep(ms)',                description: 'Block the engine for ms milliseconds.' },
            { name: 'peek',   signature: 'peek(addr) -> byte',       description: 'Read one byte from engine memory at addr.' },
            { name: 'poke',   signature: 'poke(addr, val)',          description: 'Write one byte (val & 0xFF) to engine memory at addr.' },
            { name: 'copy',   signature: 'copy(dst, src, size)',     description: 'Copy size bytes between two engine-memory addresses.' },
            { name: 'log',    signature: 'log(...)',                 description: 'Print arguments (separated by spaces) to the editor console.' },
        ],
    },
    {
        title: 'Constants',
        items: [
            { name: 'TB_SCREEN_WIDTH',  signature: 'TB_SCREEN_WIDTH = 128',     description: 'Display width in pixels.' },
            { name: 'TB_SCREEN_HEIGHT', signature: 'TB_SCREEN_HEIGHT = 128',    description: 'Display height in pixels.' },
            { name: 'SINE',             signature: 'SINE',                      description: 'Waveform constant. Currently the only waveform used by music() and sfx().' },
            { name: 'SAW',              signature: 'SAW',                       description: 'Waveform constant (reserved; engine currently always uses SINE).' },
            { name: 'SQUARE',           signature: 'SQUARE',                    description: 'Waveform constant (reserved).' },
            { name: 'NOISE',            signature: 'NOISE',                     description: 'Waveform constant (reserved).' },
        ],
    },
];
```

- [ ] **Step 4: Run, expect pass**

```bash
cd editor && npx vitest run src/info/scriptApi.test.ts
```

Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/info/scriptApi.ts editor/src/info/scriptApi.test.ts
git commit -m "$(cat <<'EOF'
info: add scriptApi.ts — structured Lua API + annotations data

Hand-curated to mirror src/tinybit/lua_functions.c (Lua-exposed
functions) plus the editor-only --@score annotation and the _draw
hook the engine looks up each frame. Grouped into Hooks /
Annotations / Drawing / Color / Audio / Input / Misc / Constants
in display order.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `abcInfo.ts` data + sanity test

**Files:**
- Create: `editor/src/info/abcInfo.ts`
- Create: `editor/src/info/abcInfo.test.ts`

- [ ] **Step 1: Write failing data sanity test**

Create `editor/src/info/abcInfo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ABC_SECTIONS } from './abcInfo';

describe('ABC_SECTIONS data', () => {
    it('has a non-empty list of sections', () => {
        expect(ABC_SECTIONS.length).toBeGreaterThan(0);
    });

    it('every section is non-empty and has a title', () => {
        for (const s of ABC_SECTIONS) {
            expect(s.title.length).toBeGreaterThan(0);
            expect(s.body.length).toBeGreaterThan(0);
        }
    });

    it('every entry has non-empty text', () => {
        for (const s of ABC_SECTIONS) {
            for (const e of s.body) {
                expect(e.text.length).toBeGreaterThan(0);
            }
        }
    });

    it('every entry with an abc field has at least 4 characters of content', () => {
        for (const s of ABC_SECTIONS) {
            for (const e of s.body) {
                if (e.abc !== undefined) {
                    expect(e.abc.length).toBeGreaterThanOrEqual(4);
                }
            }
        }
    });

    it('includes a Headers section and an Engine limits section', () => {
        const titles = ABC_SECTIONS.map((s) => s.title);
        expect(titles).toContain('Headers');
        expect(titles).toContain('Engine limits');
    });

    it('at least one section contains a rendered example (abc field)', () => {
        const anyAbc = ABC_SECTIONS.some((s) => s.body.some((e) => e.abc !== undefined));
        expect(anyAbc).toBe(true);
    });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd editor && npx vitest run src/info/abcInfo.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `abcInfo.ts`**

Create `editor/src/info/abcInfo.ts`:

```ts
export interface AbcEntry {
    text: string;
    abc?: string;
}

export interface AbcSection {
    title: string;
    body: AbcEntry[];
}

export const ABC_SECTIONS: AbcSection[] = [
    {
        title: 'Headers',
        body: [
            { text: 'Every score starts with header lines:' },
            { text: 'X:1 tune number. T:Title. M:4/4 meter. L:1/8 default note length. Q:1/4=120 tempo. K:C key.' },
            { text: 'A typical header block plus a few notes:', abc: 'X:1\nT:Example\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\nCDEF GABc |' },
        ],
    },
    {
        title: 'Notes and accidentals',
        body: [
            { text: 'Uppercase letters C–B are the C major scale in octave 4. Lowercase c–b are octave 5.' },
            { text: 'Trailing , drops an octave (C, = C in octave 3). Trailing \' raises (c\' = C in octave 6).' },
            { text: 'Prefix ^ for sharp, _ for flat, = for natural.' },
            { text: 'Example mixing pitches and accidentals:', abc: 'K:C\n^C D _E =F C, c\'' },
        ],
    },
    {
        title: 'Durations',
        body: [
            { text: 'L:1/8 sets the default note length. A bare C is one default unit; C2 is two units; C/2 is half; C3/4 is three-quarters.' },
            { text: 'Example showing 1, 2, /2, and 3/4 durations:', abc: 'L:1/8\nK:C\nC C2 C/2 C3/4 C2 |' },
        ],
    },
    {
        title: 'Rests',
        body: [
            { text: 'z is a rest. z2 is twice the default length. Z is a whole-measure rest.' },
            { text: 'Example with rests:', abc: 'L:1/4\nK:C\nC z D z2 E |' },
        ],
    },
    {
        title: 'Bars and repeats',
        body: [
            { text: 'A single | ends a bar. || or |] ends a section. |: ... :| repeats the enclosed material once.' },
            { text: 'Example with a repeat:', abc: 'L:1/4\nK:C\n|: C D E F :| G A B c |]' },
        ],
    },
    {
        title: 'Chords',
        body: [
            { text: 'Square brackets group simultaneous notes. Up to 3 notes per chord in this engine.' },
            { text: 'C major, F major, G major chords:', abc: 'K:C\n[CEG] [FAc] [GBd] |' },
        ],
    },
    {
        title: 'Tuplets',
        body: [
            { text: '(3 marks the next three notes as a triplet (three notes in the time of two). (2 is a duplet, (5 a quintuplet, and so on.' },
            { text: 'Triplet example:', abc: 'L:1/8\nK:C\n(3CDE (3FGA c2 |' },
        ],
    },
    {
        title: 'Voices',
        body: [
            { text: 'A V: header introduces or switches to a voice. The engine supports up to 3 voices, played simultaneously.' },
            { text: 'Two-voice example (melody + bass):', abc: 'L:1/8\nK:C\nV:MELODY\nCDEF GABc |\nV:BASS\nC,4 G,4 |' },
        ],
    },
    {
        title: 'Engine limits',
        body: [
            { text: 'Notes per voice: 400. Voices per score: 3. SFX channel limit: 10 notes.' },
            { text: 'Sample rate: 22 kHz (browser playback retunes if the host AudioContext disagrees).' },
            { text: 'Waveform: SINE only. The other waveform constants exist in the API but the engine currently hard-codes SINE.' },
        ],
    },
];
```

- [ ] **Step 4: Run, expect pass**

```bash
cd editor && npx vitest run src/info/abcInfo.test.ts
```

Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/info/abcInfo.ts editor/src/info/abcInfo.test.ts
git commit -m "$(cat <<'EOF'
info: add abcInfo.ts — sectioned ABC notation cheatsheet

Nine sections cover the headers, notes & accidentals, durations,
rests, bars + repeats, chords, tuplets, voices, and the engine's
own limits (per-voice note cap, voice cap, sample rate, SINE-only
synth). Most sections include a small ABC snippet for the modal to
render via MiniScore.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `ScriptApiModal.tsx`

**Files:**
- Create: `editor/src/info/ScriptApiModal.tsx`
- Create: `editor/src/info/ScriptApiModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `editor/src/info/ScriptApiModal.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ScriptApiModal } from './ScriptApiModal';
import { SCRIPT_API_SECTIONS } from './scriptApi';

afterEach(() => cleanup());

describe('ScriptApiModal', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<ScriptApiModal open={false} onClose={() => {}} />);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders every section heading from SCRIPT_API_SECTIONS', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        for (const s of SCRIPT_API_SECTIONS) {
            expect(screen.getByRole('heading', { name: s.title })).toBeInTheDocument();
        }
    });

    it('renders the --@score annotation entry', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        expect(screen.getByText('--@score')).toBeInTheDocument();
    });

    it('renders the _draw hook entry', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        expect(screen.getByText('_draw')).toBeInTheDocument();
    });

    it('invokes onClose when ✕ is clicked', () => {
        const onClose = vi.fn();
        render(<ScriptApiModal open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd editor && npx vitest run src/info/ScriptApiModal.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ScriptApiModal.tsx`**

Create `editor/src/info/ScriptApiModal.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { InfoModal } from './InfoModal';
import { SCRIPT_API_SECTIONS, type ApiEntry } from './scriptApi';

const sectionStyle: CSSProperties = { marginBottom: 20 };
const headingStyle: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: '#6B6B76',
    borderBottom: '1px solid #ECECF0',
    paddingBottom: 4, marginBottom: 8,
};
const entryStyle: CSSProperties = { marginBottom: 10 };
const nameRow: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' };
const nameStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontWeight: 700, color: '#181820',
};
const sigStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: '#6B6B76', fontSize: 12,
};
const descStyle: CSSProperties = { fontSize: 13, color: '#181820', marginTop: 2, lineHeight: 1.4 };
const exampleStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11, whiteSpace: 'pre',
    background: '#F6F6F8', border: '1px solid #ECECF0', borderRadius: 4,
    padding: '4px 8px', marginTop: 4, color: '#181820',
    overflowX: 'auto',
};

export interface ScriptApiModalProps {
    open: boolean;
    onClose(): void;
}

function Entry({ entry }: { entry: ApiEntry }) {
    return (
        <div style={entryStyle}>
            <div style={nameRow}>
                <span style={nameStyle}>{entry.name}</span>
                <span style={sigStyle}>{entry.signature}</span>
            </div>
            <div style={descStyle}>{entry.description}</div>
            {entry.example && <pre style={exampleStyle}>{entry.example}</pre>}
        </div>
    );
}

export function ScriptApiModal({ open, onClose }: ScriptApiModalProps) {
    return (
        <InfoModal open={open} title="Script API" onClose={onClose}>
            {SCRIPT_API_SECTIONS.map((section) => (
                <section key={section.title} style={sectionStyle}>
                    <h2 style={headingStyle}>{section.title}</h2>
                    {section.items.map((entry) => (
                        <Entry key={entry.name} entry={entry} />
                    ))}
                </section>
            ))}
        </InfoModal>
    );
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd editor && npx vitest run src/info/ScriptApiModal.test.tsx
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/info/ScriptApiModal.tsx editor/src/info/ScriptApiModal.test.tsx
git commit -m "$(cat <<'EOF'
info: add ScriptApiModal — InfoModal-wrapped Lua/annotations reference

Renders SCRIPT_API_SECTIONS as h2-headed sections, each entry as
{name (mono bold), signature (mono gray), description, optional
pre-formatted example}. Pure presentation; no internal state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `AbcInfoModal.tsx`

**Files:**
- Create: `editor/src/info/AbcInfoModal.tsx`
- Create: `editor/src/info/AbcInfoModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `editor/src/info/AbcInfoModal.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AbcInfoModal } from './AbcInfoModal';
import { ABC_SECTIONS } from './abcInfo';

const renderAbc = vi.fn((el: HTMLElement, _abc: string): void => {
    el.innerHTML = '<svg data-testid="abc-svg"></svg>';
});

vi.mock('abcjs', () => ({
    default:    { renderAbc: (el: HTMLElement, abc: string) => renderAbc(el, abc) },
    renderAbc:  (el: HTMLElement, abc: string) => renderAbc(el, abc),
}));

afterEach(() => { cleanup(); renderAbc.mockClear(); });

describe('AbcInfoModal', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<AbcInfoModal open={false} onClose={() => {}} />);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders every section heading from ABC_SECTIONS', () => {
        render(<AbcInfoModal open={true} onClose={() => {}} />);
        for (const s of ABC_SECTIONS) {
            expect(screen.getByRole('heading', { name: s.title })).toBeInTheDocument();
        }
    });

    it('renders a MiniScore via abcjs for entries with an abc field', async () => {
        const abcCount = ABC_SECTIONS.reduce((n, s) => n + s.body.filter((e) => e.abc !== undefined).length, 0);
        render(<AbcInfoModal open={true} onClose={() => {}} />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(abcCount));
    });

    it('invokes onClose when ✕ is clicked', () => {
        const onClose = vi.fn();
        render(<AbcInfoModal open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd editor && npx vitest run src/info/AbcInfoModal.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AbcInfoModal.tsx`**

Create `editor/src/info/AbcInfoModal.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { InfoModal } from './InfoModal';
import { MiniScore } from './MiniScore';
import { ABC_SECTIONS } from './abcInfo';

const sectionStyle: CSSProperties = { marginBottom: 22 };
const headingStyle: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: '#6B6B76',
    borderBottom: '1px solid #ECECF0',
    paddingBottom: 4, marginBottom: 8,
};
const textStyle: CSSProperties = { fontSize: 13, color: '#181820', lineHeight: 1.5, marginBottom: 6 };

export interface AbcInfoModalProps {
    open: boolean;
    onClose(): void;
}

export function AbcInfoModal({ open, onClose }: AbcInfoModalProps) {
    return (
        <InfoModal open={open} title="ABC Notation" onClose={onClose}>
            {ABC_SECTIONS.map((section) => (
                <section key={section.title} style={sectionStyle}>
                    <h2 style={headingStyle}>{section.title}</h2>
                    {section.body.map((entry, idx) => (
                        <div key={idx}>
                            <p style={textStyle}>{entry.text}</p>
                            {entry.abc && <MiniScore abc={entry.abc} />}
                        </div>
                    ))}
                </section>
            ))}
        </InfoModal>
    );
}
```

- [ ] **Step 4: Run, expect pass**

```bash
cd editor && npx vitest run src/info/AbcInfoModal.test.tsx
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/info/AbcInfoModal.tsx editor/src/info/AbcInfoModal.test.tsx
git commit -m "$(cat <<'EOF'
info: add AbcInfoModal — ABC primer with inline MiniScore examples

Renders ABC_SECTIONS as h2-headed sections of {paragraph text, optional
rendered MiniScore example}. Pure presentation; no internal state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `?` into Score tab

**Files:**
- Modify: `editor/src/score/ScoreTab.tsx`

- [ ] **Step 1: Add the help button + modal state to ScoreTab**

Open `editor/src/score/ScoreTab.tsx`.

Add to the import block at the top:

```ts
import { HelpButton } from '../info/HelpButton';
import { AbcInfoModal } from '../info/AbcInfoModal';
```

Inside `ScoreTab`, alongside the existing `useState` calls, add:

```ts
const [helpOpen, setHelpOpen] = useState(false);
```

Locate the chip bar JSX (a `<div style={chipBar}>` near the start of the returned JSX, which currently contains the chip buttons and the `+ New score` button). Add the `HelpButton` as the LAST child of that div, immediately after the existing `+ New score` button:

```tsx
<button type="button" style={newScoreBtn} onClick={handleNewScore}>+ New score</button>
<HelpButton onClick={() => setHelpOpen(true)} aria-label="ABC notation help" style={{ marginLeft: 4 }} />
```

Then, at the very end of the returned JSX (just before the outermost `</div>`), add the modal:

```tsx
<AbcInfoModal open={helpOpen} onClose={() => setHelpOpen(false)} />
```

- [ ] **Step 2: Verify type-check and tests still pass**

```bash
cd editor && npx tsc --noEmit && npx vitest run src/score/ScoreTab.test.tsx
```

Expected: zero TS errors. The existing 7 ScoreTab tests still pass (none of them care about the new button — yet).

- [ ] **Step 3: Add one new test to ScoreTab.test.tsx**

Append to `editor/src/score/ScoreTab.test.tsx`. The mock at the top of the file already mocks `abcjs`. Add this describe at the bottom:

```tsx
describe('ScoreTab — help modal', () => {
    it('opens the ABC modal when the ? button is clicked', () => {
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /abc notation help/i }));
        // The modal renders "ABC Notation" as a title.
        expect(screen.getByText('ABC Notation')).toBeInTheDocument();
    });
});
```

- [ ] **Step 4: Run, expect pass**

```bash
cd editor && npx vitest run src/score/ScoreTab.test.tsx
```

Expected: 8/8 pass.

- [ ] **Step 5: Commit**

```bash
git add editor/src/score/ScoreTab.tsx editor/src/score/ScoreTab.test.tsx
git commit -m "$(cat <<'EOF'
score: add ? button to chip bar opening the ABC notation modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire `?` overlay into Script tab via `App.tsx`

**Files:**
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/App.test.tsx`

- [ ] **Step 1: Add imports and state to `App.tsx`**

Open `editor/src/App.tsx`.

Add to the imports near the top (alongside the existing `ScoreTab` / `scoreHoverTooltip` imports):

```ts
import { HelpButton } from './info/HelpButton';
import { ScriptApiModal } from './info/ScriptApiModal';
```

Inside the `App` component, alongside the other `useState` calls, add:

```ts
const [scriptHelpOpen, setScriptHelpOpen] = useState(false);
```

- [ ] **Step 2: Replace the bare `<CodeEditor>` script-tab branch with a positioning wrapper + corner `?`**

Locate the existing JSX:

```tsx
{activeTab === 'script' && (
    <CodeEditor
        value={sketch.script}
        onChange={sketch.setScript}
        extraExtensions={[scoreHoverExtension]}
    />
)}
```

Replace it with:

```tsx
{activeTab === 'script' && (
    <div style={{ position: 'relative', height: '100%' }}>
        <CodeEditor
            value={sketch.script}
            onChange={sketch.setScript}
            extraExtensions={[scoreHoverExtension]}
        />
        <HelpButton
            onClick={() => setScriptHelpOpen(true)}
            aria-label="Script API help"
            style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}
        />
    </div>
)}
```

- [ ] **Step 3: Render the modal at App level**

In the App's top-level JSX, place the `<ScriptApiModal>` alongside the existing `<UploadConfirm>` block (near the bottom, after `<AppSplit>`):

```tsx
<ScriptApiModal open={scriptHelpOpen} onClose={() => setScriptHelpOpen(false)} />
```

- [ ] **Step 4: Verify type-check is clean**

```bash
cd editor && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Add one new test to App.test.tsx**

`editor/src/App.test.tsx` currently has just one test (`renders toolbar brand`) and minimal imports. Replace the whole file with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './App';

test('renders toolbar brand', () => {
    render(<App />);
    expect(screen.getByText(/tinybit/i)).toBeInTheDocument();
});

test('opens the Script API modal when the ? button on the script tab is clicked', () => {
    render(<App />);
    const helpBtn = screen.getByRole('button', { name: /script api help/i });
    fireEvent.click(helpBtn);
    // InfoModal renders via createPortal into document.body; screen.getByText still finds it.
    expect(screen.getByText('Script API')).toBeInTheDocument();
});
```

Note: this test races with the async engine boot — if `getRuntime` rejects before the click happens, App swaps to a `bootError` view and the button disappears. In practice the rejection happens in a later microtask, so the synchronous assertion completes first. If this test ever turns flaky, replace it with a more explicit test in `ScriptApiModal.test.tsx` that mounts the modal directly.

- [ ] **Step 6: Run, expect pass**

```bash
cd editor && npx vitest run src/App.test.tsx
```

Expected: previous tests pass + the new one passes.

If the new test fails because the App boots asynchronously (engine loading), bump the assertion to be inside `waitFor()` and check the test mocks for the runtime initialization — the existing test in App.test.tsx is the template.

- [ ] **Step 7: Commit**

```bash
git add editor/src/App.tsx editor/src/App.test.tsx
git commit -m "$(cat <<'EOF'
app: overlay ? on the script editor opening the Script API modal

Wraps the script tab body in a position:relative container, then
absolutely positions HelpButton in the top-right corner so it
floats over CodeMirror without affecting layout. The modal itself
renders at App level so it overlays the full window when open.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire editor test suite**

```bash
cd editor && npm test
```

Expected: all tests pass. Note the new total count vs. before the branch (we add ~33 tests across the info module).

- [ ] **Step 2: Type-check + production build**

```bash
cd editor && npx tsc --noEmit && npm run build
```

Expected: zero TS errors, build succeeds, `editor/dist/` populated.

- [ ] **Step 3: Re-run the engine smokes for regressions**

```bash
node scripts/smoke_encoder.mjs
node scripts/smoke_decoder.mjs
node scripts/smoke_preview.mjs
```

Expected: each prints OK and exits 0.

- [ ] **Step 4: No final commit needed unless fixups surfaced**

If steps 1-3 are all clean, no further commits. If anything failed and was patched, commit with a `chore: verification fixups` message + Co-Authored-By trailer.

---

## Spec ↔ Plan coverage check

| Spec section | Covered by task(s) |
|---|---|
| User-facing surface — script-tab corner button | 9 |
| User-facing surface — score-tab chip-bar button | 8 |
| Modal shell (overlay, close, Esc, backdrop) | 2 |
| Script API content — Hooks (`_draw`) | 4 |
| Script API content — Annotations (`--@score`) | 4 |
| Script API content — Drawing, Color, Audio, Input, Misc, Constants | 4 |
| ABC content — Headers, Notes, Durations, Rests, Bars, Chords, Tuplets, Voices, Limits | 5 |
| MiniScore rendering of ABC examples | 3, 7 |
| HelpButton | 1 |
| ScriptApiModal | 6 |
| AbcInfoModal | 7 |
| Score tab wiring | 8 |
| App / script tab wiring | 9 |
| Error handling — abcjs throw inside MiniScore | 3 |
| Testing — unit/component coverage for each component + data files | 1-7 (each task) |
| Testing — App + ScoreTab integration assertions | 8, 9 |
