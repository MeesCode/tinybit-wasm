import type { CSSProperties } from 'react';
import { PlayButton } from './PlayButton';
import { DownloadButton } from './DownloadButton';

export type EngineState = 'idle' | 'running' | 'error';

export interface ToolbarProps {
    engineState: EngineState;
    canPlay: boolean;
    onPlay():    void;
    onStop():    void;
    onClear():   void;
    onGallery(): void;
    onOpen():    void;
    onDownload(): void;
    onResetEngine?(): void;
}

const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    background: '#FFFFFF',
    borderBottom: '1px solid #ECECF0',
    flexShrink: 0,
};

const brandStyle: CSSProperties = {
    fontWeight: 800,
    fontSize: 16,
    letterSpacing: 0.3,
    color: '#ED225D',
    marginRight: 8,
};

const neutralStyle: CSSProperties = {
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 13,
    background: '#F1F1F4',
    color: '#181820',
    border: '1px solid #ECECF0',
};

const pillStyle: CSSProperties = {
    marginLeft: 'auto',
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
};

export function Toolbar(p: ToolbarProps) {
    const running = p.engineState === 'running';
    const crashed = p.engineState === 'error';
    return (
        <div style={barStyle}>
            <span style={brandStyle}>tinybit</span>
            <PlayButton running={running} disabled={!p.canPlay} onClick={p.onPlay} />
            <button type="button" onClick={p.onStop} disabled={!running} style={{ ...neutralStyle, opacity: running ? 1 : 0.4 }} aria-label="Stop">
                ■ Stop
            </button>
            <button type="button" onClick={p.onClear} style={neutralStyle} aria-label="Clear editor">
                🗑 Clear
            </button>
            <button type="button" onClick={p.onGallery} style={neutralStyle} aria-label="Gallery">
                🎮 Gallery
            </button>
            <button type="button" onClick={p.onOpen} style={neutralStyle} aria-label="Open">
                📂 Open
            </button>
            <DownloadButton disabled={!p.canPlay} onClick={p.onDownload} />
            <span style={{
                ...pillStyle,
                background: crashed ? '#FEE2E2' : running ? '#DCFCE7' : '#F1F1F4',
                color:      crashed ? '#DC2626' : running ? '#166534' : '#6B6B76',
                cursor:     crashed ? 'pointer' : 'default',
            }}
                  onClick={crashed ? p.onResetEngine : undefined}>
                {crashed ? 'Crashed — click to reset' : running ? 'Running' : 'Idle'}
            </span>
        </div>
    );
}
