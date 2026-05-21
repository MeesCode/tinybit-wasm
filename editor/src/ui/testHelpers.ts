import { vi } from 'vitest';

export interface StubMql {
    matches: boolean;
    listeners: Array<(e: MediaQueryListEvent) => void>;
}

export function stubMatchMedia(initial: boolean): StubMql {
    const stub: StubMql = { matches: initial, listeners: [] };
    const mql = {
        get matches() { return stub.matches; },
        media: '',
        onchange: null,
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            stub.listeners.push(l);
        },
        removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
            const i = stub.listeners.indexOf(l);
            if (i >= 0) stub.listeners.splice(i, 1);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn(() => mql),
    });
    return stub;
}

export function restoreMatchMedia(): void {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
}
