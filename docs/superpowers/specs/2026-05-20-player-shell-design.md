# Player Shell — Design

**Date:** 2026-05-20
**Status:** Spec
**Related code:** `editor/src/App.tsx`, `editor/src/ui/Toolbar.tsx`, `editor/src/state/gallery.ts`, `editor/src/state/persist.ts`, `editor/src/engine/tinybit.ts`, `editor/src/engine/frameLoop.ts`, `editor/index.html`, `editor/public/`

## Problem

The editor today runs a cartridge inside the editing surface: a fixed 128×128 canvas in the right-hand pane, surrounded by the toolbar, code editor, and console. That layout is fine on a desktop while authoring, but it has two specific gaps:

1. **Not playable on a phone.** The current canvas is small relative to a phone screen, controls are keyboard-only, and the editor chrome around it isn't useful when you just want to play.
2. **No "just play a cartridge" entry.** Every play path goes through the editor — you have to either load the gallery into the editor and press ▶ Play, or drag a `.tb.png` onto the editor surface. There's no way to send someone a URL that opens straight into a runnable cartridge.

## Goal

Add a separate *player* view that:

- Wraps the 128×128 engine canvas in a swappable device-image "Gameboy"-style shell, with painted-on buttons whose touch hitboxes drive the engine.
- Is reachable via URL — `?play=current` (boot the sketch currently being edited) and `?play` (boot the gallery picker, then the picked cartridge).
- Is mobile-friendly: full-bleed viewport, touch input via pointer events, no editor chrome.
- Reuses the existing gallery loader (which already decodes covers via the engine's exposed decoder), so cartridges in `editor/src/cartridges/` appear in the picker without a separate enumeration path.

## Non-goals

- Editing in the player. Player is play-only. To edit, return to the editor route.
- Live-syncing a running editor session into an already-open player tab. "Play current" is a one-shot snapshot of the sketch at navigation time.
- Save state, pause UI, fullscreen API, screenshot/share.
- Orientation lock or a distinct landscape layout. Single layout that scales and letterboxes.
- Multiple selectable shell skins. One shell asset, swappable by replacing the file and updating its coord config.
- Start and Select buttons. The shell exposes exactly six buttons — A, B, Up, Down, Left, Right. The engine still supports Start (Enter) and Select (Backspace) for cartridges played in the editor; the player view ignores them entirely.
- Modifying the C engine, the wasm crate, or the encoder/decoder. All needed FFI exports already exist (`tb_init`, `tb_feed_cartridge`, `tb_start`, `tb_stop`, `tb_set_button`, `tb_display_ptr`, `tb_audio_ptr`, `tb_dec_*`).
- Adding a new Vite entry/HTML. Single-bundle, single-`index.html`, route by query string.

## Routing

`App.tsx` dispatches on `window.location.search` *before* mounting the editor:

```
URL                       → Component
?play=current             → <PlayerRoute initial="current" />
?play   (or ?play=gallery)→ <PlayerRoute initial="gallery" />
(no ?play)                → <Editor />  (the current App)
```

A pure helper:

```ts
// editor/src/player/routing.ts
export type PlayerMode = 'current' | 'gallery';
export type Route = { kind: 'editor' } | { kind: 'player'; mode: PlayerMode };
export function pickRoute(search: string): Route;
```

`App.tsx` becomes a one-line router at the top:

```tsx
const route = pickRoute(window.location.search);
if (route.kind === 'player') return <PlayerRoute initial={route.mode} />;
return <Editor />;
```

The existing `App` body moves into an `Editor` component (unchanged behaviour). No router library; no `popstate` listener needed because navigating between routes is a full page load.

**Exit** is `history.back()`. The browser back button works because routes are real navigations. If `history.length === 1` (direct link, no prior page), a "Back to editor" link navigates to `/` instead.

## Entry points

### From the editor: 📱 Player button

Toolbar gets one new neutral button between **🗑 Clear** and **🎮 Gallery**:

```
[▶ Play] [■ Stop] [🗑 Clear] [📱 Player] [🎮 Gallery] [📂 Open] [⬇ Download]   Idle
```

`aria-label="Open in player"`. Behaviour:

1. Stop any running engine + frame loop (mirror existing `handleStop`).
2. Call `saveSketch(...)` synchronously (not the debounced variant) so the player route sees fresh state.
3. `window.location.search = '?play=current'` (full navigation; preserves history so back works).

Always enabled. Does not require `canPlay` — the player surfaces the same encode errors the editor would, so navigating with an empty script just shows an error card with a "Back" link.

### Standalone: `?play`

Pasting `?play` in the URL bar (or following an external link) lands directly on the gallery picker. No new editor-side button for this — adding one would be redundant ("Gallery in the player" is the same as "Gallery in the editor" plus an extra click). The URL is the affordance.

## The shell

### Asset

One PNG at `editor/public/player-shell.png` — painted-on device illustration including the screen bezel and all six buttons drawn in their visual positions. Placeholder for now; swap by replacing the file and updating coords.

### Layout config

A single typed const in `editor/src/player/shellLayout.ts`:

```ts
export type Pct = number; // 0–100, % of the *rendered image* (not viewport)

export interface ButtonRect { left: Pct; top: Pct; width: Pct; height: Pct; }

export interface ShellLayout {
  imageUrl: string;          // points at /player-shell.png by default
  imageAspect: number;       // intrinsic width / intrinsic height; used to size the wrapper before the image loads
  screen: ButtonRect;        // the 128×128 cutout
  buttons: Record<PlayerButton, ButtonRect>;  // hitbox per button
}

export type PlayerButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b';
```

`PlayerButton → engine idx` mapping mirrors `BUTTONS` in `editor/src/engine/tinybit.ts`: a=0, b=1, up=2, down=3, left=4, right=5. Lives next to the layout config so swap+remap is one file. The engine's idx 6 (Start) and idx 7 (Select) are deliberately not surfaced.

### Component shape

```
PlayerRoute (state machine, owns runtime & frame loop)
├── PlayerGallery (when mode='gallery' and no cart picked yet)
└── PlayerShell   (when running or boot-error)
    ├── <img src={layout.imageUrl} />   (background, object-fit:contain, centered)
    ├── <canvas/>                       (positioned per layout.screen, image-rendering:pixelated)
    ├── Hitbox × 6                      (positioned per layout.buttons[name])
    └── Exit chip (✕)                   (small button → history.back())
```

The shell wrapper sizes itself to the rendered image via a `ResizeObserver` on the `<img>`, then absolutely positions canvas + hitboxes inside it using `%` offsets. This keeps everything aligned at any viewport size without per-breakpoint media queries.

A button is a transparent `<button>` styled as `position: absolute` with `background: transparent`. Pressed state: `background: rgba(0,0,0,0.25)` while `pointerdown` is held — the painted-on button "darkens" without us trying to fake a 3D depression.

### Input

```ts
// editor/src/player/usePointerButton.ts
export function usePointerButton(
  setButton: (pressed: boolean) => void,
): React.HTMLAttributes<HTMLElement>;
```

Returns pointer-event handlers for one button. Pattern per button:

- `onPointerDown` → `e.currentTarget.setPointerCapture(e.pointerId)`, call `setButton(true)`.
- `onPointerUp`, `onPointerCancel`, `onLostPointerCapture` → `setButton(false)`.
- The component's style: `touchAction: 'none'` (prevents scroll/zoom interception inside the hitbox), `userSelect: 'none'`.

This handles finger slides off the button (`pointercancel` / `lostpointercapture`) cleanly without sticky-button bugs.

Keyboard support in the player route: a `keydown`/`keyup` listener that uses the same BUTTONS map but **filters to the six buttons that the shell exposes**. Pressing Enter or Backspace does nothing in the player. (The editor route keeps the existing full 8-button keyboard handling.)

## Data flow

### `mode='current'`

1. `PlayerRoute` mounts in state `'boot'`.
2. Wait for `getRuntime()` to resolve (reuse the existing singleton).
3. Read persisted sketch via existing `loadSketch()`.
4. Encode via `runtime.enc.encode(...)` using the same placeholders-for-null-sprite/cover logic as the editor's `buildCartridge`. Pure reuse — factor it out into `editor/src/engine/buildCartridge.ts` if cleaner.
5. `tb.init() → tb.feedCartridge(bytes) → tb.start()`, start the frame loop bound to the shell's `<canvas>`.
6. State → `'running'`.

Errors (engine boot, encode, Lua start error) → state `'error'` rendering an inline card with the message and a "Back to editor" link.

### `mode='gallery'`

1. `PlayerRoute` mounts in state `'gallery-loading'`.
2. Wait for runtime, then call `loadGallery(runtime.dec)` (already module-cached; already used by the editor's gallery modal).
3. Render `PlayerGallery` (a mobile-friendly grid of cover images, same data shape as the editor's `GalleryModal`).
4. User picks → re-use `loadCartridgeBytes`-style logic: `tb.init`, `feedCartridge(entry.cartridge)`, `start`, frame loop on. State → `'running'`.

A small back button in the shell returns to the gallery (state → `'gallery-ready'`), letting the user pick another cartridge without going through the editor.

## Viewport & CSS

`editor/index.html` currently must have the standard mobile viewport meta. The spec mandates:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

(If it's already present and correct, no change. If not, add it.)

Player-route-only CSS, scoped to a `<div>` with `data-route="player"`:

```css
[data-route="player"] {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  background: #181820;
  touch-action: manipulation;  /* disables browser double-tap-zoom */
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
```

The image is `object-fit: contain` so the device shell always fits the viewport with letterboxing on the off-axis. Canvas + hitboxes are children of a wrapper that mirrors the image's *rendered* (not natural) box; a `ResizeObserver` keeps the wrapper in sync.

## Audio

The existing AudioContext resume gesture (`audioWorklet.ts`) attaches to the document on construction. On mobile, the first pointerdown on any hitbox is a valid user gesture, so audio should start cleanly. If testing on a real device shows it doesn't, add an explicit `audioCtx.resume()` call inside `usePointerButton`'s first `pointerdown` for the session.

## File map

```
editor/public/player-shell.png                    # placeholder asset
editor/src/player/
  routing.ts          routing.test.ts             # pickRoute pure function
  shellLayout.ts                                  # asset + coords config
  PlayerRoute.tsx     PlayerRoute.test.tsx        # state machine + runtime wiring
  PlayerShell.tsx     PlayerShell.test.tsx        # image + canvas + hitboxes
  PlayerGallery.tsx   PlayerGallery.test.tsx      # mobile picker
  usePointerButton.ts usePointerButton.test.ts    # pointer wiring hook
editor/src/engine/
  buildCartridge.ts   buildCartridge.test.ts      # extracted from App.tsx; shared by editor and player
editor/src/App.tsx                                # add router shim at top
editor/src/ui/Toolbar.tsx                         # add 📱 Player button
editor/index.html                                 # verify viewport meta
editor/e2e/player.spec.ts                         # new Playwright spec
```

## Testing

- `routing.test.ts` — verifies `pickRoute('')`, `pickRoute('?play')`, `pickRoute('?play=current')`, `pickRoute('?play=gallery')`, `pickRoute('?something=else')` cases.
- `usePointerButton.test.ts` — driver issues synthetic `pointerdown`/`up`/`cancel`/`lostpointercapture` events and asserts on `setButton` calls.
- `PlayerShell.test.tsx` — given a layout config, asserts six hitboxes and one canvas exist with the expected positioning style.
- `PlayerGallery.test.tsx` — renders gallery entries from a mocked `loadGallery`; clicking a card calls the pick handler.
- `PlayerRoute.test.tsx` — drives the state machine: gallery flow (loading → ready → picked → running), current-sketch flow (boot → running), error path.
- `buildCartridge.test.ts` — the extracted helper, behaviour-equivalent to today's inline `buildCartridge` in App.
- Playwright `player.spec.ts` — visit `/?play=current`, wait for canvas, tap an A hitbox (via `page.touchscreen.tap(...)`), verify engine reacts (canvas pixel changes / no Lua error). Visit `/?play`, verify gallery entries render, pick one, verify canvas.
- Manual: real phone, both routes, both orientations.

## Yagni / future

Deliberately deferred (don't build now, don't preclude later):

- Theme variants of the shell (DMG / pocket / Color).
- A "play this cartridge directly" deep link by gallery id.
- In-shell "next/prev cartridge" navigation in gallery mode.
- An on-screen pause button.
- Per-orientation layouts.
- Start/Select buttons — keep the door open by leaving idx 6/7 in the engine and the editor keyboard map untouched; just don't surface them in `shellLayout`.
