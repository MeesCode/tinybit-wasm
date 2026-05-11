import type { CSSProperties, ReactNode } from 'react';
import { useSpriteEditorStore, type Tool, type PencilSize } from '../state/spriteEditorStore';
import { nextZoom, prevZoom } from './viewport';

const svgProps = {
    width: 18, height: 18, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
};

const PencilGlyph = (
    <svg {...svgProps}>
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
        <path d="m15 5 4 4"/>
    </svg>
);

const EraserGlyph = (
    <svg {...svgProps}>
        <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/>
        <path d="M22 21H7"/>
        <path d="m5 11 9 9"/>
    </svg>
);

const FillGlyph = (
    <svg {...svgProps}>
        <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/>
        <path d="m5 2 5 5"/>
        <path d="M2 13h15"/>
        <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>
    </svg>
);

const EyedropperGlyph = (
    <svg {...svgProps}>
        <path d="m2 22 1-1h3l9-9"/>
        <path d="M3 21v-3l9-9"/>
        <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
    </svg>
);

const SIZES: PencilSize[] = [1, 2, 3, 4, 8];

const railStyle: CSSProperties = { width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 6, background: '#F6F6F8', borderRight: '1px solid #ECECF0', overflowY: 'auto', overflowX: 'hidden' };
const btnStyle = (active: boolean): CSSProperties => ({
    width: 32, height: 32, borderRadius: 6, border: 'none',
    background: active ? '#ED225D' : '#FFFFFF',
    color: active ? '#FFFFFF' : '#181820',
    cursor: 'pointer', fontSize: 14, lineHeight: 1,
});
const dividerStyle: CSSProperties = { width: 28, height: 1, background: '#ECECF0', margin: '4px 0' };

function nextSize(s: PencilSize): PencilSize {
    const i = SIZES.indexOf(s);
    return SIZES[Math.min(i + 1, SIZES.length - 1)];
}
function prevSize(s: PencilSize): PencilSize {
    const i = SIZES.indexOf(s);
    return SIZES[Math.max(i - 1, 0)];
}

export function ToolRail() {
    const { tool, pencilSize, zoom, setTool, setPencilSize, setZoom } = useSpriteEditorStore();

    const toolBtn = (id: Tool, label: string, glyph: ReactNode) => (
        <button type="button" key={id} aria-label={label} title={label} onClick={() => setTool(id)} style={btnStyle(tool === id)}>{glyph}</button>
    );

    return (
        <div style={railStyle} role="toolbar">
            {toolBtn('pencil',     'Pencil',     PencilGlyph)}
            {toolBtn('eraser',     'Eraser',     EraserGlyph)}
            {toolBtn('fill',       'Fill',       FillGlyph)}
            {toolBtn('eyedropper', 'Eyedropper', EyedropperGlyph)}
            <div style={dividerStyle} />
            <button type="button" aria-label="Increase pencil size" onClick={() => setPencilSize(nextSize(pencilSize))} style={btnStyle(false)}>+</button>
            <div style={{ fontSize: 11, color: '#181820' }}>{pencilSize}</div>
            <button type="button" aria-label="Decrease pencil size" onClick={() => setPencilSize(prevSize(pencilSize))} style={btnStyle(false)}>−</button>
            <div style={dividerStyle} />
            <button type="button" aria-label="Zoom in"  onClick={() => setZoom(nextZoom(zoom))} style={btnStyle(false)}>+</button>
            <div style={{ fontSize: 11, color: '#181820' }}>{zoom}×</div>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom(prevZoom(zoom))} style={btnStyle(false)}>−</button>
        </div>
    );
}
