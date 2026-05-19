import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { findScores } from './scoreLinks';

export type ScorePickCallback = (linkId: string) => void;

// A small inline widget rendered just after the `--@music` / `--@sfx` annotation comment.
// Clicking it asks the App to switch to the Score tab and select this link.
// Implemented as a persistent decoration rather than a hover tooltip because
// CodeMirror's hoverTooltip dismisses when the cursor leaves the source range,
// making the popup impossible to actually click.
class ScoreEditWidget extends WidgetType {
    constructor(public linkId: string, public label: string, public onPick: ScorePickCallback) { super(); }
    eq(other: ScoreEditWidget) { return other.linkId === this.linkId && other.label === this.label; }
    toDOM() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cm-score-edit';
        btn.textContent = '🎵 ' + this.label;
        Object.assign(btn.style, {
            display:      'inline-block',
            marginLeft:   '8px',
            padding:      '1px 8px',
            background:   '#ED225D',
            color:        '#FFFFFF',
            fontSize:     '10px',
            fontWeight:   '600',
            border:       'none',
            borderRadius: '999px',
            cursor:       'pointer',
            verticalAlign: 'middle',
            boxShadow:    '0 1px 2px rgba(0,0,0,0.15)',
        } as CSSStyleDeclaration);
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.onPick(this.linkId);
        });
        return btn;
    }
    // Allow the widget to receive its own pointer events.
    ignoreEvent() { return false; }
}

function buildDecorations(script: string, onPick: ScorePickCallback): DecorationSet {
    const { links } = findScores(script);
    const builder: { from: number; deco: Decoration }[] = [];
    for (const link of links) {
        // Place the widget at the end of the annotation line.
        const lineEnd = script.indexOf('\n', findLineStart(script, link.annotationLine));
        const pos = lineEnd === -1 ? script.length : lineEnd;
        const label = link.name ? `Edit "${link.name}"` : `Edit (line ${link.annotationLine})`;
        builder.push({
            from: pos,
            deco: Decoration.widget({
                widget: new ScoreEditWidget(link.id, label, onPick),
                side: 1,
            }),
        });
    }
    builder.sort((a, b) => a.from - b.from);
    return Decoration.set(builder.map((b) => b.deco.range(b.from)));
}

function findLineStart(script: string, line: number): number {
    if (line <= 1) return 0;
    let i = 0, n = 1;
    while (i < script.length && n < line) {
        if (script.charCodeAt(i) === 10) n++;
        i++;
    }
    return i;
}

// Effect dispatched on every doc change to refresh decorations.
const refreshEffect = StateEffect.define<DecorationSet>();

export function scoreHoverTooltip(onPick: ScorePickCallback): Extension {
    const field = StateField.define<DecorationSet>({
        create: (state) => buildDecorations(state.doc.toString(), onPick),
        update: (deco, tr) => {
            if (tr.docChanged) return buildDecorations(tr.newDoc.toString(), onPick);
            for (const e of tr.effects) if (e.is(refreshEffect)) return e.value;
            return deco;
        },
        provide: (f) => EditorView.decorations.from(f),
    });
    return field;
}

// Kept for the existing test that imports it.
export function __forTest_clickHandler(onPick: ScorePickCallback) {
    return (id: string) => onPick(id);
}
