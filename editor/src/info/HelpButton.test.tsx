import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HelpButton } from './HelpButton';

afterEach(() => cleanup());

describe('HelpButton', () => {
    it('renders a button with a ? glyph and the provided aria-label', () => {
        render(<HelpButton onClick={() => {}} aria-label="Open help" />);
        const btn = screen.getByRole('button', { name: /open help/i });
        expect(btn.textContent).toContain('?');
    });

    it('invokes onClick when clicked', () => {
        const onClick = vi.fn();
        render(<HelpButton onClick={onClick} aria-label="Open help" />);
        fireEvent.click(screen.getByRole('button', { name: /open help/i }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('applies extra style overrides', () => {
        render(<HelpButton onClick={() => {}} aria-label="Help" style={{ position: 'absolute', top: 8, right: 8 }} />);
        const btn = screen.getByRole('button', { name: /help/i });
        expect(btn.style.position).toBe('absolute');
        expect(btn.style.top).toBe('8px');
        expect(btn.style.right).toBe('8px');
    });
});
