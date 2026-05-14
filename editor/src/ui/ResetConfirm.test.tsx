import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetConfirm } from './ResetConfirm';

describe('ResetConfirm', () => {
    test('renders body text and two buttons', () => {
        render(<ResetConfirm onReset={() => {}} onCancel={() => {}} />);
        expect(screen.getByText(/reset to the demo/i)).toBeInTheDocument();
        expect(screen.getByText(/discard your current/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    test('Reset fires onReset exactly once and not onCancel', async () => {
        const onReset  = vi.fn();
        const onCancel = vi.fn();
        render(<ResetConfirm onReset={onReset} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /reset/i }));
        expect(onReset).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();
    });

    test('Cancel fires onCancel exactly once and not onReset', async () => {
        const onReset  = vi.fn();
        const onCancel = vi.fn();
        render(<ResetConfirm onReset={onReset} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onReset).not.toHaveBeenCalled();
    });

    test('Escape key fires onCancel', async () => {
        const onReset  = vi.fn();
        const onCancel = vi.fn();
        render(<ResetConfirm onReset={onReset} onCancel={onCancel} />);
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
