import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ToolRail } from './ToolRail';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('<ToolRail>', () => {
    test('renders four tool buttons', () => {
        render(<ToolRail />);
        expect(screen.getByRole('button', { name: /pencil/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /eraser/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /fill/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /eyedropper/i })).toBeTruthy();
    });

    test('clicking a tool switches the store', () => {
        render(<ToolRail />);
        fireEvent.click(screen.getByRole('button', { name: /eraser/i }));
        expect(useSpriteEditorStore.getState().tool).toBe('eraser');
    });

    test('pencil size slider updates store', () => {
        render(<ToolRail />);
        const slider = screen.getByLabelText(/pencil size/i) as HTMLInputElement;
        fireEvent.change(slider, { target: { value: '3' } });
        expect(useSpriteEditorStore.getState().pencilSize).toBe(4);
    });

    test('zoom in/out buttons step the ladder', () => {
        useSpriteEditorStore.setState({ zoom: 1 });
        render(<ToolRail />);
        fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
        expect(useSpriteEditorStore.getState().zoom).toBe(2);
        fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
        expect(useSpriteEditorStore.getState().zoom).toBe(1);
    });
});
