import type { CSSProperties } from 'react';

export interface MobileLandingProps {
    onOpenEditor(): void;
}

const wrapStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100dvh',
    background: '#181820',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    boxSizing: 'border-box',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    textAlign: 'center',
};

const brandStyle: CSSProperties = {
    fontWeight: 800,
    fontSize: 36,
    letterSpacing: 0.5,
    color: '#ED225D',
    marginBottom: 8,
};

const taglineStyle: CSSProperties = {
    color: '#cfcfd6',
    fontSize: 15,
    marginBottom: 32,
};

const playButtonStyle: CSSProperties = {
    background: '#ED225D',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '16px 28px',
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: 48,
    minWidth: 220,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
};

const captionStyle: CSSProperties = {
    color: '#9a9aa6',
    fontSize: 13,
    marginBottom: 16,
    maxWidth: 260,
    lineHeight: 1.4,
};

const linkStyle: CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#ED225D',
    fontSize: 13,
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 4,
};

export function MobileLanding({ onOpenEditor }: MobileLandingProps) {
    const onPlay = () => {
        window.location.search = '?play';
    };
    return (
        <div style={wrapStyle} data-route="mobile-landing">
            <div style={brandStyle}>tinybit</div>
            <div style={taglineStyle}>An itty-bitty game engine.</div>
            <button
                type="button"
                onClick={onPlay}
                style={playButtonStyle}
                aria-label="Play games"
            >
                ▶ Play games
            </button>
            <div style={captionStyle}>Editing works best on a bigger screen.</div>
            <button
                type="button"
                onClick={onOpenEditor}
                style={linkStyle}
                aria-label="Open editor anyway"
            >
                Open editor anyway →
            </button>
        </div>
    );
}
