import { useEffect, useRef, useState, type CSSProperties } from 'react';

type RenderAbc = (target: HTMLElement, abc: string, options?: Record<string, unknown>) => unknown;

const outerWrap: CSSProperties = { display: 'block', margin: '6px 0' };
const errorBand: CSSProperties = {
    background: '#FEF2F2', color: '#B91C1C',
    border: '1px solid #FCA5A5', borderRadius: 4,
    padding: '4px 8px', fontSize: 11,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
};

export interface MiniScoreProps {
    abc: string;
}

export function MiniScore({ abc }: MiniScoreProps) {
    const targetRef = useRef<HTMLDivElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [renderAbc, setRenderAbc] = useState<RenderAbc | null>(null);

    useEffect(() => {
        let cancelled = false;
        import('abcjs')
            .then((mod) => {
                if (cancelled) return;
                const fn: RenderAbc | undefined =
                    (mod as { renderAbc?: RenderAbc }).renderAbc ??
                    ((mod as { default?: { renderAbc?: RenderAbc } }).default?.renderAbc);
                if (!fn) { setError('abcjs module did not expose renderAbc'); return; }
                setRenderAbc(() => fn);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : String(err));
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!renderAbc || !targetRef.current) return;
        setError(null);
        try {
            renderAbc(targetRef.current, abc, { staffwidth: 320, scale: 0.9 });
        } catch (err) {
            targetRef.current.innerHTML = '';
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [renderAbc, abc]);

    return (
        <div style={outerWrap}>
            {error && <div style={errorBand}>{error}</div>}
            <div ref={targetRef} aria-label="example score" />
        </div>
    );
}
