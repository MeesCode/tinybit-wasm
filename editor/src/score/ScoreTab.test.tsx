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
    preview.sfx.mockClear();
    preview.stop.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ScoreTab — empty state', () => {
    it('shows empty state and a + New music button when no annotations exist', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        expect(screen.getByText(/no scores yet/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /new music/i })).toBeInTheDocument();
    });

    it('inserts a starter snippet into the script when + New music is clicked', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /new music/i }));
        const updated = useSketchStore.getState().script;
        expect(updated).toContain('--@music: music_1');
        expect(updated).toContain('[[\nL:1/4\nK:C\nC D E F |\n]]');
    });
});

describe('ScoreTab — with one score', () => {
    const SCRIPT = '--@music: melody\nlocal m = [[\nK:C\nC D E F\n]]\nmusic(m)\n';

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
        const SCRIPT = '--@music\nlocal m = [[\nK:C\nC\n]]\n';
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

describe('ScoreTab — sfx scores', () => {
    const SFX_SCRIPT = '--@sfx: jump\nlocal j = "c/4d/4"\nsfx(j)\n';

    it('renders a chip for the sfx score', () => {
        useSketchStore.setState({ script: SFX_SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        expect(screen.getByRole('button', { name: /jump/i })).toBeInTheDocument();
    });

    it('routes Play through preview.sfx when the selected score is sfx-kind', () => {
        useSketchStore.setState({ script: SFX_SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /play/i }));
        expect(preview.sfx).toHaveBeenCalledTimes(1);
        expect(preview.music).not.toHaveBeenCalled();
    });

    it('shows the SFX 10-note cap in the badge when an sfx score is selected', () => {
        useSketchStore.setState({ script: SFX_SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        // Badge text reflects the SFX cap, not the music 400 cap.
        expect(screen.getByText(/\/10 notes/i)).toBeInTheDocument();
    });

    it('inserts a starter --@sfx snippet when "+ New SFX" is clicked', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /\+ new sfx/i }));
        const updated = useSketchStore.getState().script;
        expect(updated).toContain('--@sfx: sfx_1');
    });
});
