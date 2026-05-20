import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { PlayerShell } from './PlayerShell';
import { PLAYER_BUTTONS } from './shellLayout';

const noopProps = {
    onSetButton: () => {},
    onExit:      () => {},
    onReset:     () => {},
};

describe('PlayerShell', () => {
    test('renders the shell image, canvas, six hitboxes, and the top-bar Reset + Close buttons', () => {
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} {...noopProps} />);

        expect(screen.getByAltText(/player shell/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/tinybit display/i)).toBeInstanceOf(HTMLCanvasElement);
        for (const name of PLAYER_BUTTONS) {
            expect(screen.getByLabelText(new RegExp(`^${name} button$`, 'i'))).toBeInTheDocument();
        }
        expect(screen.getByRole('button', { name: /restart launcher/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /exit player/i })).toBeInTheDocument();
    });

    test('clicking Close fires onExit', async () => {
        const onExit = vi.fn();
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} {...noopProps} onExit={onExit} />);
        await userEvent.click(screen.getByRole('button', { name: /exit player/i }));
        expect(onExit).toHaveBeenCalledOnce();
    });

    test('clicking Reset fires onReset', async () => {
        const onReset = vi.fn();
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} {...noopProps} onReset={onReset} />);
        await userEvent.click(screen.getByRole('button', { name: /restart launcher/i }));
        expect(onReset).toHaveBeenCalledOnce();
    });

    test('pressing the A hitbox calls onSetButton with idx 0 (a) true then false', () => {
        const onSet = vi.fn();
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} {...noopProps} onSetButton={onSet} />);
        const a = screen.getByLabelText(/^a button$/i);
        fireEvent.pointerDown(a, { pointerId: 1 });
        fireEvent.pointerUp(a, { pointerId: 1 });
        expect(onSet).toHaveBeenNthCalledWith(1, 0, true);
        expect(onSet).toHaveBeenNthCalledWith(2, 0, false);
    });

    test('pressing the Up hitbox calls onSetButton with idx 2 (up)', () => {
        const onSet = vi.fn();
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} {...noopProps} onSetButton={onSet} />);
        const up = screen.getByLabelText(/^up button$/i);
        fireEvent.pointerDown(up, { pointerId: 1 });
        expect(onSet).toHaveBeenCalledWith(2, true);
    });

    test('canvas is 128x128 with pixelated rendering', () => {
        const ref = createRef<HTMLCanvasElement>();
        render(<PlayerShell canvasRef={ref} {...noopProps} />);
        const canvas = screen.getByLabelText(/tinybit display/i) as HTMLCanvasElement;
        expect(canvas.width).toBe(128);
        expect(canvas.height).toBe(128);
        expect(canvas.style.imageRendering).toBe('pixelated');
    });
});
