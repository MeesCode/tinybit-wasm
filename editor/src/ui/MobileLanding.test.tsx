import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileLanding } from './MobileLanding';

const originalLocation = window.location;

function stubLocationSearch(setter: (v: string) => void): void {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
            ...originalLocation,
            get search() { return ''; },
            set search(v: string) { setter(v); },
        },
    });
}

beforeEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
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
        stubLocationSearch(setSearch);
        render(<MobileLanding onOpenEditor={() => {}} />);
        await userEvent.click(screen.getByRole('button', { name: /play games/i }));
        expect(setSearch).toHaveBeenCalledWith('?play');
    });

    test('clicking the escape link calls onOpenEditor and does not navigate', async () => {
        const setSearch = vi.fn();
        stubLocationSearch(setSearch);
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
