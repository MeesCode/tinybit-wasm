import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SpriteEditor } from './SpriteEditor';
import { useSketchStore } from '../state/sketchStore';
import { useSpriteEditorStore } from '../state/spriteEditorStore';

beforeEach(() => {
    useSketchStore.getState().reset();
    useSpriteEditorStore.getState().reset();
});

describe('<SpriteEditor>', () => {
    test('renders the three subcomponents', () => {
        const { container } = render(<SpriteEditor />);
        expect(container.querySelector('[role="toolbar"]')).toBeTruthy();
        expect(container.querySelectorAll('canvas').length).toBe(2);
        expect(container.querySelector('[role="region"]')).toBeTruthy();
    });

    test('keyboard b/e/g/i switches tools', () => {
        const { container } = render(<SpriteEditor />);
        const root = container.firstChild as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: 'e' });
        expect(useSpriteEditorStore.getState().tool).toBe('eraser');
        fireEvent.keyDown(root, { key: 'g' });
        expect(useSpriteEditorStore.getState().tool).toBe('fill');
        fireEvent.keyDown(root, { key: 'i' });
        expect(useSpriteEditorStore.getState().tool).toBe('eyedropper');
        fireEvent.keyDown(root, { key: 'b' });
        expect(useSpriteEditorStore.getState().tool).toBe('pencil');
    });

    test('keyboard + / - zooms', () => {
        useSpriteEditorStore.setState({ zoom: 4 });
        const { container } = render(<SpriteEditor />);
        const root = container.firstChild as HTMLElement;
        root.focus();
        fireEvent.keyDown(root, { key: '+' });
        expect(useSpriteEditorStore.getState().zoom).toBe(8);
        fireEvent.keyDown(root, { key: '-' });
        expect(useSpriteEditorStore.getState().zoom).toBe(4);
    });
});
