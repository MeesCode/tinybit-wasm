import type { CSSProperties } from 'react';
import { FaPlay } from 'react-icons/fa6';

export interface PlayButtonProps {
    running: boolean;
    disabled: boolean;
    onClick(): void;
}

export function PlayButton({ running, disabled, onClick }: PlayButtonProps) {
    const baseStyle: CSSProperties = {
        padding: '6px 14px',
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 13,
        transition: 'background 0.12s, color 0.12s, opacity 0.12s',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
    };
    const style: CSSProperties = running
        ? { ...baseStyle, background: 'transparent', color: '#ED225D', border: '1.5px solid #ED225D' }
        : { ...baseStyle, background: '#ED225D', color: '#fff', border: '1.5px solid #ED225D' };
    return (
        <button type="button" onClick={onClick} disabled={disabled} style={style} aria-label="Play">
            <FaPlay size={12} aria-hidden /> Play
        </button>
    );
}
