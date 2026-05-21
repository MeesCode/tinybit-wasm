import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileGate } from './MobileGate';
import { MOBILE_OPT_OUT_KEY } from './mobileOptOut';

interface StubMql {
    matches: boolean;
    listeners: Array<(e: MediaQueryListEvent) => void>;
}

function stubMatchMedia(initial: boolean): StubMql {
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

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    sessionStorage.clear();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('MobileGate', () => {
    test('renders children when viewport is wide', () => {
        stubMatchMedia(false);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.getByText('editor-content')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });

    test('renders MobileLanding (not children) when viewport is narrow and no opt-out', () => {
        stubMatchMedia(true);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.getByRole('button', { name: /play games/i })).toBeInTheDocument();
        expect(screen.queryByText('editor-content')).not.toBeInTheDocument();
    });

    test('renders children when viewport is narrow but opt-out flag is set', () => {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, '1');
        stubMatchMedia(true);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.getByText('editor-content')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });

    test('clicking "Open editor anyway" writes the flag and reveals the editor', async () => {
        stubMatchMedia(true);
        render(<MobileGate><div>editor-content</div></MobileGate>);
        expect(screen.queryByText('editor-content')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /open editor anyway/i }));
        expect(sessionStorage.getItem(MOBILE_OPT_OUT_KEY)).toBe('1');
        expect(screen.getByText('editor-content')).toBeInTheDocument();
    });
});
