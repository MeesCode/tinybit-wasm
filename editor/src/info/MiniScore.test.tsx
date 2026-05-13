import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MiniScore } from './MiniScore';

const renderAbc = vi.fn((el: HTMLElement, _abc: string): void => {
    el.innerHTML = '<svg data-testid="mini-svg"></svg>';
});

vi.mock('abcjs', () => ({
    default:    { renderAbc: (el: HTMLElement, abc: string) => renderAbc(el, abc) },
    renderAbc:  (el: HTMLElement, abc: string) => renderAbc(el, abc),
}));

beforeEach(() => { renderAbc.mockClear(); });
afterEach(() => cleanup());

describe('MiniScore', () => {
    it('renders an SVG via abcjs for valid ABC', async () => {
        render(<MiniScore abc="K:C\nC D E F" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByTestId('mini-svg')).toBeInTheDocument());
    });

    it('renders an error band when abcjs throws', async () => {
        renderAbc.mockImplementationOnce(() => { throw new Error('mini-boom'); });
        render(<MiniScore abc="bogus" />);
        await waitFor(() => expect(screen.getByText(/mini-boom/i)).toBeInTheDocument());
    });

    it('re-renders when the abc prop changes', async () => {
        const { rerender } = render(<MiniScore abc="K:C\nC" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(1));
        rerender(<MiniScore abc="K:G\nG" />);
        await waitFor(() => expect(renderAbc).toHaveBeenCalledTimes(2));
    });
});
