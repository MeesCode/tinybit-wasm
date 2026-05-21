import { useEffect, useState } from 'react';

export const NARROW_BREAKPOINT_PX = 720;
const QUERY = `(max-width: ${NARROW_BREAKPOINT_PX}px)`;

function readInitial(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
}

export function useIsNarrowViewport(): boolean {
    const [narrow, setNarrow] = useState<boolean>(readInitial);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(QUERY);
        const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return narrow;
}
