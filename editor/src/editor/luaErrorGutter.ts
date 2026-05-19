import { StateField, StateEffect, RangeSetBuilder, type Extension } from '@codemirror/state';
import { gutter, GutterMarker, Decoration, type DecorationSet, EditorView } from '@codemirror/view';

export interface LuaErrorMarkerData {
    line: number;
    message: string;
}

export const setLuaErrorMarkerEffect = StateEffect.define<LuaErrorMarkerData | null>();

class LuaErrorIconMarker extends GutterMarker {
    constructor(private readonly message: string) { super(); }
    eq(other: GutterMarker) { return other instanceof LuaErrorIconMarker && other.message === this.message; }
    toDOM() {
        const el = document.createElement('div');
        el.className = 'cm-lua-error-marker';
        el.title = this.message;
        el.textContent = '⚠';
        Object.assign(el.style, {
            color: '#DC2626',
            fontSize: '12px',
            lineHeight: '1',
            textAlign: 'center',
            paddingLeft: '2px',
            paddingRight: '2px',
            cursor: 'help',
        } as CSSStyleDeclaration);
        return el;
    }
}

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

export function luaErrorGutter(): Extension {
    return [
        luaErrorMarkerField,
        gutter({
            class: 'cm-lua-error-gutter',
            lineMarker(view, lineInfo) {
                const err = view.state.field(luaErrorMarkerField);
                if (!err) return null;
                const line = view.state.doc.lineAt(lineInfo.from);
                if (line.number !== err.line) return null;
                return new LuaErrorIconMarker(err.message);
            },
        }),
        lineHighlightField,
        lineHighlightTheme,
    ];
}
