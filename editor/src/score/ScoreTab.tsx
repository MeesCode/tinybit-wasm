import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSketchStore } from '../state/sketchStore';
import { findScores, type ScoreLink } from './scoreLinks';
import { insertNewScoreSnippet, replaceScoreContent } from './scoreSync';
import { ScoreEditor } from './ScoreEditor';
import { ScorePreview } from './ScorePreview';
import type { Preview } from '../engine/preview';

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 };
const chipBar: CSSProperties = {
    display: 'flex', flexWrap: 'wrap', gap: 4,
    padding: '6px 8px', borderBottom: '1px solid #ECECF0', background: '#FAFAFA',
    alignItems: 'center',
};
function chipStyle(active: boolean): CSSProperties {
    return {
        padding: '3px 8px', fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
        borderRadius: 999, border: '1px solid ' + (active ? '#ED225D' : '#ECECF0'),
        background: active ? '#FDE4EF' : '#FFFFFF', color: active ? '#ED225D' : '#181820',
        cursor: 'pointer',
    };
}
const newScoreBtn: CSSProperties = {
    marginLeft: 'auto', padding: '3px 10px', fontSize: 11, fontWeight: 600,
    borderRadius: 999, border: '1px solid #ED225D',
    background: '#ED225D', color: '#FFFFFF', cursor: 'pointer',
};
const editorWrap: CSSProperties = { flex: 1, minHeight: 0, borderBottom: '1px solid #ECECF0' };
const previewWrap: CSSProperties = { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const transportBar: CSSProperties = { padding: '6px 8px', display: 'flex', gap: 6, borderTop: '1px solid #ECECF0', background: '#FAFAFA' };
const transportBtn = (disabled: boolean): CSSProperties => ({
    padding: '4px 10px', fontSize: 12, fontWeight: 600,
    borderRadius: 4, border: '1px solid #ED225D',
    background: disabled ? '#FDE4EF' : '#ED225D', color: disabled ? '#ED225D' : '#FFFFFF',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
});
const banner: CSSProperties = {
    padding: '8px 10px', background: '#FEF2F2', color: '#B91C1C', fontSize: 12,
    borderBottom: '1px solid #FCA5A5',
};
const emptyState: CSSProperties = {
    flex: 1, display: 'grid', placeItems: 'center', color: '#6B6B76', fontSize: 13, padding: 20, textAlign: 'center',
};

export interface ScoreTabProps {
    preview: Preview;
    previewAvailable: boolean;
    selectedLinkId?: string;
    onSelectLink?(id: string | null): void;
}

const DEBOUNCE_MS = 300;

export function ScoreTab({ preview, previewAvailable, selectedLinkId: controlledId, onSelectLink }: ScoreTabProps) {
    const script = useSketchStore((s) => s.script);
    const setScript = useSketchStore((s) => s.setScript);
    const { links } = useMemo(() => findScores(script), [script]);

    const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
    const selectedId = controlledId ?? internalSelectedId;
    const setSelected = useCallback((id: string | null) => {
        if (onSelectLink) onSelectLink(id);
        else setInternalSelectedId(id);
    }, [onSelectLink]);

    // Auto-select the first link if none is selected.
    useEffect(() => {
        if (!selectedId && links.length > 0) setSelected(links[0].id);
    }, [selectedId, links, setSelected]);

    const selectedLink = links.find((l) => l.id === selectedId) ?? null;

    // Local buffer for low-latency typing; flushed to sketchStore on a debounce.
    const [buffer, setBuffer] = useState<string>(selectedLink?.content ?? '');
    const writebackTimer = useRef<number | null>(null);

    // When the selected link changes (or its underlying content changes externally), reset the buffer.
    const adoptedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!selectedLink) { setBuffer(''); adoptedKeyRef.current = null; return; }
        const key = `${selectedLink.id}@${selectedLink.contentRange.from}-${selectedLink.contentRange.to}`;
        if (adoptedKeyRef.current !== key) {
            setBuffer(selectedLink.content);
            adoptedKeyRef.current = key;
        }
    }, [selectedLink]);

    const flushTimer = useCallback(() => {
        if (writebackTimer.current != null) {
            window.clearTimeout(writebackTimer.current);
            writebackTimer.current = null;
        }
    }, []);
    useEffect(() => () => flushTimer(), [flushTimer]);

    const handleChange = useCallback((next: string) => {
        setBuffer(next);
        if (!selectedLink) return;
        flushTimer();
        writebackTimer.current = window.setTimeout(() => {
            const result = replaceScoreContent(useSketchStore.getState().script, selectedLink, next);
            if ('error' in result) {
                // eslint-disable-next-line no-console
                console.warn(`[score] writeback dropped (${result.error})`);
                return;
            }
            setScript(result.script);
        }, DEBOUNCE_MS);
    }, [selectedLink, flushTimer, setScript]);

    const handleNewScore = useCallback(() => {
        flushTimer();
        const current = useSketchStore.getState().script;
        const { script: newScript, newLink } = insertNewScoreSnippet(current, current.length);
        setScript(newScript);
        setSelected(newLink.id);
    }, [flushTimer, setScript, setSelected]);

    const handlePlay = useCallback(() => {
        if (!selectedLink) return;
        try { preview.music(buffer); }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error('[score] preview failed:', err);
        }
    }, [preview, selectedLink, buffer]);

    const handleStop = useCallback(() => { preview.stop(); }, [preview]);

    const linkStale = selectedId != null && !selectedLink;

    return (
        <div style={wrap}>
            <div style={chipBar}>
                {links.length === 0
                    ? <span style={{ color: '#6B6B76', fontSize: 12 }}>No scores yet.</span>
                    : links.map((l: ScoreLink) => (
                        <button key={l.id}
                            type="button"
                            style={chipStyle(l.id === selectedId)}
                            onClick={() => setSelected(l.id)}>
                            {l.name ?? `(anon @ line ${l.annotationLine})`}
                        </button>
                    ))}
                <button type="button" style={newScoreBtn} onClick={handleNewScore}>+ New score</button>
            </div>
            {linkStale && (
                <div style={banner}>
                    This score is no longer linked to the script. Pick another score, or click + New score.
                </div>
            )}
            {!selectedLink && !linkStale && links.length === 0 && (
                <div style={emptyState}>
                    Click <b>+ New score</b> to insert a starter ABC score into your script.
                </div>
            )}
            {selectedLink && (
                <>
                    <div style={editorWrap}>
                        <ScoreEditor value={buffer} onChange={handleChange} />
                    </div>
                    <div style={previewWrap}>
                        <ScorePreview abc={buffer} />
                        <div style={transportBar}>
                            <button type="button" style={transportBtn(!previewAvailable)} disabled={!previewAvailable}
                                onClick={handlePlay} aria-label="play">▶ Play</button>
                            <button type="button" style={transportBtn(false)}
                                onClick={handleStop} aria-label="stop">⏹ Stop</button>
                            {!previewAvailable && <span style={{ fontSize: 11, color: '#6B6B76', alignSelf: 'center' }}>Preview requires rebuilding the WASM</span>}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
