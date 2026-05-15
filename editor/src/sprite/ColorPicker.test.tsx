import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { ColorPanel } from './ColorPanel';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('<ColorPicker>', () => {
    test('the colour preview is a button, not a native colour input', () => {
        render(<ColorPanel />);
        const swatch = screen.getByRole('button', { name: /current colour/i });
        expect(swatch.tagName).toBe('BUTTON');
        expect(swatch.getAttribute('aria-haspopup')).toBe('dialog');
        // Sanity: the implementation must not fall back to the native picker.
        expect(document.querySelector('input[type="color"]')).toBeNull();
    });

    test('clicking the preview toggles a custom dialog (not input[type=color])', () => {
        render(<ColorPanel />);
        const swatch = screen.getByRole('button', { name: /current colour/i });
        expect(screen.queryByRole('dialog', { name: /colour picker/i })).toBeNull();

        fireEvent.click(swatch);
        expect(screen.getByRole('dialog', { name: /colour picker/i })).toBeInTheDocument();
        expect(document.querySelector('input[type="color"]')).toBeNull();

        fireEvent.click(swatch);
        expect(screen.queryByRole('dialog', { name: /colour picker/i })).toBeNull();
    });

    test('the picker exposes custom HSV/alpha sliders, not native colour input', () => {
        render(<ColorPanel />);
        fireEvent.click(screen.getByRole('button', { name: /current colour/i }));
        // Three sliders inside the dialog: SV square, hue, alpha.
        expect(screen.getByRole('slider', { name: /saturation and value/i })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: /^hue$/i })).toBeInTheDocument();
        expect(screen.getAllByRole('slider', { name: /alpha/i }).length).toBeGreaterThan(0);
    });

    test('typing into the picker hex input updates the store (snapped)', () => {
        render(<ColorPanel />);
        fireEvent.click(screen.getByRole('button', { name: /current colour/i }));
        const hex = screen.getByLabelText(/hex \(picker\)/i) as HTMLInputElement;
        fireEvent.focus(hex);
        fireEvent.change(hex, { target: { value: '#12ab34ff' } });
        fireEvent.blur(hex);
        expect(useSpriteEditorStore.getState().color).toBe(0x10A030F0);
    });

    test('Escape on the dialog closes it', () => {
        render(<ColorPanel />);
        fireEvent.click(screen.getByRole('button', { name: /current colour/i }));
        expect(screen.getByRole('dialog', { name: /colour picker/i })).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: /colour picker/i })).toBeNull();
    });

    test('pointerdown outside the dialog closes it', async () => {
        const { container } = render(
            <div>
                <ColorPanel />
                <div data-testid="outside" style={{ width: 10, height: 10 }} />
            </div>,
        );
        fireEvent.click(screen.getByRole('button', { name: /current colour/i }));
        expect(screen.getByRole('dialog', { name: /colour picker/i })).toBeInTheDocument();

        // The picker installs its document listener on a setTimeout(0) so the
        // opening click can't immediately fire it — flush the timer.
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });

        const outside = container.querySelector('[data-testid="outside"]') as HTMLElement;
        fireEvent.pointerDown(outside);
        expect(screen.queryByRole('dialog', { name: /colour picker/i })).toBeNull();
    });
});
