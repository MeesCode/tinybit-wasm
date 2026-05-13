import type { CSSProperties } from 'react';
import { InfoModal } from './InfoModal';
import { SCRIPT_API_SECTIONS, type ApiEntry } from './scriptApi';

const sectionStyle: CSSProperties = { marginBottom: 20 };
const headingStyle: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: '#6B6B76',
    borderBottom: '1px solid #ECECF0',
    paddingBottom: 4, marginBottom: 8,
};
const entryStyle: CSSProperties = { marginBottom: 10 };
const nameRow: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' };
const nameStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontWeight: 700, color: '#181820',
};
const sigStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: '#6B6B76', fontSize: 12,
};
const descStyle: CSSProperties = { fontSize: 13, color: '#181820', marginTop: 2, lineHeight: 1.4 };
const exampleStyle: CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11, whiteSpace: 'pre',
    background: '#F6F6F8', border: '1px solid #ECECF0', borderRadius: 4,
    padding: '4px 8px', marginTop: 4, color: '#181820',
    overflowX: 'auto',
};

export interface ScriptApiModalProps {
    open: boolean;
    onClose(): void;
}

function Entry({ entry }: { entry: ApiEntry }) {
    return (
        <div style={entryStyle}>
            <div style={nameRow}>
                <span style={nameStyle}>{entry.name}</span>
                <span style={sigStyle}>{entry.signature}</span>
            </div>
            <div style={descStyle}>{entry.description}</div>
            {entry.example && <pre style={exampleStyle}>{entry.example}</pre>}
        </div>
    );
}

export function ScriptApiModal({ open, onClose }: ScriptApiModalProps) {
    return (
        <InfoModal open={open} title="Script API" onClose={onClose}>
            {SCRIPT_API_SECTIONS.map((section) => (
                <section key={section.title} style={sectionStyle}>
                    <h2 style={headingStyle}>{section.title}</h2>
                    {section.items.map((entry) => (
                        <Entry key={entry.name} entry={entry} />
                    ))}
                </section>
            ))}
        </InfoModal>
    );
}
