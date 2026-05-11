import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadConfirm } from './UploadConfirm';

describe('UploadConfirm', () => {
    test('renders the filename and two buttons', () => {
        render(<UploadConfirm filename="cool-game.tb.png" onReplace={() => {}} onCancel={() => {}} />);
        expect(screen.getByText(/cool-game\.tb\.png/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    test('Replace fires onReplace exactly once and not onCancel', async () => {
        const onReplace = vi.fn();
        const onCancel  = vi.fn();
        render(<UploadConfirm filename="x.tb.png" onReplace={onReplace} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /replace/i }));
        expect(onReplace).toHaveBeenCalledOnce();
        expect(onCancel).not.toHaveBeenCalled();
    });

    test('Cancel fires onCancel exactly once and not onReplace', async () => {
        const onReplace = vi.fn();
        const onCancel  = vi.fn();
        render(<UploadConfirm filename="x.tb.png" onReplace={onReplace} onCancel={onCancel} />);
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledOnce();
        expect(onReplace).not.toHaveBeenCalled();
    });

    test('Escape key fires onCancel', async () => {
        const onReplace = vi.fn();
        const onCancel  = vi.fn();
        render(<UploadConfirm filename="x.tb.png" onReplace={onReplace} onCancel={onCancel} />);
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
