# Mobile Editor Entry — Design

**Date:** 2026-05-21
**Status:** Spec
**Related code:** `editor/src/App.tsx`, `editor/src/Editor.tsx`, `editor/src/player/routing.ts`, `editor/src/ui/Toolbar.tsx`, `editor/index.html`

## Problem

The editor route (`/`) renders a multi-pane desktop layout: toolbar + script/sprite/cartridge tabs + canvas pane + console pane, glued together by `AppSplit`. On a phone-sized viewport this collapses into something unusable — pane minimums fight the viewport width, the script editor and sprite editor are both too small to interact with, and the toolbar's "Player" button (which would actually let the user *do* something on the device) is buried among editor-only controls.

The player route (`?play`) is already fully mobile-friendly: touch hitboxes via pointer events, dynamic viewport units, aspect-preserving shell layout. It just isn't where phone users land by default.

## Goal

When a phone-sized viewport visits the editor URL, show a focused landing screen whose primary action is "Play games" (→ `?play`). Phone users get a one-tap path into the playable, mobile-ready experience. Desktop is untouched.

## Non-goals

- A responsive / mobile-friendly editor. Authoring stays desktop-first by design — phones don't get the script editor, sprite editor, score editor, or cartridge tab.
- A redirect. The landing screen is a screen with a button, not an automatic navigation, so shared `/` links don't silently rewrite themselves to `?play`.
- Tablet-specific UX. iPad portrait (768 CSS px) falls just above the breakpoint and keeps the desktop editor. Reasonable default; revisit if data says otherwise.
- Persistent opt-out across sessions. The "Open editor anyway" escape is session-scoped only.
- Engine changes, player changes, gallery changes. The landing screen sits entirely above the editor's existing surface area.
- Server-side detection or UA sniffing. Width-based only.

## Detection

A pure helper exposed as a hook:

```ts
// editor/src/ui/useIsNarrowViewport.ts
export const NARROW_BREAKPOINT_PX = 720;
export function useIsNarrowViewport(): boolean;
```

Implementation uses `window.matchMedia('(max-width: 720px)')` and subscribes to its `change` event so the result re-renders on rotation / window resize. SSR-safe default is `false` (treat unknown as desktop).

**Why 720 px:**
- Phone *portrait* widths sit well below 720 CSS px (typical 360–430), so the landing reliably catches the "someone tapped a link on their phone" case.
- Phone *landscape* widths (≈ 667–932 depending on device) mostly sit above 720, so a user who deliberately rotates to landscape gets the editor — at which point the toolbar's existing "Player" button is right there if they decide they actually wanted to play.
- iPad portrait (768 px) sits just above the threshold, keeping the editor on tablets where it remains usable.
- Below ~720 px the `AppSplit` pane minimums already break the layout, so this is roughly the existing "editor stops working" threshold.

## Routing

Today `App.tsx` is:

```tsx
const route = pickRoute(window.location.search);
if (route.kind === 'player') return <PlayerRoute />;
return <Editor />;
```

It becomes:

```tsx
const route = pickRoute(window.location.search);
if (route.kind === 'player') return <PlayerRoute />;
return <MobileGate><Editor /></MobileGate>;
```

`MobileGate` is a tiny wrapper:

```tsx
function MobileGate({ children }: { children: ReactNode }) {
    const narrow = useIsNarrowViewport();
    const [optedOut, setOptedOut] = useState(() => readOptOutFlag());
    if (!narrow || optedOut) return <>{children}</>;
    return <MobileLanding onOpenEditor={() => { writeOptOutFlag(); setOptedOut(true); }} />;
}
```

`readOptOutFlag` / `writeOptOutFlag` read & write `sessionStorage['tinybit:editor-on-mobile']`. Both are no-ops if storage is unavailable (private mode, quota errors) — failure mode is "show the landing screen again," which is the safer fallback.

`pickRoute` and `PlayerRoute` are untouched.

## `MobileLanding` component

