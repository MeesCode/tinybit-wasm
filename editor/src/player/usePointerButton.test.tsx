import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { usePointerButton } from './usePointerButton';

function Harness({ onChange }: { onChange: (pressed: boolean) => void }) {
    const handlers = usePointerButton(onChange);
    return <div data-testid="hitbox" {...handlers} style={{ width: 50, height: 50, ...handlers.style }} />;
}

describe('usePointerButton', () => {
    test('pointerdown sets pressed true, pointerup false', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox');
        fireEvent.pointerDown(hb, { pointerId: 1 });
        fireEvent.pointerUp(hb, { pointerId: 1 });
        expect(onChange).toHaveBeenNthCalledWith(1, true);
        expect(onChange).toHaveBeenNthCalledWith(2, false);
    });

    test('pointercancel releases the button', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox');
        fireEvent.pointerDown(hb, { pointerId: 1 });
        fireEvent.pointerCancel(hb, { pointerId: 1 });
        expect(onChange).toHaveBeenLastCalledWith(false);
    });

    test('lostpointercapture releases the button', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox');
        fireEvent.pointerDown(hb, { pointerId: 1 });
        fireEvent.lostPointerCapture(hb, { pointerId: 1 });
        expect(onChange).toHaveBeenLastCalledWith(false);
    });

    test('touchAction style is "none"', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const hb = screen.getByTestId('hitbox') as HTMLElement;
        expect(hb.style.touchAction).toBe('none');
    });
});
