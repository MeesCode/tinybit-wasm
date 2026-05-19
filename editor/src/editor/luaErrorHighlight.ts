import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

export interface LuaErrorMarkerData {
    line: number;
    message: string;
}

export const setLuaErrorMarkerEffect = StateEffect.define<LuaErrorMarkerData | null>();

export const luaErrorMarkerField = StateField.define<LuaErrorMarkerData | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setLuaErrorMarkerEffect)) return e.value;
        return value;
    },
});

const lineHighlight = Decoration.line({ attributes: { class: 'cm-lua-error-line' } });

const lineHighlightField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
        const prev = tr.startState.field(luaErrorMarkerField, false) ?? null;
        const next = tr.state.field(luaErrorMarkerField);
        if (deco !== Decoration.none && !tr.docChanged && prev === next) return deco;
        if (!next) return Decoration.none;
        const lineCount = tr.state.doc.lines;
        if (next.line < 1 || next.line > lineCount) return Decoration.none;
        const builder = new RangeSetBuilder<Decoration>();
        builder.add(tr.state.doc.line(next.line).from, tr.state.doc.line(next.line).from, lineHighlight);
        return builder.finish();
    },
    provide: (f) => EditorView.decorations.from(f),
});

const lineHighlightTheme = EditorView.theme({
    '.cm-lua-error-line': { backgroundColor: '#FEE2E2' },
    '.cm-activeLine.cm-lua-error-line': { backgroundColor: '#FCA5A5' },
});

export function luaErrorHighlight(): Extension {
    return [luaErrorMarkerField, lineHighlightField, lineHighlightTheme];
}
