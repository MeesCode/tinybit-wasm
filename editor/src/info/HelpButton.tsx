import type { CSSProperties } from 'react';

const baseStyle: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, padding: 0,
    fontSize: 12, fontWeight: 700,
    border: '1px solid #ED225D',
    borderRadius: 999,
    background: '#FFFFFF', color: '#ED225D',
    cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
};

export interface HelpButtonProps {
    onClick(): void;
    'aria-label': string;
    style?: CSSProperties;
}

export function HelpButton({ onClick, style, ...rest }: HelpButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={rest['aria-label']}
            style={{ ...baseStyle, ...style }}>
            ?
        </button>
    );
}
