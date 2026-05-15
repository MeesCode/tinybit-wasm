import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ChangeEvent,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSpriteEditorStore } from '../state/spriteEditorStore';
import {
    hexToRgba,
    hsvToRgb,
    packRgba8,
    rgbaToHex,
    rgbToHsv,
    unpackRgba8,
} from './color';

const PICKER_W = 220;
const SV_H = 140;
const STRIP_H = 14;

const popover: CSSProperties = {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    left: 0,
    zIndex: 50,
    width: PICKER_W,
    padding: 10,
    background: '#FFFFFF',
    border: '1px solid #ECECF0',
    borderRadius: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
};

const svBox = (hueCss: string): CSSProperties => ({
    position: 'relative',
    width: '100%',
    height: SV_H,
    borderRadius: 4,
    cursor: 'crosshair',
    touchAction: 'none',
    background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hueCss})`,
});

const hueStrip: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: STRIP_H,
    borderRadius: 4,
    cursor: 'pointer',
    touchAction: 'none',
    background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
};

const alphaStrip = (rgbCss: string): CSSProperties => ({
    position: 'relative',
    width: '100%',
    height: STRIP_H,
    borderRadius: 4,
    cursor: 'pointer',
    touchAction: 'none',
    backgroundImage:
        `linear-gradient(to right, rgba(0,0,0,0), ${rgbCss}),` +
        'linear-gradient(45deg, #ccc 25%, transparent 25%),' +
        'linear-gradient(-45deg, #ccc 25%, transparent 25%),' +
        'linear-gradient(45deg, transparent 75%, #ccc 75%),' +
        'linear-gradient(-45deg, transparent 75%, #ccc 75%)',
    backgroundSize: '100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px',
    backgroundPosition: '0 0, 0 0, 0 4px, 4px -4px, -4px 0',
});

const svDot = (x: number, y: number): CSSProperties => ({
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: 10,
    height: 10,
    marginLeft: -5,
    marginTop: -5,
    borderRadius: '50%',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
});

const stripDot = (x: number): CSSProperties => ({
    position: 'absolute',
    left: `${x * 100}%`,
    top: '50%',
    width: 8,
    height: STRIP_H + 4,
    marginLeft: -4,
    marginTop: -((STRIP_H + 4) / 2),
    borderRadius: 3,
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
    pointerEvents: 'none',
});

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

interface Props {
    /** Called when the user dismisses the picker (Escape, outside click). */
    onClose: () => void;
}

export function ColorPicker({ onClose }: Props) {
    const { color, setColor, setColorTransient } = useSpriteEditorStore();
    const rootRef = useRef<HTMLDivElement | null>(null);

    // Internal HSV is the source of truth while the picker is open: round-tripping
    // through snapped RGB loses precision and makes hue drift as you drag.
    const initial = useMemo(() => {
        const u = unpackRgba8(color);
        const hsv = rgbToHsv(u.r, u.g, u.b);
        return { ...hsv, a: u.a };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const [h, setH] = useState(initial.h);
    const [s, setS] = useState(initial.s);
    const [v, setV] = useState(initial.v);
    const [a, setA] = useState(initial.a);
    const [draftHex, setDraftHex] = useState(rgbaToHex(color));
    const hexFocusedRef = useRef(false);

    function emit(h: number, s: number, v: number, a: number, commit: boolean) {
        const { r, g, b } = hsvToRgb(h, s, v);
        const rgba = packRgba8(r, g, b, a);
        if (commit) setColor(rgba); else setColorTransient(rgba);
        if (!hexFocusedRef.current) setDraftHex(rgbaToHex(rgba));
    }

    const svRef = useRef<HTMLDivElement | null>(null);
    const hueRef = useRef<HTMLDivElement | null>(null);
    const alphaRef = useRef<HTMLDivElement | null>(null);
    const svDragging = useRef(false);
    const hueDragging = useRef(false);
    const alphaDragging = useRef(false);

    function readXY(ref: React.RefObject<HTMLDivElement>, e: ReactPointerEvent<HTMLDivElement>) {
        const el = ref.current;
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        const x = clamp01(r.width === 0 ? 0 : (e.clientX - r.left) / r.width);
        const y = clamp01(r.height === 0 ? 0 : (e.clientY - r.top) / r.height);
        return { x, y };
    }

    function applySv(x: number, y: number, commit: boolean) {
        setS(x); setV(1 - y);
        emit(h, x, 1 - y, a, commit);
    }
    function applyHue(x: number, commit: boolean) {
        const nh = x * 360;
        setH(nh);
        emit(nh, s, v, a, commit);
    }
    function applyAlpha(x: number, commit: boolean) {
        const na = Math.round(x * 255);
        setA(na);
        emit(h, s, v, na, commit);
    }

    // Outside click / Escape dismissal. We let the swatch button (marked with
    // data-color-swatch) handle its own toggle so the document listener doesn't
    // race with it.
    useEffect(() => {
        function onDocDown(e: globalThis.PointerEvent) {
            const t = e.target as HTMLElement | null;
            if (!t) return;
            if (rootRef.current?.contains(t)) return;
            if (t.closest('[data-color-swatch]')) return;
            onClose();
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        // Defer install by a tick so the opening click doesn't immediately fire it.
        const id = window.setTimeout(() => {
            document.addEventListener('pointerdown', onDocDown);
        }, 0);
        document.addEventListener('keydown', onKey);
        return () => {
            window.clearTimeout(id);
            document.removeEventListener('pointerdown', onDocDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    // Keep draft hex in sync with the store while the user isn't typing.
    useLayoutEffect(() => {
        if (!hexFocusedRef.current) setDraftHex(rgbaToHex(color));
    }, [color]);

    function commitHex() {
        const parsed = hexToRgba(draftHex);
        if (parsed === null) { setDraftHex(rgbaToHex(color)); return; }
        const u = unpackRgba8(parsed);
        const hsv = rgbToHsv(u.r, u.g, u.b);
        setH(hsv.h); setS(hsv.s); setV(hsv.v); setA(u.a);
        setColor(parsed);
    }

    const hueRgb = hsvToRgb(h, 1, 1);
    const hueCss = `rgb(${hueRgb.r}, ${hueRgb.g}, ${hueRgb.b})`;
    const cur = hsvToRgb(h, s, v);
    const rgbCss = `rgb(${cur.r}, ${cur.g}, ${cur.b})`;

    return (
        <div ref={rootRef} role="dialog" aria-label="Colour picker" style={popover}>
            <div
                ref={svRef}
                role="slider"
                aria-label="Saturation and value"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(s * 100)}
                style={svBox(hueCss)}
                onPointerDown={(e) => {
                    svDragging.current = true;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    const p = readXY(svRef, e); applySv(p.x, p.y, false);
                }}
                onPointerMove={(e) => {
                    if (!svDragging.current) return;
                    const p = readXY(svRef, e); applySv(p.x, p.y, false);
                }}
                onPointerUp={(e) => {
                    if (!svDragging.current) return;
                    svDragging.current = false;
                    const p = readXY(svRef, e); applySv(p.x, p.y, true);
                }}
            >
                <div style={svDot(s, 1 - v)} />
            </div>
            <div
                ref={hueRef}
                role="slider"
                aria-label="Hue"
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={Math.round(h)}
                style={hueStrip}
                onPointerDown={(e) => {
                    hueDragging.current = true;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    applyHue(readXY(hueRef, e).x, false);
                }}
                onPointerMove={(e) => {
                    if (!hueDragging.current) return;
                    applyHue(readXY(hueRef, e).x, false);
                }}
                onPointerUp={(e) => {
                    if (!hueDragging.current) return;
                    hueDragging.current = false;
                    applyHue(readXY(hueRef, e).x, true);
                }}
            >
                <div style={stripDot(h / 360)} />
            </div>
            <div
                ref={alphaRef}
                role="slider"
                aria-label="Alpha"
                aria-valuemin={0}
                aria-valuemax={255}
                aria-valuenow={a}
                style={alphaStrip(rgbCss)}
                onPointerDown={(e) => {
                    alphaDragging.current = true;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    applyAlpha(readXY(alphaRef, e).x, false);
                }}
                onPointerMove={(e) => {
                    if (!alphaDragging.current) return;
                    applyAlpha(readXY(alphaRef, e).x, false);
                }}
                onPointerUp={(e) => {
                    if (!alphaDragging.current) return;
                    alphaDragging.current = false;
                    applyAlpha(readXY(alphaRef, e).x, true);
                }}
            >
                <div style={stripDot(a / 255)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6B6B76' }}>
                Hex
                <input
                    aria-label="Hex (picker)"
                    type="text"
                    value={draftHex}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDraftHex(e.target.value)}
                    onFocus={() => { hexFocusedRef.current = true; }}
                    onBlur={() => { hexFocusedRef.current = false; commitHex(); }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commitHex();
                        if (e.key === 'Escape') { (e.target as HTMLInputElement).blur(); onClose(); }
                    }}
                    style={{
                        flex: 1,
                        padding: '4px 6px',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 12,
                        border: '1px solid #ECECF0',
                        borderRadius: 4,
                    }}
                />
            </label>
        </div>
    );
}
