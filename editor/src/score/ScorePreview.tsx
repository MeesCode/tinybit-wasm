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

    // Track the container width so we can pass a staffwidth to abcjs. We avoid
    // `responsive: 'resize'` because it fits the SVG to the container in both
    // dimensions, defeating vertical scrolling on tall scores. With an explicit
    // staffwidth the SVG fits horizontally and grows vertically as needed.
    const [hostWidth, setHostWidth] = useState(0);
    useEffect(() => {
        const el = hostRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            for (const e of entries) {
                const w = e.contentRect.width;
                if (w > 0) setHostWidth(Math.floor(w));
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (!renderAbc || !hostRef.current) return;
        setError(null);
        try {
            const opts: Record<string, unknown> = { scale: 1 };
            if (hostWidth > 40) opts.staffwidth = hostWidth - 32;  // subtract padding for breathing room
            renderAbc(hostRef.current, abc, opts);
        } catch (err) {
            hostRef.current.innerHTML = '';
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [renderAbc, abc, hostWidth]);

    return (
        <div style={outerWrap}>
            {error && <div style={errorBand}>{error}</div>}
            <div ref={hostRef} style={previewHost} aria-label="rendered score" />
        </div>
    );
}
