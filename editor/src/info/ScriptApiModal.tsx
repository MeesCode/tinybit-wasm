import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { InfoModal } from './InfoModal';
import { SCRIPT_API_SECTIONS, type ApiEntry, type ApiSection } from './scriptApi';

const layout: CSSProperties = { display: 'flex', height: '100%', minHeight: 0 };
const rail: CSSProperties = {
    width: 200, flex: '0 0 200px',
    borderRight: '1px solid #ECECF0',
    display: 'flex', flexDirection: 'column',
    background: '#FAFAFA',
};
const searchWrap: CSSProperties = { padding: '12px 12px 8px 12px' };
const searchInput: CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    fontSize: 13, lineHeight: '20px',
    padding: '6px 8px',
    border: '1px solid #ECECF0', borderRadius: 6,
    background: '#FFFFFF', color: '#181820',
    outlineColor: '#ED225D',
};
const tabList: CSSProperties = { display: 'flex', flexDirection: 'column', padding: '4px 8px 12px 8px', gap: 2, overflowY: 'auto', flex: 1 };
const tabBase: CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    border: 'none', background: 'transparent',
    fontSize: 13, color: '#181820',
    padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
    textAlign: 'left',
};
const tabActive: CSSProperties = { ...tabBase, background: '#FDE4EF', color: '#ED225D', fontWeight: 600 };
const tabCount: CSSProperties = { fontSize: 11, color: '#6B6B76', marginLeft: 8, fontVariantNumeric: 'tabular-nums' };
const pane: CSSProperties = { flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 18px' };
const paneHeading: CSSProperties = {
    position: 'sticky', top: -14,
    margin: '-14px -18px 12px -18px', padding: '10px 18px',
    background: '#FFFFFF',
    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: '#6B6B76', borderBottom: '1px solid #ECECF0',
    zIndex: 1,
};
const entryCard: CSSProperties = { marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid #F4F4F7' };
const entryHead: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 };
const entryName: CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 700, color: '#181820' };
const entrySig: CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: '#6B6B76', fontSize: 12 };
const entryDesc: CSSProperties = { fontSize: 13, color: '#181820', marginTop: 2, lineHeight: 1.45 };
const sectionLabel: CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
    color: '#6B6B76', marginTop: 10, marginBottom: 4,
};
const paramRow: CSSProperties = { display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#181820' };
const paramName: CSSProperties = { flex: '0 0 80px', fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: '#ED225D' };
const codeBlock: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11, whiteSpace: 'pre',
    background: '#F6F6F8', border: '1px solid #ECECF0', borderRadius: 4,
    padding: '6px 10px', color: '#181820',
    overflowX: 'auto', margin: 0,
};
const tipBlock: CSSProperties = {
    fontSize: 12, lineHeight: 1.5, color: '#181820',
    background: '#FFF8E6', border: '1px solid #F2E2A6', borderRadius: 4,
    padding: '6px 10px', marginTop: 4,
};
const emptyState: CSSProperties = { fontSize: 13, color: '#6B6B76', padding: '40px 0', textAlign: 'center' };
const insertBtn: CSSProperties = {
    border: '1px solid #ECECF0', background: '#FFFFFF', color: '#ED225D',
    fontSize: 12, fontWeight: 600, lineHeight: '20px',
    padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
    marginLeft: 'auto',
};

interface FilteredSection extends ApiSection {
    matches: ApiEntry[];
}

function matchesQuery(entry: ApiEntry, q: string): boolean {
    const needle = q.toLowerCase();
    return (
        entry.name.toLowerCase().includes(needle) ||
        entry.signature.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)
    );
}

function filterSections(query: string): FilteredSection[] {
    const q = query.trim();
    return SCRIPT_API_SECTIONS.map((s) => ({
        ...s,
        matches: q.length === 0 ? s.items : s.items.filter((e) => matchesQuery(e, q)),
    })).filter((s) => q.length === 0 || s.matches.length > 0);
}

export interface ScriptApiModalProps {
    open: boolean;
    onClose(): void;
    onInsert?(text: string): void;
}

