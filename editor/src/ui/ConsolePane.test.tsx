import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConsolePane } from './ConsolePane';
import { useConsoleStore } from '../state/consoleStore';

beforeEach(() => useConsoleStore.getState().clear());

describe('ConsolePane', () => {
    test('renders lines from the console store', () => {
        useConsoleStore.getState().append('log', 'hello world');
        useConsoleStore.getState().append('error', 'boom');
        render(<ConsolePane />);
        expect(screen.getByText('hello world')).toBeInTheDocument();
        expect(screen.getByText('boom')).toBeInTheDocument();
    });

    test('toggling a filter chip hides matching lines', async () => {
        useConsoleStore.getState().append('warn', 'careful');
        useConsoleStore.getState().append('error', 'boom');
        render(<ConsolePane />);
        await userEvent.click(screen.getByRole('button', { name: /warn/i }));
        expect(screen.queryByText('careful')).not.toBeInTheDocument();
        expect(screen.getByText('boom')).toBeInTheDocument();
    });

    test('Clear empties the visible list', async () => {
        useConsoleStore.getState().append('log', 'first');
        render(<ConsolePane />);
        await userEvent.click(screen.getByRole('button', { name: /clear/i }));
        expect(screen.queryByText('first')).not.toBeInTheDocument();
    });
});
