import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MeterFooter } from './MeterFooter';

function bar() {
    return screen.getByTestId('meter-bar');
}

describe('MeterFooter', () => {
    it('shows label + used/cap in KB with one decimal at 50%', () => {
        render(<MeterFooter label="Script" used={16_310} cap={32_621} mode="light" />);
        expect(screen.getByText('Script')).toBeInTheDocument();
        expect(screen.getByText('15.9 / 31.9 KB')).toBeInTheDocument();
        expect(bar().getAttribute('aria-label')).toMatch(/50%/);
    });

    it('uses bytes when used < 1024', () => {
        render(<MeterFooter label="Script" used={423} cap={32_621} mode="light" />);
        // cap drives the unit; readout uses the cap's unit on both sides
        expect(screen.getByText('0.4 / 31.9 KB')).toBeInTheDocument();
    });

    it('colours the bar green below 75%', () => {
        render(<MeterFooter label="Script" used={1_000} cap={32_621} mode="light" />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.backgroundColor).toBe('rgb(22, 163, 74)');     // #16A34A
    });

    it('colours the bar yellow between 75% and 90%', () => {
        render(<MeterFooter label="Script" used={26_500} cap={32_621} mode="light" />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.backgroundColor).toBe('rgb(234, 179, 8)');     // #EAB308
    });

    it('colours the bar red at or above 90%', () => {
        render(<MeterFooter label="Script" used={30_000} cap={32_621} mode="light" />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.backgroundColor).toBe('rgb(220, 38, 38)');     // #DC2626
    });

    it('renders overflow state: bar capped at 100% in red, readout prefixed with warning', () => {
        render(<MeterFooter label="Script" used={40_000} cap={32_621} mode="light" overflow />);
        const fill = bar().querySelector('[data-testid="meter-fill"]') as HTMLElement;
        expect(fill.style.width).toBe('100%');
        expect(fill.style.backgroundColor).toBe('rgb(220, 38, 38)');
        expect(screen.getByText(/⚠/)).toBeInTheDocument();
    });

    it('renders idle state with dim "— idle" label and no numbers', () => {
        render(<MeterFooter label="Lua heap" used={null} cap={262_144} mode="dark" />);
        expect(screen.getByText(/Lua heap — idle/)).toBeInTheDocument();
        expect(screen.queryByText(/KB/)).toBeNull();
    });

    it('renders the custom idleText (e.g. "unavailable") when provided', () => {
        render(<MeterFooter label="Lua heap" used={null} cap={262_144} mode="dark" idleText="unavailable" />);
        expect(screen.getByText(/Lua heap — unavailable/)).toBeInTheDocument();
    });
});
