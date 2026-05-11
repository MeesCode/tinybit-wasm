import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSketchStore } from './state/sketchStore';
import { useConsoleStore } from './state/consoleStore';
import { loadSketch, saveSketchDebounced } from './state/persist';
import { getRuntime, type Runtime } from './engine/runtime';
import { makeFrameLoop, type FrameLoop, type FrameLoopState } from './engine/frameLoop';
import { BUTTONS, PREVENT_DEFAULT_KEYS } from './engine/tinybit';
import { EncodeError } from './engine/encoder';
import { getPlaceholderCover, getPlaceholderSprite } from './engine/placeholders';
import { Toolbar } from './ui/Toolbar';
import { EditorPane, type EditorTab } from './ui/EditorPane';
import { CodeEditor } from './editor/CodeEditor';
import { CartridgeTab } from './ui/CartridgeTab';
import { AltEditorTab } from './ui/AltEditorTab';
import { CanvasPane, type CanvasHandle } from './ui/CanvasPane';
import { ConsolePane } from './ui/ConsolePane';
import { AppSplit } from './ui/PanelSplitter';

const appStyle = { display: 'flex', flexDirection: 'column' as const, height: '100%' };

export function App() {
    const sketch = useSketchStore();
    const consoleAppend = useConsoleStore((s) => s.append);
    const [activeTab, setActiveTab] = useState<EditorTab>('script');
    const [engineState, setEngineState] = useState<FrameLoopState>('idle');
    const [runtime, setRuntime] = useState<Runtime | null>(null);
    const [bootError, setBootError] = useState<string | null>(null);
    const frameLoopRef = useRef<FrameLoop | null>(null);
    const canvasRef = useRef<CanvasHandle | null>(null);

    useEffect(() => {
        const stored = loadSketch();
        if (stored) {
            sketch.setScript(stored.script);
            sketch.setTitle(stored.title);
            sketch.setAuthor(stored.author);
            sketch.setSprite(stored.sprite);
            sketch.setCover(stored.cover);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        saveSketchDebounced(
            { script: sketch.script, sprite: sketch.sprite, cover: sketch.cover, title: sketch.title, author: sketch.author },
            (msg) => consoleAppend('warn', msg),
        );
    }, [sketch.script, sketch.sprite, sketch.cover, sketch.title, sketch.author, consoleAppend]);

    useEffect(() => {
        let cancelled = false;
        getRuntime({
            stdout: (line) => consoleAppend('engine', line),
            stderr: (line) => consoleAppend('engine', line),
        })
            .then((rt) => {
                if (cancelled) return;
                setRuntime(rt);
                if (!rt.encoderAvailable) consoleAppend('warn', 'Encoder exports missing — rebuild after merging feat/tb-encoder.');
                const fl = makeFrameLoop(rt.tb);
                fl.onStateChange(setEngineState);
                fl.onError((msg) => consoleAppend('error', msg));
                frameLoopRef.current = fl;
            })
            .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                if (!cancelled) setBootError(msg);
                consoleAppend('error', `Engine boot failed: ${msg}`);
            });
        return () => { cancelled = true; };
    }, [consoleAppend]);

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            const rt = runtime; if (!rt) return;
            const idx = BUTTONS[e.key]; if (idx === undefined) return;
            if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
            if (e.repeat) return;
            rt.tb.setButton(idx, true);
        };
        const up = (e: KeyboardEvent) => {
            const rt = runtime; if (!rt) return;
            const idx = BUTTONS[e.key]; if (idx === undefined) return;
            if (PREVENT_DEFAULT_KEYS.has(e.key)) e.preventDefault();
            rt.tb.setButton(idx, false);
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [runtime]);

    const buildCartridge = useCallback(async (): Promise<Uint8Array | null> => {
        if (!runtime || !runtime.encoderAvailable) {
            consoleAppend('error', 'Encoder not available in this WASM build.');
            return null;
        }
        const sprite = sketch.sprite ?? await getPlaceholderSprite();
        const cover  = sketch.cover  ?? await getPlaceholderCover();
        try {
            return runtime.enc.encode({
                script: new TextEncoder().encode(sketch.script),
                sprite,
                cover,
                title:  sketch.title  || 'untitled',
                author: sketch.author || '',
            });
        } catch (err) {
            if (err instanceof EncodeError) consoleAppend('error', `Encode failed (${err.code}): ${err.message}`);
            else consoleAppend('error', String(err));
            return null;
        }
    }, [runtime, sketch.script, sketch.sprite, sketch.cover, sketch.title, sketch.author, consoleAppend]);

    const handlePlay = useCallback(async () => {
        const rt = runtime; const fl = frameLoopRef.current; const canvas = canvasRef.current?.getCanvas();
        if (!rt || !fl || !canvas) return;
        fl.stop();
        const bytes = await buildCartridge();
        if (!bytes) return;
        try {
            rt.tb.init();
            rt.tb.feedCartridge(bytes);
            rt.tb.start();
            await fl.start(canvas);
        } catch (err) {
            consoleAppend('error', err instanceof Error ? err.message : String(err));
        }
    }, [runtime, buildCartridge, consoleAppend]);

    const handleStop = useCallback(() => {
        frameLoopRef.current?.stop();
        runtime?.tb.stop();
    }, [runtime]);

    const handleDownload = useCallback(async () => {
        const bytes = await buildCartridge();
        if (!bytes) return;
        const safe = (sketch.title || 'cartridge').replace(/[^A-Za-z0-9._-]+/g, '_') || 'cartridge';
        const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safe}.tb.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, [buildCartridge, sketch.title]);

    const handleResetEngine = useCallback(() => {
        if (!runtime) return;
        runtime.tb.stop();
        setEngineState('idle');
    }, [runtime]);

    const canPlay = useMemo(() => runtime !== null && sketch.script.trim().length > 0, [runtime, sketch.script]);

    if (bootError) {
        return (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 40 }}>
                <div>
                    <h2 style={{ color: '#DC2626' }}>Failed to load engine</h2>
                    <p style={{ color: '#6B6B76' }}>{bootError}</p>
                    <button type="button" style={{ padding: '6px 14px', borderRadius: 6, background: '#ED225D', color: '#fff' }} onClick={() => location.reload()}>Reload</button>
                </div>
            </div>
        );
    }

    return (
        <div style={appStyle}>
            <Toolbar
                engineState={engineState}
                canPlay={canPlay}
                onPlay={handlePlay}
                onStop={handleStop}
                onDownload={handleDownload}
                onResetEngine={handleResetEngine}
            />
            <AppSplit
                left={
                    <EditorPane active={activeTab} onChange={setActiveTab}>
                        {activeTab === 'script' && <CodeEditor value={sketch.script} onChange={sketch.setScript} />}
                        {activeTab === 'alt' && <AltEditorTab />}
                        {activeTab === 'cartridge' && <CartridgeTab />}
                    </EditorPane>
                }
                rightTop={<CanvasPane ref={canvasRef} />}
                rightBottom={<ConsolePane />}
            />
        </div>
    );
}
