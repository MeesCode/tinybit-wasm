import { useEffect, useRef, useState, type CSSProperties } from 'react';

type RenderAbc = (target: HTMLElement, abc: string, options?: Record<string, unknown>) => unknown;

const outerWrap: CSSProperties = {
    display: 'flex', flexDirection: 'column',
    height: '100%', minHeight: 0,
};
const previewHost: CSSProperties = {
    flex: 1, minHeight: 0,
    background: '#FFFFFF',
    overflow: 'auto',
    padding: '6px 8px',
};
const errorBand: CSSProperties = {
    background: '#FEF2F2',
    color: '#B91C1C',
    border: '1px solid #FCA5A5',
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    margin: '6px 8px',
    borderRadius: 4,
};

export interface ScorePreviewProps {
    abc: string;
}

export function ScorePreview({ abc }: ScorePreviewProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [renderAbc, setRenderAbc] = useState<RenderAbc | null>(null);

    useEffect(() => {
        let cancelled = false;
        // Lazy-import abcjs so the script-only path isn't bloated.
        import('abcjs')
            .then((mod) => {
                if (cancelled) return;
                const fn: RenderAbc | undefined =
                    (mod as { renderAbc?: RenderAbc }).renderAbc ??
                    ((mod as { default?: { renderAbc?: RenderAbc } }).default?.renderAbc);
                if (!fn) {
                    setError('abcjs module did not expose renderAbc');
                    return;
                }
                setRenderAbc(() => fn);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!renderAbc || !hostRef.current) return;
        setError(null);
        try {
            renderAbc(hostRef.current, abc, { responsive: 'resize' });
        } catch (err) {
            hostRef.current.innerHTML = '';
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [renderAbc, abc]);

    return (
        <div style={outerWrap}>
            {error && <div style={errorBand}>{error}</div>}
            <div ref={hostRef} style={previewHost} aria-label="rendered score" />
        </div>
    );
}
