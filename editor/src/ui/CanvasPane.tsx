import { forwardRef, useImperativeHandle, useRef, type CSSProperties } from 'react';

const wrapStyle: CSSProperties = {
    height: '100%',
    background: '#F1F1F4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const canvasStyle: CSSProperties = {
    width: 'min(100% - 16px, calc(100vh - 200px))',
    aspectRatio: '1 / 1',
    imageRendering: 'pixelated',
    background: '#000',
    border: '1px solid #ECECF0',
    borderRadius: 4,
};

export interface CanvasHandle { getCanvas(): HTMLCanvasElement | null; }

export const CanvasPane = forwardRef<CanvasHandle>(function CanvasPane(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    useImperativeHandle(ref, () => ({ getCanvas: () => canvasRef.current }), []);
    return (
        <div style={wrapStyle}>
            <canvas ref={canvasRef} width={128} height={128} style={canvasStyle} aria-label="TinyBit display" />
        </div>
    );
});
