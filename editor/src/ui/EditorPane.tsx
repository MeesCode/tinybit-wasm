import { useMemo, type ReactNode, type CSSProperties } from 'react';
import { useSketchStore } from '../state/sketchStore';
import { SCRIPT_MAX } from '../engine/limits';
import { MeterFooter } from './MeterFooter';

export type EditorTab = 'script' | 'alt' | 'cartridge' | 'score';

export interface EditorPaneProps {
    active: EditorTab;
    onChange(t: EditorTab): void;
    children: ReactNode;        // the body of the active tab
}

const wrapStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: '#FFFFFF',
};

const tabsStyle: CSSProperties = {
    display: 'flex',
    background: '#F6F6F8',
    borderBottom: '1px solid #ECECF0',
    flexShrink: 0,
};

function tabStyle(active: boolean): CSSProperties {
    return {
        padding: '8px 14px',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.2,
        color: active ? '#ED225D' : '#6B6B76',
        background: active ? '#FFFFFF' : 'transparent',
        borderBottom: active ? '2px solid #ED225D' : '2px solid transparent',
        borderRight: '1px solid #ECECF0',
    };
}

const bodyStyle: CSSProperties = { flex: 1, minHeight: 0, overflow: 'hidden' };

const encoder = new TextEncoder();

export function EditorPane({ active, onChange, children }: EditorPaneProps) {
    const script = useSketchStore((s) => s.script);
    const scriptBytes = useMemo(() => encoder.encode(script).length, [script]);

    return (
        <div style={wrapStyle}>
            <div role="tablist" style={tabsStyle}>
                {(['script', 'alt', 'score', 'cartridge'] as const).map((t) => (
                    <button
                        key={t}
                        role="tab"
                        aria-selected={active === t}
                        type="button"
                        onClick={() => onChange(t)}
                        style={tabStyle(active === t)}>
                        {t === 'script' ? 'script'
                         : t === 'alt' ? 'spritesheet'
                         : t === 'score' ? 'score'
                         : 'cartridge'}
                    </button>
                ))}
            </div>
            <div role="tabpanel" style={bodyStyle}>{children}</div>
            <MeterFooter
                label="Script"
                used={scriptBytes}
                cap={SCRIPT_MAX}
                mode="light"
                overflow={scriptBytes > SCRIPT_MAX}
            />
        </div>
    );
}
