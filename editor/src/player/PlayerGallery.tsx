import type { CSSProperties } from 'react';
import type { GalleryEntry, GalleryFailure } from '../state/gallery';

export type PlayerGalleryState =
    | { kind: 'loading' }
    | { kind: 'ready'; entries: GalleryEntry[]; failures: GalleryFailure[] }
    | { kind: 'error'; message: string };

export interface PlayerGalleryProps {
    state: PlayerGalleryState;
    onPick(entry: GalleryEntry): void;
    onBack(): void;
}

const wrapStyle: CSSProperties = {
    width: '100vw',
    minHeight: '100dvh',
    background: '#181820',
    color: '#fff',
    padding: '16px 16px 32px',
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
};

const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
};

const backStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
};

const titleStyle: CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
};

const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 14,
};

const cardStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    background: '#23232c',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'center',
};

const coverStyle: CSSProperties = {
    width: '100%',
    aspectRatio: '1 / 1',
    objectFit: 'contain',
    imageRendering: 'pixelated',
    background: '#000',
    borderRadius: 6,
};

const subtitleStyle: CSSProperties = { color: '#a4a4ad', fontSize: 12 };

const msgStyle: CSSProperties = { textAlign: 'center', padding: '40px 0', color: '#a4a4ad' };

export function PlayerGallery({ state, onPick, onBack }: PlayerGalleryProps) {
    return (
        <div style={wrapStyle} data-route="player-gallery">
            <div style={headerStyle}>
                <button type="button" style={backStyle} onClick={onBack} aria-label="Back">‹ Back</button>
                <h1 style={titleStyle}>Pick a game</h1>
            </div>
            {state.kind === 'loading' && <div style={msgStyle}>Loading…</div>}
            {state.kind === 'error'   && <div style={msgStyle}>{state.message}</div>}
            {state.kind === 'ready' && state.entries.length === 0 && state.failures.length === 0 && (
                <div style={msgStyle}>No cartridges available.</div>
            )}
            {state.kind === 'ready' && (state.entries.length > 0 || state.failures.length > 0) && (
                <div style={gridStyle}>
                    {state.entries.map((e) => (
                        <button key={e.id} type="button" style={cardStyle} onClick={() => onPick(e)}>
                            <img src={e.coverUrl} alt="" style={coverStyle} />
                            <div style={{ fontWeight: 600 }}>{e.title || e.filename}</div>
                            <div style={subtitleStyle}>{e.author}</div>
                        </button>
                    ))}
                    {state.failures.map((f) => (
                        <div key={f.id} style={{ ...cardStyle, opacity: 0.5, cursor: 'default' }}>
                            <div style={{ ...coverStyle, display: 'grid', placeItems: 'center', fontSize: 24 }}>⚠</div>
                            <div style={{ fontWeight: 600 }}>{f.filename}</div>
                            <div style={subtitleStyle}>{f.message}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
