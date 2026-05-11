import type { CSSProperties } from 'react';

export interface DownloadButtonProps {
    disabled: boolean;
    onClick(): void;
}

const style: CSSProperties = {
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 13,
    background: '#F1F1F4',
    color: '#181820',
    border: '1px solid #ECECF0',
};

export function DownloadButton({ disabled, onClick }: DownloadButtonProps) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} style={{ ...style, opacity: disabled ? 0.4 : 1 }} aria-label="Download">
            ⬇ Download
        </button>
    );
}