export function ScriptApiModal({ open, onClose, onInsert }: ScriptApiModalProps) {
    const [query, setQuery] = useState('');
    const [activeTitle, setActiveTitle] = useState<string>(SCRIPT_API_SECTIONS[0]?.title ?? '');
    const searchRef = useRef<HTMLInputElement | null>(null);
    const tabListRef = useRef<HTMLDivElement | null>(null);
    const shouldFocusActiveTab = useRef(false);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActiveTitle(SCRIPT_API_SECTIONS[0]?.title ?? '');
            queueMicrotask(() => searchRef.current?.focus());
        }
    }, [open]);

    const filtered = useMemo(() => filterSections(query), [query]);

    useEffect(() => {
        if (filtered.length === 0) return;
        if (!filtered.some((s) => s.title === activeTitle)) {
            setActiveTitle(filtered[0].title);
        }
    }, [filtered, activeTitle]);

    // Focus the active tab button after keyboard-driven selection.
    useEffect(() => {
        if (!shouldFocusActiveTab.current) return;
        shouldFocusActiveTab.current = false;
        const btn = tabListRef.current?.querySelector<HTMLButtonElement>('[role="tab"][tabindex="0"]');
        btn?.focus();
    });

    const active = filtered.find((s) => s.title === activeTitle) ?? filtered[0];

    function activateTab(title: string) {
        shouldFocusActiveTab.current = true;
        setActiveTitle(title);
    }

    function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            const next = filtered[(index + delta + filtered.length) % filtered.length];
            if (next) activateTab(next.title);
        } else if (e.key === 'Home') {
            e.preventDefault();
            if (filtered[0]) activateTab(filtered[0].title);
        } else if (e.key === 'End') {
            e.preventDefault();
            const last = filtered[filtered.length - 1];
            if (last) activateTab(last.title);
        }
    }

    return (
        <InfoModal open={open} title="Script API" onClose={onClose} widthCss="min(880px, 95vw)" maxHeightCss="85vh">
            <div style={layout}>
                <div style={rail}>
                    <div style={searchWrap}>
                        <input
                            ref={searchRef}
                            type="search"
                            role="searchbox"
                            placeholder="Search functions…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label="Search script API"
                            style={searchInput}
                        />
                    </div>
                    <div ref={tabListRef} role="tablist" aria-label="Script API categories" style={tabList}>
                        {filtered.map((s, i) => {
                            const isActive = active != null && s.title === active.title;
                            const tabId = `script-api-tab-${s.title.toLowerCase()}`;
                            const total = s.items.length;
                            const showRatio = s.matches.length !== total;
                            return (
                                <button
                                    key={s.title}
                                    id={tabId}
                                    role="tab"
                                    type="button"
                                    aria-selected={isActive}
                                    aria-controls="script-api-panel"
                                    tabIndex={isActive ? 0 : -1}
                                    style={isActive ? tabActive : tabBase}
                                    onClick={() => setActiveTitle(s.title)}
                                    onKeyDown={(e) => onTabKeyDown(e, i)}
                                >
                                    <span>{s.title}</span>
                                    <span style={tabCount}>{showRatio ? `${s.matches.length} / ${total}` : total}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div
                    id="script-api-panel"
                    role="tabpanel"
                    aria-labelledby={active ? `script-api-tab-${active.title.toLowerCase()}` : undefined}
                    style={pane}
                >
                    {active ? (
                        <>
                            <h2 style={paneHeading}>{active.title}</h2>
                            {active.matches.length === 0 ? (
                                <div role="status" aria-live="polite" style={emptyState}>No matches for &ldquo;{query}&rdquo; in {active.title}. Try another category.</div>
                            ) : (
                                active.matches.map((e) => (
                                    <Entry key={e.name} entry={e} onInsert={onInsert} onClose={onClose} />
                                ))
                            )}
                        </>
                    ) : (
                        <div role="status" aria-live="polite" style={emptyState}>No matches for &ldquo;{query}&rdquo;.</div>
                    )}
                </div>
            </div>
        </InfoModal>
    );
}

interface EntryProps {
    entry: ApiEntry;
    onInsert?: (text: string) => void;
    onClose: () => void;
}

function Entry({ entry, onInsert, onClose }: EntryProps) {
    const insertText = entry.insert ?? entry.signature;

    function handleInsert() {
        if (!onInsert) return;
        onInsert(insertText);
        onClose();
    }

    return (
        <article style={entryCard}>
            <div style={entryHead}>
                <span style={entryName}>{entry.name}</span>
                <span style={entrySig}>{entry.signature}</span>
                {onInsert && (
                    <button
                        type="button"
                        style={insertBtn}
                        onClick={handleInsert}
                        aria-label={`Insert ${entry.name} at cursor`}
                    >
                        Insert
                    </button>
                )}
            </div>
            <div style={entryDesc}>{entry.description}</div>
            {entry.params && entry.params.length > 0 && (
                <>
                    <div style={sectionLabel}>Parameters</div>
                    {entry.params.map((p) => (
                        <div key={p.name} style={paramRow}>
                            <span style={paramName}>{p.name}</span>
                            <span>{p.description}</span>
                        </div>
                    ))}
                </>
            )}
            {entry.example && (
                <>
                    <div style={sectionLabel}>Example</div>
                    <pre style={codeBlock}>{entry.example}</pre>
                </>
            )}
            {entry.tip && (
                <>
                    <div style={sectionLabel}>Tip</div>
                    <div style={tipBlock}>💡 {entry.tip}</div>
                </>
            )}
        </article>
    );
}
