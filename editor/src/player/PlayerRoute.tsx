import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getRuntime, type Runtime } from '../engine/runtime';
import { makeFrameLoop, type FrameLoop } from '../engine/frameLoop';
import { loadSketch } from '../state/persist';
import { loadGallery } from '../state/gallery';
import { buildCartridge } from '../engine/buildCartridge';
import { configureGameLoader, clearGameLoader } from '../engine/gameLoader';
import { PlayerShell } from './PlayerShell';
import type { PlayerMode } from './routing';

type State =
    | { kind: 'boot' }
    | { kind: 'running' }
    | { kind: 'error'; message: string };

const errorWrap: CSSProperties = {
    width: '100vw', minHeight: '100dvh',
    background: '#181820', color: '#fff',
    display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
};

const linkStyle: CSSProperties = {
    color: '#ED225D', textDecoration: 'underline', marginTop: 12, display: 'inline-block',
};

export interface PlayerRouteProps {
    initial: PlayerMode;
}

export function PlayerRoute({ initial }: PlayerRouteProps) {
    const [state, setState] = useState<State>({ kind: 'boot' });
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const runtimeRef = useRef<Runtime | null>(null);
    const frameLoopRef = useRef<FrameLoop | null>(null);

    // Boot runtime + dispatch initial mode.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const rt = await getRuntime({ stdout: () => {}, stderr: () => {} });
                if (cancelled) return;
                runtimeRef.current = rt;
                frameLoopRef.current = makeFrameLoop(rt.tb);
                if (initial === 'current') {
                    await bootCurrent(rt);
                } else {
                    await bootGallery(rt);
                }
            } catch (err) {
                if (!cancelled) {
                    setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
                }
            }
        })();
        return () => {
            cancelled = true;
            // Stop the engine and tear down the game loader on unmount so a
            // stale gallery doesn't leak into a future ?play=current session.
            frameLoopRef.current?.stop();
            runtimeRef.current?.tb.stop();
            clearGameLoader();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keyboard input (desktop convenience) - map only the six surfaced buttons.
    useEffect(() => {
        const map: Record<string, number> = {
            a: 0, A: 0, b: 1, B: 1,
            ArrowUp: 2, ArrowDown: 3, ArrowLeft: 4, ArrowRight: 5,
        };
        const down = (e: KeyboardEvent) => {
            const idx = map[e.key]; if (idx === undefined) return;
            if (e.key.startsWith('Arrow')) e.preventDefault();
            if (e.repeat) return;
            runtimeRef.current?.tb.setButton(idx, true);
        };
        const up = (e: KeyboardEvent) => {
            const idx = map[e.key]; if (idx === undefined) return;
            if (e.key.startsWith('Arrow')) e.preventDefault();
            runtimeRef.current?.tb.setButton(idx, false);
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, []);

    async function bootCurrent(rt: Runtime): Promise<void> {
        const stored = loadSketch();
        if (!stored) throw new Error('No sketch saved. Open the editor first.');
        const result = await buildCartridge(rt.enc, {
            script: stored.script, sprite: stored.sprite, cover: stored.cover,
            title: stored.title, author: stored.author,
        });
        if (!result.ok) throw new Error(result.error);
        // ?play=current bypasses the engine's launcher entirely.
        clearGameLoader();
        setState({ kind: 'running' });
        await startCartridge(rt, result.bytes);
    }

    async function bootGallery(rt: Runtime): Promise<void> {
        // Populate the loader, then boot the engine without feeding a
        // cartridge — the built-in launcher script (loaded by tb.init) will
        // call gamecount()/gameload() and walk the user through selection.
        const g = await loadGallery(rt.dec);
        const carts = g.entries.map((e) => e.cartridge);
        configureGameLoader({
            gallery: carts,
            feed: (bytes) => rt.tb.feedCartridge(bytes),
        });
        setState({ kind: 'running' });
        await startLauncher(rt);
    }

    async function waitForCanvas(): Promise<HTMLCanvasElement> {
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not mounted');
        return canvas;
    }

    async function startCartridge(rt: Runtime, bytes: Uint8Array): Promise<void> {
        const canvas = await waitForCanvas();
        rt.tb.init();
        rt.tb.feedCartridge(bytes);
        rt.tb.start();
        await frameLoopRef.current!.start(canvas);
    }

    async function startLauncher(rt: Runtime): Promise<void> {
        const canvas = await waitForCanvas();
        // tb.init() loads the engine's built-in launcher Lua script. No
        // feedCartridge call — the launcher will request cartridge bytes
        // through the gamecount/gameload imports as the user navigates.
        rt.tb.init();
        rt.tb.start();
        await frameLoopRef.current!.start(canvas);
    }

    function handleSetButton(idx: number, pressed: boolean): void {
        runtimeRef.current?.tb.setButton(idx, pressed);
    }

    function handleExit(): void {
        frameLoopRef.current?.stop();
        runtimeRef.current?.tb.stop();
        // From ?play (the launcher), exit just restarts the launcher so the
        // user can pick another cartridge. From ?play=current, back out to
        // the editor.
        if (initial === 'gallery' && runtimeRef.current) {
            void startLauncher(runtimeRef.current);
            return;
        }
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = '/';
        }
    }

    if (state.kind === 'boot') {
        return <div style={errorWrap}>Loading engine…</div>;
    }
    if (state.kind === 'error') {
        return (
            <div style={errorWrap}>
                <div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Couldn't start</div>
                    <div style={{ color: '#cfcfd6' }}>{state.message}</div>
                    <a href="/" style={linkStyle}>Back to editor</a>
                </div>
            </div>
        );
    }
    return (
        <PlayerShell canvasRef={canvasRef} onSetButton={handleSetButton} onExit={handleExit} />
    );
}
