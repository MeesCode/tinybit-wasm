import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ScorePreview } from './ScorePreview';

const renderAbc = vi.fn((el: HTMLElement, _abc: string) => {
    el.innerHTML = '<svg data-testid="rendered-svg"><g></g></svg>';
});

vi.mock('abcjs', () => ({
    default:    { renderAbc: (...a: any[]) => renderAbc(...a) },
    renderAbc:  (...a: any[]) => renderAbc(...a),
}));

beforeEach(() => { renderAbc.mockClear(); });
afterEach(() => { cleanup(); });

describe('ScorePreview', () => {
    it('renders an SVG via abcjs when given valid ABC', async () => {
        render(<ScorePreview abc="K:C\nC D E F" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByTestId('rendered-svg')).toBeInTheDocument());
    });

    it('renders an error band when abcjs throws', async () => {
        renderAbc.mockImplementationOnce(() => { throw new Error('boom'); });
        render(<ScorePreview abc="totally broken" />);
        await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
    });

    it('re-renders when abc prop changes', async () => {
        const { rerender } = render(<ScorePreview abc="K:C\nC" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(1));
        rerender(<ScorePreview abc="K:G\nG" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(2));
    });
});
