import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './App';

test('renders toolbar brand', () => {
    render(<App />);
    expect(screen.getByText('tinybit')).toBeInTheDocument();
});

test('opens the Script API modal when the ? button on the script tab is clicked', () => {
    render(<App />);
    const helpBtn = screen.getByRole('button', { name: /script api help/i });
    fireEvent.click(helpBtn);
    // InfoModal renders via createPortal into document.body; screen.getByText still finds it.
    expect(screen.getByText('Script API')).toBeInTheDocument();
});
