import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection, keymap, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { luaLang } from './luaSupport';
import { luaErrorHighlight, setLuaErrorMarkerEffect, type LuaErrorMarkerData } from './luaErrorHighlight';

const bubblegum = HighlightStyle.define([
    { tag: t.keyword,  color: '#ED225D', fontWeight: '600' },
    { tag: t.string,   color: '#16A34A' },
    { tag: t.number,   color: '#D97706' },
    { tag: t.comment,  color: '#A0A0AA', fontStyle: 'italic' },
    { tag: t.variableName, color: '#2563EB' },
    { tag: t.operator, color: '#181820' },
    { tag: t.bracket,  color: '#181820' },
]);

const editorTheme = EditorView.theme({
    '&': { height: '100%', backgroundColor: '#fff', color: '#181820' },
    '.cm-content': { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '13px', padding: '8px 0' },
    '.cm-gutters': { backgroundColor: '#FAFAFA', color: '#A0A0AA', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#FDE4EF44' },
    '.cm-activeLineGutter': { backgroundColor: '#FDE4EF88', color: '#ED225D' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#FDE4EF !important' },
    '.cm-cursor': { borderLeftColor: '#ED225D', borderLeftWidth: '2px' },
}, { dark: false });

export interface CodeEditorProps {
    value: string;
    onChange(v: string): void;
    extraExtensions?: Extension[];
    luaErrorMarker?: LuaErrorMarkerData | null;
}

export function CodeEditor({ value, onChange, extraExtensions, luaErrorMarker }: CodeEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!hostRef.current) return;
        const state = EditorState.create({
            doc: value,
            extensions: [
                lineNumbers(),
                foldGutter(),
                drawSelection({ cursorBlinkRate: 1000 }),
                highlightSpecialChars(),
                history(),
                indentOnInput(),
                bracketMatching(),
                luaLang(),
                luaErrorHighlight(),
                syntaxHighlighting(bubblegum),
                editorTheme,
                EditorState.allowMultipleSelections.of(true),
                EditorView.clickAddsSelectionRange.of((e) => e.ctrlKey || e.metaKey),
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) onChangeRef.current(u.state.doc.toString());
                }),
                EditorView.contentAttributes.of({ 'aria-label': 'TinyBit Lua script editor' }),
                ...(extraExtensions ?? []),
            ],
        });
        const view = new EditorView({ state, parent: hostRef.current });
        viewRef.current = view;
        return () => { view.destroy(); viewRef.current = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== value) {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        }
    }, [value]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: setLuaErrorMarkerEffect.of(luaErrorMarker ?? null) });
    }, [luaErrorMarker]);

    return <div ref={hostRef} style={{ height: '100%', overflow: 'hidden' }} />;
}
