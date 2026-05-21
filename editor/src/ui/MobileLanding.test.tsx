import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileLanding } from './MobileLanding';

const originalLocation = window.location;

afterEach(() => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
    });
});

describe('MobileLanding', () => {
    test('renders brand, tagline, play CTA, and editor escape link', () => {
        render(<MobileLanding onOpenEditor={() => {}} />);
        expect(screen.getByText('tinybit')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /play games/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /open editor anyway/i })).toBeInTheDocument();
    });

    test('clicking Play navigates to ?play via location.search', async () => {
        const setSearch = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                get search() { return ''; },
                set search(v: string) { setSearch(v); },
            },
        });
        render(<MobileLanding onOpenEditor={() => {}} />);
        await userEvent.click(screen.getByRole('button', { name: /play games/i }));
        expect(setSearch).toHaveBeenCalledWith('?play');
    });

    test('clicking the escape link calls onOpenEditor and does not navigate', async () => {
        const setSearch = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {
                ...originalLocation,
                get search() { return ''; },
                set search(v: string) { setSearch(v); },
            },
        });
        const onOpenEditor = vi.fn();
        render(<MobileLanding onOpenEditor={onOpenEditor} />);
        await userEvent.click(screen.getByRole('button', { name: /open editor anyway/i }));
        expect(onOpenEditor).toHaveBeenCalledTimes(1);
        expect(setSearch).not.toHaveBeenCalled();
    });

    test('marks itself with data-route for E2E targeting', () => {
        const { container } = render(<MobileLanding onOpenEditor={() => {}} />);
        expect(container.querySelector('[data-route="mobile-landing"]')).not.toBeNull();
    });
});
