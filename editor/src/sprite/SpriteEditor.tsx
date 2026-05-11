import { useEffect, useRef, type CSSProperties } from 'react';
import { ToolRail } from './ToolRail';
import { ColorPanel } from './ColorPanel';
import { PixelCanvas, type PointerCb } from './PixelCanvas';
import { useSketchStore } from '../state/sketchStore';
import { useSpriteEditorStore, type Tool, type PencilSize } from '../state/spriteEditorStore';
import { stampBrush, drawLine, floodFill, readPixel } from './tools';
import { nextZoom, prevZoom } from './viewport';
import { encodePixelsToPng } from './png';

const root: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none' };
const topRow: CSSProperties = { display: 'flex', flex: '1 1 auto', minHeight: 0 };
const railCell: CSSProperties = { flexShrink: 0 };
const canvasCell: CSSProperties = { flex: '1 1 auto', minWidth: 0, minHeight: 0 };
const bottomCell: CSSProperties = { flexShrink: 0 };

const SIZE_LIST: PencilSize[] = [1, 2, 3, 4, 8];

export function SpriteEditor() {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const lastMoveRef = useRef<{ x: number; y: number } | null>(null);
    const baselineRef = useRef<Uint8Array | null>(null);
    const dirtyRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

    useEffect(() => {
        const s = useSketchStore.getState();
        if (s.spritePixels) return;
        useSketchStore.setState({ spritePixels: new Uint8Array(128 * 128 * 4) });
    }, []);

    useEffect(() => {
        let t: ReturnType<typeof setTimeout> | null = null;
        const unsub = useSketchStore.subscribe((s, prev) => {
            if (s.spritePixels === prev.spritePixels) return;
            if (!s.spritePixels) return;
            if (t) clearTimeout(t);
            t = setTimeout(async () => {
                try {
                    const px = useSketchStore.getState().spritePixels;
                    if (!px) return;
                    const png = await encodePixelsToPng(px);
                    useSketchStore.getState().setSprite(png);
                } catch { /* re-encode fail — next stroke will try again */ }
            }, 500);
        });
        return () => { unsub(); if (t) clearTimeout(t); };
    }, []);

    const panStateRef = useRef<{ spaceDown: boolean; dragging: boolean; lastX: number; lastY: number }>({ spaceDown: false, dragging: false, lastX: 0, lastY: 0 });

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === ' ') panStateRef.current.spaceDown = true; };
        const onKeyUp   = (e: KeyboardEvent) => { if (e.key === ' ') panStateRef.current.spaceDown = false; };
        const onMouseMove = (e: MouseEvent) => {
            const s = panStateRef.current;
            if (!s.dragging) return;
            const dx = e.clientX - s.lastX, dy = e.clientY - s.lastY;
            s.lastX = e.clientX; s.lastY = e.clientY;
            const ed = useSpriteEditorStore.getState();
            const z = ed.zoom;
            ed.setPan({ x: ed.pan.x + dx / z, y: ed.pan.y + dy / z });
        };
        const onMouseUp = () => { panStateRef.current.dragging = false; };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup',   onKeyUp);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup',   onMouseUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup',   onKeyUp);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup',   onMouseUp);
        };
    }, []);

    function onMouseDownCapture(e: React.MouseEvent<HTMLDivElement>) {
        const s = panStateRef.current;
        const isMiddle = e.button === 1;
        const isSpaceLeft = s.spaceDown && e.button === 0;
        if (isMiddle || isSpaceLeft) {
            s.dragging = true;
            s.lastX = e.clientX;
            s.lastY = e.clientY;
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function onWheel(e: React.WheelEvent<HTMLDivElement>) {
        e.preventDefault();
        const ed = useSpriteEditorStore.getState();
        const target = e.deltaY < 0 ? nextZoom(ed.zoom) : prevZoom(ed.zoom);
        if (target === ed.zoom) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        ed.setZoom(target, { sx: e.clientX - rect.left, sy: e.clientY - rect.top, canvasW: rect.width, canvasH: rect.height });
    }

    function handlePointer(...args: Parameters<PointerCb>): void {
        const [type, px, py, mods] = args;
        const sketch = useSketchStore.getState();
        const buf = sketch.spritePixels;
        if (!buf) return;
        const ed = useSpriteEditorStore.getState();

        if (type === 'down') {
            if (px < 0) return;
            // Only the left button paints. Middle drives pan; right is reserved.
            if (mods.button !== 0) return;
            baselineRef.current = new Uint8Array(buf);
            dirtyRef.current = { x: px, y: py, w: 1, h: 1 };
            applyTool(ed.tool, buf, px, py, true);
            lastMoveRef.current = { x: px, y: py };
            useSketchStore.setState({ spritePixels: new Uint8Array(buf.buffer) });
        } else if (type === 'move' && lastMoveRef.current && px >= 0) {
            if (ed.tool === 'pencil' || ed.tool === 'eraser') {
                const colour = ed.tool === 'eraser' ? 0 : ed.color;
                const r = drawLine(buf, lastMoveRef.current.x, lastMoveRef.current.y, px, py, ed.pencilSize, colour);
                growRect(dirtyRef.current!, r);
                useSketchStore.setState({ spritePixels: new Uint8Array(buf.buffer) });
            }
            lastMoveRef.current = { x: px, y: py };
        } else if (type === 'up') {
            const baseline = baselineRef.current;
            const dirty = dirtyRef.current;
            baselineRef.current = null;
            dirtyRef.current = null;
            lastMoveRef.current = null;
            if (!baseline || !dirty) return;
            if (ed.tool === 'eyedropper') return;
            const before = sliceRect(baseline, dirty);
            const after  = sliceRect(buf, dirty);
            useSpriteEditorStore.getState().pushPatch({ rect: dirty, before, after });
        }
    }

    function applyTool(tool: Tool, buf: Uint8Array, px: number, py: number, isDown: boolean) {
        const ed = useSpriteEditorStore.getState();
        if (tool === 'pencil') {
            const r = stampBrush(buf, px, py, ed.pencilSize, ed.color);
            growRect(dirtyRef.current!, r);
        } else if (tool === 'eraser') {
            const r = stampBrush(buf, px, py, ed.pencilSize, 0);
            growRect(dirtyRef.current!, r);
        } else if (tool === 'fill') {
            const r = floodFill(buf, px, py, ed.color);
            if (r) growRect(dirtyRef.current!, r);
        } else if (tool === 'eyedropper' && isDown) {
            const c = readPixel(buf, px, py);
            ed.setColor(c);
            ed.setTool('pencil');
        }
    }

    function growRect(target: { x: number; y: number; w: number; h: number }, r: { x: number; y: number; w: number; h: number }) {
        const x0 = Math.min(target.x, r.x), y0 = Math.min(target.y, r.y);
        const x1 = Math.max(target.x + target.w, r.x + r.w);
        const y1 = Math.max(target.y + target.h, r.y + r.h);
        target.x = x0; target.y = y0; target.w = x1 - x0; target.h = y1 - y0;
    }

    function sliceRect(buf: Uint8Array, rect: { x: number; y: number; w: number; h: number }): Uint8Array {
        const out = new Uint8Array(rect.w * rect.h * 4);
        let oi = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const off = (y * 128 + rect.x) * 4;
            out.set(buf.subarray(off, off + rect.w * 4), oi);
            oi += rect.w * 4;
        }
        return out;
    }

    function writePatch(buf: Uint8Array, rect: { x: number; y: number; w: number; h: number }, data: Uint8Array) {
        let si = 0;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const off = (y * 128 + rect.x) * 4;
            buf.set(data.subarray(si, si + rect.w * 4), off);
            si += rect.w * 4;
        }
    }

    function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
        const ed = useSpriteEditorStore.getState();
        switch (e.key) {
            case 'b': ed.setTool('pencil'); break;
            case 'e': ed.setTool('eraser'); break;
            case 'g': ed.setTool('fill'); break;
            case 'i': ed.setTool('eyedropper'); break;
            case '+': case '=': ed.setZoom(nextZoom(ed.zoom)); break;
            case '-': ed.setZoom(prevZoom(ed.zoom)); break;
            case '[': {
                const i = SIZE_LIST.indexOf(ed.pencilSize);
                if (i > 0) ed.setPencilSize(SIZE_LIST[i - 1]);
                break;
            }
            case ']': {
                const i = SIZE_LIST.indexOf(ed.pencilSize);
                if (i < SIZE_LIST.length - 1) ed.setPencilSize(SIZE_LIST[i + 1]);
                break;
            }
            case 'z':
                if (e.ctrlKey || e.metaKey) {
                    const buf = useSketchStore.getState().spritePixels;
                    if (!buf) return;
                    if (e.shiftKey) ed.redo((p) => writePatch(buf, p.rect, p.after));
                    else            ed.undo((p) => writePatch(buf, p.rect, p.before));
                    useSketchStore.setState({ spritePixels: new Uint8Array(buf.buffer) });
                }
                break;
        }
    }

    return (
        <div ref={rootRef} tabIndex={0} style={root} onKeyDown={handleKey} onMouseDownCapture={onMouseDownCapture} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}>
            <div style={topRow}>
                <div style={railCell}><ToolRail /></div>
                <div style={canvasCell}><PixelCanvas onPointer={handlePointer} /></div>
            </div>
            <div style={bottomCell}><ColorPanel /></div>
        </div>
    );
}
