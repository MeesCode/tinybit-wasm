import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { CodeEditor } from './CodeEditor';

afterEach(() => cleanup());

describe('CodeEditor', () => {
    it('calls onReady once with an EditorView after mount', () => {
        const onReady = vi.fn();
        render(<CodeEditor value="print('hi')" onChange={() => {}} onReady={onReady} />);
        expect(onReady).toHaveBeenCalledTimes(1);
        const view = onReady.mock.calls[0][0];
        expect(view).toBeInstanceOf(EditorView);
        expect(view.state.doc.toString()).toBe("print('hi')");
    });

    it('does not call onReady on subsequent prop updates', () => {
        const onReady = vi.fn();
        const { rerender } = render(<CodeEditor value="a" onChange={() => {}} onReady={onReady} />);
        rerender(<CodeEditor value="b" onChange={() => {}} onReady={onReady} />);
        expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('works without an onReady prop', () => {
        expect(() => render(<CodeEditor value="x" onChange={() => {}} />)).not.toThrow();
    });
});
