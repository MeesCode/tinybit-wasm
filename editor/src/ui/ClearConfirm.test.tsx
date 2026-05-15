import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClearConfirm } from './ClearConfirm';

describe('ClearConfirm', () => {
    test('renders body text and two buttons', () => {
        render(<ClearConfirm onClear={() => {}} onCancel={() => {}} />);
        expect(screen.getByText(/clear the editor/i)).toBeInTheDocument();
        expect(screen.getByText(/discard your current/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    test('Clear fires onClear exactly once and not onCancel', async () => {
        const onClear  = vi.fn();
        const onCancel = vi.fn();
        render(<ClearConfirm onClear={onClear} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /^clear$/i }));
        expect(onClear).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();
    });

    test('Cancel fires onCancel exactly once and not onClear', async () => {
        const onClear  = vi.fn();
        const onCancel = vi.fn();
        render(<ClearConfirm onClear={onClear} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onClear).not.toHaveBeenCalled();
    });

    test('Escape key fires onCancel', async () => {
        const onClear  = vi.fn();
        const onCancel = vi.fn();
        render(<ClearConfirm onClear={onClear} onCancel={onCancel} />);
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledOnce();
    });

    test('Cancel button receives focus on open (Clear does not)', () => {
        render(<ClearConfirm onClear={() => {}} onCancel={() => {}} />);
        expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus();
        expect(screen.getByRole('button', { name: /^clear$/i })).not.toHaveFocus();
    });
});
