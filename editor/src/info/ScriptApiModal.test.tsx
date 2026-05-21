import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ScriptApiModal } from './ScriptApiModal';
import { SCRIPT_API_SECTIONS } from './scriptApi';

afterEach(() => cleanup());

function open() {
    return render(<ScriptApiModal open={true} onClose={() => {}} />);
}

describe('ScriptApiModal — shell', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<ScriptApiModal open={false} onClose={() => {}} />);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('invokes onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        render(<ScriptApiModal open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('ScriptApiModal — sidebar', () => {
    it('renders a tab for every section', () => {
        open();
        for (const s of SCRIPT_API_SECTIONS) {
            expect(screen.getByRole('tab', { name: new RegExp(`^${s.title}\\b`, 'i') })).toBeInTheDocument();
        }
    });

    it('starts on the first section (Hooks)', () => {
        open();
        const hooksTab = screen.getByRole('tab', { name: /^Hooks\b/ });
        expect(hooksTab).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('_draw')).toBeInTheDocument();
    });

    it('switching to Drawing reveals drawing entries and hides Hooks entries', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        expect(screen.getByText('cls')).toBeInTheDocument();
        expect(screen.getByText('sprite (cell)')).toBeInTheDocument();
        expect(screen.queryByText('_draw')).toBeNull();
    });

    it('renders the entry count in each sidebar tab', () => {
        open();
        const drawing = SCRIPT_API_SECTIONS.find((s) => s.title === 'Drawing')!;
        const tab = screen.getByRole('tab', { name: /^Drawing\b/ });
        expect(tab.textContent).toContain(String(drawing.items.length));
    });
});

describe('ScriptApiModal — entry rendering', () => {
    it('renders parameters when an entry has params', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        // sprite (cell) has params [n, "x, y"]
        const card = screen.getByText('sprite (cell)').closest('article')!;
        expect(within(card).getByText(/parameters/i)).toBeInTheDocument();
        expect(within(card).getByText('n')).toBeInTheDocument();
    });

    it('renders an example block when provided', () => {
        open();
        const card = screen.getByText('_draw').closest('article')!;
        expect(within(card).getByText(/example/i)).toBeInTheDocument();
    });

    it('renders a tip block when provided', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        const card = screen.getByText('draw_polygon').closest('article')!;
        expect(within(card).getByText(/tip/i)).toBeInTheDocument();
    });

    it('omits parameters/example/tip blocks when the entry does not provide them', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        const card = screen.getByText('duplicate').closest('article')!;
        expect(within(card).queryByText(/parameters/i)).toBeNull();
        expect(within(card).queryByText(/example/i)).toBeNull();
        expect(within(card).queryByText(/^tip$/i)).toBeNull();
    });
});

describe('ScriptApiModal — search', () => {
    it('filters the right pane to matching entries in the active category', () => {
        open();
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sprite' } });
        expect(screen.getByText('sprite (cell)')).toBeInTheDocument();
        expect(screen.getByText('sprite (region)')).toBeInTheDocument();
        expect(screen.queryByText('cls')).toBeNull();
    });

    it('hides categories with zero matches from the sidebar while a filter is active', () => {
        open();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sprite' } });
        expect(screen.queryByRole('tab', { name: /^Hooks\b/ })).toBeNull();
        expect(screen.queryByRole('tab', { name: /^Color\b/ })).toBeNull();
        expect(screen.getByRole('tab', { name: /^Drawing\b/ })).toBeInTheDocument();
    });

    it('shows an empty state when the active category has no matches', () => {
        open();
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzznomatch' } });
        expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    });

    it('matches against name, signature, and description', () => {
        open();
        // "Pause" only appears in sleep()'s description.
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pause' } });
        const miscTab = screen.getByRole('tab', { name: /^Misc\b/ });
        fireEvent.click(miscTab);
        expect(screen.getByText('sleep')).toBeInTheDocument();
    });
});

describe('ScriptApiModal — keyboard navigation', () => {
    it('ArrowDown on the sidebar moves to the next category', () => {
        open();
        const hooksTab = screen.getByRole('tab', { name: /^Hooks\b/ });
        hooksTab.focus();
        fireEvent.keyDown(hooksTab, { key: 'ArrowDown' });
        const annotationsTab = screen.getByRole('tab', { name: /^Annotations\b/ });
        expect(annotationsTab).toHaveAttribute('aria-selected', 'true');
    });
});

describe('ScriptApiModal — Insert button', () => {
    it('does not render Insert buttons when onInsert is not provided', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        expect(screen.queryByRole('button', { name: /^insert .* at cursor$/i })).toBeNull();
    });

    it('renders an Insert button per entry when onInsert is provided', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} onInsert={() => {}} />);
        // On the default Hooks tab: _draw is the only entry.
        expect(screen.getByRole('button', { name: /^insert _draw at cursor$/i })).toBeInTheDocument();
    });

    it('clicking Insert calls onInsert with the entry\'s `insert` value when present', () => {
        const onInsert = vi.fn();
        render(<ScriptApiModal open={true} onClose={() => {}} onInsert={onInsert} />);
        fireEvent.click(screen.getByRole('button', { name: /^insert _draw at cursor$/i }));
        expect(onInsert).toHaveBeenCalledTimes(1);
        // _draw has an `insert` override that is a multi-line skeleton.
        const arg = onInsert.mock.calls[0][0] as string;
        expect(arg).toContain('function _draw()');
        expect(arg).toContain('end');
    });

    it('clicking Insert falls back to signature when `insert` is absent', () => {
        const onInsert = vi.fn();
        render(<ScriptApiModal open={true} onClose={() => {}} onInsert={onInsert} />);
        fireEvent.click(screen.getByRole('tab', { name: /^Drawing\b/ }));
        fireEvent.click(screen.getByRole('button', { name: /^insert cls at cursor$/i }));
        expect(onInsert).toHaveBeenCalledWith('cls()');
    });

    it('clicking Insert closes the modal', () => {
        const onInsert = vi.fn();
        const onClose = vi.fn();
        render(<ScriptApiModal open={true} onClose={onClose} onInsert={onInsert} />);
        fireEvent.click(screen.getByRole('button', { name: /^insert _draw at cursor$/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('strips the `-> ReturnType` suffix from inserted signatures', () => {
        const onInsert = vi.fn();
        render(<ScriptApiModal open={true} onClose={() => {}} onInsert={onInsert} />);
        fireEvent.click(screen.getByRole('tab', { name: /^Misc\b/ }));
        fireEvent.click(screen.getByRole('button', { name: /^insert random at cursor$/i }));
        // random's signature is `random(min, max) -> int`; the inserted text should drop the return type.
        expect(onInsert).toHaveBeenCalledWith('random(min, max)');
    });
});
