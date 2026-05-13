import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { findScores, type ScoreLink } from './scoreLinks';

export type ScorePickCallback = (linkId: string) => void;

// Returns true if `pos` lies anywhere in the link's footprint: the `--@score`
// annotation line, the opener, the literal content, and the closer. This makes
// the popup discoverable by hovering on the annotation comment itself, not
// only on the score body.
function isInLinkFootprint(script: string, pos: number, link: ScoreLink): boolean {
    if (pos >= link.openerRange.from && pos < link.closerRange.to) return true;
    // The annotation comment line: scan backward to the line start, then check
    // if the line index matches link.annotationLine.
    const lineStart = script.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = script.indexOf('\n', pos);
    const lineNumber = (script.slice(0, lineStart).match(/\n/g)?.length ?? 0) + 1;
    void lineEnd;
    return lineNumber === link.annotationLine;
}

export function scoreHoverTooltip(onPick: ScorePickCallback) {
    return hoverTooltip(
        (view, pos): Tooltip | null => {
            const script = view.state.doc.toString();
            const { links } = findScores(script);
            const hit = links.find((l) => isInLinkFootprint(script, pos, l));
            if (!hit) return null;
            const label = hit.name
                ? `Edit "${hit.name}" in Score tab`
                : `Edit (anon @ line ${hit.annotationLine}) in Score tab`;
            return {
                pos: hit.openerRange.from,
                above: true,
                create: () => {
                    const dom = document.createElement('button');
                    dom.type = 'button';
                    dom.className = 'cm-score-tooltip';
                    dom.textContent = '🎵 ' + label;
                    Object.assign(dom.style, {
                        padding:      '6px 12px',
                        background:   '#ED225D',
                        color:        '#FFFFFF',
                        fontSize:     '12px',
                        fontWeight:   '600',
                        border:       'none',
                        borderRadius: '6px',
                        boxShadow:    '0 2px 6px rgba(0,0,0,0.25)',
                        cursor:       'pointer',
                        whiteSpace:   'nowrap',
                    } as CSSStyleDeclaration);
                    dom.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        onPick(hit.id);
                    });
                    return { dom };
                },
            };
        },
        { hoverTime: 100, hideOnChange: true },
    );
}

// Exposed for tests; do not import from production code.
export function __forTest_clickHandler(onPick: ScorePickCallback) {
    return (id: string) => onPick(id);
}
