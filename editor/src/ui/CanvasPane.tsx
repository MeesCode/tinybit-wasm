import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { Runtime } from '../engine/runtime';
import type { FrameLoopState } from '../engine/frameLoop';
import { useLuaHeap } from '../engine/useLuaHeap';
import { LUA_HEAP_CAPACITY } from '../engine/limits';
import { MeterFooter } from './MeterFooter';

export interface CanvasPaneProps {
    runtime: Runtime | null;
    engineState: FrameLoopState;
}

const wrapStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    background: '#F1F1F4',
};

const canvasAreaStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    containerType: 'size',
};

const canvasStyle: CSSProperties = {
    width: 'min(calc(100cqw - 16px), calc(100cqh - 16px))',
    aspectRatio: '1 / 1',
    imageRendering: 'pixelated',
    background: '#000',
    border: '1px solid #ECECF0',
    borderRadius: 4,
};

export interface CanvasHandle { getCanvas(): HTMLCanvasElement | null; }

export const CanvasPane = forwardRef<CanvasHandle, CanvasPaneProps>(function CanvasPane(
    { runtime, engineState }, ref,
) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    useImperativeHandle(ref, () => ({ getCanvas: () => canvasRef.current }), []);

    const heap = useLuaHeap(runtime, engineState);

    const used = heap.state === 'live' ? heap.used : null;
    const cap  = heap.state === 'live' ? heap.cap  : LUA_HEAP_CAPACITY;
    const idleText = heap.state === 'unavailable' ? 'unavailable' : 'idle';

    return (
        <div style={wrapStyle}>
            <div style={canvasAreaStyle}>
                <canvas ref={canvasRef} width={128} height={128} style={canvasStyle} aria-label="TinyBit display" />
            </div>
            <MeterFooter
                label="Lua heap"
                used={used}
                cap={cap}
                mode="dark"
                idleText={idleText}
            />
        </div>
    );
});
