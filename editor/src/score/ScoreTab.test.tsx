import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { useSketchStore, DEFAULT_SCRIPT } from '../state/sketchStore';
import { ScoreTab } from './ScoreTab';

vi.mock('abcjs', () => ({
    renderAbc: (el: HTMLElement) => { el.innerHTML = '<svg data-testid="rendered-svg"></svg>'; },
    default: { renderAbc: (el: HTMLElement) => { el.innerHTML = '<svg data-testid="rendered-svg"></svg>'; } },
}));

const preview = { music: vi.fn(), sfx: vi.fn(), stop: vi.fn() };

beforeEach(() => {
    useSketchStore.setState({ script: DEFAULT_SCRIPT });
    preview.music.mockClear();
    preview.stop.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ScoreTab — empty state', () => {
    it('shows empty state and a + New score button when no annotations exist', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        expect(screen.getByText(/no scores yet/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /new score/i })).toBeInTheDocument();
    });

    it('inserts a starter snippet into the script when + New score is clicked', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /new score/i }));
        const updated = useSketchStore.getState().script;
        expect(updated).toContain('--@score: score_1');
        expect(updated).toContain('[[\nL:1/4\nK:C\nC D E F |\n]]');
    });
});

describe('ScoreTab — with one score', () => {
    const SCRIPT = '--@score: melody\nlocal m = [[\nK:C\nC D E F\n]]\nmusic(m)\n';

    it('renders a chip for the score and loads its content into the editor', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        expect(screen.getByRole('button', { name: /melody/i })).toBeInTheDocument();
    });

    it('routes Play through preview.music with the current ABC content', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /play/i }));
        expect(preview.music).toHaveBeenCalledTimes(1);
        const called = preview.music.mock.calls[0][0] as string;
        expect(called).toContain('K:C');
    });

    it('routes Stop through preview.stop', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        expect(preview.stop).toHaveBeenCalled();
    });

    it('disables Play with a tooltip when previewAvailable=false', () => {
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable={false} />);
        const play = screen.getByRole('button', { name: /play/i });
        expect(play).toBeDisabled();
    });
});

describe('ScoreTab — stale link', () => {
    it('shows a banner when the held link is removed from the script', () => {
        const SCRIPT = '--@score\nlocal m = [[\nK:C\nC\n]]\n';
        useSketchStore.setState({ script: SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        // Externally remove the annotation
        act(() => useSketchStore.setState({ script: 'local m = [[\nK:C\nC\n]]\n' }));
        expect(screen.getByText(/no longer linked/i)).toBeInTheDocument();
    });
});

describe('ScoreTab — help modal', () => {
    it('opens the ABC modal when the ? button is clicked', () => {
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /abc notation help/i }));
        // The modal renders "ABC Notation" as a title.
        expect(screen.getByText('ABC Notation')).toBeInTheDocument();
    });
});
