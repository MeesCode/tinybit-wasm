# Mobile Editor Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a phone-sized viewport (≤ 720 CSS px) visits the editor URL (`/`), show a focused landing screen with a "Play games" CTA into the existing `?play` route. Desktop and the player route are untouched.

**Architecture:** A new `MobileGate` wrapper in `App.tsx` intercepts the editor branch only. It uses `useIsNarrowViewport()` (a thin wrapper over `window.matchMedia`) plus a `sessionStorage`-backed opt-out flag to decide between rendering `<MobileLanding />` and the existing `<Editor />`. The player route is untouched and remains directly reachable on phones via `?play`.

**Tech Stack:** React 18 + TypeScript + Vite, Zustand (not used here), Vitest + jsdom + React Testing Library, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-05-21-mobile-editor-entry-design.md`

---

## File Structure

**Created:**
- `editor/src/ui/useIsNarrowViewport.ts` — pure hook around `matchMedia('(max-width: 720px)')`, plus the breakpoint constant.
- `editor/src/ui/useIsNarrowViewport.test.ts` — unit tests for the hook.
- `editor/src/ui/mobileOptOut.ts` — read/write helpers for the `sessionStorage` opt-out flag.
- `editor/src/ui/mobileOptOut.test.ts` — unit tests for the helpers.
- `editor/src/ui/MobileLanding.tsx` — the landing screen component.
- `editor/src/ui/MobileLanding.test.tsx` — component tests.
- `editor/src/ui/MobileGate.tsx` — wrapper that chooses between landing and editor.
- `editor/src/ui/MobileGate.test.tsx` — wrapper tests.
- `editor/tests/e2e/mobile.spec.ts` — Playwright coverage at a 375×667 viewport.

**Modified:**
- `editor/src/App.tsx` — wrap `<Editor />` with `<MobileGate>`.

**Untouched:**
- `editor/src/Editor.tsx`, all other editor surface area.
- `editor/src/player/*` — the player route already handles mobile correctly.
- `editor/src/ui/Toolbar.tsx` — its existing "Player" button keeps working for users who opted into the editor on mobile.

---

## Task 1: Width-detection hook

**Files:**
- Create: `editor/src/ui/useIsNarrowViewport.ts`
- Test: `editor/src/ui/useIsNarrowViewport.test.ts`

This task builds the pure viewport-width hook. Tests use a stubbed `window.matchMedia` because jsdom doesn't implement it.

- [ ] **Step 1: Write the failing test**

Create `editor/src/ui/useIsNarrowViewport.test.ts`:

```ts
import { describe, test, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsNarrowViewport, NARROW_BREAKPOINT_PX } from './useIsNarrowViewport';

interface StubMql {
    matches: boolean;
    listeners: Array<(e: MediaQueryListEvent) => void>;
}

function stubMatchMedia(initial: boolean): StubMql {
    const stub: StubMql = { matches: initial, listeners: [] };
    const mql = {
        get matches() { return stub.matches; },
        media: '',
        onchange: null,
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            stub.listeners.push(l);
        },
        removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            const i = stub.listeners.indexOf(l);
            if (i >= 0) stub.listeners.splice(i, 1);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn(() => mql),
    });
    return stub;
}

afterEach(() => {
    // Restore: jsdom never had matchMedia, so deleting is fine.
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('useIsNarrowViewport', () => {
    test('exposes the breakpoint constant at 720', () => {
        expect(NARROW_BREAKPOINT_PX).toBe(720);
    });

    test('returns true when the media query matches on mount', () => {
        stubMatchMedia(true);
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(true);
    });

    test('returns false when the media query does not match on mount', () => {
        stubMatchMedia(false);
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(false);
    });

    test('updates when the media query change event fires', () => {
        const stub = stubMatchMedia(false);
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(false);
        act(() => {
            stub.matches = true;
            stub.listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
        });
        expect(result.current).toBe(true);
    });

    test('removes its listener on unmount', () => {
        const stub = stubMatchMedia(false);
        const { unmount } = renderHook(() => useIsNarrowViewport());
        expect(stub.listeners.length).toBe(1);
        unmount();
        expect(stub.listeners.length).toBe(0);
    });

    test('defaults to false when matchMedia is unavailable', () => {
        // No stub installed — matchMedia is undefined in jsdom.
        const { result } = renderHook(() => useIsNarrowViewport());
        expect(result.current).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/ui/useIsNarrowViewport.test.ts`
Expected: FAIL with `Failed to resolve import "./useIsNarrowViewport"`.

- [ ] **Step 3: Write minimal implementation**

Create `editor/src/ui/useIsNarrowViewport.ts`:

```ts
import { useEffect, useState } from 'react';

export const NARROW_BREAKPOINT_PX = 720;
const QUERY = `(max-width: ${NARROW_BREAKPOINT_PX}px)`;

function readInitial(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
}

export function useIsNarrowViewport(): boolean {
    const [narrow, setNarrow] = useState<boolean>(readInitial);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(QUERY);
        const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return narrow;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npx vitest run src/ui/useIsNarrowViewport.test.ts`
Expected: PASS, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/useIsNarrowViewport.ts editor/src/ui/useIsNarrowViewport.test.ts
git commit -m "feat(editor): add useIsNarrowViewport hook (720px breakpoint)"
```

---

## Task 2: Session-storage opt-out helpers

**Files:**
- Create: `editor/src/ui/mobileOptOut.ts`
- Test: `editor/src/ui/mobileOptOut.test.ts`

These helpers wrap `sessionStorage` for the "Open editor anyway" escape flag, swallowing storage errors so failure mode is "show the landing screen again".

- [ ] **Step 1: Write the failing test**

Create `editor/src/ui/mobileOptOut.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readMobileEditorOptOut, writeMobileEditorOptOut, MOBILE_OPT_OUT_KEY } from './mobileOptOut';

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('mobileOptOut', () => {
    test('uses the documented storage key', () => {
        expect(MOBILE_OPT_OUT_KEY).toBe('tinybit:editor-on-mobile');
    });

    test('read returns false when nothing is stored', () => {
        expect(readMobileEditorOptOut()).toBe(false);
    });

    test('write sets the flag and read returns true', () => {
        writeMobileEditorOptOut();
        expect(sessionStorage.getItem(MOBILE_OPT_OUT_KEY)).toBe('1');
        expect(readMobileEditorOptOut()).toBe(true);
    });

    test('read returns false when the value is not "1"', () => {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, 'no');
        expect(readMobileEditorOptOut()).toBe(false);
    });

    test('read swallows storage exceptions and returns false', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(readMobileEditorOptOut()).toBe(false);
    });

    test('write swallows storage exceptions silently', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => writeMobileEditorOptOut()).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/ui/mobileOptOut.test.ts`
Expected: FAIL with `Failed to resolve import "./mobileOptOut"`.

- [ ] **Step 3: Write minimal implementation**

Create `editor/src/ui/mobileOptOut.ts`:

```ts
export const MOBILE_OPT_OUT_KEY = 'tinybit:editor-on-mobile';

export function readMobileEditorOptOut(): boolean {
    try {
        return sessionStorage.getItem(MOBILE_OPT_OUT_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeMobileEditorOptOut(): void {
    try {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, '1');
    } catch {
        // Storage may be unavailable (private mode, quota, security policy).
        // Failure mode: landing screen shows again — the safer fallback.
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npx vitest run src/ui/mobileOptOut.test.ts`
Expected: PASS, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/mobileOptOut.ts editor/src/ui/mobileOptOut.test.ts
git commit -m "feat(editor): add session-scoped mobile editor opt-out helpers"
```

---

## Task 3: `MobileLanding` component

**Files:**
- Create: `editor/src/ui/MobileLanding.tsx`
- Test: `editor/src/ui/MobileLanding.test.tsx`

The landing screen. Self-contained — no engine boot, no store imports.

- [ ] **Step 1: Write the failing test**

Create `editor/src/ui/MobileLanding.test.tsx`:

```tsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileLanding } from './MobileLanding';

const originalLocation = window.location;

afterEach(() => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
    });
});

describe('MobileLanding', () => {
    test('renders brand, tagline, play CTA, and editor escape link', () => {
        render(<MobileLanding onOpenEditor={() => {}} />);
        expect(screen.getByText('tinybit')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /play games/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /open editor anyway/i })).toBeInTheDocument();
    });

    test('clicking Play navigates to ?play via location.search', async () => {
        const setSearch = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                get search() { return ''; },
                set search(v: string) { setSearch(v); },
            },
        });
        render(<MobileLanding onOpenEditor={() => {}} />);
        await userEvent.click(screen.getByRole('button', { name: /play games/i }));
        expect(setSearch).toHaveBeenCalledWith('?play');
    });

    test('clicking the escape link calls onOpenEditor and does not navigate', async () => {
        const setSearch = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                get search() { return ''; },
                set search(v: string) { setSearch(v); },
            },
        });
        const onOpenEditor = vi.fn();
        render(<MobileLanding onOpenEditor={onOpenEditor} />);
        await userEvent.click(screen.getByRole('button', { name: /open editor anyway/i }));
        expect(onOpenEditor).toHaveBeenCalledTimes(1);
        expect(setSearch).not.toHaveBeenCalled();
    });

    test('marks itself with data-route for E2E targeting', () => {
        const { container } = render(<MobileLanding onOpenEditor={() => {}} />);
        expect(container.querySelector('[data-route="mobile-landing"]')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/ui/MobileLanding.test.tsx`
Expected: FAIL with `Failed to resolve import "./MobileLanding"`.

- [ ] **Step 3: Write minimal implementation**

Create `editor/src/ui/MobileLanding.tsx`:

```tsx
import type { CSSProperties } from 'react';

export interface MobileLandingProps {
    onOpenEditor(): void;
}

const wrapStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100dvh',
    background: '#181820',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    textAlign: 'center',
};

const brandStyle: CSSProperties = {
    fontWeight: 800,
    fontSize: 36,
    letterSpacing: 0.5,
    color: '#ED225D',
    marginBottom: 8,
};

const taglineStyle: CSSProperties = {
    color: '#cfcfd6',
    fontSize: 15,
    marginBottom: 32,
};

const playButtonStyle: CSSProperties = {
    background: '#ED225D',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '16px 28px',
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: 48,
    minWidth: 220,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
};

const captionStyle: CSSProperties = {
    color: '#9a9aa6',
    fontSize: 13,
    marginBottom: 16,
    maxWidth: 260,
    lineHeight: 1.4,
};

const linkStyle: CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#ED225D',
    fontSize: 13,
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 4,
};

export function MobileLanding({ onOpenEditor }: MobileLandingProps) {
    const onPlay = () => {
        window.location.search = '?play';
    };
    return (
        <div style={wrapStyle} data-route="mobile-landing">
            <div style={brandStyle}>tinybit</div>
            <div style={taglineStyle}>An itty-bitty game engine.</div>
            <button
                type="button"
                onClick={onPlay}
                style={playButtonStyle}
                aria-label="Play games"
            >
                ▶ Play games
            </button>
            <div style={captionStyle}>Editing works best on a bigger screen.</div>
            <button
                type="button"
                onClick={onOpenEditor}
                style={linkStyle}
                aria-label="Open editor anyway"
            >
                Open editor anyway →
            </button>
        </div>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npx vitest run src/ui/MobileLanding.test.tsx`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/MobileLanding.tsx editor/src/ui/MobileLanding.test.tsx
git commit -m "feat(editor): add MobileLanding component"
```

---

## Task 4: `MobileGate` wrapper

**Files:**
- Create: `editor/src/ui/MobileGate.tsx`
- Test: `editor/src/ui/MobileGate.test.tsx`

The wrapper chooses between `<MobileLanding>` and its children (the editor). It composes the hook from Task 1 and the helpers from Task 2.

- [ ] **Step 1: Write the failing test**

Create `editor/src/ui/MobileGate.test.tsx`:

```tsx
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileGate } from './MobileGate';
import { MOBILE_OPT_OUT_KEY } from './mobileOptOut';

interface StubMql {
    matches: boolean;
    listeners: Array<(e: MediaQueryListEvent) => void>;
}

function stubMatchMedia(initial: boolean): StubMql {
    const stub: StubMql = { matches: initial, listeners: [] };
    const mql = {
        get matches() { return stub.matches; },
        media: '',
        onchange: null,
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            stub.listeners.push(l);
        },
        removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            const i = stub.listeners.indexOf(l);
            if (i >= 0) stub.listeners.splice(i, 1);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn(() => mql),
    });
    return stub;
}

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    sessionStorage.clear();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('MobileGate', () => {
    test('renders children when viewport is wide', () => {
        stubMatchMedia(false);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.getByText('editor-content')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });

    test('renders MobileLanding (not children) when viewport is narrow and no opt-out', () => {
        stubMatchMedia(true);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.getByRole('button', { name: /play games/i })).toBeInTheDocument();
        expect(screen.queryByText('editor-content')).not.toBeInTheDocument();
    });

    test('renders children when viewport is narrow but opt-out flag is set', () => {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, '1');
        stubMatchMedia(true);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.getByText('editor-content')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });

    test('clicking "Open editor anyway" writes the flag and reveals the editor', async () => {
        stubMatchMedia(true);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.queryByText('editor-content')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /open editor anyway/i }));
        expect(sessionStorage.getItem(MOBILE_OPT_OUT_KEY)).toBe('1');
        expect(screen.getByText('editor-content')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npx vitest run src/ui/MobileGate.test.tsx`
Expected: FAIL with `Failed to resolve import "./MobileGate"`.

- [ ] **Step 3: Write minimal implementation**

Create `editor/src/ui/MobileGate.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { useIsNarrowViewport } from './useIsNarrowViewport';
import { readMobileEditorOptOut, writeMobileEditorOptOut } from './mobileOptOut';
import { MobileLanding } from './MobileLanding';

export interface MobileGateProps {
    children: ReactNode;
}

export function MobileGate({ children }: MobileGateProps) {
    const narrow = useIsNarrowViewport();
    const [optedOut, setOptedOut] = useState<boolean>(() => readMobileEditorOptOut());

    if (!narrow || optedOut) return <>{children}</>;

    return (
        <MobileLanding
            onOpenEditor={() => {
                writeMobileEditorOptOut();
                setOptedOut(true);
            }}
        />
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npx vitest run src/ui/MobileGate.test.tsx`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add editor/src/ui/MobileGate.tsx editor/src/ui/MobileGate.test.tsx
git commit -m "feat(editor): add MobileGate wrapper for narrow-viewport routing"
```

---

## Task 5: Wire `MobileGate` into `App.tsx`

**Files:**
- Modify: `editor/src/App.tsx`
- Modify: `editor/src/App.test.tsx`

Wrap the editor branch — only the editor branch. The player branch stays an unconditional `<PlayerRoute />` so phones reaching `?play` directly bypass the gate.

- [ ] **Step 1: Extend App tests for narrow-viewport behavior**

Replace the body of `editor/src/App.test.tsx` with:

```tsx
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';
import { MOBILE_OPT_OUT_KEY } from './ui/mobileOptOut';

const originalLocation = window.location;

function setSearch(search: string): void {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, search },
    });
}

interface StubMql {
    matches: boolean;
    listeners: Array<(e: MediaQueryListEvent) => void>;
}

function stubMatchMedia(initial: boolean): StubMql {
    const stub: StubMql = { matches: initial, listeners: [] };
    const mql = {
        get matches() { return stub.matches; },
        media: '',
        onchange: null,
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            stub.listeners.push(l);
        },
        removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            const i = stub.listeners.indexOf(l);
            if (i >= 0) stub.listeners.splice(i, 1);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn(() => mql),
    });
    return stub;
}

beforeEach(() => {
    setSearch('');
    sessionStorage.clear();
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    sessionStorage.clear();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('App router', () => {
    test('renders the editor by default on a wide viewport', () => {
        stubMatchMedia(false);
        render(<App />);
        expect(screen.getByText('tinybit')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });

    test('renders the player route when ?play is present (wide viewport)', () => {
        stubMatchMedia(false);
        setSearch('?play');
        render(<App />);
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders the player route when ?play=current is present (wide viewport)', () => {
        stubMatchMedia(false);
        setSearch('?play=current');
        render(<App />);
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders MobileLanding on the editor route when viewport is narrow', () => {
        stubMatchMedia(true);
        render(<App />);
        expect(screen.getByRole('button', { name: /play games/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('still renders the player route on ?play even when viewport is narrow', () => {
        stubMatchMedia(true);
        setSearch('?play');
        render(<App />);
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders the editor when narrow but opt-out flag is set', () => {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, '1');
        stubMatchMedia(true);
        render(<App />);
        expect(screen.getByText('tinybit')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify the narrow-viewport behavior is missing**

Run: `cd editor && npx vitest run src/App.test.tsx`
Expected: the `"renders MobileLanding on the editor route when viewport is narrow"` test FAILS — the current `App.tsx` always renders `<Editor />` on `/`, so the "Play games" button isn't present. The other tests may incidentally pass because the assertions happen to align with current behavior; that's fine. The point of step 2 is confirming there's a failing assertion the implementation will need to satisfy.

- [ ] **Step 3: Wire `MobileGate` into `App.tsx`**

Replace the body of `editor/src/App.tsx` with:

```tsx
import { Editor } from './Editor';
import { PlayerRoute } from './player/PlayerRoute';
import { pickRoute } from './player/routing';
import { MobileGate } from './ui/MobileGate';

export function App() {
    const route = pickRoute(window.location.search);
    if (route.kind === 'player') return <PlayerRoute />;
    return (
        <MobileGate>
            <Editor />
        </MobileGate>
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/App.test.tsx`
Expected: PASS, 6 tests passing.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run: `cd editor && npm test`
Expected: PASS, no regressions in existing component / store tests.

- [ ] **Step 6: Run TypeScript build check**

Run: `cd editor && npm run build`
Expected: completes successfully (tsc --noEmit + vite build).

- [ ] **Step 7: Commit**

```bash
git add editor/src/App.tsx editor/src/App.test.tsx
git commit -m "feat(editor): gate the editor route behind MobileGate"
```

---

## Task 6: E2E coverage at a phone viewport

**Files:**
- Create: `editor/tests/e2e/mobile.spec.ts`

Playwright defaults to 1280×800. Use `test.use({ viewport: ... })` to scope a phone viewport to this file.

- [ ] **Step 1: Write the E2E spec**

Create `editor/tests/e2e/mobile.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('mobile editor entry', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('narrow viewport on / shows the landing screen, not the editor', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /play games/i })).toBeVisible();
        await expect(page.locator('[data-route="mobile-landing"]')).toBeVisible();
        await expect(page.getByRole('button', { name: /clear editor/i })).toBeHidden();
    });

    test('tapping Play navigates to ?play and shows the PlayerShell', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /play games/i }).click();
        await expect(page).toHaveURL(/\?play(?!=)/);
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
    });

    test('"Open editor anyway" reveals the editor for the rest of the session', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /open editor anyway/i }).click();
        await expect(page.getByRole('button', { name: /clear editor/i })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: /play games/i })).toBeHidden();
    });

    test('?play on a narrow viewport bypasses the landing and boots the player directly', async ({ page }) => {
        await page.goto('/?play');
        await expect(page.getByLabel(/tinybit display/i)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: /play games/i })).toBeHidden();
    });
});
```

- [ ] **Step 2: Run the new E2E spec**

Run: `cd editor && npx playwright test tests/e2e/mobile.spec.ts`
Expected: PASS, 4 tests passing.

- [ ] **Step 3: Run the full E2E suite to catch regressions**

Run: `cd editor && npm run test:e2e`
Expected: PASS — existing `player.spec.ts`, `gallery.spec.ts`, `clear.spec.ts`, `sprite.spec.ts`, `upload.spec.ts`, `score.spec.ts`, `smoke.spec.ts` still pass at the default 1280×800 viewport.

- [ ] **Step 4: Commit**

```bash
git add editor/tests/e2e/mobile.spec.ts
git commit -m "test(editor): e2e coverage for mobile landing screen at 375x667"
```

---

## Task 7: Manual verification

This is not a code task — it's a verification pass against the running dev server before declaring the feature done.

- [ ] **Step 1: Start the dev server**

Run: `./scripts/dev.sh`
Expected: Vite serves at `http://localhost:5173`.

- [ ] **Step 2: Verify wide-viewport behavior**

In a desktop browser at default window size, open `http://localhost:5173/`. The editor (toolbar, panes, console) should render exactly as before. No landing screen.

- [ ] **Step 3: Verify narrow-viewport behavior via DevTools device mode**

In Chrome / Firefox DevTools, enable device toolbar, choose "iPhone SE" (375×667). Reload `http://localhost:5173/`. Expected:
- Full dark landing screen.
- Large pink "▶ Play games" button.
- "Open editor anyway →" link at the bottom.

- [ ] **Step 4: Verify Play navigation**

Tap the Play button. URL should become `http://localhost:5173/?play`. The PlayerShell should boot and the engine launcher cartridge should be visible inside the shell.

- [ ] **Step 5: Verify the escape link**

Navigate back to `http://localhost:5173/` (still in 375×667). Tap "Open editor anyway →". The editor surface should appear (cramped on the narrow viewport — that's expected and by design). Reload the page: editor should still render (session opt-out is sticky for the tab).

- [ ] **Step 6: Verify session-scoping**

Close the tab and open a new one to `http://localhost:5173/` at 375×667. Landing screen should re-appear (sessionStorage doesn't survive tab close).

- [ ] **Step 7: Verify direct player link still works**

At 375×667, visit `http://localhost:5173/?play` directly. Should go straight to the PlayerShell, not the landing.

- [ ] **Step 8: Verify the resize transition**

At desktop width, visit `http://localhost:5173/`. Shrink the window below 720 px width. The landing should appear without a reload. Expand back above 720 px — editor should return.

If any step fails, file a regression task and fix before continuing.
