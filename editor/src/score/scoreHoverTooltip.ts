import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { findScores } from './scoreLinks';

export type ScorePickCallback = (linkId: string) => void;

export function scoreHoverTooltip(onPick: ScorePickCallback) {
    return hoverTooltip((view, pos): Tooltip | null => {
        const script = view.state.doc.toString();
        const { links } = findScores(script);
        const hit = links.find((l) =>
            pos >= l.contentRange.from && pos <= l.contentRange.to
        );
        if (!hit) return null;
        const label = hit.name ? `Edit "${hit.name}" in Score tab` : `Edit (anon @ line ${hit.annotationLine}) in Score tab`;
        return {
            pos: hit.contentRange.from,
            above: true,
            create: () => {
                const dom = document.createElement('div');
                dom.className = 'cm-score-tooltip';
                dom.style.padding = '4px 8px';
                dom.style.background = '#181820';
                dom.style.color = '#FFFFFF';
                dom.style.fontSize = '11px';
                dom.style.fontWeight = '600';
                dom.style.borderRadius = '4px';
                dom.style.cursor = 'pointer';
                dom.textContent = '✏️ ' + label;
                dom.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    onPick(hit.id);
                });
                return { dom };
            },
        };
    }, { hideOnChange: true });
}

// Exposed for tests; do not import from production code.
export function __forTest_clickHandler(onPick: ScorePickCallback) {
    return (id: string) => onPick(id);
}
