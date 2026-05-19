import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AbcInfoModal } from './AbcInfoModal';
import { ABC_SECTIONS } from './abcInfo';

const renderAbc = vi.fn((el: HTMLElement, _abc: string): void => {
    el.innerHTML = '<svg data-testid="abc-svg"></svg>';
});

vi.mock('abcjs', () => ({
    default:    { renderAbc: (el: HTMLElement, abc: string) => renderAbc(el, abc) },
    renderAbc:  (el: HTMLElement, abc: string) => renderAbc(el, abc),
}));

afterEach(() => { cleanup(); renderAbc.mockClear(); });

describe('AbcInfoModal', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<AbcInfoModal open={false} onClose={() => {}} />);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders every section heading from ABC_SECTIONS', () => {
        render(<AbcInfoModal open={true} onClose={() => {}} />);
        for (const s of ABC_SECTIONS) {
            expect(screen.getByRole('heading', { name: s.title })).toBeInTheDocument();
        }
    });

    it('renders a MiniScore via abcjs for entries with an abc field', async () => {
        const abcCount = ABC_SECTIONS.reduce((n, s) => n + s.body.filter((e) => e.abc !== undefined).length, 0);
        render(<AbcInfoModal open={true} onClose={() => {}} />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(abcCount));
    });

    it('invokes onClose when ✕ is clicked', () => {
        const onClose = vi.fn();
        render(<AbcInfoModal open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
