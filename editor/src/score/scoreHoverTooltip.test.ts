import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { scoreHoverTooltip } from './scoreHoverTooltip';

function makeView(doc: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const state = EditorState.create({ doc, extensions: [scoreHoverTooltip(() => {})] });
    return new EditorView({ state, parent: host });
}

describe('scoreHoverTooltip', () => {
    it('returns a CodeMirror extension', () => {
        const ext = scoreHoverTooltip(() => {});
        expect(ext).toBeDefined();
    });

    it('does not throw when applied to a script with a linked score', () => {
        const script = '--@score: m\nlocal m = [[\nK:C\nC\n]]\nmusic(m)\n';
        const view = makeView(script);
        expect(view.state.doc.toString()).toBe(script);
        view.destroy();
    });

    it('does not throw on a script with no annotations', () => {
        const view = makeView('function _draw() end\n');
        expect(view.state.doc.toString()).toBe('function _draw() end\n');
        view.destroy();
    });

    it('invokes the onPick callback when the tooltip button receives a synthesized click', async () => {
        // We can't easily synthesize a mouse hover that triggers CM6's hoverTooltip, but we
        // can verify the *callback contract* by exporting and unit-testing the click handler.
        const onPick = vi.fn();
        const mod = await import('./scoreHoverTooltip');
        const handler = mod.__forTest_clickHandler(onPick);
        handler('name:m');
        expect(onPick).toHaveBeenCalledWith('name:m');
    });
});
