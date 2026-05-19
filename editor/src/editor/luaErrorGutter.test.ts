import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { luaErrorGutter, luaErrorMarkerField, setLuaErrorMarkerEffect } from './luaErrorGutter';

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
});
