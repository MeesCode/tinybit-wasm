import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';
import { MOBILE_OPT_OUT_KEY } from './ui/mobileOptOut';
import { stubMatchMedia, restoreMatchMedia } from './ui/testHelpers';

const originalLocation = window.location;

function setSearch(search: string): void {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, search },
    });
}

beforeEach(() => {
    setSearch('');
    sessionStorage.clear();
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    sessionStorage.clear();
    restoreMatchMedia();
});

describe('App router', () => {
    test('renders the editor by default on a wide viewport', () => {
        stubMatchMedia(false);
        render(<App />);
        expect(screen.getByText('tinybit')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });

    test('renders the player route when ?play is present (wide viewport)', () => {
        stubMatchMedia(false);
        setSearch('?play');
        render(<App />);
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders the player route when ?play=current is present (wide viewport)', () => {
        stubMatchMedia(false);
        setSearch('?play=current');
        render(<App />);
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders MobileLanding on the editor route when viewport is narrow', () => {
        stubMatchMedia(true);
        render(<App />);
        expect(screen.getByRole('button', { name: /play games/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('still renders the player route on ?play even when viewport is narrow', () => {
        stubMatchMedia(true);
        setSearch('?play');
        render(<App />);
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders the editor when narrow but opt-out flag is set', () => {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, '1');
        stubMatchMedia(true);
        render(<App />);
        expect(screen.getByText('tinybit')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /play games/i })).not.toBeInTheDocument();
    });
});
