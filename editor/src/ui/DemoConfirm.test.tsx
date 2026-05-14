import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoConfirm } from './DemoConfirm';

describe('DemoConfirm', () => {
    test('renders body text and two buttons', () => {
        render(<DemoConfirm onLoad={() => {}} onCancel={() => {}} />);
        expect(screen.getByText(/load the demo/i)).toBeInTheDocument();
        expect(screen.getByText(/discard your current/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^load demo$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    });

    test('Load demo button fires onLoad exactly once and not onCancel', async () => {
        const onLoad   = vi.fn();
        const onCancel = vi.fn();
        render(<DemoConfirm onLoad={onLoad} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /^load demo$/i }));
        expect(onLoad).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();
    });

    test('Cancel fires onCancel exactly once and not onLoad', async () => {
        const onLoad   = vi.fn();
        const onCancel = vi.fn();
        render(<DemoConfirm onLoad={onLoad} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onLoad).not.toHaveBeenCalled();
    });

    test('Escape key fires onCancel', async () => {
        const onLoad   = vi.fn();
        const onCancel = vi.fn();
        render(<DemoConfirm onLoad={onLoad} onCancel={onCancel} />);
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledOnce();
    });

    test('Cancel button receives focus on open (Load demo does not)', () => {
        render(<DemoConfirm onLoad={() => {}} onCancel={() => {}} />);
        expect(screen.getByRole('button', { name: /^cancel$/i })).toHaveFocus();
        expect(screen.getByRole('button', { name: /^load demo$/i })).not.toHaveFocus();
    });
});
