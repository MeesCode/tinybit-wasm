import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { GalleryEntry, GalleryFailure } from '../state/gallery';

const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(24, 24, 32, 0.45)',
    display: 'grid', placeItems: 'center', zIndex: 9999,
};
const dialogStyle: CSSProperties = {
    background: '#FFFFFF', borderRadius: 10, padding: '20px 24px',
    minWidth: 480, maxWidth: 720, maxHeight: '80vh', overflow: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)', fontSize: 14, color: '#181820',
};
const titleStyle: CSSProperties = { fontWeight: 700, fontSize: 16, marginBottom: 12 };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 14, marginBottom: 16 };
const cardStyle: CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    padding: 8, borderRadius: 8, border: '1px solid #ECECF0', background: '#FFFFFF',
    cursor: 'pointer', fontSize: 13, color: '#181820',
};
const cardImgStyle: CSSProperties = { width: 96, height: 96, imageRendering: 'pixelated', borderRadius: 4, background: '#F1F1F4' };
const cardTitleStyle: CSSProperties = { fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const cardAuthorStyle: CSSProperties = { color: '#6B6B76', fontSize: 12, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const failureCardStyle: CSSProperties = { ...cardStyle, cursor: 'default', borderStyle: 'dashed', color: '#6B6B76' };
const emptyStyle: CSSProperties = { textAlign: 'center', color: '#6B6B76', padding: '20px 0' };
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const cancelStyle: CSSProperties = {
    padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    border: '1px solid #ECECF0', background: '#F1F1F4', color: '#181820', cursor: 'pointer',
};

export type GalleryModalState =
    | { kind: 'loading' }
    | { kind: 'ready'; entries: GalleryEntry[]; failures: GalleryFailure[] }
    | { kind: 'error'; message: string };

export interface GalleryModalProps {
    open:     boolean;
    state:    GalleryModalState;
    onPick(entry: GalleryEntry): void;
    onCancel(): void;
}

export function GalleryModal({ open, state, onPick, onCancel }: GalleryModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onCancel]);

    if (!open) return null;

    return createPortal(
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Choose a cartridge">
            <div style={dialogStyle}>
                <div style={titleStyle}>Choose a cartridge</div>
                {state.kind === 'loading' && <div style={emptyStyle}>Loading…</div>}
                {state.kind === 'error'   && <div style={emptyStyle}>{state.message}</div>}
                {state.kind === 'ready'   && renderReady(state, onPick)}
                <div style={actionsStyle}>
                    <button type="button" style={cancelStyle} onClick={onCancel}>Cancel</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function renderReady(
    s: { kind: 'ready'; entries: GalleryEntry[]; failures: GalleryFailure[] },
    onPick: (e: GalleryEntry) => void,
) {
    if (s.entries.length === 0 && s.failures.length === 0) {
        return (
            <div style={emptyStyle}>
                <div>No cartridges in <code>editor/src/cartridges/</code>.</div>
                <div>Drop <code>.tb.png</code> files there to populate the gallery.</div>
            </div>
        );
    }
    return (
        <div style={gridStyle}>
            {s.entries.map((e) => (
                <button
                    key={e.id}
                    type="button"
                    style={cardStyle}
                    onClick={() => onPick(e)}
                    aria-label={e.title || e.filename}
                >
                    <img src={e.coverUrl} style={cardImgStyle} alt="" />
                    <div style={cardTitleStyle}>{e.title || e.filename}</div>
                    <div style={cardAuthorStyle}>{e.author}</div>
                </button>
            ))}
            {s.failures.map((f) => (
                <div key={f.id} style={failureCardStyle}>
                    <div style={{ ...cardImgStyle, display: 'grid', placeItems: 'center', fontSize: 24 }}>⚠</div>
                    <div style={cardTitleStyle}>{f.filename}</div>
                    <div style={cardAuthorStyle}>{f.message}</div>
                </div>
            ))}
        </div>
    );
}
