import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
    test('renders brand and three buttons', () => {
        render(<Toolbar engineState="idle" canPlay onPlay={() => {}} onStop={() => {}} onDownload={() => {}} />);
        expect(screen.getByText(/tinybit/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /play/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /stop/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    });

    test('Play is disabled when canPlay is false', () => {
        render(<Toolbar engineState="idle" canPlay={false} onPlay={() => {}} onStop={() => {}} onDownload={() => {}} />);
        expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
    });

    test('clicking Play and Download fires the callbacks', async () => {
        const onPlay = vi.fn();
        const onDownload = vi.fn();
        render(<Toolbar engineState="idle" canPlay onPlay={onPlay} onStop={() => {}} onDownload={onDownload} />);
        await userEvent.click(screen.getByRole('button', { name: /play/i }));
        await userEvent.click(screen.getByRole('button', { name: /download/i }));
        expect(onPlay).toHaveBeenCalledOnce();
        expect(onDownload).toHaveBeenCalledOnce();
    });

    test('shows a Crashed pill in error state with click-to-reset', async () => {
        const onReset = vi.fn();
        render(<Toolbar engineState="error" canPlay onPlay={() => {}} onStop={() => {}} onDownload={() => {}} onResetEngine={onReset} />);
        const pill = screen.getByText(/crashed/i);
        await userEvent.click(pill);
        expect(onReset).toHaveBeenCalledOnce();
    });
});
