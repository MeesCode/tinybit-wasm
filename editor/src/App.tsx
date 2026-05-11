import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSketchStore } from './state/sketchStore';
import { useConsoleStore } from './state/consoleStore';
import { loadSketch, saveSketchDebounced } from './state/persist';
import { getRuntime, type Runtime } from './engine/runtime';
import { makeFrameLoop, type FrameLoop, type FrameLoopState } from './engine/frameLoop';
import { BUTTONS, PREVENT_DEFAULT_KEYS } from './engine/tinybit';
import { EncodeError } from './engine/encoder';
import { DecodeError } from './engine/decoder';
import { readPngSize } from './lib/png';
import { getPlaceholderCover, getPlaceholderSprite } from './engine/placeholders';
import { Toolbar } from './ui/Toolbar';
import { EditorPane, type EditorTab } from './ui/EditorPane';
import { CodeEditor } from './editor/CodeEditor';
import { CartridgeTab } from './ui/CartridgeTab';
import { AltEditorTab } from './ui/AltEditorTab';
import { CanvasPane, type CanvasHandle } from './ui/CanvasPane';
import { ConsolePane } from './ui/ConsolePane';
import { AppSplit } from './ui/PanelSplitter';
import { UploadConfirm } from './ui/UploadConfirm';

const appStyle = { display: 'flex', flexDirection: 'column' as const, height: '100%' };

const dropOverlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9998,
    background: 'rgba(237, 34, 93, 0.18)',
    display: 'grid', placeItems: 'center',
    pointerEvents: 'none',
    color: '#FFFFFF', fontSize: 20, fontWeight: 700, letterSpacing: 0.5,
    textShadow: '0 1px 2px rgba(0,0,0,0.35)',
};

interface PendingUpload {
    bytes: Uint8Array;
    filename: string;
}

export function App() {
    const sketch = useSketchStore();
    const consoleAppend = useConsoleStore((s) => s.append);
    const [activeTab, setActiveTab] = useState<EditorTab>('script');
    const [engineState, setEngineState] = useState<FrameLoopState>('idle');
    const [runtime, setRuntime] = useState<Runtime | null>(null);
    const [bootError, setBootError] = useState<string | null>(null);
    const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragDepthRef = useRef(0);
    const frameLoopRef = useRef<FrameLoop | null>(null);
    const canvasRef = useRef<CanvasHandle | null>(null);
    const openInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        const stored = loadSketch();
        if (stored) {
            sketch.setScript(stored.script);
            sketch.setTitle(stored.title);
            sketch.setAuthor(stored.author);
            if (stored.sprite) {
                void sketch.setSpriteFromPng(stored.sprite).catch((err) => {
                    consoleAppend('warn', `Failed to decode persisted sprite: ${err instanceof Error ? err.message : String(err)}`);
                });
            }
            sketch.setCover(stored.cover);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Live-mirror painted pixels into the engine's spritesheet while running.
    useEffect(() => {
        if (!runtime) return;
        return useSketchStore.subscribe((s, prev) => {
            if (s.spritePixels && s.spritePixels !== prev.spritePixels) {
                runtime.spritesheet.fullReload(s.spritePixels);
            }
        });
    }, [runtime]);

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
                if (!rt.decoderAvailable) consoleAppend('warn', 'Decoder exports missing — rebuild after merging feat/tb-decoder.');
                const fl = makeFrameLoop(rt.tb);
                fl.onStateChange(setEngineState);
                fl.onError((msg) => consoleAppend('error', msg));
                frameLoopRef.current = fl;
                rt.spritesheet.setRunningPredicate(() => fl.state() === 'running');
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

    // Upload pipeline ────────────────────────────────────────────────────────

    const acceptFile = useCallback(async (file: File) => {
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const size = readPngSize(bytes);
            if (!size || size.width !== 256 || size.height !== 256) {
                consoleAppend('error',
                    size
                        ? `Not a TinyBit cartridge (expected 256×256 PNG, got ${size.width}×${size.height})`
                        : 'Not a TinyBit cartridge (expected 256×256 PNG)');
                return;
            }
            setPendingUpload({ bytes, filename: file.name });
        } catch (err) {
            consoleAppend('error', err instanceof Error ? err.message : String(err));
        }
    }, [consoleAppend]);

    const handleConfirmReplace = useCallback(() => {
        const pu = pendingUpload;
        setPendingUpload(null);
        if (!pu || !runtime || !runtime.decoderAvailable) {
            if (pu) consoleAppend('error', 'Decoder not available in this WASM build.');
            return;
        }
        try {
            const result = runtime.dec.decode(pu.bytes);
            sketch.loadCartridge({
                title:  result.title,
                author: result.author,
                sprite: result.sprite,
                cover:  result.cover,
                script: result.script,
            });
            consoleAppend('log', `Loaded '${result.title || 'untitled'}' by ${result.author || '<unknown>'}`);
            if (!result.crcOk) {
                consoleAppend('warn', 'Loaded with CRC mismatch (script may be corrupted)');
            }
        } catch (err) {
            if (err instanceof DecodeError) consoleAppend('error', `Decode failed (${err.code}): ${err.message}`);
            else consoleAppend('error', err instanceof Error ? err.message : String(err));
        }
    }, [pendingUpload, runtime, sketch, consoleAppend]);

    const handleConfirmCancel = useCallback(() => {
        setPendingUpload(null);
    }, []);

    const handleOpenClick = useCallback(() => {
        openInputRef.current?.click();
    }, []);

    const onOpenInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = ''; // allow re-picking the same file
        if (f) void acceptFile(f);
    }, [acceptFile]);

    // Drag-and-drop wiring ───────────────────────────────────────────────────

    useEffect(() => {
        const onDragEnter = (e: DragEvent) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            dragDepthRef.current += 1;
            setIsDragging(true);
        };
        const onDragOver = (e: DragEvent) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        };
        const onDragLeave = (e: DragEvent) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
            e.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setIsDragging(false);
        };
        const onDrop = (e: DragEvent) => {
            if (!e.dataTransfer) return;
            e.preventDefault();
            dragDepthRef.current = 0;
            setIsDragging(false);
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                void acceptFile(files[0]);
            }
        };
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover',  onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop',      onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover',  onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop',      onDrop);
        };
    }, [acceptFile]);

    // Encode / play / download ───────────────────────────────────────────────

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
            // Overwrite the cartridge's spritesheet with the live edited buffer so
            // edits made before Play take effect from frame 0.
            const pixels = useSketchStore.getState().spritePixels;
            if (pixels) rt.spritesheet.fullReload(pixels);
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
                onOpen={handleOpenClick}
                onDownload={handleDownload}
                onResetEngine={handleResetEngine}
            />
            <input
                ref={openInputRef}
                data-testid="open-input"
                type="file"
                accept=".png,image/png"
                style={{ display: 'none' }}
                onChange={onOpenInputChange}
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
            {isDragging && <div style={dropOverlayStyle}>Drop .tb.png to open</div>}
            {pendingUpload && (
                <UploadConfirm
                    filename={pendingUpload.filename}
                    onReplace={handleConfirmReplace}
                    onCancel={handleConfirmCancel}
                />
            )}
        </div>
    );
}
