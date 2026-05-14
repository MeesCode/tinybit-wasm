import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useSketchStore } from '../state/sketchStore';
import { useConsoleStore } from '../state/consoleStore';
import { findScores, type ScoreLink, type Diagnostic } from './scoreLinks';
import { insertNewScoreSnippet, replaceScoreContent } from './scoreSync';
import { ScoreEditor } from './ScoreEditor';
import { ScorePreview } from './ScorePreview';
import { countAbc, noteStatus, voiceStatus, MUSIC_MAX_NOTES, MAX_VOICES, type CountStatus } from './abcCounts';
import type { Preview } from '../engine/preview';
import { HelpButton } from '../info/HelpButton';
import { AbcInfoModal } from '../info/AbcInfoModal';

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
const editorPaneStyle: CSSProperties = { height: '100%', minHeight: 0, overflow: 'hidden' };
const previewPaneStyle: CSSProperties = { height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const splitHandle: CSSProperties = { background: '#ECECF0', width: '100%', height: 4, cursor: 'row-resize' };
const transportBar: CSSProperties = {
    padding: '6px 8px', display: 'flex', gap: 6,
    borderTop: '1px solid #ECECF0', background: '#FAFAFA',
    flex: '0 0 auto',
    alignItems: 'center',
};
const COUNT_COLORS: Record<CountStatus, { color: string; background: string; border: string }> = {
    ok:   { color: '#6B6B76', background: '#FFFFFF', border: '#ECECF0' },
    warn: { color: '#92400E', background: '#FEF3C7', border: '#FBBF24' },  // amber
    over: { color: '#FFFFFF', background: '#DC2626', border: '#B91C1C' },  // red
};
function countBadgeStyle(status: CountStatus): CSSProperties {
    const c = COUNT_COLORS[status];
    return {
        marginLeft: 'auto', // pushes first badge to the right edge; subsequent badges keep their own marginLeft
        padding: '3px 8px', fontSize: 11, fontWeight: 600,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        borderRadius: 4,
        color: c.color, background: c.background, border: '1px solid ' + c.border,
    };
}
function countBadgeFollowerStyle(status: CountStatus): CSSProperties {
    return { ...countBadgeStyle(status), marginLeft: 4 };
}
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

function diagSignature(d: Diagnostic): string {
    if (d.kind === 'duplicate-name') return `dup:${d.name}@${d.line}`;
    return `unbound@${d.line}`;
}

export interface ScoreTabProps {
    preview: Preview;
    previewAvailable: boolean;
    selectedLinkId?: string;
    onSelectLink?(id: string | null): void;
    // Called immediately before the preview pump starts. The host should tear
    // down any running game cartridge so the engine's audio channels aren't
    // driven from two pumps simultaneously.
    onBeforePreview?(): void;
}

const DEBOUNCE_MS = 300;

export function ScoreTab({ preview, previewAvailable, selectedLinkId: controlledId, onSelectLink, onBeforePreview }: ScoreTabProps) {
    const script = useSketchStore((s) => s.script);
    const setScript = useSketchStore((s) => s.setScript);
    const consoleAppend = useConsoleStore((s) => s.append);
    const { links, diagnostics } = useMemo(() => findScores(script), [script]);

    // Surface parse-time diagnostics into the editor console exactly once per
    // distinct diagnostic set (otherwise every keystroke would re-log).
    const lastDiagSigRef = useRef<string>('');
    useEffect(() => {
        const sig = diagnostics.map(diagSignature).join('|');
        if (sig === lastDiagSigRef.current) return;
        lastDiagSigRef.current = sig;
        for (const d of diagnostics) consoleAppend('warn', d.message);
    }, [diagnostics, consoleAppend]);

    const [helpOpen, setHelpOpen] = useState(false);
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
                consoleAppend('warn', `Score writeback dropped: ${result.error}`);
                return;
            }
            setScript(result.script);
        }, DEBOUNCE_MS);
    }, [selectedLink, flushTimer, setScript, consoleAppend]);

    // Flushes any pending debounced writeback to the script *synchronously*.
    // Called before mutations that would otherwise drop the in-flight edit
    // (e.g. inserting a new score while the user is mid-keystroke).
    const flushWriteback = useCallback(() => {
        if (writebackTimer.current == null || !selectedLink) {
            flushTimer();
            return;
        }
        flushTimer();
        const r = replaceScoreContent(useSketchStore.getState().script, selectedLink, buffer);
        if ('error' in r) {
            consoleAppend('warn', `Score writeback dropped: ${r.error}`);
            return;
        }
        setScript(r.script);
    }, [selectedLink, buffer, flushTimer, setScript, consoleAppend]);

    const handleNewScore = useCallback(() => {
        flushWriteback();
        // TODO: thread the script-editor cursor through here so the snippet
        // can land at the cursor instead of always appending at EOF.
        const current = useSketchStore.getState().script;
        const { script: newScript, newLink } = insertNewScoreSnippet(current, current.length, 'music');
        setScript(newScript);
        setSelected(newLink.id);
    }, [flushWriteback, setScript, setSelected]);

    const handlePlay = useCallback(async () => {
        if (!selectedLink) return;
        onBeforePreview?.();
        try { await preview.music(buffer); }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            consoleAppend('error', `Score preview failed: ${msg}`);
        }
    }, [preview, selectedLink, buffer, consoleAppend, onBeforePreview]);

    const handleStop = useCallback(() => { preview.stop(); }, [preview]);

    const counts = useMemo(() => countAbc(buffer), [buffer]);
    const nStatus = noteStatus(counts.notes, 'music');
    const vStatus = voiceStatus(counts.voices);

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
                <HelpButton onClick={() => setHelpOpen(true)} aria-label="ABC notation help" style={{ marginLeft: 4 }} />
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
                    <PanelGroup direction="vertical" style={{ flex: 1, minHeight: 0 }} autoSaveId="tinybit-score-split">
                        <Panel defaultSize={50} minSize={15}>
                            <div style={editorPaneStyle}>
                                <ScoreEditor value={buffer} onChange={handleChange} />
                            </div>
                        </Panel>
                        <PanelResizeHandle style={splitHandle} />
                        <Panel defaultSize={50} minSize={15}>
                            <div style={previewPaneStyle}>
                                <ScorePreview abc={buffer} />
                            </div>
                        </Panel>
                    </PanelGroup>
                    <div style={transportBar}>
                        <button type="button" style={transportBtn(!previewAvailable)} disabled={!previewAvailable}
                            onClick={handlePlay} aria-label="play">▶ Play</button>
                        <button type="button" style={transportBtn(false)}
                            onClick={handleStop} aria-label="stop">⏹ Stop</button>
                        {!previewAvailable && <span style={{ fontSize: 11, color: '#6B6B76', alignSelf: 'center' }}>Preview requires rebuilding the WASM</span>}
                        <span
                            style={countBadgeStyle(nStatus)}
                            title={nStatus === 'over' ? `Over engine limit of ${MUSIC_MAX_NOTES} notes per voice` : `Notes (max ${MUSIC_MAX_NOTES} per voice)`}>
                            {counts.notes}/{MUSIC_MAX_NOTES} notes
                        </span>
                        <span
                            style={countBadgeFollowerStyle(vStatus)}
                            title={vStatus === 'over' ? `Over engine limit of ${MAX_VOICES} voices` : `Voices (max ${MAX_VOICES})`}>
                            {counts.voices}/{MAX_VOICES} voices
                        </span>
                    </div>
                </>
            )}
            <AbcInfoModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
    );
}
