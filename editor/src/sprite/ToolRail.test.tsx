import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ToolRail } from './ToolRail';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('<ToolRail>', () => {
    test('renders four tool buttons', () => {
        render(<ToolRail />);
        expect(screen.getByRole('button', { name: 'Pencil' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Eraser' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fill' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Eyedropper' })).toBeTruthy();
    });

    test('clicking a tool switches the store', () => {
        render(<ToolRail />);
        fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
        expect(useSpriteEditorStore.getState().tool).toBe('eraser');
    });

    test('pencil size +/- buttons step through 1, 2, 3, 4, 8', () => {
        useSpriteEditorStore.setState({ pencilSize: 1 });
        render(<ToolRail />);
        const inc = screen.getByRole('button', { name: /increase pencil size/i });
        const dec = screen.getByRole('button', { name: /decrease pencil size/i });
        fireEvent.click(inc);
        expect(useSpriteEditorStore.getState().pencilSize).toBe(2);
        fireEvent.click(inc);
        fireEvent.click(inc);
        fireEvent.click(inc);
        expect(useSpriteEditorStore.getState().pencilSize).toBe(8);   // 2 → 3 → 4 → 8
        fireEvent.click(inc);
        expect(useSpriteEditorStore.getState().pencilSize).toBe(8);   // clamps at top
        fireEvent.click(dec);
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
