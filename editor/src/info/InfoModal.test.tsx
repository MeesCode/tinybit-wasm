import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InfoModal } from './InfoModal';

afterEach(() => cleanup());

describe('InfoModal', () => {
    it('renders nothing when open=false', () => {
        const { container } = render(<InfoModal open={false} title="X" onClose={() => {}}>body</InfoModal>);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders title, children, and a close button when open=true', () => {
        render(<InfoModal open={true} title="Script API" onClose={() => {}}><span>BODY</span></InfoModal>);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Script API');
        expect(screen.getByText('Script API')).toBeInTheDocument();
        expect(screen.getByText('BODY')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('invokes onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}>body</InfoModal>);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('invokes onClose when the backdrop is clicked', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}>body</InfoModal>);
        // The backdrop is the role="dialog" element itself; clicking it (not children) closes.
        fireEvent.click(screen.getByRole('dialog'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does NOT invoke onClose when a child of the dialog is clicked', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}><button>inside</button></InfoModal>);
        fireEvent.click(screen.getByRole('button', { name: 'inside' }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('invokes onClose on Escape keypress', () => {
        const onClose = vi.fn();
        render(<InfoModal open={true} title="X" onClose={onClose}>body</InfoModal>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not bind Escape when closed (no spurious onClose calls)', () => {
        const onClose = vi.fn();
        render(<InfoModal open={false} title="X" onClose={onClose}>body</InfoModal>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('marks the scrollable body with overflow:auto', () => {
        render(<InfoModal open={true} title="X" onClose={() => {}}><span data-testid="kid" /></InfoModal>);
        const body = screen.getByTestId('kid').parentElement!;
        expect(body.style.overflow).toBe('auto');
    });
});
