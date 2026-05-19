import { useEffect, type CSSProperties, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(24, 24, 32, 0.45)',
    display: 'grid', placeItems: 'center', zIndex: 9999,
};
const panel: CSSProperties = {
    display: 'flex', flexDirection: 'column',
    background: '#FFFFFF', borderRadius: 10,
    width: 'min(720px, 92vw)', maxHeight: '80vh',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    fontSize: 14, color: '#181820',
    overflow: 'hidden',
};
const header: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid #ECECF0',
    flex: '0 0 auto',
};
const titleStyle: CSSProperties = { fontWeight: 700, fontSize: 16 };
const closeBtn: CSSProperties = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 22, lineHeight: 1, color: '#6B6B76', padding: '0 4px',
};
const body: CSSProperties = {
    overflow: 'auto', padding: '14px 18px',
    flex: 1, minHeight: 0,
};

export interface InfoModalProps {
    open: boolean;
    title: string;
    onClose(): void;
    children: ReactNode;
}

export function InfoModal({ open, title, onClose, children }: InfoModalProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label={title} style={overlay} onClick={onBackdrop}>
            <div style={panel}>
                <div style={header}>
                    <div style={titleStyle}>{title}</div>
                    <button type="button" aria-label="Close" style={closeBtn} onClick={onClose}>×</button>
                </div>
                <div style={body}>{children}</div>
            </div>
        </div>,
        document.body,
    );
}
