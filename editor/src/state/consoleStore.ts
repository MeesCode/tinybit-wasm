import { create } from 'zustand';

export type ConsoleSource = 'log' | 'warn' | 'error' | 'engine';
export const ALL_SOURCES: ConsoleSource[] = ['log', 'warn', 'error', 'engine'];
export const MAX_LINES = 1000;

export interface ConsoleLine {
    id: number;
    source: ConsoleSource;
    text: string;
    ts: number;
}

export interface ConsoleState {
    lines: ConsoleLine[];
    filters: Set<ConsoleSource>;
    nextId: number;
    append(source: ConsoleSource, text: string): void;
    clear(): void;
    setFilter(source: ConsoleSource, on: boolean): void;
}

export const useConsoleStore = create<ConsoleState>((set) => ({
    lines: [],
    filters: new Set<ConsoleSource>(ALL_SOURCES),
    nextId: 1,
    append: (source, text) =>
        set((s) => {
            const line: ConsoleLine = { id: s.nextId, source, text, ts: Date.now() };
            const lines = s.lines.length >= MAX_LINES
                ? [...s.lines.slice(s.lines.length - MAX_LINES + 1), line]
                : [...s.lines, line];
            return { lines, nextId: s.nextId + 1 };
        }),
    clear: () => set({ lines: [] }),
    setFilter: (source, on) =>
        set((s) => {
            const filters = new Set(s.filters);
            if (on) filters.add(source);
            else filters.delete(source);
            return { filters };
        }),
}));
