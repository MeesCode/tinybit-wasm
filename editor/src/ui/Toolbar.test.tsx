import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
    test('renders brand and four buttons', () => {
        render(<Toolbar engineState="idle" canPlay onPlay={() => {}} onStop={() => {}} onReset={() => {}} onDownload={() => {}} onOpen={() => {}} />);
        expect(screen.getByText(/tinybit/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /play/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /stop/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /open/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    });

    test('Play is disabled when canPlay is false', () => {
        render(<Toolbar engineState="idle" canPlay={false} onPlay={() => {}} onStop={() => {}} onReset={() => {}} onDownload={() => {}} onOpen={() => {}} />);
        expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
    });

    test('clicking Play, Open, Download fires their callbacks', async () => {
        const onPlay = vi.fn();
        const onOpen = vi.fn();
        const onDownload = vi.fn();
        render(<Toolbar engineState="idle" canPlay onPlay={onPlay} onStop={() => {}} onReset={() => {}} onDownload={onDownload} onOpen={onOpen} />);
        await userEvent.click(screen.getByRole('button', { name: /play/i }));
        await userEvent.click(screen.getByRole('button', { name: /open/i }));
        await userEvent.click(screen.getByRole('button', { name: /download/i }));
        expect(onPlay).toHaveBeenCalledOnce();
        expect(onOpen).toHaveBeenCalledOnce();
        expect(onDownload).toHaveBeenCalledOnce();
    });

    test('shows a Crashed pill in error state with click-to-reset', async () => {
        const onReset = vi.fn();
        render(<Toolbar engineState="error" canPlay onPlay={() => {}} onStop={() => {}} onDownload={() => {}} onOpen={() => {}} onReset={() => {}} onResetEngine={onReset} />);
        const pill = screen.getByText(/crashed/i);
        await userEvent.click(pill);
        expect(onReset).toHaveBeenCalledOnce();
    });

    test('renders a Reset button between Stop and Open and fires onReset', async () => {
        const onReset = vi.fn();
        render(
            <Toolbar
                engineState="idle"
                canPlay={true}
                onPlay={() => {}}
                onStop={() => {}}
                onOpen={() => {}}
                onDownload={() => {}}
                onReset={onReset}
            />,
        );
        const buttons = screen.getAllByRole('button');
        const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
        const stopIdx  = labels.findIndex((l) => /stop/i.test(l));
        const openIdx  = labels.findIndex((l) => /open/i.test(l));
        const resetIdx = labels.findIndex((l) => /reset/i.test(l));
        expect(resetIdx).toBeGreaterThan(stopIdx);
        expect(resetIdx).toBeLessThan(openIdx);

        await userEvent.click(screen.getByRole('button', { name: /reset to demo/i }));
        expect(onReset).toHaveBeenCalledOnce();
    });
});
