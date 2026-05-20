import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getRuntime, type Runtime } from '../engine/runtime';
import { makeFrameLoop, type FrameLoop } from '../engine/frameLoop';
import { loadGallery } from '../state/gallery';
import { configureGameLoader, clearGameLoader } from '../engine/gameLoader';
import { PlayerShell } from './PlayerShell';

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

export function PlayerRoute() {
    const [state, setState] = useState<State>({ kind: 'boot' });
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const runtimeRef = useRef<Runtime | null>(null);
    const frameLoopRef = useRef<FrameLoop | null>(null);

    // A promise that resolves with the canvas DOM node the moment the callback
    // ref fires. Using rAF to wait for canvas mount is unreliable (Firefox
    // Android in particular runs the rAF before the React commit attaches the
    // node); a callback ref is deterministic.
    const canvasReadyRef = useRef<{
        promise: Promise<HTMLCanvasElement>;
        resolve: (c: HTMLCanvasElement) => void;
    } | null>(null);
    if (canvasReadyRef.current === null) {
        let resolve!: (c: HTMLCanvasElement) => void;
        const promise = new Promise<HTMLCanvasElement>((r) => { resolve = r; });
        canvasReadyRef.current = { promise, resolve };
    }
    const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
        canvasRef.current = node;
        if (node) canvasReadyRef.current!.resolve(node);
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const rt = await getRuntime({ stdout: () => {}, stderr: () => {} });
                if (cancelled) return;
                runtimeRef.current = rt;
                frameLoopRef.current = makeFrameLoop(rt.tb);

                const g = await loadGallery(rt.dec);
                if (cancelled) return;
                configureGameLoader({
                    gallery: g.entries.map((e) => e.cartridge),
                    feed: (bytes) => rt.tb.feedCartridge(bytes),
                });

                setState({ kind: 'running' });
                await startLauncher(rt);
            } catch (err) {
                if (!cancelled) {
                    setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
                }
            }
        })();
        return () => {
            cancelled = true;
            frameLoopRef.current?.stop();
            runtimeRef.current?.tb.stop();
            clearGameLoader();
        };
    }, []);

    // Keyboard input (desktop convenience) — map only the six surfaced buttons.
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

    async function startLauncher(rt: Runtime): Promise<void> {
        const canvas = await canvasReadyRef.current!.promise;
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
        // Always return to the editor. Using an explicit URL (rather than
        // history.back) keeps behaviour predictable for direct-link visits
        // and for tabs where about:blank sits in the back stack.
        window.location.href = '/';
    }

    function handleReset(): void {
        const rt = runtimeRef.current; if (!rt) return;
        frameLoopRef.current?.stop();
        rt.tb.stop();
        void startLauncher(rt);
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
        <PlayerShell
            canvasRef={setCanvasRef}
            onSetButton={handleSetButton}
            onExit={handleExit}
            onReset={handleReset}
        />
    );
}
