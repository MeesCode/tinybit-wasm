import type { CSSProperties } from 'react';
import { InfoModal } from './InfoModal';
import { MiniScore } from './MiniScore';
import { ABC_SECTIONS } from './abcInfo';

const sectionStyle: CSSProperties = { marginBottom: 22 };
const headingStyle: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    color: '#6B6B76',
    borderBottom: '1px solid #ECECF0',
    paddingBottom: 4, marginBottom: 8,
};
const textStyle: CSSProperties = { fontSize: 13, color: '#181820', lineHeight: 1.5, marginBottom: 6 };

export interface AbcInfoModalProps {
    open: boolean;
    onClose(): void;
}

export function AbcInfoModal({ open, onClose }: AbcInfoModalProps) {
    return (
        <InfoModal open={open} title="ABC Notation" onClose={onClose}>
            {ABC_SECTIONS.map((section) => (
                <section key={section.title} style={sectionStyle}>
                    <h2 style={headingStyle}>{section.title}</h2>
                    {section.body.map((entry, idx) => (
                        <div key={idx}>
                            <p style={textStyle}>{entry.text}</p>
                            {entry.abc && <MiniScore abc={entry.abc} />}
                        </div>
                    ))}
                </section>
            ))}
        </InfoModal>
    );
}
