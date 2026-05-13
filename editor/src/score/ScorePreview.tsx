import { useEffect, useRef, useState, type CSSProperties } from 'react';

type RenderAbc = (target: HTMLElement, abc: string, options?: Record<string, unknown>) => unknown;

const outerWrap: CSSProperties = {
    display: 'flex', flexDirection: 'column',
    height: '100%', minHeight: 0,
};
// The scrollable host we control. abcjs renders into the *inner* div so its
// inline-style overrides (overflow:hidden + height:Hpx, set inside
// set-paper-size.js) don't kill scrolling on this element.
const scrollHost: CSSProperties = {
    flex: 1, minHeight: 0,
    background: '#FFFFFF',
    overflow: 'auto',
    padding: '6px 8px',
};
// The inner target — abcjs sets overflow:hidden + height:Hpx on this. The
// outer scrollHost is constrained by its flex parent, so when H exceeds the
// scrollHost's content height, scrollHost gets a vertical scrollbar.
const abcTarget: CSSProperties = {
    width: '100%',
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
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const targetRef = useRef<HTMLDivElement | null>(null);
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

    // Track the scroll host's width so we can feed staffwidth to abcjs. Without
    // a staffwidth, abcjs uses its default (~740px) which usually overflows our
    // preview pane horizontally and avoids wrapping (so the score stays one
    // line tall and never triggers vertical overflow).
    const [hostWidth, setHostWidth] = useState(0);
    useEffect(() => {
        const el = scrollRef.current;
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
        if (!renderAbc || !targetRef.current) return;
        setError(null);
        try {
            const opts: Record<string, unknown> = { scale: 1 };
            if (hostWidth > 40) opts.staffwidth = hostWidth - 32;
            renderAbc(targetRef.current, abc, opts);
        } catch (err) {
            targetRef.current.innerHTML = '';
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [renderAbc, abc, hostWidth]);

    return (
        <div style={outerWrap}>
            {error && <div style={errorBand}>{error}</div>}
            <div ref={scrollRef} style={scrollHost} aria-label="rendered score">
                <div ref={targetRef} style={abcTarget} />
            </div>
        </div>
    );
}
