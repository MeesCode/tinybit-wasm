import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ColorPanel } from './ColorPanel';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => useSpriteEditorStore.getState().reset());

describe('<ColorPanel>', () => {
    test('hex input sets the colour (snapped)', () => {
        render(<ColorPanel />);
        const hex = screen.getByLabelText(/hex/i) as HTMLInputElement;
        fireEvent.change(hex, { target: { value: '#a9b7c8ff' } });
        fireEvent.blur(hex);
        expect(useSpriteEditorStore.getState().color).toBe(0xA0B0C0F0);
    });

    test('recent colours render; clicking one sets current colour', () => {
        useSpriteEditorStore.getState().setColor(0xFF0000FF);  // snaps to 0xF00000F0
        useSpriteEditorStore.getState().setColor(0x00FF00FF);  // snaps to 0x00F000F0
        render(<ColorPanel />);
        const buttons = screen.getAllByRole('button', { name: /recent colour/i });
        expect(buttons.length).toBe(2);
        useSpriteEditorStore.getState().setColor(0x000000FF);   // change current
        fireEvent.click(buttons[0]);                            // most-recent is the green one
        expect(useSpriteEditorStore.getState().color).toBe(0x00F000F0);
    });
});
