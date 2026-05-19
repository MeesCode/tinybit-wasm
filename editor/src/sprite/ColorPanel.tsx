import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { useSpriteEditorStore } from '../state/spriteEditorStore';
import { hexToRgba, rgbaToHex, unpackRgba8, packRgba8 } from './color';
import { ColorPicker } from './ColorPicker';

const wrap: CSSProperties = { display: 'flex', gap: 12, padding: 12, background: '#F6F6F8', borderTop: '1px solid #ECECF0', alignItems: 'center' };
const swatchAnchor: CSSProperties = { position: 'relative' };
const swatch = (rgba: number): CSSProperties => ({
    width: 22, height: 22, borderRadius: 4, border: '1px solid #ECECF0',
    background: rgbaToHex(rgba),
    cursor: 'pointer',
});
const swatchButton = (rgba: number): CSSProperties => ({
    ...swatch(rgba),
    width: 36, height: 36, padding: 0,
});

export function ColorPanel() {
    const { color, recent, setColor, setColorTransient } = useSpriteEditorStore();
    const [draft, setDraft] = useState(rgbaToHex(color));
    const [pickerOpen, setPickerOpen] = useState(false);
    const focusedRef = useRef(false);

    // Keep the hex input in sync with the store when the user isn't actively typing
    // (eyedropper, recent-colour click, alpha slider all mutate `color` externally).
    useEffect(() => {
        if (!focusedRef.current) setDraft(rgbaToHex(color));
    }, [color]);

    function commit() {
        const v = hexToRgba(draft);
        if (v !== null) setColor(v);
        else setDraft(rgbaToHex(color));
    }

    const u = unpackRgba8(color);

    return (
        <div style={wrap} role="region" aria-label="Colour panel">
            <div style={swatchAnchor}>
                <button
                    type="button"
                    data-color-swatch=""
                    aria-label="Current colour"
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    title="Current colour — click to open picker"
                    onClick={() => setPickerOpen((o) => !o)}
                    style={swatchButton(color)}
                />
                {pickerOpen && <ColorPicker onClose={() => setPickerOpen(false)} />}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#6B6B76' }}>
                Hex
                <input
                    aria-label="Hex"
                    type="text"
                    value={draft}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
                    onFocus={() => { focusedRef.current = true; }}
                    onBlur={() => { focusedRef.current = false; commit(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                    style={{ width: 96, padding: '4px 6px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, border: '1px solid #ECECF0', borderRadius: 4 }}
                />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#6B6B76' }}>
                Alpha
                <input
                    aria-label="Alpha"
                    type="range" min={0} max={255}
                    value={u.a}
                    onChange={(e) => setColorTransient(packRgba8(u.r, u.g, u.b, Number(e.target.value)))}
                    onPointerUp={() => setColor(useSpriteEditorStore.getState().color)}
                />
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
                {recent.map((c, i) => (
                    <button key={i} type="button" aria-label={`Recent colour ${i + 1}`} title={rgbaToHex(c)} onClick={() => setColor(c)} style={swatch(c)} />
                ))}
            </div>
        </div>
    );
}
