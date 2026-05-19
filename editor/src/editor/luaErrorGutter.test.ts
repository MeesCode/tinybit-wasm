import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { luaErrorGutter, luaErrorMarkerField, setLuaErrorMarkerEffect } from './luaErrorGutter';

function decoCountFor(state: EditorState): number {
    let n = 0;
    const sets = state.facet(EditorView.decorations);
    for (const s of sets) {
        const set = typeof s === 'function' ? s(null as unknown as EditorView) : s;
        const iter = set.iter();
        while (iter.value) { n++; iter.next(); }
    }
    return n;
}

describe('luaErrorGutter', () => {
    it('starts with no marker', () => {
        const state = EditorState.create({
            doc: 'line 1\nline 2\nline 3',
            extensions: [luaErrorGutter()],
        });
        expect(state.field(luaErrorMarkerField)).toBeNull();
    });

    it('stores the marker when the effect fires', () => {
        const initial = EditorState.create({
            doc: 'line 1\nline 2\nline 3',
            extensions: [luaErrorGutter()],
        });
        const tr = initial.update({
            effects: setLuaErrorMarkerEffect.of({ line: 2, message: 'boom' }),
        });
        expect(tr.state.field(luaErrorMarkerField)).toEqual({ line: 2, message: 'boom' });
    });

    it('clears the marker when the effect fires with null', () => {
        const initial = EditorState.create({
            doc: 'x',
            extensions: [luaErrorGutter()],
        });
        const set = initial.update({
            effects: setLuaErrorMarkerEffect.of({ line: 1, message: 'oops' }),
        }).state;
        expect(set.field(luaErrorMarkerField)).not.toBeNull();
        const clear = set.update({ effects: setLuaErrorMarkerEffect.of(null) }).state;
        expect(clear.field(luaErrorMarkerField)).toBeNull();
    });

    it('preserves the marker across unrelated transactions', () => {
        const initial = EditorState.create({
            doc: 'hello',
            extensions: [luaErrorGutter()],
        });
        const set = initial.update({
            effects: setLuaErrorMarkerEffect.of({ line: 1, message: 'boom' }),
        }).state;
        const edited = set.update({ changes: { from: 5, insert: ' world' } }).state;
        expect(edited.field(luaErrorMarkerField)).toEqual({ line: 1, message: 'boom' });
    });

    it('adds a line decoration at the error line and removes it on clear', () => {
        const initial = EditorState.create({
            doc: 'a\nb\nc',
            extensions: [luaErrorGutter()],
        });
        expect(decoCountFor(initial)).toBe(0);

        const set = initial.update({
            effects: setLuaErrorMarkerEffect.of({ line: 2, message: 'boom' }),
        }).state;
        expect(decoCountFor(set)).toBe(1);

        const cleared = set.update({ effects: setLuaErrorMarkerEffect.of(null) }).state;
        expect(decoCountFor(cleared)).toBe(0);
    });

    it('drops the line decoration when the marker line is past the doc end', () => {
        const initial = EditorState.create({
            doc: 'only one line',
            extensions: [luaErrorGutter()],
        });
        const set = initial.update({
            effects: setLuaErrorMarkerEffect.of({ line: 99, message: 'out of range' }),
        }).state;
        expect(decoCountFor(set)).toBe(0);
    });
});
