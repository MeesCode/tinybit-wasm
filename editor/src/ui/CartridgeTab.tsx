import { useEffect, useState, type CSSProperties, type ChangeEvent } from 'react';
import { useSketchStore } from '../state/sketchStore';
import { readPngSize } from '../lib/png';

const wrapStyle: CSSProperties = { padding: 16, overflow: 'auto', height: '100%' };
const fieldStyle: CSSProperties = { display: 'block', marginBottom: 12, fontSize: 12, color: '#6B6B76', fontWeight: 600 };
const inputStyle: CSSProperties = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #ECECF0', borderRadius: 6, background: '#fff', color: '#181820', marginTop: 4 };
const slotStyle: CSSProperties = { border: '1px dashed #ECECF0', borderRadius: 8, padding: 12, marginBottom: 12, background: '#fff' };
const thumbStyle: CSSProperties = { width: 64, height: 64, border: '1px solid #ECECF0', borderRadius: 4, imageRendering: 'pixelated', background: '#F1F1F4' };
const errStyle: CSSProperties = { color: '#DC2626', fontSize: 12, marginTop: 6 };

interface SlotProps {
    label: string;
    bytes: Uint8Array | null;
    onPick(bytes: Uint8Array): void;
    error: string | null;
    inputTestId: string;
}

function AssetSlot({ label, bytes, onPick, error, inputTestId }: SlotProps) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!bytes) { setUrl(null); return; }
        const next = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [bytes]);
    return (
        <div style={slotStyle}>
            <label style={fieldStyle}>{label} <span style={{ color: '#A0A0AA', fontWeight: 400 }}>(128×128 PNG)</span></label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {url ? <img src={url} alt={label} style={thumbStyle} /> : <div style={thumbStyle} />}
                <input
                    type="file"
                    accept="image/png"
                    data-testid={inputTestId}
                    onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const buf = new Uint8Array(await f.arrayBuffer());
                        onPick(buf);
                    }}
                />
            </div>
            {bytes && !error && <div style={{ fontSize: 11, color: '#A0A0AA', marginTop: 6 }}>{bytes.length.toLocaleString()} bytes</div>}
            {error && <div style={errStyle}>{error}</div>}
        </div>
    );
}

export function CartridgeTab() {
    const { title, author, sprite, cover, setTitle, setAuthor, setSpriteFromPng, setCover } = useSketchStore();
    const [spriteErr, setSpriteErr] = useState<string | null>(null);
    const [coverErr,  setCoverErr]  = useState<string | null>(null);

    const handleSprite = async (raw: Uint8Array) => {
        const size = readPngSize(raw);
        if (!size) { setSpriteErr('Not a valid PNG.'); return; }
        if (size.width !== 128 || size.height !== 128) {
            setSpriteErr(`Must be 128×128 (got ${size.width}×${size.height}).`);
            return;
        }
        setSpriteErr(null);
        try { await setSpriteFromPng(raw); }
        catch (e) { setSpriteErr((e as Error).message); }
    };

    const handleCover = (raw: Uint8Array) => {
        const size = readPngSize(raw);
        if (!size) { setCoverErr('Not a valid PNG.'); setCover(null); return; }
        if (size.width !== 128 || size.height !== 128) {
            setCoverErr(`Must be 128×128 (got ${size.width}×${size.height}).`);
            setCover(null);
            return;
        }
        setCoverErr(null);
        setCover(raw);
    };

    return (
        <div style={wrapStyle}>
            <label style={fieldStyle}>
                Title
                <input style={inputStyle} value={title} maxLength={63} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            </label>
            <label style={fieldStyle}>
                Author
                <input style={inputStyle} value={author} maxLength={63} onChange={(e) => setAuthor(e.target.value)} aria-label="Author" />
            </label>
            <AssetSlot
                label="Spritesheet"
                bytes={sprite}
                onPick={(b) => void handleSprite(b)}
                error={spriteErr}
                inputTestId="sprite-input"
            />
            <AssetSlot
                label="Cover image"
                bytes={cover}
                onPick={handleCover}
                error={coverErr}
                inputTestId="cover-input"
            />
        </div>
    );
}
