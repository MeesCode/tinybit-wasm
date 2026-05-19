import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';

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
    ];
}