New file: `editor/src/ui/MobileLanding.tsx`.

Layout (full viewport, `100dvh`, dark `#181820` to match `PlayerShell`):

```
                ┌─────────────────────────────┐
                │                             │
                │        tinybit              │   ← brand text, large
                │                             │
                │  An itty-bitty game engine  │   ← tagline, muted
                │                             │
                │   ┌─────────────────────┐   │
                │   │  ▶  Play games      │   │   ← primary CTA, brand pink
                │   └─────────────────────┘   │
                │                             │
                │   Editing works best on a   │   ← caption
                │   bigger screen.            │
                │                             │
                │   Open editor anyway →      │   ← subtle text link
                │                             │
                └─────────────────────────────┘
```

Behavior:

- **Play button** → `window.location.search = '?play'`. Same one-line navigation as the toolbar's existing "Player" button. The player route handles its own engine boot; `MobileLanding` does not import `getRuntime` and does not touch wasm — keeping first paint fast on mobile.
- **"Open editor anyway"** → calls the `onOpenEditor` prop, which sets the session flag and re-renders `MobileGate` to expose the editor for the remainder of the session.
- Brand text matches the toolbar's `#ED225D` brand color.
- Play button is large enough to be a comfortable touch target (≥ 48 dp tall, full inset width with margin).
- Uses `100dvh` not `100vh` so mobile browser chrome doesn't push the CTA off-screen.
- No persisted state aside from the session opt-out flag; no animation; no autoplay.

## Opt-out persistence

`sessionStorage['tinybit:editor-on-mobile'] = '1'` when the user taps "Open editor anyway". The choice is:

| Option                | Behavior                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| No persistence        | User sees the landing every reload — too naggy if they're trying to actually look at the editor.      |
| **sessionStorage**    | Sticks for the tab/session. Fresh tabs (the common "tapped a shared link" path) re-show the landing. |
| localStorage          | Sticks forever. A one-off "let me see the editor" decision permanently changes default behavior — bad. |

`sessionStorage` is the right middle. Storage failures (private mode, exception throw) are caught and treated as "not opted out" — landing shows again, which is the safe direction.

## Toolbar

No changes. The existing "Player" button keeps working for desktop users and for mobile users who opted into the editor anyway.

## What about `?play` on mobile?

Already correct. `PlayerRoute` is unconditional — `MobileGate` only wraps the editor branch. A phone visiting `/?play` directly bypasses the landing and goes straight to `PlayerShell`, which is the desired behavior for shared player links.

## Testing

Unit tests:
- `useIsNarrowViewport` — fires on `matchMedia` change, returns initial state, defaults to `false` when `window` is undefined.
- Opt-out helpers — round-trip via `sessionStorage`, swallow storage errors gracefully.

Component tests (Vitest + jsdom):
- `MobileLanding` renders brand, Play, escape link; Play sets `location.search`; escape link calls `onOpenEditor`.
- `MobileGate`:
  - wide viewport → renders children (editor) unchanged
  - narrow viewport, no opt-out → renders `MobileLanding`, no `Editor` mount
  - narrow viewport, opt-out flag set on mount → renders children
  - narrow viewport, click "Open editor anyway" → flag written, children rendered

E2E (Playwright):
- One test with a 375×667 viewport visiting `/`: expects landing, taps Play, lands on `PlayerShell` (`data-route="player"`).
- One test with the same viewport that visits `/?play` directly: expects `PlayerShell` (verifies the gate doesn't interfere with the player route).

Existing editor and player tests are unaffected.

## Implementation order

1. `useIsNarrowViewport` hook + opt-out helpers + unit tests.
2. `MobileLanding` component + tests.
3. `MobileGate` wired into `App.tsx` + tests.
4. Playwright coverage.

Total surface: three new files (`useIsNarrowViewport.ts`, `MobileLanding.tsx`, and either an `optOut.ts` or co-locating helpers in `MobileLanding.tsx`), one small change to `App.tsx`.
