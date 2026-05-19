import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useConsoleStore, ALL_SOURCES, type ConsoleSource } from '../state/consoleStore';

const wrapStyle: CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', background: '#FAFAFA', borderTop: '1px solid #ECECF0' };
const headerStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #ECECF0', flexShrink: 0 };
const listStyle: CSSProperties = { flex: 1, overflow: 'auto', padding: '6px 10px', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, color: '#6B6B76', lineHeight: 1.5 };
const chipStyle = (on: boolean, color: string): CSSProperties => ({
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    border: `1px solid ${on ? color : '#ECECF0'}`,
    background: on ? color + '22' : '#fff',
    color: on ? color : '#A0A0AA',
});
const clearStyle: CSSProperties = { marginLeft: 'auto', padding: '2px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: '#F1F1F4', color: '#181820', border: '1px solid #ECECF0' };

const SOURCE_COLOR: Record<ConsoleSource, string> = {
    log: '#2563EB', warn: '#D97706', error: '#DC2626', engine: '#6B6B76',
};

export function ConsolePane() {
    const { lines, filters, setFilter, clear } = useConsoleStore();
    const visible = useMemo(() => lines.filter((l) => filters.has(l.source)), [lines, filters]);
    const listRef = useRef<HTMLDivElement | null>(null);
    const pinnedRef = useRef(true);

    const onScroll = () => {
        const el = listRef.current;
        if (!el) return;
        pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    };

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    }, [visible.length]);

    return (
        <div style={wrapStyle}>
            <div style={headerStyle}>
                {ALL_SOURCES.map((s) => (
                    <button key={s} type="button" aria-label={s} style={chipStyle(filters.has(s), SOURCE_COLOR[s])} onClick={() => setFilter(s, !filters.has(s))}>
                        {s}
                    </button>
                ))}
                <button type="button" aria-label="Clear" style={clearStyle} onClick={clear}>Clear</button>
            </div>
            <div ref={listRef} style={listStyle} onScroll={onScroll}>
                {visible.map((l) => (
                    <div key={l.id}>
                        <span style={{ color: SOURCE_COLOR[l.source], marginRight: 6 }}>{l.source}</span>
                        {l.text}
                    </div>
                ))}
            </div>
        </div>
    );
}
