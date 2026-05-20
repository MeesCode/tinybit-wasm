import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

const originalLocation = window.location;

function setSearch(search: string): void {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, search },
    });
}

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('App router', () => {
    beforeEach(() => { setSearch(''); });

    test('renders the editor by default', () => {
        render(<App />);
        // The toolbar brand renders as lowercase "tinybit"; the CodeMirror skeleton
        // script contains "TinyBit" (mixed case), so exact-match avoids ambiguity.
        expect(screen.getByText('tinybit')).toBeInTheDocument();
    });

    test('renders the player route when ?play is present', () => {
        setSearch('?play');
        render(<App />);
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });

    test('renders the player route when ?play=current is present', () => {
        setSearch('?play=current');
        render(<App />);
        expect(screen.queryByRole('button', { name: /clear editor/i })).not.toBeInTheDocument();
    });
});
