import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
    test('renders brand and four buttons', () => {
        render(<Toolbar engineState="idle" canPlay onPlay={() => {}} onStop={() => {}} onClear={() => {}} onGallery={() => {}} onDownload={() => {}} onOpen={() => {}} />);
        expect(screen.getByText(/tinybit/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /play/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /stop/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /open/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    });

    test('Play is disabled when canPlay is false', () => {
        render(<Toolbar engineState="idle" canPlay={false} onPlay={() => {}} onStop={() => {}} onClear={() => {}} onGallery={() => {}} onDownload={() => {}} onOpen={() => {}} />);
        expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
    });

    test('clicking Play, Open, Download fires their callbacks', async () => {
        const onPlay = vi.fn();
        const onOpen = vi.fn();
        const onDownload = vi.fn();
        render(<Toolbar engineState="idle" canPlay onPlay={onPlay} onStop={() => {}} onClear={() => {}} onGallery={() => {}} onDownload={onDownload} onOpen={onOpen} />);
        await userEvent.click(screen.getByRole('button', { name: /play/i }));
        await userEvent.click(screen.getByRole('button', { name: /open/i }));
        await userEvent.click(screen.getByRole('button', { name: /download/i }));
        expect(onPlay).toHaveBeenCalledOnce();
        expect(onOpen).toHaveBeenCalledOnce();
        expect(onDownload).toHaveBeenCalledOnce();
    });

    test('shows a Crashed pill in error state with click-to-reset', async () => {
        const onReset = vi.fn();
        render(<Toolbar engineState="error" canPlay onPlay={() => {}} onStop={() => {}} onDownload={() => {}} onOpen={() => {}} onClear={() => {}} onGallery={() => {}} onResetEngine={onReset} />);
        const pill = screen.getByText(/crashed/i);
        await userEvent.click(pill);
        expect(onReset).toHaveBeenCalledOnce();
    });

    test('renders a Clear button between Stop and Open and fires onClear', async () => {
        const onClear = vi.fn();
        render(
            <Toolbar
                engineState="idle"
                canPlay={true}
                onPlay={() => {}}
                onStop={() => {}}
                onOpen={() => {}}
                onDownload={() => {}}
                onClear={onClear}
                onGallery={() => {}}
            />,
        );
        const buttons = screen.getAllByRole('button');
        const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
        const stopIdx  = labels.findIndex((l) => /stop/i.test(l));
        const openIdx  = labels.findIndex((l) => /open/i.test(l));
        const clearIdx = labels.findIndex((l) => /clear/i.test(l));
        expect(clearIdx).toBeGreaterThan(stopIdx);
        expect(clearIdx).toBeLessThan(openIdx);

        await userEvent.click(screen.getByRole('button', { name: /clear editor/i }));
        expect(onClear).toHaveBeenCalledOnce();
    });

    test('renders a Player button between Clear and Gallery and fires onOpenPlayer', async () => {
        const onOpenPlayer = vi.fn();
        render(
            <Toolbar
                engineState="idle"
                canPlay={true}
                onPlay={() => {}}
                onStop={() => {}}
                onClear={() => {}}
                onGallery={() => {}}
                onOpen={() => {}}
                onDownload={() => {}}
                onOpenPlayer={onOpenPlayer}
            />,
        );
        const buttons = screen.getAllByRole('button');
        const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
        const clearIdx   = labels.findIndex((l) => /clear/i.test(l));
        const playerIdx  = labels.findIndex((l) => /open in player/i.test(l));
        const galleryIdx = labels.findIndex((l) => /gallery/i.test(l));
        expect(playerIdx).toBeGreaterThan(clearIdx);
        expect(playerIdx).toBeLessThan(galleryIdx);

        await userEvent.click(screen.getByRole('button', { name: /open in player/i }));
        expect(onOpenPlayer).toHaveBeenCalledOnce();
    });

    test('renders Player and Gallery buttons between Clear and Open', async () => {
        const onGallery = vi.fn();
        render(
            <Toolbar
                engineState="idle"
                canPlay={true}
                onPlay={() => {}}
                onStop={() => {}}
                onClear={() => {}}
                onGallery={onGallery}
                onOpen={() => {}}
                onDownload={() => {}}
                onOpenPlayer={() => {}}
            />,
        );
        const buttons = screen.getAllByRole('button');
        const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
        const clearIdx   = labels.findIndex((l) => /clear/i.test(l));
        const playerIdx  = labels.findIndex((l) => /open in player/i.test(l));
        const galleryIdx = labels.findIndex((l) => /gallery/i.test(l));
        const openIdx    = labels.findIndex((l) => /^open$/i.test(l));
        expect(clearIdx).toBeLessThan(playerIdx);
        expect(playerIdx).toBeLessThan(galleryIdx);
        expect(galleryIdx).toBeLessThan(openIdx);

        await userEvent.click(screen.getByRole('button', { name: /gallery/i }));
        expect(onGallery).toHaveBeenCalledOnce();
    });
});
