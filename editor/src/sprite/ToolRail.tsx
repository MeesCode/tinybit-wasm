import type { CSSProperties } from 'react';
import { useSpriteEditorStore, type Tool, type PencilSize } from '../state/spriteEditorStore';
import { nextZoom, prevZoom } from './viewport';

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

    const toolBtn = (id: Tool, label: string, glyph: string) => (
        <button type="button" key={id} aria-label={label} title={label} onClick={() => setTool(id)} style={btnStyle(tool === id)}>{glyph}</button>
    );

    return (
        <div style={railStyle} role="toolbar">
            {toolBtn('pencil',     'Pencil',     '✎')}
            {toolBtn('eraser',     'Eraser',     '⌫')}
            {toolBtn('fill',       'Fill',       '🪣')}
            {toolBtn('eyedropper', 'Eyedropper', '💧')}
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
