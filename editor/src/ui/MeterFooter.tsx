import type { CSSProperties } from 'react';

export interface MeterFooterProps {
    label: string;
    used: number | null;        // bytes; null = idle/unavailable
    cap: number;                // bytes
    mode: 'light' | 'dark';
    overflow?: boolean;
    idleText?: string;
}

const FILL_GREEN  = '#16A34A';
const FILL_YELLOW = '#EAB308';
const FILL_RED    = '#DC2626';

const lightPalette = {
    background: '#FAFAFB',
    border:     '#ECECF0',
    text:       '#4B4B58',
    dim:        '#6B6B76',
    track:      '#ECECF0',
};
const darkPalette = {
    background: '#1a1a22',
    border:     '#2a2a35',
    text:       '#c6c6cf',
    dim:        '#6B6B76',
    track:      '#2a2a35',
};

function fillColor(pct: number): string {
    if (pct >= 90) return FILL_RED;
    if (pct >= 75) return FILL_YELLOW;
    return FILL_GREEN;
}

function formatBytes(bytes: number, capUnit: 'B' | 'KB'): string {
    if (capUnit === 'B') return `${bytes}`;
    return (Math.round(bytes / 102.4) / 10).toFixed(1);
}

function unitFor(cap: number): 'B' | 'KB' {
    return cap < 1024 ? 'B' : 'KB';
}

export function MeterFooter({ label, used, cap, mode, overflow, idleText }: MeterFooterProps) {
    const palette = mode === 'dark' ? darkPalette : lightPalette;
    const isIdle = used === null;

    const rowStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 24,
        padding: '0 10px',
        background: palette.background,
        borderTop: `1px solid ${palette.border}`,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        color: isIdle ? palette.dim : palette.text,
        flexShrink: 0,
    };

    const trackStyle: CSSProperties = {
        width: 60,
        height: 6,
        background: palette.track,
        borderRadius: 3,
        overflow: 'hidden',
        flexShrink: 0,
    };

    if (isIdle) {
        return (
            <div role="status" aria-live="off" style={rowStyle}>
                <span>{label} — {idleText ?? 'idle'}</span>
                <div data-testid="meter-bar" style={trackStyle} aria-label={`${label}: ${idleText ?? 'idle'}`}>
                    <div data-testid="meter-fill" style={{ width: '0%', height: '100%', backgroundColor: palette.track }} />
                </div>
            </div>
        );
    }

    const rawPct = (used / cap) * 100;
    const clampedPct = Math.min(100, Math.max(0, rawPct));
    const color = fillColor(rawPct);
    const unit = unitFor(cap);
    const usedStr = formatBytes(used, unit);
    const capStr  = formatBytes(cap, unit);
    const readout = `${usedStr} / ${capStr}${unit === 'KB' ? ' KB' : ' B'}`;
    const readoutColor = overflow ? FILL_RED : palette.text;

    return (
        <div role="status" aria-live="off" style={rowStyle}>
            <span>{label}</span>
            <div
                data-testid="meter-bar"
                style={trackStyle}
                aria-label={`${label} usage: ${usedStr} of ${capStr} ${unit === 'KB' ? 'kilobytes' : 'bytes'} (${Math.round(rawPct)}%)`}
            >
                <div
                    data-testid="meter-fill"
                    style={{ width: `${clampedPct}%`, height: '100%', backgroundColor: color }}
                />
            </div>
            <span style={{ color: readoutColor, marginLeft: 'auto' }}>
                {overflow ? `⚠ ${readout}` : readout}
            </span>
        </div>
    );
}
