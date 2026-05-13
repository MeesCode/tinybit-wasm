import { type ReactNode, type CSSProperties } from 'react';

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

export function EditorPane({ active, onChange, children }: EditorPaneProps) {
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
        </div>
    );
}
