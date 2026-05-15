import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryModal } from './GalleryModal';
import type { GalleryEntry, GalleryFailure } from '../state/gallery';

function entry(overrides: Partial<GalleryEntry> = {}): GalleryEntry {
    return {
        id: 'a.tb.png', filename: 'a.tb.png',
        title: 'Alpha', author: 'A',
        coverUrl: 'data:image/png;base64,AAAA',
        cartridge: new Uint8Array(),
        ...overrides,
    };
}

describe('GalleryModal', () => {
    test('renders nothing when closed', () => {
        const { container } = render(
            <GalleryModal open={false} state={{ kind: 'loading' }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    test('renders a loading message when state is loading', () => {
        render(
            <GalleryModal open state={{ kind: 'loading' }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    test('renders an error message when state is error', () => {
        render(
            <GalleryModal open state={{ kind: 'error', message: 'boom' }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText(/boom/)).toBeInTheDocument();
    });

    test('renders the empty-folder message when ready with no entries or failures', () => {
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText(/no cartridges in/i)).toBeInTheDocument();
        expect(screen.getByText(/editor\/src\/cartridges/i)).toBeInTheDocument();
    });

    test('renders one card per entry with title and author', () => {
        render(
            <GalleryModal
                open
                state={{ kind: 'ready',
                    entries: [entry({ title: 'Alpha', author: 'A' }), entry({ id: 'b', filename: 'b.tb.png', title: 'Beta', author: 'B' })],
                    failures: [],
                }}
                onPick={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: /alpha/i })).toBeInTheDocument();
        expect(screen.getByText('A')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /beta/i })).toBeInTheDocument();
        expect(screen.getByText('B')).toBeInTheDocument();
    });

    test('clicking a card calls onPick with that entry', async () => {
        const onPick = vi.fn();
        const e = entry({ id: 'a', title: 'Alpha', author: 'A' });
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [e], failures: [] }} onPick={onPick} onCancel={() => {}} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /alpha/i }));
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick).toHaveBeenCalledWith(e);
    });

    test('failure cards render filename and error message and are not buttons', () => {
        const failures: GalleryFailure[] = [{ id: 'bad', filename: 'bad.tb.png', message: 'corrupt' }];
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures }} onPick={() => {}} onCancel={() => {}} />,
        );
        expect(screen.getByText('bad.tb.png')).toBeInTheDocument();
        expect(screen.getByText(/corrupt/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /bad/ })).toBeNull();
    });

    test('Cancel button calls onCancel', async () => {
        const onCancel = vi.fn();
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onCancel={onCancel} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    test('Escape key calls onCancel', async () => {
        const onCancel = vi.fn();
        render(
            <GalleryModal open state={{ kind: 'ready', entries: [], failures: [] }} onPick={() => {}} onCancel={onCancel} />,
        );
        await userEvent.keyboard('{Escape}');
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
