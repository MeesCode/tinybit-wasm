import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ScriptApiModal } from './ScriptApiModal';
import { SCRIPT_API_SECTIONS } from './scriptApi';

afterEach(() => cleanup());

describe('ScriptApiModal', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<ScriptApiModal open={false} onClose={() => {}} />);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders every section heading from SCRIPT_API_SECTIONS', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        for (const s of SCRIPT_API_SECTIONS) {
            expect(screen.getByRole('heading', { name: s.title })).toBeInTheDocument();
        }
    });

    it('renders the --@music and --@sfx annotation entries', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        expect(screen.getByText('--@music')).toBeInTheDocument();
        expect(screen.getByText('--@sfx')).toBeInTheDocument();
    });

    it('renders the _draw hook entry', () => {
        render(<ScriptApiModal open={true} onClose={() => {}} />);
        expect(screen.getByText('_draw')).toBeInTheDocument();
    });

    it('invokes onClose when ✕ is clicked', () => {
        const onClose = vi.fn();
        render(<ScriptApiModal open={true} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
