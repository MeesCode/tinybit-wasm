import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerGallery } from './PlayerGallery';
import type { GalleryEntry } from '../state/gallery';

function entry(id: string, title: string): GalleryEntry {
    return {
        id, filename: `${id}.tb.png`, title, author: 'me',
        coverUrl: `data:,${id}`, cartridge: new Uint8Array(0),
    };
}

describe('PlayerGallery', () => {
    test('renders a card per entry; pick fires callback', async () => {
        const onPick = vi.fn();
        const onBack = vi.fn();
        render(
            <PlayerGallery
                state={{ kind: 'ready', entries: [entry('a', 'Alpha'), entry('b', 'Beta')], failures: [] }}
                onPick={onPick}
                onBack={onBack}
            />,
        );
        expect(screen.getByText(/Alpha/)).toBeInTheDocument();
        expect(screen.getByText(/Beta/)).toBeInTheDocument();
        await userEvent.click(screen.getByText(/Alpha/));
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    });

    test('shows loading state', () => {
        render(<PlayerGallery state={{ kind: 'loading' }} onPick={() => {}} onBack={() => {}} />);
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    test('shows error state', () => {
        render(<PlayerGallery state={{ kind: 'error', message: 'boom' }} onPick={() => {}} onBack={() => {}} />);
        expect(screen.getByText(/boom/i)).toBeInTheDocument();
    });

    test('shows empty hint when ready with zero entries', () => {
        render(<PlayerGallery state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onBack={() => {}} />);
        expect(screen.getByText(/no cartridges/i)).toBeInTheDocument();
    });

    test('back chip fires onBack', async () => {
        const onBack = vi.fn();
        render(<PlayerGallery state={{ kind: 'loading' }} onPick={() => {}} onBack={onBack} />);
        await userEvent.click(screen.getByRole('button', { name: /back/i }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});
