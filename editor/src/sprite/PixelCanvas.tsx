import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSketchStore } from '../state/sketchStore';
import { useSpriteEditorStore } from '../state/spriteEditorStore';
import { screenToPixel, type Viewport } from './viewport';
import { computeOverlay, drawOverlay } from './overlay';

export type PointerCb = (
    type: 'down' | 'move' | 'up',
    px: number,
    py: number,
    modifiers: { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean; button: number },
) => void;

const SIZE = 128;
const wrapStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%', minHeight: 0 };
const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, imageRendering: 'pixelated' as CSSProperties['imageRendering'], cursor: 'crosshair' };

export function PixelCanvas({ onPointer }: { onPointer: PointerCb }) {
    const pixelsRef  = useRef<HTMLCanvasElement | null>(null);
    const overlayRef = useRef<HTMLCanvasElement | null>(null);
    const wrapRef    = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const spritePixels = useSketchStore((s) => s.spritePixels);
    const { zoom, pan, showGrid, showNumbers } = useSpriteEditorStore();

    // Track wrapper size
    useEffect(() => {
        if (!wrapRef.current) return;
        const el = wrapRef.current;
        const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        update();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Redraw pixel layer
    useEffect(() => {
        const c = pixelsRef.current;
        if (!c || size.w === 0) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = size.w * dpr; c.height = size.h * dpr;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.scale(dpr, dpr);

        // Checkerboard background to show transparency
        const tile = 16;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size.w, size.h);
        ctx.fillStyle = '#E8E8EE';
        for (let y = 0; y < size.h; y += tile) {
            for (let x = 0; x < size.w; x += tile) {
                if ((((x / tile) + (y / tile)) & 1) === 0) ctx.fillRect(x, y, tile, tile);
            }
        }

        if (!spritePixels) return;

        const off = document.createElement('canvas');
        off.width = SIZE; off.height = SIZE;
        const offCtx = off.getContext('2d');
        if (!offCtx) return;
        const img = new ImageData(new Uint8ClampedArray(spritePixels), SIZE, SIZE);
        offCtx.putImageData(img, 0, 0);

        const drawW = SIZE * zoom, drawH = SIZE * zoom;
        const x = Math.floor((size.w - drawW) / 2) + pan.x * zoom;
        const y = Math.floor((size.h - drawH) / 2) + pan.y * zoom;
        ctx.drawImage(off, x, y, drawW, drawH);
    }, [spritePixels, zoom, pan, size]);

    // Redraw overlay layer
    useEffect(() => {
        const c = overlayRef.current;
        if (!c || size.w === 0) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = size.w * dpr; c.height = size.h * dpr;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        const drawW = SIZE * zoom, drawH = SIZE * zoom;
        const sx = Math.floor((size.w - drawW) / 2) + pan.x * zoom;
        const sy = Math.floor((size.h - drawH) / 2) + pan.y * zoom;
        drawOverlay({
            ctx, canvasW: size.w, canvasH: size.h,
            plan: computeOverlay(zoom, showGrid, showNumbers),
            spriteRect: { x: sx, y: sy, w: drawW, h: drawH },
            zoom,
        });
    }, [zoom, pan, size, showGrid, showNumbers]);

    function makeHandler(type: 'down' | 'move' | 'up') {
        return (e: React.PointerEvent<HTMLCanvasElement>) => {
            const c = pixelsRef.current; if (!c) return;
            const rect = c.getBoundingClientRect();
            const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
            const vp: Viewport = { zoom, pan };
            const p = screenToPixel(vp, sx, sy, rect.width, rect.height);
            const mods = { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, button: e.button };
            if (!p) {
                if (type === 'up') onPointer(type, -1, -1, mods);
                return;
            }
            if (type === 'down') c.setPointerCapture(e.pointerId);
            if (type === 'up' && c.hasPointerCapture && c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
            onPointer(type, p.x, p.y, mods);
        };
    }

    return (
        <div ref={wrapRef} style={wrapStyle}>
            <canvas ref={pixelsRef} style={canvasStyle}
                onPointerDown={makeHandler('down')}
                onPointerMove={makeHandler('move')}
                onPointerUp={makeHandler('up')} />
            <canvas ref={overlayRef} style={{ ...canvasStyle, pointerEvents: 'none' }} />
        </div>
    );
}
