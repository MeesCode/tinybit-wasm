import { useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(24, 24, 32, 0.45)',
    display: 'grid', placeItems: 'center', zIndex: 9999,
};
const dialogStyle: CSSProperties = {
    background: '#FFFFFF', borderRadius: 10, padding: '20px 24px',
    minWidth: 320, maxWidth: 480, boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    fontSize: 14, color: '#181820',
};
const titleStyle: CSSProperties = { fontWeight: 700, fontSize: 16, marginBottom: 8 };
const bodyStyle:  CSSProperties = { color: '#6B6B76', marginBottom: 16, lineHeight: 1.5 };
const actionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const btnBase: CSSProperties = {
    padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    border: '1px solid #ECECF0', cursor: 'pointer',
};
const cancelStyle: CSSProperties = { ...btnBase, background: '#F1F1F4', color: '#181820' };
const clearStyle:  CSSProperties = { ...btnBase, background: '#ED225D', color: '#FFFFFF', borderColor: '#ED225D' };

export interface ClearConfirmProps {
    onClear():  void;
    onCancel(): void;
}

export function ClearConfirm({ onClear, onCancel }: ClearConfirmProps) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    return createPortal(
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Clear editor?">
            <div style={dialogStyle}>
                <div style={titleStyle}>Clear the editor?</div>
                <div style={bodyStyle}>
                    This will discard your current script, sprite, cover, title, and author.
                    Editor preferences are kept.
                </div>
                <div style={actionsStyle}>
                    <button type="button" style={cancelStyle} onClick={onCancel} autoFocus>Cancel</button>
                    <button type="button" style={clearStyle}  onClick={onClear}>Clear</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
