import { describe, test, expect, beforeEach } from 'vitest';
import { useConsoleStore, MAX_LINES, ALL_SOURCES } from './consoleStore';

beforeEach(() => useConsoleStore.getState().clear());

describe('consoleStore', () => {
    test('append adds a line with an incrementing id and ts', () => {
        useConsoleStore.getState().append('log', 'hi');
        const [line] = useConsoleStore.getState().lines;
        expect(line.text).toBe('hi');
        expect(line.source).toBe('log');
        expect(typeof line.id).toBe('number');
        expect(typeof line.ts).toBe('number');
    });

    test('ring-buffers at MAX_LINES', () => {
        const store = useConsoleStore.getState();
        for (let i = 0; i < MAX_LINES + 5; i++) store.append('log', String(i));
        const lines = useConsoleStore.getState().lines;
        expect(lines.length).toBe(MAX_LINES);
        expect(lines[0].text).toBe('5');
        expect(lines[MAX_LINES - 1].text).toBe(String(MAX_LINES + 4));
    });

    test('filters default to all sources on', () => {
        for (const src of ALL_SOURCES) expect(useConsoleStore.getState().filters.has(src)).toBe(true);
    });

    test('setFilter toggles a source', () => {
        useConsoleStore.getState().setFilter('warn', false);
        expect(useConsoleStore.getState().filters.has('warn')).toBe(false);
        useConsoleStore.getState().setFilter('warn', true);
        expect(useConsoleStore.getState().filters.has('warn')).toBe(true);
    });

    test('clear empties lines but keeps filters', () => {
        useConsoleStore.getState().append('log', 'hi');
        useConsoleStore.getState().setFilter('error', false);
        useConsoleStore.getState().clear();
        expect(useConsoleStore.getState().lines).toEqual([]);
        expect(useConsoleStore.getState().filters.has('error')).toBe(false);
    });
});
